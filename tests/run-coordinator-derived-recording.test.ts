import { describe, expect, it } from "vitest";
import {
  EvidenceMatrixRecordSchema,
  RunCoordinator,
  RunEventSchema,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

const at = "2026-07-29T12:00:00.000Z";

describe("RunCoordinator.recordDerived", () => {
  it("recognizes a durably committed batch after an ambiguous append error", async () => {
    const events: RunEvent[] = [
      event(1, "created", "run.created", { goal: "Test ambiguous append" }),
      event(2, "proposed-r1", "graph.revision.proposed", { graphId: "graph", revision: 1 }),
      event(3, "approved-r1", "graph.revision.approved", { graphId: "graph", revision: 1 })
    ];
    let throwAfterCommit = true;
    const coordinator = new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId, expectedSequence, inputs) => {
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events.push(...appended);
          if (throwAfterCommit) {
            throwAfterCommit = false;
            throw new Error("response lost after durable append");
          }
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    });
    let derivations = 0;

    const state = await coordinator.recordDerived("run-derived", () => {
      derivations += 1;
      return [{
        eventId: "derived-readiness",
        occurredAt: new Date(Date.parse(at) + derivations * 1_000).toISOString(),
        type: "readiness.observed",
        payload: { readyNodeIds: ["node-r1"], pendingDecisionIds: [] }
      }];
    });

    expect(derivations).toBe(1);
    expect(state.readiness.readyNodeIds).toEqual(["node-r1"]);
    expect(events.filter((item) => item.eventId === "derived-readiness")).toHaveLength(1);
  });

  it("re-derives facts after optimistic contention changes the current revision", async () => {
    const events: RunEvent[] = [
      event(1, "created", "run.created", { goal: "Test derived recording" }),
      event(2, "proposed-r1", "graph.revision.proposed", { graphId: "graph", revision: 1 }),
      event(3, "approved-r1", "graph.revision.approved", { graphId: "graph", revision: 1 })
    ];
    let injectContention = true;
    const coordinator = new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId, expectedSequence, inputs) => {
          if (injectContention) {
            injectContention = false;
            events.push(event(
              expectedSequence + 1,
              "proposed-r2",
              "graph.revision.proposed",
              { graphId: "graph", revision: 2 }
            ));
            throw new Error("optimistic contention");
          }
          expect(expectedSequence).toBe(events.length);
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events.push(...appended);
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    });
    const derivedFrom: number[] = [];

    const state = await coordinator.recordDerived("run-derived", (current) => {
      derivedFrom.push(current.graphRevision!);
      return [{
        eventId: "derived-readiness",
        occurredAt: at,
        type: "readiness.observed",
        payload: {
          readyNodeIds: [`node-r${current.graphRevision}`],
          pendingDecisionIds: []
        }
      }];
    });

    expect(derivedFrom).toEqual([1, 2]);
    expect(state.graphRevision).toBe(2);
    expect(state.readiness.readyNodeIds).toEqual(["node-r2"]);
  });

  /**
   * A derived batch that is already durable has to be recognised as the same
   * batch. The journal stores the schema-normalised event, so a field the schema
   * fills in by default — `matrix.observations`, for instance — is present on the
   * persisted side and absent from the freshly derived input. Comparing raw input
   * against normalised output made an identical re-derivation look like a
   * conflicting one, and a run that hit contention aborted instead of settling.
   */
  it("recognizes a persisted batch whose schema filled in a default", async () => {
    const matrixInput = {
      matrixId: "matrix-1",
      candidateCommit: "commit-1",
      validationContract: { id: "validation-1", revision: "sha256:validation" },
      criteria: [{
        criterionId: "criterion-1",
        obligationId: "obligation-1",
        status: "satisfied",
        justification: "Exact candidate evidence passed.",
        evidenceRefs: ["evidence-1"]
      }],
      outcome: "verified"
    };
    const matrix = EvidenceMatrixRecordSchema.parse(matrixInput);
    const derivedMatrix = structuredClone(matrix);
    Reflect.deleteProperty(derivedMatrix, "observations");
    const events: RunEvent[] = [
      event(1, "created", "run.created", { goal: "Test schema defaults" }),
      event(2, "proposed-r1", "graph.revision.proposed", { graphId: "graph", revision: 1 }),
      event(3, "approved-r1", "graph.revision.approved", { graphId: "graph", revision: 1 }),
      event(4, "attempt-started", "attempt.started", {
        attemptId: "run-derived:attempt:node-a:1",
        nodeId: "node-a",
        inputFingerprint: "sha256:inputs",
        executorProfile: { id: "codex-cli", revision: "sha256:profile" }
      }),
      event(5, "attempt-candidate", "attempt.candidate_created", {
        attemptId: "run-derived:attempt:node-a:1",
        nodeId: "node-a",
        candidateCommit: "commit-1",
        outputDigest: "sha256:output",
        changedFiles: ["src/a.ts"]
      }),
      event(6, "derived-validation", "validation.completed", {
        attemptId: "run-derived:attempt:node-a:1",
        nodeId: "node-a",
        matrix
      })
    ];
    const coordinator = new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async () => { throw new Error("an already durable batch must not be appended again"); }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    });

    // Precondition: schema parsing fills the canonical field omitted by the
    // boundary input before the event becomes a durable domain fact.
    expect(matrixInput).not.toHaveProperty("observations");
    expect(matrix.observations).toEqual([]);
    expect(derivedMatrix).not.toHaveProperty("observations");

    const state = await coordinator.recordDerived("run-derived", () => [{
      eventId: "derived-validation",
      occurredAt: at,
      type: "validation.completed",
      payload: { attemptId: "run-derived:attempt:node-a:1", nodeId: "node-a", matrix: derivedMatrix }
    }]);

    expect(state.evidenceMatrices).toEqual(["matrix-1"]);
  });
});

function event(
  sequence: number,
  eventId: string,
  type: RunEventInput["type"],
  payload: RunEventInput["payload"]
): RunEvent {
  return RunEventSchema.parse({
    eventId,
    runId: "run-derived",
    sequence,
    occurredAt: at,
    type,
    payload
  });
}
