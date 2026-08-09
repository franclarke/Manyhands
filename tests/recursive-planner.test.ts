import { describe, expect, it } from "vitest";
import {
  RecursivePlanner,
  criterionIdFor,
  type CutRequest,
  type PlannedUnit,
  type UnitProposal
} from "@manyhands/decomposer";

/**
 * Stages 2 and 3 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * One model call per unit, parent-first, five fields per child. The model never
 * decides leaf vs composite — P4 does — and never declares a relation.
 *
 * The budget is three paths: a leaf that reads one file and writes both a
 * source file and its test already costs three.
 */

const BUDGET = 3;

const D = "src/domain/orders.js";
const S = "src/application/service.js";
const A = "src/api/server.js";
const U = "src/ui/tower.js";
const H = "src/shared/util.js";
const C = "src/config/app.js";
const BACKORDERS = "src/domain/backorders.js";

const EVIDENCE = [D, S, A, U, H, C].map((reference, index) => ({
  id: `path-${index}`,
  kind: "path" as const,
  reference,
  observation: "source file",
  confidence: 1
}));

const GOAL_CRITERIA = [{ id: "criterion-goal", description: "Backorders work end to end", required: true }];

function root(reads: string[]): UnitProposal {
  return { key: "root", objective: "Add backorders across the stack", criteria: GOAL_CRITERIA, reads, writes: [] };
}

function child(key: string, reads: string[], writes: string[] = []) {
  return { key, objective: `Implement ${key}`, criterion: `${key} works`, reads, writes };
}

function cut(rationale: string, children: ReturnType<typeof child>[]): string {
  return JSON.stringify({ rationale, children });
}

const ROOT = root([D, S, A, U, H, C]);

/** Four levels: root -> backend -> core -> {domain, application}. */
const DEEP_TREE = {
  root: cut("Split backend from presentation", [
    child("backend", [D, S, A, H, C]),
    child("frontend", [U], ["test/frontend.test.js"])
  ]),
  backend: cut("Split the cohesive core from its edge", [
    child("core", [D, S], [BACKORDERS, "test/core.test.js"]),
    child("edge", [A], ["test/edge.test.js"])
  ]),
  core: cut("Domain and application are separately verifiable", [
    child("domain", [D], [BACKORDERS, "test/domain.test.js"]),
    child("application", [S], ["test/core.test.js"])
  ])
};

function scriptedModel(script: Record<string, string | string[]>) {
  const seen: CutRequest[] = [];
  return {
    seen,
    async proposeCut(request: CutRequest) {
      seen.push(request);
      const answer = script[request.unit.key];
      if (answer === undefined) throw new Error(`no scripted cut for ${request.unit.key}`);
      if (typeof answer === "string") return answer;
      return answer[Math.min(request.attempt - 1, answer.length - 1)]!;
    }
  };
}

function planDeep(script: Record<string, string | string[]>, start: UnitProposal = ROOT) {
  const model = scriptedModel(script);
  return new RecursivePlanner({ model, budget: { maxScopePaths: BUDGET }, maxAttemptsPerUnit: 2 })
    .plan({ root: start, criteria: GOAL_CRITERIA, evidence: EVIDENCE })
    .then((result) => ({ model, result }));
}

function flatten(node: PlannedUnit): PlannedUnit[] {
  return node.kind === "composite" ? [node, ...node.children.flatMap(flatten)] : [node];
}

function depthOf(node: PlannedUnit): number {
  return node.kind === "composite" ? 1 + Math.max(...node.children.map(depthOf)) : 1;
}

function leafKeys(node: PlannedUnit): string[] {
  return flatten(node).filter((unit) => unit.kind === "leaf").map((unit) => unit.unit.key).sort();
}

describe("recursive planner", () => {
  it("keeps a unit inside the budget as a leaf without ever calling the model", async () => {
    const model = scriptedModel({});
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: BUDGET } }).plan({
      root: { key: "small", objective: "small", criteria: GOAL_CRITERIA, reads: [D], writes: ["test/small.test.js"] },
      criteria: GOAL_CRITERIA,
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("leaf");
    expect(model.seen).toHaveLength(0);
  });

  it("accepts a cohesive root wrapper with one executable child", async () => {
    const model = scriptedModel({
      root: cut("The whole request is one cohesive unit", [
        child("inventory-summary", [D], ["test/inventory-summary.test.js"])
      ])
    });
    const result = await new RecursivePlanner({ model, budget: { maxScopePaths: BUDGET } }).plan({
      root: ROOT,
      criteria: GOAL_CRITERIA,
      evidence: EVIDENCE
    });

    expect(result.unresolved).toHaveLength(0);
    expect(result.root.kind).toBe("composite");
    expect(result.root.children).toHaveLength(1);
    expect(result.root.children[0]?.kind).toBe("leaf");
  });

  it("recurses until every unit fits the budget, producing depth beyond two", async () => {
    const { result } = await planDeep(DEEP_TREE);

    expect(depthOf(result.root)).toBe(4);
    expect(leafKeys(result.root)).toEqual(["application", "domain", "edge", "frontend"]);
    expect(result.unresolved).toHaveLength(0);
  });

  it("asks the model once per unit that needs a cut, parent-first", async () => {
    const { model } = await planDeep(DEEP_TREE);

    expect(model.seen.map((request) => request.unit.key)).toEqual(["root", "backend", "core"]);
    expect(model.seen.map((request) => request.depth)).toEqual([0, 1, 2]);
  });

  it("gives every child its own derived criterion instead of repeating the parent's", async () => {
    const { result } = await planDeep(DEEP_TREE);
    const domain = flatten(result.root).find((node) => node.unit.key === "domain")!;

    expect(domain.unit.criteria).toEqual([
      { id: criterionIdFor("domain"), description: "domain works", required: true }
    ]);
    expect(result.root.unit.criteria).toEqual(GOAL_CRITERIA);
  });

  it("records the rationale that justifies every level of depth", async () => {
    const { result } = await planDeep(DEEP_TREE);

    const rationales = flatten(result.root)
      .filter((node): node is Extract<PlannedUnit, { kind: "composite" }> => node.kind === "composite")
      .map((node) => node.rationale);
    expect(rationales).toEqual([
      "Split backend from presentation",
      "Split the cohesive core from its edge",
      "Domain and application are separately verifiable"
    ]);
  });

  it("repairs an invalid cut in place using the exact validator diagnostics", async () => {
    const { model, result } = await planDeep({
      ...DEEP_TREE,
      // The SP2 shape: prose where the contract wants structure.
      root: [JSON.stringify({ rationale: "split it", children: "backend and frontend" }), DEEP_TREE.root]
    });

    expect(model.seen.filter((request) => request.unit.key === "root")).toHaveLength(2);
    expect(model.seen[0]!.repairIssues).toHaveLength(0);
    expect(model.seen[1]!.repairIssues.join(" ")).toContain("children");
    expect(result.root.kind).toBe("composite");
  });

  it("marks only the failing unit unresolved and keeps every resolved ancestor and sibling", async () => {
    const { result } = await planDeep({ ...DEEP_TREE, core: "not json at all" });

    expect(result.root.kind).toBe("composite");
    expect(result.unresolved.map((node) => node.unit.key)).toEqual(["core"]);
    expect(result.unresolved[0]!.diagnostics.join(" ").length).toBeGreaterThan(0);
    expect(leafKeys(result.root)).toEqual(["edge", "frontend"]);
  });

  it("rejects a cut that hands a child everything the parent had", async () => {
    const { model, result } = await planDeep({
      ...DEEP_TREE,
      root: [
        cut("No shrinking at all", [child("backend", [D, S, A, U, H, C]), child("frontend", [U], ["test/frontend.test.js"])]),
        DEEP_TREE.root
      ]
    });

    expect(model.seen[1]!.repairIssues.join(" ")).toContain("must shrink");
    expect(result.root.kind).toBe("composite");
  });

  it("repairs sibling reads that would compile into an artifact cycle", async () => {
    const cyclic = cut("Split by layer but give the domain unnecessary edge reads", [
      child("domain", [A], [D, "test/domain.test.js"]),
      child("application", [D], [S, "test/application.test.js"]),
      child("api", [S], [A, "test/api.test.js"])
    ]);

    const { model, result } = await planDeep({
      ...DEEP_TREE,
      root: [cyclic, DEEP_TREE.root]
    });

    const repair = model.seen.find((request) => request.unit.key === "root" && request.attempt === 2);
    expect(repair?.repairIssues.join(" ")).toContain("dependency cycle");
    expect(result.unresolved).toHaveLength(0);
  });

  /**
   * The root arrives from the host with reads and no writes. Accepting it as a
   * leaf because it happens to fit the budget produces a plan whose only unit
   * promises no output at all — a run that can only end in "leaf produced no
   * diff". A leaf is a unit that can prove something, so it must write a test.
   */
  it("cuts a unit that fits the budget but writes no test, instead of calling it a leaf", async () => {
    const { model, result } = await planDeep(
      {
        small: cut("Split the goal into provable work", [
          child("alpha", [D], ["test/alpha.test.js"]),
          child("beta", [S], ["test/beta.test.js"])
        ])
      },
      { key: "small", objective: "A goal that already fits", criteria: GOAL_CRITERIA, reads: [D, S], writes: [] }
    );

    expect(model.seen.map((request) => request.unit.key)).toEqual(["small"]);
    expect(result.root.kind).toBe("composite");
    expect(leafKeys(result.root)).toEqual(["alpha", "beta"]);
  });

  it("reports a unit stopped by the depth limit instead of accepting it as a leaf", async () => {
    const model = scriptedModel(DEEP_TREE);
    const result = await new RecursivePlanner({
      model,
      budget: { maxScopePaths: BUDGET },
      maxAttemptsPerUnit: 2,
      maxDepth: 1
    }).plan({ root: ROOT, criteria: GOAL_CRITERIA, evidence: EVIDENCE });

    // `backend` sits at depth 1, over budget, and the limit stops it. It is not
    // a leaf: nothing checked that it can be implemented or proven.
    expect(result.unresolved.map((node) => node.unit.key)).toEqual(["backend"]);
    expect(result.unresolved[0]!.diagnostics.join(" ")).toContain("depth");
  });

  it("rejects a cut that reuses a unit key from another branch", async () => {
    const { model, result } = await planDeep({
      root: cut("Split by layer", [
        child("backend", [D, S, A, H, C]),
        child("frontend", [U], ["test/frontend.test.js"])
      ]),
      backend: [
        // `frontend` already exists in the other branch: two units with one key
        // collapse into one node and silently merge their scopes.
        cut("Reuses a cousin's key", [
          child("frontend", [D, S], [BACKORDERS, "test/core.test.js"]),
          child("edge", [A], ["test/edge.test.js"])
        ]),
        DEEP_TREE.backend
      ],
      core: DEEP_TREE.core
    });

    const repair = model.seen.find((request) => request.unit.key === "backend" && request.attempt === 2);
    expect(repair?.repairIssues.join(" ")).toContain("frontend");
    expect(result.unresolved).toHaveLength(0);
  });

  it("states the exact JSON shape in the prompt it sends", async () => {
    const { model } = await planDeep(DEEP_TREE);

    const prompt = `${model.seen[0]!.system}\n${model.seen[0]!.user}`;
    for (const field of ["rationale", "children", "key", "objective", "criterion", "reads", "writes"]) {
      expect(prompt).toContain(field);
    }
    // The SP2 lesson: a field named but never shaped is the field the model gets wrong.
    expect(prompt).toContain('"children": [');
  });
});
