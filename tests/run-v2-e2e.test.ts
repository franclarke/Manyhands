import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileGraphRevision } from "@manyhands/decomposer";
import { IntegrationManifestExecutor, JsonIntegrationOperationJournal, createIntegrationRequestManifest } from "@manyhands/execution-core";
import { V2ExecutionDriver, type V2NodeExecutionInput, type V2NodeExecutionOutcome } from "@manyhands/orchestrator-graph";
import { RunCoordinator, RunEventSchema, observeRunParallelism, type RunEvent, type RunEventInput } from "@manyhands/run-coordinator";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const at = "2026-07-18T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("V2 productive run", () => {
  it("materializes declared child artifacts and integrates the exact verified root candidate", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const journal = memoryJournal(compiled.graph.graphId);
    const executed: V2NodeExecutionInput[] = [];
    const driver = new V2ExecutionDriver({
      coordinator: journal.coordinator,
      now: () => at,
      loadCurrentInputs: async () => ({
        graph: compiled.graph,
        contracts: compiled.contracts,
        repositoryContextDigest: "sha256:repository",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" },
        materializableNodeIds: Object.keys(compiled.graph.nodes),
        availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
        conflictConstraints: []
      }),
      execute: async (input) => {
        executed.push(input);
        return success(input, input.node.id === compiled.graph.rootId);
      }
    });

    const state = await driver.run({
      runId: "run-product-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: compiled.graph.baseCommit }
    });

    const root = executed.find((input) => input.node.id === compiled.graph.rootId)!;
    expect(executed.slice(0, 3).every((input) => input.consumedArtifacts.length === 0)).toBe(true);
    expect(root.consumedArtifacts.map((artifact) => artifact.nodeId).sort()).toEqual(["node-api", "node-domain", "node-ui"]);
    expect(root.consumedArtifacts.map((artifact) => artifact.contract)).toEqual(
      expect.arrayContaining(compiled.graph.artifactRequirements
        .filter((requirement) => requirement.consumerNodeId === compiled.graph.rootId)
        .map((requirement) => requirement.artifactContract))
    );
    expect(state.lifecycle).toBe("result_ready");
    expect(state.finalCandidate).toMatchObject({ manifestId: "manifest-final", commit: `commit-${compiled.graph.rootId}` });
    expect(state.evidenceMatrices).toHaveLength(4);
    expect(journal.events().filter((event) => event.type === "wave.selected")).toHaveLength(2);

    // Stage 7's instrument, read off the journal this run actually wrote rather
    // than off hand-built events. A derivation that only ever sees fixtures is
    // how a measurement ends up describing a shape the product never emits.
    const parallelism = observeRunParallelism(journal.events());
    expect(parallelism.unobservedReadinessCount).toBe(0);
    // Three independent leaves under a cap of three: everything the graph
    // offered was taken, so the plan is the ceiling and the cap never bound.
    expect(parallelism.peakAvailable).toBe(3);
    expect(parallelism.peakExecuted).toBe(3);
    expect(parallelism.capBindingObservations).toBe(0);
  });

  it("re-enters the driver after an integration journal takeover without repeating the applied child", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const rootId = compiled.graph.rootId;
    const journal = memoryJournal(compiled.graph.graphId);
    const operationDirectory = await mkdtemp(join(tmpdir(), "mh-v2-takeover-"));
    temporaryDirectories.push(operationDirectory);
    const integrationJournal = new JsonIntegrationOperationJournal(operationDirectory);
    const locations = ["commit-node-api", "commit-node-domain", "commit-node-ui"];
    const resultShas = ["PICK-0", "PICK-1", "PICK-2"];
    const git = new CrashAfterEffectGit({
      heads: { "/wt": "BASE" },
      cherryPickResultShas: resultShas,
      commitMessages: Object.fromEntries([
        ...locations.map((location) => [location, `source ${location}`]),
        ...locations.map((location, index) => [resultShas[index]!, `source ${location}\n\n(cherry picked from commit ${location})`])
      ])
    });
    const driver = new V2ExecutionDriver({
      coordinator: journal.coordinator,
      now: () => at,
      loadCurrentInputs: async () => ({
        graph: compiled.graph,
        contracts: compiled.contracts,
        repositoryContextDigest: "sha256:repository",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" },
        materializableNodeIds: Object.keys(compiled.graph.nodes),
        availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
        conflictConstraints: []
      }),
      execute: async (input) => {
        if (input.node.id !== rootId) return success(input, false);
        const request = createIntegrationRequestManifest({
          runId: input.runId,
          integrationAttemptId: input.attemptId,
          compositeNode: { id: input.node.id, graphRevision: input.graph.revision },
          base: { manifestId: `base:${input.attemptId}`, resultingCommit: "BASE", inputFingerprint: `sha256:${"a".repeat(64)}` },
          availableArtifacts: input.consumedArtifacts.map((artifact) => ({
            schemaVersion: 1 as const,
            artifactId: artifact.artifactId,
            runId: artifact.runId,
            nodeId: artifact.nodeId,
            digest: artifact.digest,
            producerAttemptId: artifact.producerAttemptId,
            contract: artifact.contract,
            kind: "commit" as const,
            location: artifact.location,
            adoptedAt: artifact.adoptedAt
          })),
          requiredArtifactIds: input.consumedArtifacts.map((artifact) => artifact.artifactId),
          seamRevisions: input.contract.seams.map(({ id, revision }) => ({ id, revision })),
          parentGoal: input.contract.task.goal,
          validationContract: { ...input.contract.task.validation },
          outputArtifactContract: { id: input.outputArtifactContract.id, revision: input.outputArtifactContract.revision },
          createdAt: at
        });
        const deps = {
          git,
          validate: async () => ({ matrixId: `matrix-${rootId}`, outcome: "verified" as const }),
          digestCandidate: async () => "digest-root"
        };
        await expect(new IntegrationManifestExecutor(deps).integrate({
          request,
          worktreePath: "/wt",
          integrationOperation: { journal: integrationJournal, runId: input.runId, operationId: "op-1", fencingToken: 1 }
        })).rejects.toThrow("simulated crash");
        const recovered = await new IntegrationManifestExecutor(deps).integrate({
          request,
          worktreePath: "/wt",
          integrationOperation: { journal: integrationJournal, runId: input.runId, operationId: "op-2", fencingToken: 2, allowTakeover: true }
        });
        expect(recovered.disposition).toBe("success");
        return success(input, true, recovered.candidateSha);
      }
    });
    const state = await driver.run({
      runId: "run-product-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: compiled.graph.baseCommit }
    });
    expect(state.lifecycle).toBe("result_ready");
    expect(git.calls.filter((call) => call.op === "cherryPick").map((call) => call.args.commitSha)).toEqual(locations);
  });
});

function success(input: V2NodeExecutionInput, root: boolean, candidateCommit = `commit-${input.node.id}`): V2NodeExecutionOutcome {
  const obligation = input.contract.validation.obligations[0]!;
  return {
    kind: "success",
    candidateCommit,
    outputDigest: `sha256:${input.node.id}`,
    changedFiles: [...input.contract.scope.allowedPaths],
    evidenceMatrix: {
      matrixId: `matrix-${input.node.id}`,
      candidateCommit,
      validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
      criteria: [{
        criterionId: obligation.criterionId,
        obligationId: obligation.id,
        status: "satisfied",
        justification: "The exact candidate satisfied the declared obligation.",
        evidenceRefs: [`evidence-${input.node.id}`]
      }],
      outcome: "verified",
      validationRecipeDigest: "sha256:recipe-v2"
    },
    artifactLocation: `commit-${input.node.id}`,
    ...(root ? {
      integrationManifestId: "integration-final",
      finalManifestId: "manifest-final",
      finalManifest: {
        commitSha: candidateCommit,
        treeSha: `tree-${input.node.id}`,
        graphRevision: input.graph.revision,
        artifactIds: input.contract.task.produces.map(({ id }) => id),
        evidenceMatrixId: `matrix-${input.node.id}`,
        validationRecipeDigest: "sha256:recipe-v2",
        deliveryTarget: "main"
      }
    } : {})
  };
}

class CrashAfterEffectGit extends FakeGitRunner {
  private cherryPicks = 0;

  override async cherryPick(params: Parameters<FakeGitRunner["cherryPick"]>[0]): ReturnType<FakeGitRunner["cherryPick"]> {
    const outcome = await super.cherryPick(params);
    if (this.cherryPicks++ === 0) throw new Error("simulated crash");
    return outcome;
  }
}

function memoryJournal(graphId: string) {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-product-v2", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build booking" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-product-v2", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-product-v2", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  return {
    coordinator: new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId, expectedSequence, inputs: RunEventInput[]) => {
          expect(expectedSequence).toBe(events.length);
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events = [...events, ...appended];
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    }),
    events: () => structuredClone(events)
  };
}
