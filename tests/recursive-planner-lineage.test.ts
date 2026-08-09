import { describe, expect, it } from "vitest";
import {
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

  it("returns a duplicate-parent-criterion diagnostic and repairs the cut", async () => {
    const model = modelFor(cut([
      child("domain", ["criterion-1", "criterion-2"], [DOMAIN], [DOMAIN, TEST_DOMAIN]),
      child("application", ["criterion-2", "criterion-3"], [APPLICATION], [APPLICATION, TEST_APPLICATION]),
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
