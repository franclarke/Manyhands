import { describe, expect, it, vi } from "vitest";
import {
  PlanningEngine,
  type PlanningModel,
  type PlanningModelProposal,
  type PlanningRepositoryReader
} from "@manyhands/decomposer";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const budget = () => ({
  modelCalls: 3,
  repositoryQueries: 4,
  queryBytes: 10_000,
  revisions: 3,
  repairs: 2,
  expansions: 1
});

describe("Stage 5 progressive PlanningEngine", () => {
  it("returns a verified ready plan with attributable unified-budget trace", async () => {
    const fixture = stage5Fixture();
    const model: PlanningModel = {
      propose: vi.fn(async (): Promise<PlanningModelProposal> => ({ kind: "candidate", material: withoutDigest(fixture.plan) }))
    };
    const engine = new PlanningEngine({
      model,
      repository: repository(),
      hasher: stage5Sha256,
      critic: { review: async () => [{
        code: "model_style_risk",
        message: "The decomposition may be harder to explain.",
        resolution: "human_decision",
        evidenceRefs: []
      }] }
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("ready");
    expect(result.trace.consumed).toMatchObject({ modelCalls: 1, repositoryQueries: 1, revisions: 1 });
    expect(result.trace.advisoryFindings).toEqual([expect.objectContaining({
      code: "model_style_risk",
      severity: "advisory",
      authority: "model_advisory"
    })]);
  });

  it("terminates an equivalent repair with no_progress instead of retrying", async () => {
    const fixture = stage5Fixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.resourceIntents[0]!.resourceId = "resource:missing";
    const model: PlanningModel = { propose: vi.fn(async (): Promise<PlanningModelProposal> => ({ kind: "candidate", material })) };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("no_progress");
    expect(model.propose).toHaveBeenCalledTimes(2);
    expect(result.trace.revisions).toHaveLength(1);
  });

  it.each(["needs_input", "ambiguous", "unsupported"] as const)(
    "preserves the explicit %s outcome without a partial plan",
    async (kind) => {
      const fixture = stage5Fixture();
      const proposal: PlanningModelProposal = kind === "needs_input"
        ? { kind, decisions: [decision()] }
        : kind === "ambiguous"
          ? { kind, decisions: [decision()], alternatives: [
              { id: "alternative:a", proposalDigest: "sha256:a", summary: "A owns the seam.", evidenceRefs: [] },
              { id: "alternative:b", proposalDigest: "sha256:b", summary: "B owns the seam.", evidenceRefs: [] }
            ] }
          : { kind, findings: [{ code: "language_unsupported", message: "Parser unavailable.", evidenceRefs: [] }], missingCapabilities: ["parser:language"] };
      const engine = new PlanningEngine({
        model: { propose: async () => proposal },
        repository: repository(),
        hasher: stage5Sha256
      });

      const result = await engine.plan(request(fixture), new AbortController().signal);
      expect(result.kind).toBe(kind);
      expect("plan" in result).toBe(false);
    }
  );

  it("fails closed before a model call when repository usage exceeds budget", async () => {
    const fixture = stage5Fixture();
    const model: PlanningModel = { propose: vi.fn(async (): Promise<PlanningModelProposal> => ({ kind: "candidate", material: withoutDigest(fixture.plan) })) };
    const engine = new PlanningEngine({
      model,
      repository: repository({ queryBytes: 20_000 }),
      hasher: stage5Sha256
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("budget_exhausted");
    expect(model.propose).not.toHaveBeenCalled();
  });

  it("exposes plan, expand and amend as bounded operations", async () => {
    const fixture = stage5Fixture();
    const operations: string[] = [];
    const model: PlanningModel = {
      propose: async (input) => {
        operations.push(input.operation);
        return { kind: "candidate", material: withoutDigest(fixture.plan) };
      }
    };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });
    const signal = new AbortController().signal;

    await engine.plan(request(fixture), signal);
    await engine.expand({ ...request(fixture), basePlan: fixture.plan, unitId: "unit:root" }, signal);
    await engine.amend({ ...request(fixture), basePlan: fixture.plan, decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }] }, signal);
    expect(operations).toEqual(["plan", "expand", "amend"]);
  });
});

function request(fixture: ReturnType<typeof stage5Fixture>) {
  return {
    goal: fixture.goal,
    repositoryView: fixture.repositoryView,
    proofStrategies: fixture.proofStrategies,
    budget: budget()
  };
}

function repository(overrides: Partial<Awaited<ReturnType<PlanningRepositoryReader["inspect"]>>> = {}): PlanningRepositoryReader {
  return {
    inspect: async () => ({
      queryReceipts: ["query:architecture"],
      evidenceRefs: ["evidence:architecture"],
      repositoryQueries: 1,
      queryBytes: 1_024,
      missingCapabilities: [],
      ...overrides
    })
  };
}

function decision() {
  return {
    id: "decision:owner",
    question: "Which unit owns the shared surface?",
    rationale: "Both alternatives remain repository-grounded.",
    options: [
      { id: "option:a", label: "A", consequences: ["A owns the surface."] },
      { id: "option:b", label: "B", consequences: ["B owns the surface."] }
    ],
    evidenceRefs: ["evidence:architecture"]
  };
}

function withoutDigest(plan: ReturnType<typeof stage5Fixture>["plan"]) {
  const material = structuredClone(plan);
  Reflect.deleteProperty(material, "digest");
  return material;
}
