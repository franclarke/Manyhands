import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTONOMY,
  autonomyPublishesDelivery,
  autonomyResolution,
  foldRun,
  runAutonomy,
  ProductRunDefinitionSchema,
  type AutonomyLevel,
  type DecisionInput,
  type RunEvent
} from "@manyhands/run-coordinator";

const at = "2026-08-16T00:00:00.000Z";
const LEVELS: readonly AutonomyLevel[] = ["supervised", "semi", "autonomous"];

/**
 * The run form has offered `Supervisado / Semi / Autónomo` since the first
 * product screen and the value never left the browser: the only match for
 * `autonomous` in the tree was a prompt string, and every run parked at
 * `Approve graph revision 1?` no matter what was selected.
 *
 * A control that silently does nothing is worse than no control, because the
 * operator reads the run's behaviour as the system's judgement instead of as a
 * setting that was dropped.
 */
describe("What a standing authorization answers", () => {
  it("answers nothing at all when the operator kept every decision", () => {
    for (const decision of [plan(), amendment(), conflict(), clarification()]) {
      expect(autonomyResolution("supervised", decision)).toBeUndefined();
    }
  });

  it("approves the plan it just compiled once the operator delegated that", () => {
    expect(autonomyResolution("semi", plan())).toBe("approve");
    expect(autonomyResolution("autonomous", plan())).toBe("approve");
  });

  it("retries a conflict rather than parking the graph on it", () => {
    expect(autonomyResolution("semi", conflict())).toBe("retry");
  });

  it("never answers a question about what the operator wanted", () => {
    // A goal clarification exists precisely because the answer could not be
    // derived. Deriving one anyway is the invented domain state this project
    // forbids, so no level resolves it — including the fully autonomous one.
    for (const level of LEVELS) {
      expect(autonomyResolution(level, clarification())).toBeUndefined();
    }
  });

  it("never answers with an option the decision did not offer", () => {
    const narrowed: DecisionInput = { ...plan(), options: [
      { id: "stop", label: "Stop" },
      { id: "escalate", label: "Escalate" }
    ] };

    expect(autonomyResolution("autonomous", narrowed)).toBeUndefined();
  });

  it("publishes to the target branch only when the run is fully autonomous", () => {
    // Delivery is the single act that leaves the run's own workspace and moves
    // a ref someone else can pull. Semi stops there on purpose.
    expect(autonomyPublishesDelivery("supervised")).toBe(false);
    expect(autonomyPublishesDelivery("semi")).toBe(false);
    expect(autonomyPublishesDelivery("autonomous")).toBe(true);
  });
});

describe("What the run definition carries", () => {
  it("keeps the level the operator chose", () => {
    const definition = ProductRunDefinitionSchema.parse({ ...baseDefinition(), autonomy: "autonomous" });

    expect(runAutonomy(definition)).toBe("autonomous");
  });

  it("reads a definition written before autonomy existed as supervised", () => {
    // Every journal already on disk omits the field. Folding one has to mean
    // "nobody delegated anything", never "the safest guess".
    const definition = ProductRunDefinitionSchema.parse(baseDefinition());

    expect(definition.autonomy).toBeUndefined();
    expect(runAutonomy(definition)).toBe("supervised");
    expect(DEFAULT_AUTONOMY).toBe("supervised");
  });
});

describe("What the journal records about who approved", () => {
  it("keeps the authorization that answered instead of the answer alone", () => {
    const projection = foldRun([
      created(),
      raised(plan()),
      resolved({ optionId: "approve", authorizedBy: { kind: "autonomy_policy", level: "semi" } })
    ]);

    expect(projection.decisions["approve-plan"]?.resolution).toEqual({ optionId: "approve" });
    expect(projection.decisions["approve-plan"]?.authorizedBy)
      .toEqual({ kind: "autonomy_policy", level: "semi" });
  });

  it("leaves the authorization absent when a person answered", () => {
    const projection = foldRun([created(), raised(plan()), resolved({ optionId: "approve" })]);

    expect(projection.decisions["approve-plan"]?.status).toBe("resolved");
    expect(projection.decisions["approve-plan"]?.authorizedBy).toBeUndefined();
  });
});

function plan(): DecisionInput {
  return {
    id: "approve-plan",
    kind: "approve_plan",
    question: "Approve graph revision 1?",
    options: [{ id: "approve", label: "Approve plan" }, { id: "request_changes", label: "Request changes" }],
    affectedNodeIds: ["node:root"],
    evidenceRefs: ["graph:g:r1"],
    impact: "acceptance"
  };
}

function amendment(): DecisionInput {
  return { ...plan(), id: "approve-amendment", kind: "approve_amendment", impact: "scope" };
}

function conflict(): DecisionInput {
  return {
    ...plan(),
    id: "resolve-conflict",
    kind: "resolve_conflict",
    options: [{ id: "retry", label: "Retry" }, { id: "stop", label: "Stop" }],
    impact: "risk"
  };
}

function clarification(): DecisionInput {
  return {
    ...plan(),
    id: "clarify-goal",
    kind: "clarify_goal",
    options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
    impact: "scope"
  };
}

function baseDefinition(): Record<string, unknown> {
  const selection = { executorId: "claude-code-cli", model: "claude-opus-5" };
  return {
    schemaVersion: 1,
    workspaceId: "workspace-1",
    userPrompt: "Build it",
    acceptanceCriteria: [],
    title: "Build it",
    planningSelection: selection,
    executionSelection: selection,
    repairSelection: selection,
    executionConfig: {},
    targetContext: { fingerprint: "repo@base" }
  };
}

function created(): RunEvent {
  return event(1, "run.created", { goal: "Build it" });
}

function raised(decision: DecisionInput): RunEvent {
  return event(2, "decision.raised", { decision });
}

function resolved(payload: Record<string, unknown>): RunEvent {
  return event(3, "decision.resolved", { decisionId: "approve-plan", ...payload } as never);
}

function event<T extends RunEvent["type"]>(
  sequence: number,
  type: T,
  payload: Extract<RunEvent, { type: T }>["payload"]
): Extract<RunEvent, { type: T }> {
  return {
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: at,
    type,
    payload
  } as Extract<RunEvent, { type: T }>;
}
