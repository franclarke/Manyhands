import { describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import {
  RunCoordinator,
  RunEventSchema,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import {
  V2ExecutionDriver,
  type V2NodeExecutionInput,
  type V2NodeExecutionOutcome
} from "@manyhands/orchestrator-graph";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

const at = "2026-07-24T12:00:00.000Z";

/**
 * Silent deadlock, observed in a real run.
 *
 * When the planner declares an artifact between siblings, the compiler turns it
 * into an execution-phase `ArtifactRequirement`. But a finished node adopted
 * only its own node-result artifact, so the requirement naming the *declared*
 * artifact was never satisfied: its consumers never became ready, and the run
 * went quiet with no failure, no decision and no progress until the wall clock
 * ran out. A stall that reports nothing is worse than a failure — it looks like
 * work still happening.
 *
 * A node's successful candidate is the evidence for every artifact contract it
 * produces, so all of them must be adopted from it.
 */
describe("artifact adoption for every contract a node produces", () => {
  it("lets a consumer of a planner-declared artifact become ready", async () => {
    const breakdown = bookingBreakdown();
    breakdown.candidateArtifacts.push({
      id: "booking-model-files",
      artifactType: "source-module",
      producerUnitKey: "domain",
      consumerUnitKeys: ["api"],
      purpose: "The API compiles against the domain module",
      materializationHint: "files",
      evidenceIds: ["domain-path", "api-path"]
    });
    const compiled = compileGraphRevision({ breakdown, repositorySnapshot: bookingSnapshot() }, compilerDependencies);

    // Precondition: the scenario really does create an execution-phase
    // requirement, otherwise this test would pass without exercising anything.
    const executionRequirements = compiled.graph.artifactRequirements
      .filter((requirement) => requirement.requiredFor === "execution");
    expect(executionRequirements.length).toBeGreaterThan(0);
    const handoffProducerNodeId = executionRequirements[0]!.producerNodeId;

    const executed: string[] = [];
    const driver = new V2ExecutionDriver({
      coordinator: harness(compiled.graph.graphId).coordinator,
      now: () => at,
      loadCurrentInputs: async () => ({
        graph: compiled.graph,
        contracts: compiled.contracts,
        repositoryContextDigest: "sha256:repository",
        executorProfile: { id: "codex-cli", revision: "gpt-5.5" },
        materializableNodeIds: Object.keys(compiled.graph.nodes),
        availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
        conflictConstraints: []
      }),
      execute: async (input) => {
        executed.push(input.node.id);
        const outcome = successOutcome(input, compiled.graph.rootId);
        return input.node.id === handoffProducerNodeId
          ? { ...outcome, artifactCherryPickMainline: 1 as const }
          : outcome;
      }
    });

    const state = await driver.run({
      runId: "run-artifacts",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "codex-cli", revision: "gpt-5.5" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    // Every node runs, and the run reaches a terminal state instead of stalling.
    for (const nodeId of Object.keys(compiled.graph.nodes)) {
      expect(executed).toContain(nodeId);
    }
    expect(state.lifecycle).not.toBe("running");

    // The declared artifact is adopted under its own contract, not only the
    // producer's node-result contract.
    const adopted = Object.values(state.adoptedArtifacts).map((artifact) => artifact.contract.id);
    for (const requirement of executionRequirements) {
      expect(adopted).toContain(requirement.artifactContract.id);
    }
    expect(Object.values(state.adoptedArtifacts)
      .filter((artifact) => artifact.nodeId === handoffProducerNodeId)
      .every((artifact) => artifact.cherryPickMainline === 1)).toBe(true);
  });
});

function successOutcome(input: V2NodeExecutionInput, rootId: string): V2NodeExecutionOutcome {
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
        justification: "Exact candidate evidence passed.",
        evidenceRefs: [`evidence-${input.node.id}`]
      }],
      outcome: "verified",
      validationRecipeDigest: "sha256:recipe-v2",
      observations: []
    },
    artifactLocation: `commit-${input.node.id}`,
    ...(input.node.id === rootId
      ? {
          integrationManifestId: "integration-root",
          finalManifestId: "final-root",
          // A root outcome carries the complete manifest, not only its id: the
          // driver refuses to publish a final candidate it cannot describe.
          finalManifest: {
            commitSha: `commit-${input.node.id}`,
            treeSha: `tree-${input.node.id}`,
            graphRevision: input.graph.revision,
            artifactIds: input.contract.task.produces.map(({ id }) => id),
            evidenceMatrixId: `matrix-${input.node.id}`,
            validationRecipeDigest: "sha256:recipe-v2",
            deliveryTarget: "main"
          }
        }
      : {})
  };
}

function harness(graphId: string) {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-artifacts", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build booking" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-artifacts", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-artifacts", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  const coordinator = new RunCoordinator({
    events: {
      load: async () => structuredClone(events),
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
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
  });
  return { coordinator };
}
