import { describe, expect, it } from "vitest";

import { compileGraphRevision } from "@manyhands/decomposer";
import { V2ExecutionDriver, type V2NodeExecutionInput, type V2NodeExecutionOutcome } from "@manyhands/orchestrator-graph";
import { RunCoordinator, RunEventSchema, type RunEvent, type RunEventInput } from "@manyhands/run-coordinator";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";

const at = "2026-07-18T12:00:00.000Z";

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
  });
});

function success(input: V2NodeExecutionInput, root: boolean): V2NodeExecutionOutcome {
  const obligation = input.contract.validation.obligations[0]!;
  return {
    kind: "success",
    candidateCommit: `commit-${input.node.id}`,
    outputDigest: `sha256:${input.node.id}`,
    changedFiles: [...input.contract.scope.allowedPaths],
    evidenceMatrix: {
      matrixId: `matrix-${input.node.id}`,
      candidateCommit: `commit-${input.node.id}`,
      validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
      criteria: [{
        criterionId: obligation.criterionId,
        obligationId: obligation.id,
        status: "satisfied",
        justification: "The exact candidate satisfied the declared obligation.",
        evidenceRefs: [`evidence-${input.node.id}`]
      }],
      outcome: "verified"
    },
    artifactLocation: `commit-${input.node.id}`,
    ...(root ? { integrationManifestId: "integration-final", finalManifestId: "manifest-final" } : {})
  };
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
