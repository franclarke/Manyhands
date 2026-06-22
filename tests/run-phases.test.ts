/**
 * Run phase timeline (UI/UX loop, Bloque 3). A pure derivation of the run's
 * position in its lifecycle — Intención → Plan → Ejecución → Integración →
 * Revisión — from the reduced run signals. Feeds the horizontal phase rail under
 * the cockpit header. Pure and node-testable; never touches React or the log.
 */
import { describe, expect, it } from "vitest";
import { deriveRunTimeline, graphEmptyStateKind, type RunPhaseInput } from "@/lib/run-model/run-phases";

const base: RunPhaseInput = {
  stage: "intent",
  status: "created",
  leafTotal: 0,
  leafDone: 0,
  rootIntegrated: false
};

const states = (input: RunPhaseInput): string[] => deriveRunTimeline(input).map((p) => p.state);

describe("deriveRunTimeline", () => {
  it("labels the five phases in Spanish, in order", () => {
    expect(deriveRunTimeline(base).map((p) => p.label)).toEqual([
      "Intención",
      "Plan",
      "Ejecución",
      "Integración",
      "Revisión"
    ]);
  });

  it("intent/created → Intención active, rest pending", () => {
    expect(states(base)).toEqual(["active", "pending", "pending", "pending", "pending"]);
  });

  it("proposal/generating → Intención done, Plan active", () => {
    expect(states({ ...base, stage: "proposal", status: "generating" })).toEqual([
      "done",
      "active",
      "pending",
      "pending",
      "pending"
    ]);
  });

  it("plan awaiting review (needs_review) keeps Plan active", () => {
    expect(states({ ...base, stage: "proposal", status: "needs_review" })).toEqual([
      "done",
      "active",
      "pending",
      "pending",
      "pending"
    ]);
  });

  it("running with leaves in flight → Ejecución active with a verified count", () => {
    const phases = deriveRunTimeline({ ...base, stage: "running", status: "running", leafTotal: 4, leafDone: 1 });
    expect(phases.map((p) => p.state)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(phases[2]?.detail).toBe("1/4 verificadas");
  });

  it("hides the verified count once execution is no longer the active phase", () => {
    const phases = deriveRunTimeline({ ...base, stage: "review", status: "completed", leafTotal: 4, leafDone: 3, rootIntegrated: true });
    expect(phases[2]?.state).toBe("done");
    expect(phases[2]?.detail).toBeUndefined();
  });

  it("running with every leaf verified but root not integrated → Integración active", () => {
    expect(
      states({ ...base, stage: "running", status: "running", leafTotal: 3, leafDone: 3, rootIntegrated: false })
    ).toEqual(["done", "done", "done", "active", "pending"]);
  });

  it("review/completed → first four done, Revisión active (awaiting disposition)", () => {
    expect(states({ ...base, stage: "review", status: "completed", leafTotal: 3, leafDone: 3, rootIntegrated: true })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active"
    ]);
  });

  it("completed_with_accepted → every phase done", () => {
    expect(states({ ...base, stage: "review", status: "completed_with_accepted", leafTotal: 3, leafDone: 3, rootIntegrated: true })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done"
    ]);
  });

  it("failure during planning marks Plan failed, later phases pending", () => {
    expect(states({ ...base, stage: "proposal", status: "failed" })).toEqual([
      "done",
      "failed",
      "pending",
      "pending",
      "pending"
    ]);
  });

  it("failure during execution marks Ejecución failed", () => {
    expect(states({ ...base, stage: "running", status: "failed", leafTotal: 4, leafDone: 2 })).toEqual([
      "done",
      "done",
      "failed",
      "pending",
      "pending"
    ]);
  });
});

describe("graphEmptyStateKind", () => {
  it("a failed run with no graph is a failure, not 'still planning'", () => {
    expect(graphEmptyStateKind("failed")).toBe("failed");
  });

  it("an interrupted run reads as interrupted", () => {
    expect(graphEmptyStateKind("interrupted")).toBe("interrupted");
  });

  it("an early/active run is still building the plan", () => {
    expect(graphEmptyStateKind("created")).toBe("planning");
    expect(graphEmptyStateKind("generating")).toBe("planning");
    expect(graphEmptyStateKind("running")).toBe("planning");
  });
});
