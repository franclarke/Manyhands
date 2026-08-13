import { describe, expect, it, vi } from "vitest";
import {
  compilePlan,
  PlanningEngine,
  type PlanningModel,
  type PlanningModelProposal,
  type RepositoryInspectionAllowance,
  type PlanningRepositoryReader
} from "@manyhands/decomposer";
import { buildSemanticPlan } from "@manyhands/contracts";
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
    expect(result.kind, JSON.stringify(result, null, 2)).toBe("ready");
    expect(result.trace.consumed).toMatchObject({ modelCalls: 2, repositoryQueries: 1, revisions: 1 });
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

  it.each(["needs_input", "ambiguous"] as const)(
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
          : { kind, decisions: [decision()], alternatives: [
              { id: "alternative:a", proposalDigest: "sha256:a", summary: "A owns the seam.", evidenceRefs: [] },
              { id: "alternative:b", proposalDigest: "sha256:b", summary: "B owns the seam.", evidenceRefs: [] }
            ] };
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

  it("does not invoke repository inspection when no query allowance remains", async () => {
    const fixture = stage5Fixture();
    const inspect = vi.fn(async () => repositoryInspection());
    const model: PlanningModel = { propose: vi.fn() };
    const engine = new PlanningEngine({ model, repository: { inspect }, hasher: stage5Sha256 });

    const result = await engine.plan({
      ...request(fixture),
      budget: { ...budget(), repositoryQueries: 0, queryBytes: 0 }
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    expect(inspect).not.toHaveBeenCalled();
    expect(model.propose).not.toHaveBeenCalled();
    expect(result.trace.consumed).toMatchObject({ repositoryQueries: 0, queryBytes: 0 });
  });

  it("passes an immutable allowance and never records usage beyond it", async () => {
    const fixture = stage5Fixture();
    const allowances: RepositoryInspectionAllowance[] = [];
    const engine = new PlanningEngine({
      model: { propose: vi.fn() },
      repository: {
        inspect: async (input) => {
          allowances.push(input.allowance);
          return repositoryInspection({ repositoryQueries: input.allowance.repositoryQueries + 1 });
        }
      },
      hasher: stage5Sha256
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("rejected");
    expect(allowances).toEqual([{ repositoryQueries: 4, queryBytes: 10_000 }]);
    expect(result.trace.consumed.repositoryQueries).toBeLessThanOrEqual(result.trace.budget.repositoryQueries);
    expect(result.trace.consumed.queryBytes).toBeLessThanOrEqual(result.trace.budget.queryBytes);
  });

  it("terminates a non-consecutive A-B-A proposal cycle as no_progress", async () => {
    const fixture = stage5Fixture();
    const materials = ["resource:missing-a", "resource:missing-b"].map((resourceId) => {
      const material = withoutDigest(fixture.plan);
      material.units["unit:a"]!.resourceIntents[0]!.resourceId = resourceId;
      return material;
    });
    let call = 0;
    const model: PlanningModel = {
      propose: vi.fn(async (): Promise<PlanningModelProposal> => ({
        kind: "candidate",
        material: materials[call++ % 2]!
      }))
    };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });

    const result = await engine.plan({
      ...request(fixture),
      budget: { ...budget(), modelCalls: 4, revisions: 4, repairs: 3 }
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("no_progress");
    expect(model.propose).toHaveBeenCalledTimes(3);
  });

  it("shares the model-call budget with the optional critic", async () => {
    const fixture = stage5Fixture();
    const critic = { review: vi.fn(async () => []) };
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256,
      critic
    });

    const result = await engine.plan({ ...request(fixture), budget: { ...budget(), modelCalls: 1 } }, new AbortController().signal);
    expect(result.kind).toBe("ready");
    expect(critic.review).not.toHaveBeenCalled();
    expect(result.trace.consumed.modelCalls).toBe(1);
  });

  it("preserves deterministic non-blocking verifier findings when the critic is skipped", async () => {
    const fixture = stage5Fixture();
    fixture.repositoryView.model.coverage = {
      treeEntryCount: 2,
      sourceEntryCount: 2,
      parsedSourceCount: 1,
      unsupportedEntryCount: 1,
      disposition: "partial",
      evidenceRefs: ["evidence:architecture"]
    };
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.plan({ ...request(fixture), budget: { ...budget(), modelCalls: 1 } }, new AbortController().signal);
    expect(result.kind).toBe("ready");
    expect(result.trace.advisoryFindings).toContainEqual(expect.objectContaining({
      code: "repository_model_coverage_incomplete",
      authority: "repository"
    }));
  });

  it("counts the optional critic when budget permits it", async () => {
    const fixture = stage5Fixture();
    const critic = { review: vi.fn(async () => []) };
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256,
      critic
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("ready");
    expect(critic.review).toHaveBeenCalledTimes(1);
    expect(result.trace.consumed.modelCalls).toBe(2);
  });

  it("does not elevate a model-authored terminal opinion to deterministic authority", async () => {
    const fixture = stage5Fixture();
    const engine = new PlanningEngine({
      model: { propose: async () => ({
        kind: "rejected",
        findings: [{ code: "model_says_invalid", message: "I dislike it.", evidenceRefs: [] }]
      } as never) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings).toEqual([expect.objectContaining({ code: "model_protocol_invalid", authority: "deterministic" })]);
    expect(result.findings.map(({ code }) => code)).not.toContain("model_says_invalid");
  });

  it.each([
    { kind: "candidate", material: undefined },
    { kind: "needs_input", decisions: [null] },
    { kind: "ambiguous", decisions: [], alternatives: [null] }
  ])("validates the complete model protocol at runtime", async (proposal) => {
    const fixture = stage5Fixture();
    const engine = new PlanningEngine({
      model: { propose: async () => proposal as never },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toEqual(["model_protocol_invalid"]);
  });

  it("rejects duplicate decision options and duplicate ambiguous alternatives", async () => {
    const fixture = stage5Fixture();
    const duplicateDecision = decision();
    duplicateDecision.options[1]!.id = duplicateDecision.options[0]!.id;
    const alternative = { id: "alternative:a", proposalDigest: "sha256:a", summary: "A owns the seam.", evidenceRefs: [] };
    const proposals = [
      { kind: "needs_input", decisions: [duplicateDecision] },
      { kind: "ambiguous", decisions: [decision()], alternatives: [alternative, alternative] }
    ];
    for (const proposal of proposals) {
      const engine = new PlanningEngine({
        model: { propose: async () => proposal as never },
        repository: repository(),
        hasher: stage5Sha256
      });
      const result = await engine.plan(request(fixture), new AbortController().signal);
      expect(result.kind).toBe("rejected");
      expect(result.kind === "rejected" && result.findings.map(({ code }) => code)).toEqual(["model_protocol_invalid"]);
    }
  });

  it("derives unsupported only from repository capability evidence", async () => {
    const fixture = stage5Fixture();
    const model: PlanningModel = { propose: vi.fn() };
    const engine = new PlanningEngine({
      model,
      repository: repository({ missingCapabilities: ["parser:language"] }),
      hasher: stage5Sha256
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("unsupported");
    expect(model.propose).not.toHaveBeenCalled();
  });

  it("rejects an expansion that targets no frontier", async () => {
    const fixture = stage5Fixture();
    const model: PlanningModel = { propose: vi.fn() };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });

    const result = await engine.expand({
      ...request(fixture), basePlan: fixture.plan, unitId: "unit:does-not-exist"
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    expect(model.propose).not.toHaveBeenCalled();
  });

  it("terminates an expansion that echoes its base plan", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(basePlan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.expand({
      ...request(fixture), basePlan, unitId: "unit:a"
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("no_progress");
  });

  it("expands from a verified, compileable frontier plan", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const expandedMaterial = expandedFrontierMaterial(basePlan);
    expect(() => buildSemanticPlan(expandedMaterial, stage5Sha256)).not.toThrow();
    const compiled = compilePlan({
      ...fixture,
      plan: basePlan,
      hasher: stage5Sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    expect(compiled.ok).toBe(true);
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: expandedMaterial }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.expand({
      ...request(fixture), basePlan, unitId: "unit:a"
    }, new AbortController().signal);

    expect(result.kind, JSON.stringify(result, null, 2)).toBe("ready");
    expect(result.kind === "ready" && result.plan.revision).toBe(basePlan.revision + 1);
  });

  it("requires an expansion to be the next revision inside the target envelope", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const material = expandedFrontierMaterial(basePlan);
    material.units["unit:b"]!.objective = "Unrelated mutation.";
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.expand({
      ...request(fixture), basePlan, unitId: "unit:a"
    }, new AbortController().signal);

    expect(result.kind).toBe("needs_input");
  });

  it("does not accept a successor revision that leaves the expansion target as a frontier", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const material = withoutDigest(basePlan);
    material.revision += 1;
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.expand({
      ...request(fixture), basePlan, unitId: "unit:a"
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("expansion_not_materialized");
  });

  it("requires amendment when the expanded target itself broadens its resource envelope", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const material = expandedFrontierMaterial(basePlan);
    material.units["unit:a"]!.repositorySurface.resourceRefs.push("resource:b");
    material.units["unit:a"]!.repositorySurface.pathHints.push("src/b.ts");
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.expand({
      ...request(fixture), basePlan, unitId: "unit:a"
    }, new AbortController().signal);

    expect(result.kind).toBe("needs_input");
  });

  it("requires amendments to produce the immediate successor revision", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const authorization = await amendmentAuthorization(fixture, basePlan);
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(basePlan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.amend({
      ...request(fixture), basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization
    }, new AbortController().signal);

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.findings.map(({ code }) => code)).toContain("no_progress");
  });

  it("binds expansion and amendment lineage to the base plan and selected decisions", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const authorization = await amendmentAuthorization(fixture, basePlan);
    const amendment = withoutDigest(basePlan);
    amendment.revision += 1;
    amendment.decisions.push({
      id: "decision:owner",
      statement: "A owns the surface.",
      selectedOptionId: "option:a",
      evidenceRefs: []
    });
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: amendment }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.amend({
      ...request(fixture), basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization
    }, new AbortController().signal);

    expect(result.kind).toBe("ready");
    expect(result.trace.revisions.at(-1)).toMatchObject({
      parentDigest: authorization.priorTrace.revisions.at(-1)!.digest,
      cause: "human_decision",
      changedDecisionIds: ["decision:owner"]
    });
  });

  it("continues an initial needs_input plan only with its exact authorized decision", async () => {
    const fixture = stage5Fixture();
    const decisionDraft = decision();
    const authorizer = new PlanningEngine({
      model: { propose: async () => ({ kind: "needs_input", decisions: [decisionDraft] }) },
      repository: repository(),
      hasher: stage5Sha256
    });
    const pending = await authorizer.plan(request(fixture), new AbortController().signal);
    expect(pending.kind).toBe("needs_input");
    if (pending.kind !== "needs_input") return;

    const responder = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });
    const result = await responder.continue({
      ...request(fixture),
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      continuation: pending.continuation,
      continuationContext: {
        operation: "plan",
        decisions: [],
        proofStrategyDigests: fixture.proofStrategies.map(({ digest }) => digest)
      },
      decisionDrafts: pending.decisions,
      priorTrace: pending.trace
    }, new AbortController().signal);

    expect(result.kind).toBe("ready");
    expect(result.trace.revisions.at(-1)).toMatchObject({
      parentDigest: pending.continuation.revisionDigest,
      cause: "human_decision",
      changedDecisionIds: ["decision:owner"]
    });
  });

  it("rejects amendments that are not bound to the exact continuation decision set and trace", async () => {
    const fixture = stage5Fixture();
    const basePlan = frontierPlan(fixture);
    const authorization = await amendmentAuthorization(fixture, basePlan);
    const model: PlanningModel = { propose: vi.fn() };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });

    const invalidSelection = await engine.amend({
      ...request(fixture),
      basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:invented" }],
      ...authorization
    }, new AbortController().signal);
    expect(invalidSelection.kind).toBe("rejected");
    expect(invalidSelection.kind === "rejected" && invalidSelection.findings.map(({ code }) => code))
      .toEqual(["amendment_selection_invalid"]);

    const substitutedDrafts = structuredClone(authorization.decisionDrafts);
    substitutedDrafts[0]!.options[0]!.label = "Substituted after continuation";
    const substituted = await engine.amend({
      ...request(fixture),
      basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization,
      decisionDrafts: substitutedDrafts
    }, new AbortController().signal);
    expect(substituted.kind).toBe("rejected");
    expect(substituted.kind === "rejected" && substituted.findings.map(({ code }) => code))
      .toEqual(["continuation_decisions_mismatch"]);

    const forgedTrace = structuredClone(authorization.priorTrace);
    forgedTrace.revisions[0]!.changedDecisionIds = ["decision:forged"];
    const forged = await engine.amend({
      ...request(fixture),
      basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization,
      priorTrace: forgedTrace
    }, new AbortController().signal);
    expect(forged.kind).toBe("rejected");
    expect(forged.kind === "rejected" && forged.findings.map(({ code }) => code))
      .toEqual(["continuation_trace_invalid"]);

    const expandedBudget = await engine.amend({
      ...request(fixture),
      budget: { ...budget(), modelCalls: 100 },
      basePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization
    }, new AbortController().signal);
    expect(expandedBudget.kind).toBe("rejected");
    expect(expandedBudget.kind === "rejected" && expandedBudget.findings.map(({ code }) => code))
      .toEqual(["continuation_trace_invalid"]);

    const staleBasePlan = structuredClone(basePlan);
    staleBasePlan.units["unit:a"]!.objective = "Mutated without recomputing the canonical digest.";
    const staleBase = await engine.amend({
      ...request(fixture),
      basePlan: staleBasePlan,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization
    }, new AbortController().signal);
    expect(staleBase.kind).toBe("rejected");
    expect(staleBase.kind === "rejected" && staleBase.findings.map(({ code }) => code))
      .toEqual(["base_plan_digest_mismatch"]);
    expect(model.propose).not.toHaveBeenCalled();
  });

  it("routes missing proof authority to bounded human input", async () => {
    const fixture = stage5Fixture();
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });

    const result = await engine.plan({ ...request(fixture), proofStrategies: [] }, new AbortController().signal);
    expect(result.kind).toBe("needs_input");
    if (result.kind !== "needs_input") return;
    expect(result.decisions).toEqual([expect.objectContaining({ id: "decision:proof-authority" })]);
    expect(result.continuation.revisionDigest).toBeTruthy();
  });

  it("accepts the same plan after a continuation supplies newly authorized proof", async () => {
    const fixture = stage5Fixture();
    const authorizer = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });
    const pending = await authorizer.plan({ ...request(fixture), proofStrategies: [] }, new AbortController().signal);
    expect(pending.kind).toBe("needs_input");
    if (pending.kind !== "needs_input") return;

    const responder = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256
    });
    const result = await responder.continue({
      ...request(fixture),
      decisions: [{ id: "decision:proof-authority", selectedOptionId: "option:provide-proof" }],
      continuation: pending.continuation,
      continuationContext: { operation: "plan", decisions: [], proofStrategyDigests: [] },
      decisionDrafts: pending.decisions,
      priorTrace: pending.trace
    }, new AbortController().signal);

    expect(result.kind).toBe("ready");
  });

  it("keeps a deterministically ready plan when the advisory critic is unavailable", async () => {
    const fixture = stage5Fixture();
    const engine = new PlanningEngine({
      model: { propose: async () => ({ kind: "candidate", material: withoutDigest(fixture.plan) }) },
      repository: repository(),
      hasher: stage5Sha256,
      critic: { review: async () => { throw new Error("critic unavailable"); } }
    });

    const result = await engine.plan(request(fixture), new AbortController().signal);
    expect(result.kind).toBe("ready");
    expect(result.trace.consumed.modelCalls).toBe(2);
    expect(result.trace.advisoryFindings).toContainEqual(expect.objectContaining({
      code: "critic_unavailable",
      authority: "model_advisory"
    }));
  });

  it("exposes plan, expand and amend as bounded operations", async () => {
    const fixture = stage5Fixture();
    const baseFrontier = frontierPlan(fixture);
    const authorization = await amendmentAuthorization(fixture, baseFrontier);
    const operations: string[] = [];
    const model: PlanningModel = {
      propose: async (input) => {
        operations.push(input.operation);
        const material = withoutDigest(fixture.plan);
        if (input.operation !== "plan") material.revision = input.basePlan!.revision + 1;
        return { kind: "candidate", material };
      }
    };
    const engine = new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 });
    const signal = new AbortController().signal;

    await engine.plan(request(fixture), signal);
    await engine.expand({ ...request(fixture), basePlan: baseFrontier, unitId: "unit:a" }, signal);
    await engine.amend({
      ...request(fixture),
      basePlan: baseFrontier,
      decisions: [{ id: "decision:owner", selectedOptionId: "option:a" }],
      ...authorization
    }, signal);
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
    inspect: async () => repositoryInspection(overrides)
  };
}

function repositoryInspection(overrides: Partial<Awaited<ReturnType<PlanningRepositoryReader["inspect"]>>> = {}) {
  return {
    queryReceipts: ["query:architecture"],
    evidenceRefs: ["evidence:architecture"],
    repositoryQueries: 1,
    queryBytes: 1_024,
    missingCapabilities: [],
    ...overrides
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

function frontierPlan(fixture: ReturnType<typeof stage5Fixture>) {
  const material = withoutDigest(fixture.plan);
  material.units["unit:a"]!.role = "composite";
  material.units["unit:a"]!.expansion = "frontier";
  material.units["unit:a"]!.granularity = {
    ...material.units["unit:a"]!.granularity,
    disposition: "frontier",
    integrationObligationId: undefined
  };
  material.units["unit:a"]!.integration = {
    obligationId: "validation:a",
    objective: "Integrate the eventual children.",
    criterionIds: ["criterion:feature"],
    proofStrategyId: "proof:a",
    artifactIds: ["artifact:a"],
    seamIds: ["seam:a-b"]
  };
  return buildSemanticPlan(material, stage5Sha256);
}

function expandedFrontierMaterial(basePlan: ReturnType<typeof frontierPlan>) {
  const material = withoutDigest(basePlan);
  material.revision += 1;
  const target = material.units["unit:a"]!;
  const child = structuredClone(target);
  child.id = "unit:a-child";
  child.parentId = "unit:a";
  child.role = "leaf";
  child.expansion = "leaf";
  child.granularity = { ...child.granularity, disposition: "leaf", splitReasons: [], expectedBenefits: [], expectedCosts: [], integrationObligationId: undefined };
  child.integration = undefined;
  child.validation = [{
    ...child.validation[0]!,
    obligationId: "validation:a-child",
    proofStrategyId: "proof:a-child"
  }];
  const secondChild = structuredClone(child);
  secondChild.id = "unit:a-child-2";
  secondChild.title = "Module A integration check";
  secondChild.objective = "Validate the second bounded responsibility inside module A.";
  secondChild.repositorySurface = { resourceRefs: ["resource:a"], pathHints: ["src/a.ts"] };
  secondChild.resourceIntents = [{
    resourceId: "resource:a",
    access: "observe",
    evidenceRefs: ["evidence:a"],
    epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:a"] }
  }];
  secondChild.consumes = ["artifact:a"];
  secondChild.produces = [];
  secondChild.seamRefs = [];
  secondChild.validation = [{
    ...secondChild.validation[0]!,
    obligationId: "validation:a-child-2",
    proofStrategyId: "proof:a-child-2"
  }];
  target.expansion = "expanded";
  target.granularity = { ...target.granularity, disposition: "split", splitReasons: ["integration_boundary"], integrationObligationId: "validation:a" };
  target.resourceIntents = [];
  target.produces = [];
  target.consumes = ["artifact:a"];
  target.seamRefs = [];
  target.integration = {
    obligationId: "validation:a",
    objective: "Integrate the expanded responsibility.",
    criterionIds: ["criterion:feature"],
    proofStrategyId: "proof:a",
    artifactIds: ["artifact:a"],
    seamIds: []
  };
  material.units[child.id] = child;
  material.units[secondChild.id] = secondChild;
  material.artifacts["artifact:a"]!.producerUnitId = child.id;
  material.artifacts["artifact:a"]!.consumerUnitIds.push(target.id, secondChild.id);
  material.seams["seam:a-b"]!.producerUnitId = child.id;
  return material;
}

async function amendmentAuthorization(
  fixture: ReturnType<typeof stage5Fixture>,
  basePlan: ReturnType<typeof frontierPlan>
) {
  const decisionDraft = decision();
  const authorizer = new PlanningEngine({
    model: { propose: async () => ({ kind: "needs_input", decisions: [decisionDraft] }) },
    repository: repository(),
    hasher: stage5Sha256
  });
  const result = await authorizer.expand({
    ...request(fixture),
    basePlan,
    unitId: "unit:a"
  }, new AbortController().signal);
  if (result.kind !== "needs_input") throw new Error(`Expected needs_input authorization, received ${result.kind}.`);
  return {
    continuation: result.continuation,
    continuationContext: {
      operation: "expand" as const,
      basePlanDigest: basePlan.digest,
      unitId: "unit:a",
      decisions: [],
      proofStrategyDigests: fixture.proofStrategies.map(({ digest }) => digest)
    },
    decisionDrafts: result.decisions,
    priorTrace: result.trace
  };
}
