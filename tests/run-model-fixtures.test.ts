import { describe, expect, it } from "vitest";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenBehavioralConflict,
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenSeamAmendmentBlastRadius,
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
  it("1. exports the five golden fixtures from the index", () => {
    expect(GOLDEN_FIXTURE_NAMES).toEqual([
      "golden-happy-path",
      "golden-planning-question",
      "golden-verify-auto-repair",
      "golden-behavioral-conflict",
      "golden-seam-amendment-blast-radius"
    ]);
    expect(goldenHappyPath).toBeDefined();
    expect(goldenPlanningQuestion).toBeDefined();
    expect(goldenVerifyAutoRepair).toBeDefined();
    expect(goldenBehavioralConflict).toBeDefined();
    expect(goldenSeamAmendmentBlastRadius).toBeDefined();
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
});

function hasAnswer(choice: unknown): boolean {
  return typeof choice === "object" && choice !== null && "answer" in choice;
}
