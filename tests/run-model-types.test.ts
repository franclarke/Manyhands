import { describe, expect, it } from "vitest";
import {
  CONFLICT_DIMENSIONS,
  DECISION_KINDS,
  EXECUTION_STATE_KINDS,
  RUN_EVENT_TYPES,
  RUN_EVENT_TYPES_V2,
  type Decision,
  type Evidence,
  type RunEvent,
  type RunEventOf,
  type Seam
} from "@/lib/run-model/types";

/**
 * PR 02 — type/shape sanity for the run-model vocabulary. No reducer, no
 * selectors. These assertions lock the frozen decisions of
 * `docs/design/run-operative-model.md` that are checkable at runtime.
 */
describe("run-model/types — vocabulary", () => {
  it("knows the v1 event vocabulary including the new envelope events", () => {
    expect(RUN_EVENT_TYPES).toContain("node.verify.passed");
    expect(RUN_EVENT_TYPES).toContain("seam.amended");
    expect(RUN_EVENT_TYPES).toContain("decision.raised");
    expect(RUN_EVENT_TYPES).toContain("decision.resolved");
    expect(RUN_EVENT_TYPES).toContain("conflict.detected");
  });

  it("does NOT define a node.invalidated event (invalidation is derived)", () => {
    const all: readonly string[] = [...RUN_EVENT_TYPES, ...RUN_EVENT_TYPES_V2];
    expect(all).not.toContain("node.invalidated");
  });

  it("ExecutionState kinds do NOT include `stale` (freshness is orthogonal/derived)", () => {
    const kinds: readonly string[] = EXECUTION_STATE_KINDS;
    expect(kinds).not.toContain("stale");
    expect(kinds).toContain("integrated");
    expect(kinds).toContain("failed");
  });

  it("exposes the five unified decision kinds and the four conflict dimensions", () => {
    expect(DECISION_KINDS).toEqual([
      "approve_plan",
      "clarify",
      "resolve_conflict",
      "approve_amendment",
      "approve_merge"
    ]);
    expect(CONFLICT_DIMENSIONS).toContain("behavioral");
  });
});

describe("run-model/types — envelope & entity shapes", () => {
  it("a minimal RunEvent matches the envelope", () => {
    const event: RunEvent = {
      seq: 1,
      at: "2026-06-05T00:00:00.000Z",
      runId: "run-1",
      actor: "system",
      type: "plan.started",
      payload: {}
    };
    expect(event.seq).toBe(1);
    expect(event.actor).toBe("system");
  });

  it("node.verify.passed can record builtAgainst (enables derived invalidation)", () => {
    const event: RunEventOf<"node.verify.passed"> = {
      seq: 25,
      at: "2026-06-05T00:00:01.000Z",
      runId: "run-1",
      actor: "agent",
      type: "node.verify.passed",
      payload: {
        nodeId: "n-store",
        commit: "e5",
        changedFiles: ["src/store.ts"],
        builtAgainst: [{ seamId: "seam-store", revision: 1 }]
      }
    };
    expect(event.payload.builtAgainst[0]?.revision).toBe(1);
  });

  it("a Seam carries revision, signature and optional contract", () => {
    const seam: Seam = {
      id: "seam-store",
      name: "SnoozeStore",
      producerNodeId: "n-store",
      consumerNodeIds: ["n-ui", "n-sched"],
      signature: { draft: "snooze(id,duration)", frozen: "snooze(id,duration)" },
      contract: { "duration.unit": "ms" },
      revision: 2,
      state: "amended"
    };
    expect(seam.revision).toBe(2);
    expect(seam.contract?.["duration.unit"]).toBe("ms");
  });

  it("a Decision uses a structured choice, never a free string", () => {
    const approve: Decision = {
      id: "d-approve",
      kind: "approve_plan",
      blocking: true,
      context: {},
      status: "resolved",
      resolution: { choice: { action: "approve" }, actor: "human", at: "2026-06-05T00:00:02.000Z" }
    };
    const resolveConflict: Decision = {
      id: "d-conflict",
      kind: "resolve_conflict",
      blocking: true,
      context: { conflictId: "cf-unit" },
      status: "resolved",
      resolution: { choice: { resolutionId: "canonical-ms-fix-store" }, actor: "human", at: "2026-06-05T00:00:03.000Z" }
    };
    expect("action" in approve.resolution!.choice && approve.resolution!.choice.action).toBe("approve");
    expect("resolutionId" in resolveConflict.resolution!.choice).toBe(true);
  });

  it("Evidence can carry an invalidationTrace", () => {
    const evidence: Evidence = {
      aggregateDiffRef: "blob://run-1/diff",
      tests: { pass: 12, total: 12 },
      narrativeRef: "blob://run-1/narr",
      integrationCommit: "c9",
      invalidationTrace: [
        {
          seamId: "seam-search",
          from: 1,
          to: 2,
          cause: "signature-insufficient",
          reExecuted: ["n-search", "n-api", "n-ui"],
          reIntegrated: ["c-results", "root"],
          preserved: ["n-telemetry"]
        }
      ]
    };
    expect(evidence.invalidationTrace?.[0]?.preserved).toEqual(["n-telemetry"]);
  });
});
