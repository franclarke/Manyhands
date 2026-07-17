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

const at = "2026-07-17T12:00:00.000Z";

describe("V2ExecutionDriver", () => {
  it("executes seam siblings together, adopts exact artifacts and integrates the root bottom-up", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const dispatches: V2NodeExecutionInput[] = [];
    const ordering: string[] = [];
    harness.onAppend((events) => {
      for (const event of events) ordering.push(`event:${event.type}`);
    });
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      execute: async (input): Promise<V2NodeExecutionOutcome> => {
        ordering.push(`execute:${input.node.id}`);
        dispatches.push(input);
        const obligation = input.contract.validation.obligations[0]!;
        return {
          kind: "success",
          candidateCommit: `commit-${input.node.id}`,
          outputDigest: `sha256:${input.node.id}`,
          changedFiles: [...input.contract.scope.allowedPaths],
          evidenceMatrix: {
            matrixId: `matrix-${input.node.id}`,
            candidateCommit: `commit-${input.node.id}`,
            validationContract: {
              id: input.contract.validation.id,
              revision: input.contract.validation.revision
            },
            criteria: [{
              criterionId: obligation.criterionId,
              obligationId: obligation.id,
              status: "satisfied",
              justification: "Exact candidate evidence passed.",
              evidenceRefs: [`evidence-${input.node.id}`]
            }],
            outcome: "verified"
          },
          artifactLocation: `commit-${input.node.id}`,
          ...(input.node.id === compiled.graph.rootId
            ? { integrationManifestId: "integration-root", finalManifestId: "final-root" }
            : {})
        };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: {
        sourceTargetFingerprint: "sha256:target",
        targetBranch: "main",
        targetHead: "base-head"
      }
    });

    expect(dispatches.slice(0, 3).map((input) => input.node.id).sort()).toEqual([
      "node-api",
      "node-domain",
      "node-ui"
    ]);
    const rootDispatch = dispatches.at(-1)!;
    expect(rootDispatch.node.id).toBe(compiled.graph.rootId);
    expect(rootDispatch.consumedArtifacts).toHaveLength(3);
    expect(state.lifecycle).toBe("result_ready");
    expect(state.finalCandidate).toMatchObject({ manifestId: "final-root", commit: `commit-${compiled.graph.rootId}` });
    expect(Object.keys(state.adoptedArtifacts)).toHaveLength(4);

    const firstExecute = ordering.findIndex((item) => item.startsWith("execute:"));
    expect(ordering.slice(0, firstExecute)).toEqual(expect.arrayContaining([
      "event:wave.selected",
      "event:attempt.started"
    ]));
  });

  it("keeps an independent sibling running when another node raises a local decision", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      execute: async (input) => input.node.id === "node-api"
        ? { kind: "failure", reason: "API needs a product decision." }
        : success(input)
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId).sort()).toEqual([
      "node-domain",
      "node-ui"
    ]);
    expect(Object.values(state.decisions)).toEqual([
      expect.objectContaining({ status: "pending", affectedNodeIds: ["node-api"] })
    ]);
    expect(state.lifecycle).toBe("waiting_for_input");
  });
});

function success(input: V2NodeExecutionInput): V2NodeExecutionOutcome {
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
      criteria: [{ criterionId: obligation.criterionId, obligationId: obligation.id, status: "satisfied", justification: "Passed.", evidenceRefs: [`evidence-${input.node.id}`] }],
      outcome: "verified"
    },
    artifactLocation: `commit-${input.node.id}`
  };
}

function coordinatorHarness(graphId: string) {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-v2", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build booking" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-v2", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-v2", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  let listener: (events: RunEvent[]) => void = () => undefined;
  const coordinator = new RunCoordinator({
    events: {
      load: async () => structuredClone(events),
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
        expect(expectedSequence).toBe(events.length);
        const appended = inputs.map((input, index) => RunEventSchema.parse({
          ...input,
          runId,
          sequence: expectedSequence + index + 1
        }));
        events = [...events, ...appended];
        listener(appended);
        return appended;
      }
    },
    delivery: { publish: async () => { throw new Error("unused"); } },
    clock: () => at,
    eventId: (type, sequence) => `${type}:${sequence}`
  });
  return { coordinator, onAppend(next: (events: RunEvent[]) => void) { listener = next; } };
}
