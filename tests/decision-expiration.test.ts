import { describe, expect, it } from "vitest";
import {
  eventsForCommand,
  foldRun,
  supersededDecisionIds,
  type RunEvent
} from "@manyhands/run-coordinator";

const at = "2026-07-18T12:00:00.000Z";
const runId = "run-expire";

function ev(sequence: number, eventId: string, type: string, payload: unknown): RunEvent {
  return { eventId, runId, sequence, occurredAt: at, type, payload } as unknown as RunEvent;
}

function conflictDecision(id: string, node: string, raisedAtGraphRevision?: number) {
  return {
    id,
    kind: "resolve_conflict" as const,
    question: `Guidance needed for ${node}?`,
    options: [{ id: "retry", label: "Retry" }, { id: "stop", label: "Stop" }],
    affectedNodeIds: [node],
    evidenceRefs: [id],
    impact: "behavior" as const,
    ...(raisedAtGraphRevision !== undefined ? { raisedAtGraphRevision } : {})
  };
}

const baseEvents: RunEvent[] = [
  ev(1, "created", "run.created", { goal: "Build booking" }),
  ev(2, "proposed-1", "graph.revision.proposed", { graphId: "graph", revision: 1 }),
  ev(3, "approved-1", "graph.revision.approved", { graphId: "graph", revision: 1 }),
  ev(4, "decision-old", "decision.raised", { decision: conflictDecision("decision-old", "node-x", 1) }),
  ev(5, "proposed-2", "graph.revision.proposed", { graphId: "graph", revision: 2 })
];

describe("decision expiration on graph revision", () => {
  it("expires a pending decision superseded by a newer approved revision", () => {
    const state = foldRun(baseEvents);
    const commandEvents = eventsForCommand(state, { type: "approve_graph", graphId: "graph", revision: 2 });
    // Approving a superseding revision must both approve AND expire the stale decision.
    expect(commandEvents.map((event) => event.type)).toEqual(["graph.revision.approved", "decision.expired"]);

    const full = [...baseEvents, ...commandEvents.map((event, index) => ev(6 + index, `cmd-${index}`, event.type, event.payload))];
    const final = foldRun(full);
    expect(final.decisions["decision-old"]?.status).toBe("expired");
  });

  it("does not expire a decision raised at the newly approved revision", () => {
    const events = [...baseEvents, ev(6, "decision-new", "decision.raised", { decision: conflictDecision("decision-new", "node-y", 2) })];
    const state = foldRun(events);
    const commandEvents = eventsForCommand(state, { type: "approve_graph", graphId: "graph", revision: 2 });
    // Only the revision-1 decision is superseded; the revision-2 decision survives.
    const expired = commandEvents.filter((event) => event.type === "decision.expired").map((event) => (event.payload as { decisionId: string }).decisionId);
    expect(expired).toEqual(["decision-old"]);
    expect(expired).not.toContain("decision-new");
  });

  it("supersededDecisionIds selects only older-revision pending decisions", () => {
    const decisions = foldRun([
      ...baseEvents,
      ev(6, "decision-new", "decision.raised", { decision: conflictDecision("decision-new", "node-y", 2) })
    ]).decisions;
    expect(supersededDecisionIds(decisions, 2)).toEqual(["decision-old"]);
  });
});
