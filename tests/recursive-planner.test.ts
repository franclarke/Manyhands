import { describe, expect, it } from "vitest";
import {
  RecursivePlanner,
  type CutRequest,
  type PlannedUnit,
  type UnitProposal
} from "@manyhands/decomposer";

/**
 * Stages 2 and 3A of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * One model call per unit, parent-first, with a five-field contract per child.
 * The model never decides leaf vs composite — P4 does.
 *
 * The budget here is four paths, which is the smallest realistic one: a leaf
 * that reads a file, writes a source file and writes its test already costs
 * three. A budget of two would make every honest leaf unsatisfiable.
 */

const BUDGET = 4;

const CRITERIA = [
  { id: "criterion-1", description: "Domain records the backorder", required: true },
  { id: "criterion-2", description: "Application emits the event", required: true },
  { id: "criterion-3", description: "API exposes the backorders", required: true },
  { id: "criterion-4", description: "Presentation renders them", required: true }
];

const EVIDENCE = [
  { id: "path-0", kind: "path" as const, reference: "src/domain/orders.js", observation: "domain", confidence: 1 },
  { id: "path-1", kind: "path" as const, reference: "src/application/service.js", observation: "application", confidence: 1 },
  { id: "path-2", kind: "path" as const, reference: "src/api/server.js", observation: "api", confidence: 1 },
  { id: "path-3", kind: "path" as const, reference: "src/ui/tower.js", observation: "ui", confidence: 1 },
  { id: "path-4", kind: "path" as const, reference: "src/shared/util.js", observation: "shared", confidence: 1 }
];

function unit(key: string, criterionIds: string[], reads: string[], writes: string[] = []): UnitProposal {
  return { key, objective: `Implement ${key}`, criterionIds, reads, writes };
}

const ROOT = unit(
  "root",
  ["criterion-1", "criterion-2", "criterion-3", "criterion-4"],
  ["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js", "src/shared/util.js"]
);

function cut(rationale: string, children: UnitProposal[]): string {
  return JSON.stringify({ rationale, children });
}

const BACKEND = unit(
  "backend",
  ["criterion-1", "criterion-2", "criterion-3"],
  ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"],
  ["src/domain/backorders.js", "src/application/emit.js"]
);
const FRONTEND = unit("frontend", ["criterion-4"], ["src/ui/tower.js"], ["test/frontend.test.js"]);
const CORE = unit(
  "core",
  ["criterion-1", "criterion-2"],
  ["src/domain/orders.js", "src/application/service.js"],
  ["src/domain/backorders.js", "src/application/emit.js", "test/core.test.js"]
);
const EDGE = unit("edge", ["criterion-3"], ["src/api/server.js"], ["test/edge.test.js"]);
const DOMAIN = unit("domain", ["criterion-1"], ["src/domain/orders.js"], ["src/domain/backorders.js", "test/domain.test.js"]);
const APPLICATION = unit("application", ["criterion-2"], ["src/application/service.js"], ["src/application/emit.js", "test/core.test.js"]);

/** The tree every structural test below drives, four levels deep. */
const DEEP_TREE = {
  root: cut("Split backend from presentation", [BACKEND, FRONTEND]),
  backend: cut("Split the cohesive core from its edge", [CORE, EDGE]),
  core: cut("Domain and application are separately verifiable", [DOMAIN, APPLICATION])
};

/** Answers per unit key, so a stub can drive an arbitrary tree shape. */
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

function plannerFor(model: { proposeCut(request: CutRequest): Promise<unknown> }) {
  return new RecursivePlanner({ model, budget: { maxScopePaths: BUDGET }, maxAttemptsPerUnit: 2 });
}

function planDeep(script: Record<string, string | string[]>, root: UnitProposal = ROOT) {
  const model = scriptedModel(script);
  return plannerFor(model)
    .plan({ root, criteria: CRITERIA, evidence: EVIDENCE })
    .then((result) => ({ model, result }));
}

function flatten(node: PlannedUnit): PlannedUnit[] {
  return node.kind === "composite" ? [node, ...node.children.flatMap(flatten)] : [node];
}

function depthOf(node: PlannedUnit): number {
  return node.kind === "composite" ? 1 + Math.max(...node.children.map(depthOf)) : 1;
}

function leafKeys(node: PlannedUnit): string[] {
  return flatten(node).filter((child) => child.kind === "leaf").map((child) => child.unit.key).sort();
}

describe("recursive planner", () => {
  it("keeps a unit inside the budget as a leaf without ever calling the model", async () => {
    const model = scriptedModel({});
    const result = await plannerFor(model).plan({
      root: unit("small", ["criterion-1"], ["src/domain/orders.js"], ["test/small.test.js"]),
      criteria: [CRITERIA[0]!],
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("leaf");
    expect(model.seen).toHaveLength(0);
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

  it("rejects a cut whose children claim criteria their parent does not own", async () => {
    const { model, result } = await planDeep({
      ...DEEP_TREE,
      root: [
        cut("Invents a criterion", [
          { ...BACKEND, criterionIds: ["criterion-9"] },
          FRONTEND
        ]),
        DEEP_TREE.root
      ]
    });

    expect(model.seen[1]!.repairIssues.join(" ")).toContain("criterion-9");
    expect(result.root.kind).toBe("composite");
  });

  it("reports a unit it cannot partition instead of inventing a cut", async () => {
    const { model, result } = await planDeep(
      {},
      unit("monolith", ["criterion-1"], EVIDENCE.map((item) => item.reference))
    );

    expect(model.seen).toHaveLength(0);
    expect(result.unresolved.map((node) => node.unit.key)).toEqual(["monolith"]);
    expect(result.unresolved[0]!.diagnostics.join(" ")).toContain("single criterion");
  });

  it("states the exact JSON shape in the prompt it sends", async () => {
    const { model } = await planDeep(DEEP_TREE);

    const prompt = `${model.seen[0]!.system}\n${model.seen[0]!.user}`;
    for (const field of ["rationale", "children", "key", "objective", "criterionIds", "reads", "writes"]) {
      expect(prompt).toContain(field);
    }
    // The SP2 lesson: a field named but never shaped is the field the model gets wrong.
    expect(prompt).toContain('"children": [');
  });
});
