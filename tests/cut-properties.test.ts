import { describe, expect, it } from "vitest";
import { RecursivePlanner, type CutRequest, type UnitProposal } from "@manyhands/decomposer";

/**
 * Stage 3 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * P4 governs recursion; P1-P3 are invariants of a cut, repaired through the
 * channel that already exists. Every rejection must name the property and the
 * child, because a diagnostic that cannot be acted on is what turned thirteen
 * frozen series into thirteen separate discoveries.
 */

const D = "src/domain/orders.js";
const S = "src/application/service.js";
const A = "src/api/server.js";
const U = "src/ui/tower.js";
const H = "src/shared/util.js";
const BACKORDERS = "src/domain/backorders.js";
const EMIT = "src/application/emit.js";

const EVIDENCE = [D, S, A, U, H].map((reference, index) => ({
  id: `path-${index}`,
  kind: "path" as const,
  reference,
  observation: "source file",
  confidence: 1
}));

const GOAL = [{ id: "criterion-goal", description: "Backorders work end to end", required: true }];
const BUDGET = 3;

function parentUnit(reads: string[], writes: string[] = []): UnitProposal {
  return { key: "root", objective: "Add backorders", criteria: GOAL, reads, writes };
}

function child(key: string, reads: string[], writes: string[] = []) {
  return { key, objective: `Implement ${key}`, criterion: `${key} works`, reads, writes };
}

function cut(children: ReturnType<typeof child>[], rationale = "Split by ownership"): string {
  return JSON.stringify({ rationale, children });
}

const PARENT = parentUnit([D, S, A, U]);
const VALID_CUT = cut([
  child("domain", [D], ["test/domain.test.js"]),
  child("application", [S], ["test/service.test.js"])
]);

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

async function planWith(first: string, second: string = VALID_CUT, parent: UnitProposal = PARENT) {
  const model = twoAnswerModel(first, second);
  const result = await new RecursivePlanner({
    model,
    budget: { maxScopePaths: BUDGET },
    maxAttemptsPerUnit: 2
  }).plan({ root: parent, criteria: GOAL, evidence: EVIDENCE });
  return { model, result, rejection: model.seen[1]?.repairIssues.join("\n") ?? "" };
}

describe("P1 — a leaf must bring its own proof", () => {
  it("rejects a child inside the budget that declares no test file", async () => {
    const { rejection, result } = await planWith(cut([
      child("domain", [D], [BACKORDERS]),
      child("application", [S], ["test/service.test.js"])
    ]));

    expect(rejection).toContain("P1");
    expect(rejection).toContain("domain");
    expect(result.root.kind).toBe("composite");
  });

  it("does not demand a test from a child that will be cut further", async () => {
    const model = modelByKey({
      // `backend` is over budget, so it is a composite and proves by integration.
      root: cut([child("backend", [D, S, A, H]), child("api", [A], ["test/api.test.js"])]),
      backend: cut([
        child("domain", [D], ["test/domain.test.js"]),
        child("application", [S], ["test/service.test.js"])
      ])
    });
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: BUDGET }, maxAttemptsPerUnit: 2 })
      .plan({ root: parentUnit([D, S, A, U, H]), criteria: GOAL, evidence: EVIDENCE });

    expect(model.seen.map((request) => request.unit.key)).toEqual(["root", "backend"]);
    expect(result.unresolved).toHaveLength(0);
  });

});

describe("P2 — siblings never write the same file", () => {
  it("rejects a cut whose children both write one path, naming both children", async () => {
    const { rejection, result } = await planWith(cut([
      child("domain", [D], ["test/shared.test.js"]),
      child("application", [S], ["test/shared.test.js"])
    ]));

    expect(rejection).toContain("P2");
    expect(rejection).toContain("test/shared.test.js");
    expect(rejection).toContain("domain");
    expect(rejection).toContain("application");
    expect(result.root.kind).toBe("composite");
  });

  /**
   * Stage 4. A cut only sees its own siblings, so per-cut disjointness leaves
   * cousins free to claim the same file: coverage only requires a child's
   * subtree to write *at least* what its parent promised, never exactly that.
   *
   * The whole point of P2 is that two concurrent nodes never touch one file, so
   * the scheduler can run them without a conflict model. Enforced per cut, that
   * guarantee is local and the compiler has to rediscover collisions it should
   * have been able to assume away — which is what D9 is. It has to hold for the
   * tree, the same way key uniqueness does.
   */
  it("rejects a write already claimed by a unit in another branch", async () => {
    const model = modelByKey({
      // Two over-budget branches, cut independently. `api` sits under `backend`
      // and `tower` under `frontend`, so they are never siblings and no single
      // cut ever sees both.
      root: cut([
        child("backend", [D, S, A], [BACKORDERS]),
        child("frontend", [U, H, S], ["test/tower.test.js"])
      ]),
      backend: cut([
        child("domain", [D], [BACKORDERS, "test/domain.test.js"]),
        child("api", [A], ["test/contested.test.js"])
      ]),
      frontend: cut([
        child("tower", [U], ["test/tower.test.js"]),
        child("shared", [H], ["test/contested.test.js"])
      ])
    });
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: BUDGET },
      maxAttemptsPerUnit: 1
    }).plan({ root: parentUnit([D, S, A, U, H]), criteria: GOAL, evidence: EVIDENCE });

    const writes = leafWrites(result.root);
    expect(writes.length).toBe(new Set(writes).size);
    // ...and for the right reason: the contested cut was rejected naming the
    // property, the file and the branch that already owns it. Without this the
    // test would also pass if planning had merely collapsed to fewer leaves.
    const rejection = result.unresolved.flatMap((unit) => unit.diagnostics).join("\n");
    expect(rejection).toContain("P2");
    expect(rejection).toContain("test/contested.test.js");
    expect(rejection).toContain("api");
  });
});

/** Every path written by a leaf in the resolved tree, in traversal order. */
function leafWrites(node: { kind: string; unit: { writes: readonly string[] }; children?: unknown[] }): string[] {
  if (node.kind === "leaf") return [...node.unit.writes];
  if (node.kind !== "composite") return [];
  return (node.children as Parameters<typeof leafWrites>[0][]).flatMap(leafWrites);
}

describe("P3 — every read is satisfiable where the unit runs", () => {
  it("rejects a read that is neither in the snapshot nor written by a sibling", async () => {
    const { rejection } = await planWith(cut([
      child("domain", ["src/domain/invented.js"], ["test/domain.test.js"]),
      child("application", [S], ["test/service.test.js"])
    ]));

    expect(rejection).toContain("P3");
    expect(rejection).toContain("src/domain/invented.js");
  });

  it("accepts a read a sibling produces, because that is the dependency", async () => {
    const { model, result } = await planWith(cut([
      child("domain", [D], [BACKORDERS, "test/domain.test.js"]),
      child("application", [BACKORDERS], ["test/service.test.js"])
    ]));

    expect(model.seen).toHaveLength(1);
    expect(result.root.kind).toBe("composite");
  });

  it("accepts a read inherited from the parent's own reads", async () => {
    // `generated/schema.js` is absent from the snapshot: the only thing that
    // makes it legitimate is that the parent already reads it.
    const parent = parentUnit([D, S, A, "generated/schema.js"]);
    const { model, result } = await planWith(cut([
      child("domain", ["generated/schema.js"], ["test/domain.test.js"]),
      child("application", [S], ["test/service.test.js"])
    ]), VALID_CUT, parent);

    expect(model.seen).toHaveLength(1);
    expect(result.root.kind).toBe("composite");
  });
});

describe("write coverage — a cut cannot drop what the parent promised", () => {
  it("rejects a cut whose children lose one of the parent's writes", async () => {
    const parent = parentUnit([D, S, A], [BACKORDERS, EMIT]);
    const { rejection } = await planWith(cut([
      child("domain", [D], [BACKORDERS, "test/domain.test.js"]),
      child("application", [S], ["test/service.test.js"])
    ]), VALID_CUT, parent);

    expect(rejection).toContain(EMIT);
    expect(rejection.toLowerCase()).toContain("parent");
  });
});

describe("P4 — the budget is what drives recursion", () => {
  it("counts reads and writes together against the budget", async () => {
    const model = twoAnswerModel(VALID_CUT, VALID_CUT);
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: BUDGET },
      maxAttemptsPerUnit: 2
    }).plan({
      root: parentUnit([D], ["src/x.js", "test/x.test.js"]),
      criteria: GOAL,
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("leaf");
    expect(model.seen).toHaveLength(0);
  });

  it("reports every violated property in one rejection instead of one per round trip", async () => {
    const { rejection } = await planWith(cut([
      child("domain", ["src/domain/invented.js"], ["test/shared.test.js"]),
      child("application", [S], ["test/shared.test.js"])
    ]));

    expect(rejection).toContain("P2");
    expect(rejection).toContain("P3");
  });
});
