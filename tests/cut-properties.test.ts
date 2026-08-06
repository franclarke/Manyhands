import { describe, expect, it } from "vitest";
import { RecursivePlanner, type CutRequest, type UnitProposal } from "@manyhands/decomposer";

/**
 * Stage 3A of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * P4 governs recursion; P1-P3 are invariants of a cut, repaired through the
 * channel that already exists. Every rejection must name the property and the
 * child, because a diagnostic that cannot be acted on is what turned thirteen
 * frozen series into thirteen separate discoveries.
 */

const CRITERIA = [
  { id: "criterion-1", description: "Domain records the backorder", required: true },
  { id: "criterion-2", description: "Application emits the event", required: true }
];

const EVIDENCE = [
  { id: "path-0", kind: "path" as const, reference: "src/domain/orders.js", observation: "domain", confidence: 1 },
  { id: "path-1", kind: "path" as const, reference: "src/application/service.js", observation: "application", confidence: 1 }
];

function unit(key: string, criterionIds: string[], reads: string[], writes: string[]): UnitProposal {
  return { key, objective: `Implement ${key}`, criterionIds, reads, writes };
}

// Three reads against a budget of two: the root must be cut, which is what
// makes every test below actually reach the model.
const PARENT = unit(
  "root",
  ["criterion-1", "criterion-2"],
  ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"],
  []
);

const CRITERIA_3 = [...CRITERIA, { id: "criterion-3", description: "API exposes the backorders", required: true }];
const EVIDENCE_3 = [
  ...EVIDENCE,
  { id: "path-2", kind: "path" as const, reference: "src/api/server.js", observation: "api", confidence: 1 }
];
const THREE_CRITERION_ROOT = unit(
  "root",
  ["criterion-1", "criterion-2", "criterion-3"],
  ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"],
  []
);

function cut(children: UnitProposal[], rationale = "Split by ownership"): string {
  return JSON.stringify({ rationale, children });
}

/** Answers the first script entry, then the second, so a repair can be observed. */
function twoAnswerModel(first: string, second: string) {
  const seen: CutRequest[] = [];
  return {
    seen,
    async proposeCut(request: CutRequest) {
      seen.push(request);
      return request.attempt === 1 ? first : second;
    }
  };
}

/** One answer per unit key, for trees deeper than a single cut. */
function modelByKey(script: Record<string, string>) {
  const seen: CutRequest[] = [];
  return {
    seen,
    async proposeCut(request: CutRequest) {
      seen.push(request);
      const answer = script[request.unit.key];
      if (answer === undefined) throw new Error(`no scripted cut for ${request.unit.key}`);
      return answer;
    }
  };
}

const VALID_CUT = cut([
  unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["test/domain.test.js"]),
  unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
]);

async function planWith(first: string, second: string = VALID_CUT, parent: UnitProposal = PARENT) {
  const model = twoAnswerModel(first, second);
  const result = await new RecursivePlanner({
    model,
    budget: { maxScopePaths: 2 },
    maxAttemptsPerUnit: 2
  }).plan({ root: parent, criteria: CRITERIA, evidence: EVIDENCE_3 });
  return { model, result, rejection: model.seen[1]?.repairIssues.join("\n") ?? "" };
}

describe("P1 — a leaf must bring its own proof", () => {
  it("rejects a child inside the budget that declares no test file", async () => {
    const { rejection, result } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["src/domain/backorders.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
    ]));

    expect(rejection).toContain("P1");
    expect(rejection).toContain("domain");
    expect(result.root.kind).toBe("composite");
  });

  it("does not demand a test from a child that will be cut further", async () => {
    const model = modelByKey({
      root: cut([
        // Over budget, so it is a composite and proves by integration.
        unit("backend", ["criterion-1", "criterion-2"], ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"], []),
        unit("api", ["criterion-3"], ["src/api/server.js"], ["test/api.test.js"])
      ]),
      backend: cut([
        unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["test/domain.test.js"]),
        unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
      ])
    });
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: 2 }, maxAttemptsPerUnit: 2 })
      .plan({ root: THREE_CRITERION_ROOT, criteria: CRITERIA_3, evidence: EVIDENCE_3 });

    // Each unit was asked exactly once: `backend` carried no test and was still
    // accepted, because P4 already told us it is not a leaf.
    expect(model.seen.map((request) => request.unit.key)).toEqual(["root", "backend"]);
    expect(result.unresolved).toHaveLength(0);
  });
});

describe("P2 — siblings never write the same file", () => {
  it("rejects a cut whose children both write one path, naming both children", async () => {
    const { rejection, result } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["test/shared.test.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/shared.test.js"])
    ]));

    expect(rejection).toContain("P2");
    expect(rejection).toContain("test/shared.test.js");
    expect(rejection).toContain("domain");
    expect(rejection).toContain("application");
    expect(result.root.kind).toBe("composite");
  });
});

describe("P3 — every read is satisfiable where the unit runs", () => {
  it("rejects a read that is neither in the snapshot nor written by a sibling", async () => {
    const { rejection } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/invented.js"], ["test/domain.test.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
    ]));

    expect(rejection).toContain("P3");
    expect(rejection).toContain("src/domain/invented.js");
  });

  it("accepts a read a sibling produces, because that is the dependency", async () => {
    const { model, result } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["src/domain/backorders.js", "test/domain.test.js"]),
      unit("application", ["criterion-2"], ["src/domain/backorders.js"], ["test/service.test.js"])
    ]));

    expect(model.seen).toHaveLength(1);
    expect(result.root.kind).toBe("composite");
  });

  it("accepts a read inherited from the parent's own reads", async () => {
    // `generated/schema.js` is absent from the snapshot: the only thing that
    // makes it legitimate is that the parent already reads it.
    const parent = unit(
      "root",
      ["criterion-1", "criterion-2"],
      ["src/domain/orders.js", "src/application/service.js", "generated/schema.js"],
      []
    );
    const { model, result } = await planWith(cut([
      unit("domain", ["criterion-1"], ["generated/schema.js"], ["test/domain.test.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
    ]), VALID_CUT, parent);

    expect(model.seen).toHaveLength(1);
    expect(result.root.kind).toBe("composite");
  });
});

describe("write coverage — a cut cannot drop what the parent promised", () => {
  it("rejects a cut whose children lose one of the parent's writes", async () => {
    const parent = unit(
      "root",
      ["criterion-1", "criterion-2"],
      ["src/domain/orders.js", "src/application/service.js"],
      ["src/domain/backorders.js", "src/application/emit.js"]
    );
    const { rejection } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["src/domain/backorders.js", "test/domain.test.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/service.test.js"])
    ]), VALID_CUT, parent);

    expect(rejection).toContain("src/application/emit.js");
    expect(rejection.toLowerCase()).toContain("parent");
  });
});

describe("P4 — the budget is what drives recursion", () => {
  it("counts reads and writes together against the budget", async () => {
    const model = twoAnswerModel(VALID_CUT, VALID_CUT);
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: 2 },
      maxAttemptsPerUnit: 2
    }).plan({
      root: unit("small", ["criterion-1"], ["src/domain/orders.js"], ["test/domain.test.js"]),
      criteria: [CRITERIA[0]!],
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("leaf");
    expect(model.seen).toHaveLength(0);
  });

  it("reports every violated property in one rejection instead of one per round trip", async () => {
    const { rejection } = await planWith(cut([
      unit("domain", ["criterion-1"], ["src/domain/invented.js"], ["test/shared.test.js"]),
      unit("application", ["criterion-2"], ["src/application/service.js"], ["test/shared.test.js"])
    ]));

    expect(rejection).toContain("P2");
    expect(rejection).toContain("P3");
  });
});
