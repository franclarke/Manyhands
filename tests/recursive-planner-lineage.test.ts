import { describe, expect, it } from "vitest";
import {
  CutFeasibilityCritic,
  RecursivePlanner,
  type CutRequest,
  type UnitProposal
} from "@manyhands/decomposer";

const DOMAIN = "src/domain/orders.mjs";
const APPLICATION = "src/application/order-service.mjs";
const API = "src/api/warehouse-api.mjs";
const TEST_DOMAIN = "test/domain.test.mjs";
const TEST_APPLICATION = "test/application.test.mjs";
const TEST_API = "test/api.test.mjs";

const CRITERIA = [1, 2, 3, 4].map((number) => ({
  id: `criterion-${number}`,
  description: number === 2 ? `Domain behavior in ${DOMAIN}` : `Criterion ${number}`,
  required: true
}));

const EVIDENCE = [DOMAIN, APPLICATION, API].map((reference, index) => ({
  id: `path-${index}`,
  kind: "path" as const,
  reference,
  observation: "source file",
  confidence: 1
}));

const ROOT: UnitProposal = {
  key: "root",
  objective: "Implement the warehouse order flow",
  criteria: CRITERIA,
  reads: [DOMAIN, APPLICATION, API],
  writes: []
};

function cut(children: unknown[]): string {
  return JSON.stringify({ rationale: "Split by implementation boundary", children });
}

function child(key: string, criterionIds: string[], reads: string[], writes: string[]) {
  return { key, objective: `Implement ${key}`, criterionIds, reads, writes };
}

function modelFor(first: string, second = first) {
  const seen: CutRequest[] = [];
  return {
    seen,
    async proposeCut(request: CutRequest) {
      seen.push(request);
      return request.attempt === 1 ? first : second;
    }
  };
}

const VALID = cut([
  child("domain", ["criterion-1", "criterion-2"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
  child("application", ["criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
  child("api", ["criterion-4"], [API], [API, TEST_API])
]);

describe("recursive planner criterion lineage", () => {
  it("checks a cross-cutting criterion's required paths across all contributing children", () => {
    const criterion = {
      id: "criterion-1",
      description: "Update the domain and application implementations",
      required: true,
      requiredPaths: [DOMAIN, APPLICATION]
    };
    const review = new CutFeasibilityCritic().review({
      parent: { ...ROOT, criteria: [criterion] },
      evidence: EVIDENCE,
      proposal: {
        rationale: "Split by layer",
        children: [
          child("domain", [criterion.id], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
          child("application", [criterion.id], [APPLICATION], [APPLICATION, TEST_APPLICATION])
        ]
      }
    });

    expect(review).toEqual({ ok: true });
  });

  it("does not turn a protected evidence path into a write obligation", () => {
    const protectedTest = "test/public-reservation-api-contract.test.mjs";
    const criterion = {
      id: "criterion-1",
      description: `Repair the API proven by existing failing ${protectedTest}; do not remove or weaken it`,
      required: true
    };
    const review = new CutFeasibilityCritic().review({
      parent: { ...ROOT, criteria: [criterion], reads: [...ROOT.reads, protectedTest] },
      evidence: [
        ...EVIDENCE,
        { id: "protected-test", kind: "path", reference: protectedTest, observation: "failing consumer contract", confidence: 1 }
      ],
      proposal: {
        rationale: "Repair the adapter while preserving the oracle",
        children: [child("api", [criterion.id], [API, protectedTest], [API, TEST_API])]
      }
    });

    expect(review).toEqual({ ok: true });
  });

  it("rejects an explicit required write path that no contributor writes", () => {
    const criterion = {
      id: "criterion-1",
      description: "Change the public API adapter",
      required: true,
      requiredPaths: [API]
    };
    const review = new CutFeasibilityCritic().review({
      parent: { ...ROOT, criteria: [criterion] },
      evidence: EVIDENCE,
      proposal: {
        rationale: "Tests alone cannot implement the adapter change",
        children: [child("tests", [criterion.id], [API], [TEST_API])]
      }
    });

    expect(review).toEqual({
      ok: false,
      issues: [expect.stringContaining(`requires write path ${API}`)]
    });
  });

  it("accepts one cross-cutting parent criterion carried by every contributing child", async () => {
    const sharedCriterion = [{
      id: "criterion-1",
      description: "Deliver the reservation lifecycle across the complete warehouse slice",
      required: true
    }];
    const model = modelFor(cut([
      child("domain", ["criterion-1"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-1"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-1"], [API], [API, TEST_API]),
      child("repository", ["criterion-1"], [DOMAIN], ["src/infrastructure/repository.mjs", "test/repository.test.mjs"]),
      child("dashboard", ["criterion-1"], [API], ["src/ui/dashboard.mjs", "test/dashboard.test.mjs"]),
      child("end-to-end", ["criterion-1"], [DOMAIN, APPLICATION, API], ["test/reservation-lifecycle.test.mjs"])
    ]));

    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 1 })
      .plan({ root: { ...ROOT, criteria: sharedCriterion }, criteria: sharedCriterion, evidence: EVIDENCE });

    expect(result.unresolved.flatMap((unit) => unit.diagnostics).join(" ")).not.toContain("duplicate child assignment");
    expect(result.unresolved).toHaveLength(0);
    expect(result.root.kind).toBe("composite");
  });

  it("returns a missing-parent-criterion diagnostic and repairs the cut", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-4"], [API], [API, TEST_API])
    ]), VALID);
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 2 })
      .plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(model.seen[1]?.repairIssues.join(" ")).toContain("criterion-2");
    expect(result.unresolved).toHaveLength(0);
  });

  it("does not reject a cut that omits an optional parent criterion", async () => {
    const criteria = [
      { ...CRITERIA[0]!, required: true },
      { ...CRITERIA[1]!, required: false }
    ];
    const model = modelFor(cut([
      child("domain", ["criterion-1"], [DOMAIN], [DOMAIN, TEST_DOMAIN])
    ]));
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 1 })
      .plan({ root: { ...ROOT, criteria }, criteria, evidence: EVIDENCE });

    expect(result.unresolved.flatMap((unit) => unit.diagnostics).join(" ")).not.toContain("criterion-2");
    expect(result.unresolved).toHaveLength(0);
  });

  it("shows criterion ids beside descriptions so the model can emit valid lineage", async () => {
    const model = modelFor(VALID);
    await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 1 })
      .plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(model.seen[0]?.user).toContain("criterion-1:");
    expect(model.seen[0]?.user).toContain("criterion-2:");
  });

  it("returns a duplicate-within-child diagnostic and repairs the cut", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1", "criterion-2", "criterion-2"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-4"], [API], [API, TEST_API])
    ]), VALID);
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 2 })
      .plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(model.seen[1]?.repairIssues.join(" ")).toContain("criterion-2");
    expect(result.unresolved).toHaveLength(0);
  });

  it("returns an unknown-parent-criterion diagnostic and repairs the cut", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1", "criterion-2", "criterion-unknown"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-4"], [API], [API, TEST_API])
    ]), VALID);
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 4 }, maxAttemptsPerUnit: 2 })
      .plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(model.seen[1]?.repairIssues.join(" ")).toContain("criterion-unknown");
    expect(result.unresolved).toHaveLength(0);
  });

  it("keeps parent criterion ids as lineage and rejects an infeasible owner", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1", "criterion-2"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-4"], [API], [API, TEST_API])
    ]));
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: 4 },
      maxAttemptsPerUnit: 1
    }).plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(result.root.kind).toBe("composite");
    if (result.root.kind !== "composite") return;
    expect(result.root.children.map((node) => node.unit.criteria.map((criterion) => criterion.id))).toEqual([
      ["criterion-1", "criterion-2"],
      ["criterion-3"],
      ["criterion-4"]
    ]);
  });

  it("rejects criterion-2 when the application cut does not write its required domain path", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1"], [DOMAIN], [TEST_DOMAIN]),
      child("application", ["criterion-2", "criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
      child("api", ["criterion-4"], [API], [API, TEST_API])
    ]));
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: 4 },
      maxAttemptsPerUnit: 1,
      feasibilityCritic: {
        review({ parent, proposal }) {
          const criterion = parent.criteria.find((item) => item.id === "criterion-2");
          const owner = proposal.children.find((item) => item.criterionIds?.includes("criterion-2"));
          if (criterion !== undefined && owner !== undefined && !owner.writes.includes(DOMAIN)) {
            return { ok: false, issues: [`criterion_unimplementable: criterion-2 requires write path ${DOMAIN}; child ${owner.key} does not write it.`] };
          }
          return { ok: true };
        }
      }
    }).plan({ root: ROOT, criteria: CRITERIA, evidence: EVIDENCE });

    expect(result.root.kind).toBe("unresolved");
    expect(result.unresolved[0]?.diagnostics.join(" ")).toContain("criterion-2");
    expect(result.unresolved[0]?.diagnostics.join(" ")).toContain(DOMAIN);
  });
});
