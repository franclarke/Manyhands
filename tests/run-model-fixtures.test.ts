import { describe, expect, it } from "vitest";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  FIXTURE_CATALOG,
  goldenAppointmentBooking,
  goldenBehavioralConflict,
  goldenDeepImportPipeline,
  goldenExecutionFailed,
  goldenHappyPath,
  goldenPlanningFallback,
  goldenPlanningQuestion,
  goldenSeamAmendmentBlastRadius,
  goldenSupportDeskSaas,
  goldenSubscriptionsBillingSaas,
  goldenVerifyAutoRepair
} from "@/lib/run-model/fixtures";
import { RUN_EVENT_TYPES, type RunEvent, type RunFixture } from "@/lib/run-model/types";

const KNOWN_TYPES: readonly string[] = RUN_EVENT_TYPES;
const VALID_ACTORS = new Set(["system", "agent", "human"]);
const HEAVY_KEYS = ["diff", "log", "rawOutput", "stdout", "stderr"];

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

function payload(event: RunEvent): Record<string, unknown> {
  return event.payload;
}

describe("golden fixtures — discovery & structure", () => {
  it("1. exports the golden fixtures from the index", () => {
    expect(GOLDEN_FIXTURE_NAMES).toEqual([
      "golden-happy-path",
      "golden-planning-question",
      "golden-verify-auto-repair",
      "golden-behavioral-conflict",
      "golden-seam-amendment-blast-radius",
      "golden-execution-failed",
      "golden-planning-fallback",
      "golden-support-desk-saas",
      "golden-subscriptions-billing-saas",
      "golden-deep-import-pipeline",
      "golden-appointment-booking"
    ]);
    expect(goldenHappyPath).toBeDefined();
    expect(goldenPlanningQuestion).toBeDefined();
    expect(goldenVerifyAutoRepair).toBeDefined();
    expect(goldenBehavioralConflict).toBeDefined();
    expect(goldenSeamAmendmentBlastRadius).toBeDefined();
    expect(goldenExecutionFailed).toBeDefined();
    expect(goldenPlanningFallback).toBeDefined();
    expect(goldenSupportDeskSaas).toBeDefined();
    expect(goldenSubscriptionsBillingSaas).toBeDefined();
    expect(goldenDeepImportPipeline).toBeDefined();
    expect(goldenAppointmentBooking).toBeDefined();
  });

  it("1a. exposes every fixture through the demo catalog exactly once", () => {
    expect(FIXTURE_CATALOG.map((fixture) => fixture.name).sort()).toEqual([...GOLDEN_FIXTURE_NAMES].sort());
    expect(FIXTURE_CATALOG.every((fixture) => fixture.title.length > 0 && fixture.description.length > 0)).toBe(true);
  });

  it.each(ALL)("2. %s has a runId", (_name, fx) => {
    expect(typeof fx.runId).toBe("string");
    expect(fx.runId.length).toBeGreaterThan(0);
  });

  it.each(ALL)("3. %s has at least one event", (_name, fx) => {
    expect(fx.events.length).toBeGreaterThan(0);
  });

  it.each(ALL)("4. %s has strictly increasing seq", (_name, fx) => {
    for (let i = 1; i < fx.events.length; i += 1) {
      expect(fx.events[i]!.seq).toBeGreaterThan(fx.events[i - 1]!.seq);
    }
  });

  it.each(ALL)("5. %s events all share the fixture runId", (_name, fx) => {
    for (const e of fx.events) expect(e.runId).toBe(fx.runId);
  });

  it.each(ALL)("6. %s events all use the v1 vocabulary", (_name, fx) => {
    for (const e of fx.events) expect(KNOWN_TYPES).toContain(e.type);
  });

  it.each(ALL)("7. %s events all have a valid actor", (_name, fx) => {
    for (const e of fx.events) expect(VALID_ACTORS.has(e.actor)).toBe(true);
  });

  it.each(ALL)("8. %s contains no node.invalidated event", (_name, fx) => {
    expect(fx.events.some((e) => e.type === "node.invalidated")).toBe(false);
  });

  it.each(ALL)("9. %s embeds no heavy payload keys (uses *Ref instead)", (_name, fx) => {
    for (const e of fx.events) {
      for (const key of HEAVY_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(payload(e), key)).toBe(false);
      }
    }
  });

  it.each(ALL)("10. %s critical events reference heavy artifacts via *Ref", (_name, fx) => {
    for (const e of fx.events) {
      if (e.type === "conflict.detected") {
        expect(typeof payload(e).diagnosisRef).toBe("string");
      }
      if (e.type === "run.evidence.ready") {
        expect(typeof payload(e).aggregateDiffRef).toBe("string");
        expect(typeof payload(e).narrativeRef).toBe("string");
      }
      if (e.type === "integration.validated" && payload(e).passed === false) {
        expect(typeof payload(e).failuresRef).toBe("string");
      }
    }
  });

  it.each(ALL)("11. %s records builtAgainst on verify.passed and integration.validated", (_name, fx) => {
    for (const e of fx.events) {
      if (e.type === "node.verify.passed" || e.type === "integration.validated") {
        expect(Array.isArray(payload(e).builtAgainst)).toBe(true);
      }
    }
  });
});

describe("golden fixtures — scenario specifics", () => {
  it("12. golden-planning-question has a clarify decision answered by the human", () => {
    const raised = goldenPlanningQuestion.events.find(
      (e) => e.type === "decision.raised" && payload(e).kind === "clarify"
    );
    const resolved = goldenPlanningQuestion.events.find(
      (e) => e.type === "decision.resolved" && hasAnswer(payload(e).choice)
    );
    expect(raised).toBeDefined();
    expect(resolved).toBeDefined();
  });

  it("13. golden-verify-auto-repair has a repair and raises NO decision", () => {
    expect(goldenVerifyAutoRepair.events.some((e) => e.type === "node.repair.started")).toBe(true);
    expect(goldenVerifyAutoRepair.events.some((e) => e.type === "decision.raised")).toBe(false);
  });

  it("14. golden-behavioral-conflict raises resolve_conflict atomically after a behavioral conflict", () => {
    const events = goldenBehavioralConflict.events;
    const idx = events.findIndex((e) => e.type === "conflict.detected" && payload(e).dimension === "behavioral");
    expect(idx).toBeGreaterThanOrEqual(0);
    const next = events[idx + 1]!;
    expect(next.type).toBe("decision.raised");
    expect(payload(next).kind).toBe("resolve_conflict");
  });

  it("15. golden-behavioral-conflict amends the seam contract (not the signature)", () => {
    const amended = goldenBehavioralConflict.events.find((e) => e.type === "seam.amended");
    expect(amended).toBeDefined();
    expect(payload(amended!).changeKind).toBe("contract");
  });

  it("16. golden-seam-amendment-blast-radius raises approve_amendment atomically after a signature amendment", () => {
    const events = goldenSeamAmendmentBlastRadius.events;
    const idx = events.findIndex((e) => e.type === "amendment.proposed" && payload(e).changeKind === "signature");
    expect(idx).toBeGreaterThanOrEqual(0);
    const next = events[idx + 1]!;
    expect(next.type).toBe("decision.raised");
    expect(payload(next).kind).toBe("approve_amendment");
  });

  it("17. golden-seam-amendment-blast-radius evidence carries an invalidationTrace", () => {
    const evidence = goldenSeamAmendmentBlastRadius.events.find((e) => e.type === "run.evidence.ready");
    expect(evidence).toBeDefined();
    const trace = payload(evidence!).invalidationTrace;
    expect(Array.isArray(trace)).toBe(true);
    expect((trace as unknown[]).length).toBeGreaterThan(0);
  });

  it("18. golden-seam-amendment-blast-radius never re-runs the unaffected node", () => {
    const starts = goldenSeamAmendmentBlastRadius.events.filter(
      (e) => e.type === "node.execution.started" && payload(e).nodeId === "n-telemetry"
    );
    expect(starts.length).toBeLessThanOrEqual(1);
  });

  it("19. golden-support-desk-saas is a full product slice with repair and selective re-execution", () => {
    const events = goldenSupportDeskSaas.events;
    expect(events.filter((event) => event.type === "plan.node.proposed")).toHaveLength(12);
    expect(events.some((event) => event.type === "node.repair.started" && payload(event).nodeId === "n-ticket-domain")).toBe(true);
    expect(events.some((event) => event.type === "amendment.proposed" && payload(event).amendmentId === "am-sla-timezone")).toBe(true);
    expect(events.some((event) => event.type === "decision.raised" && payload(event).kind === "approve_amendment")).toBe(true);

    const startsFor = (nodeId: string) => events.filter(
      (event) => event.type === "node.execution.started" && payload(event).nodeId === nodeId
    ).length;
    expect(startsFor("n-ticket-api")).toBe(2);
    expect(startsFor("n-auth")).toBe(1);
    expect(startsFor("n-audit")).toBe(1);

    const evidence = events.find((event) => event.type === "run.evidence.ready");
    expect(payload(evidence!).tests).toEqual({ pass: 43, total: 43 });
    expect(payload(evidence!).invalidationTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ preserved: expect.arrayContaining(["n-auth", "n-audit"]) })
    ]));
  });

  it("20. golden-subscriptions-billing-saas preserves human planning input and repairs a structural integration conflict autonomously", () => {
    const events = goldenSubscriptionsBillingSaas.events;
    expect(events.filter((event) => event.type === "plan.node.proposed")).toHaveLength(13);
    expect(events.some((event) => event.type === "decision.raised" && payload(event).kind === "clarify")).toBe(true);
    expect(events.some((event) => event.type === "decision.resolved" && hasAnswer(payload(event).choice))).toBe(true);

    const conflictIndex = events.findIndex(
      (event) => event.type === "conflict.detected" && payload(event).conflictId === "cf-billing-event-order"
    );
    expect(conflictIndex).toBeGreaterThanOrEqual(0);
    expect(events[conflictIndex + 1]!.type).toBe("conflict.resolved");
    expect(payload(events[conflictIndex + 1]!).by).toBe("system");

    const selected = events.filter((event) => event.type === "run.scheduling.wave_selected");
    expect(selected).toHaveLength(4);
    expect(selected.every((event) => payload(event).maxParallel === 3)).toBe(true);
    expect(events.find((event) => event.type === "run.evidence.ready")?.payload.tests).toEqual({ pass: 38, total: 38 });
  });

  it("21. golden-deep-import-pipeline is narrow, deep, and ready for a paced presentation", () => {
    const events = goldenDeepImportPipeline.events;
    const nodes = events.filter((event) => event.type === "plan.node.proposed").map((event) => payload(event));
    expect(nodes).toHaveLength(15);
    expect(Math.max(...nodes.map((node) => Number(node.depth)))).toBe(8);
    const childrenByParent = new Map<string, number>();
    for (const node of nodes) {
      if (typeof node.parentId !== "string") continue;
      childrenByParent.set(node.parentId, (childrenByParent.get(node.parentId) ?? 0) + 1);
    }
    expect(Math.max(...childrenByParent.values())).toBeLessThanOrEqual(2);

    const decisions = events.filter((event) => event.type === "decision.raised").map((event) => payload(event).kind);
    expect(decisions).toEqual(expect.arrayContaining(["clarify", "approve_plan", "approve_amendment", "approve_merge"]));
    expect(events.filter((event) => event.type === "seam.frozen")).toHaveLength(5);
    expect(events.filter((event) => event.type === "node.execution.started" && payload(event).nodeId === "n-dialect")).toHaveLength(2);
    expect(events.filter((event) => event.type === "node.execution.started" && payload(event).nodeId === "n-upload")).toHaveLength(1);
    expect(goldenDeepImportPipeline.playback?.delaysMs).toHaveLength(events.length);
    expect(Math.max(...(goldenDeepImportPipeline.playback?.delaysMs ?? []))).toBeGreaterThanOrEqual(3200);
  });

  it("22. golden-appointment-booking is a hybrid technical product graph with a complete presentation arc", () => {
    const events = goldenAppointmentBooking.events;
    const nodes = events.filter((event) => event.type === "plan.node.proposed").map((event) => payload(event));
    expect(nodes).toHaveLength(23);
    expect(Math.max(...nodes.map((node) => Number(node.depth)))).toBe(3);

    const rootChildren = nodes.filter((node) => node.parentId === "root").map((node) => node.nodeId);
    expect(rootChildren).toEqual(["c-backend", "c-customer-web", "c-operations"]);

    const childrenByParent = new Map<string, number>();
    for (const node of nodes) {
      if (typeof node.parentId !== "string") continue;
      childrenByParent.set(node.parentId, (childrenByParent.get(node.parentId) ?? 0) + 1);
    }
    expect(Math.max(...childrenByParent.values())).toBe(3);

    expect(events.filter((event) => event.type === "seam.frozen")).toHaveLength(9);
    expect(events.filter((event) => event.type === "plan.dependency.proposed").length).toBeGreaterThanOrEqual(8);

    const decisions = events.filter((event) => event.type === "decision.raised").map((event) => payload(event).kind);
    expect(decisions).toEqual(expect.arrayContaining(["clarify", "approve_plan", "approve_amendment", "approve_merge"]));

    expect(events.some((event) => event.type === "node.repair.started" && payload(event).nodeId === "n-concurrency-guard")).toBe(true);
    const conflictIndex = events.findIndex((event) => event.type === "conflict.detected" && payload(event).conflictId === "cf-booking-status-view");
    expect(conflictIndex).toBeGreaterThanOrEqual(0);
    expect(events[conflictIndex + 1]?.type).toBe("conflict.resolved");
    expect(payload(events[conflictIndex + 1]!).by).toBe("system");

    expect(events.some((event) => event.type === "amendment.proposed" && payload(event).amendmentId === "am-booking-timezone")).toBe(true);
    const startsFor = (nodeId: string) => events.filter(
      (event) => event.type === "node.execution.started" && payload(event).nodeId === nodeId
    ).length;
    expect(startsFor("n-persist-booking")).toBe(2);
    expect(startsFor("n-business-hours")).toBe(1);

    const evidence = events.find((event) => event.type === "run.evidence.ready");
    expect(payload(evidence!).tests).toEqual({ pass: 52, total: 52 });
    expect(goldenAppointmentBooking.playback?.delaysMs).toHaveLength(events.length);
    expect(Math.max(...(goldenAppointmentBooking.playback?.delaysMs ?? []))).toBeGreaterThanOrEqual(3400);
  });
});

function hasAnswer(choice: unknown): boolean {
  return typeof choice === "object" && choice !== null && "answer" in choice;
}
