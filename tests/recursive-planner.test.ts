import { describe, expect, it } from "vitest";
import {
  RecursivePlanner,
  type CutRequest,
  type PlannedUnit,
  type UnitProposal
} from "@manyhands/decomposer";

/**
 * Stage 2 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * One model call per unit, parent-first, with a five-field contract per child.
 * The model never decides leaf vs composite — the policy does, here with P4
 * alone (scope against the executor budget); stage 3 adds P1-P3.
 */

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
  { id: "path-3", kind: "path" as const, reference: "src/ui/tower.js", observation: "ui", confidence: 1 }
];

function root(paths: string[]): UnitProposal {
  return {
    key: "root",
    objective: "Add backorders across the stack",
    criterionIds: CRITERIA.map((criterion) => criterion.id),
    existingPaths: paths,
    plannedPaths: []
  };
}

function child(key: string, criterionIds: string[], existingPaths: string[], plannedPaths: string[] = []): UnitProposal {
  return { key, objective: `Implement ${key}`, criterionIds, existingPaths, plannedPaths };
}

function cut(rationale: string, children: UnitProposal[]): string {
  return JSON.stringify({ rationale, children });
}

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

function plannerFor(model: { proposeCut(request: CutRequest): Promise<unknown> }, maxScopePaths = 1) {
  return new RecursivePlanner({ model, budget: { maxScopePaths }, maxAttemptsPerUnit: 2 });
}

function flatten(unit: PlannedUnit): PlannedUnit[] {
  return unit.kind === "composite" ? [unit, ...unit.children.flatMap(flatten)] : [unit];
}

function depthOf(unit: PlannedUnit): number {
  return unit.kind === "composite" ? 1 + Math.max(...unit.children.map(depthOf)) : 1;
}

describe("recursive planner", () => {
  it("keeps a unit inside the budget as a leaf without ever calling the model", async () => {
    const model = scriptedModel({});
    const result = await plannerFor(model).plan({
      root: child("small", ["criterion-1"], ["src/domain/orders.js"]),
      criteria: [CRITERIA[0]!],
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("leaf");
    expect(model.seen).toHaveLength(0);
  });

  it("recurses until every unit fits the budget, producing depth beyond two", async () => {
    const model = scriptedModel({
      root: cut("Split by layer boundary", [
        child("backend", ["criterion-1", "criterion-2", "criterion-3"], ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"]),
        child("frontend", ["criterion-4"], ["src/ui/tower.js"])
      ]),
      backend: cut("Split by ownership", [
        child("core", ["criterion-1", "criterion-2"], ["src/domain/orders.js", "src/application/service.js"]),
        child("edge", ["criterion-3"], ["src/api/server.js"])
      ]),
      core: cut("Domain and application are separately verifiable", [
        child("domain", ["criterion-1"], ["src/domain/orders.js"]),
        child("application", ["criterion-2"], ["src/application/service.js"])
      ])
    });

    const result = await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    expect(depthOf(result.root)).toBeGreaterThanOrEqual(4);
    expect(flatten(result.root).filter((unit) => unit.kind === "leaf").map((unit) => unit.unit.key).sort())
      .toEqual(["application", "domain", "edge", "frontend"]);
    expect(result.unresolved).toHaveLength(0);
  });

  it("asks the model once per unit that needs a cut, parent-first", async () => {
    const model = scriptedModel({
      root: cut("Split by layer", [
        child("backend", ["criterion-1", "criterion-2", "criterion-3"], ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"]),
        child("frontend", ["criterion-4"], ["src/ui/tower.js"])
      ]),
      backend: cut("Split again", [
        child("core", ["criterion-1", "criterion-2"], ["src/domain/orders.js", "src/application/service.js"]),
        child("edge", ["criterion-3"], ["src/api/server.js"])
      ]),
      core: cut("Final split", [
        child("domain", ["criterion-1"], ["src/domain/orders.js"]),
        child("application", ["criterion-2"], ["src/application/service.js"])
      ])
    });

    await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    expect(model.seen.map((request) => request.unit.key)).toEqual(["root", "backend", "core"]);
    expect(model.seen.map((request) => request.depth)).toEqual([0, 1, 2]);
  });

  it("repairs an invalid cut in place using the exact validator diagnostics", async () => {
    const model = scriptedModel({
      root: [
        // The SP2 shape: prose where the contract wants structure.
        JSON.stringify({ rationale: "split it", children: "domain, application, api and ui" }),
        cut("Split by layer", [
          child("backend", ["criterion-1", "criterion-2", "criterion-3"], ["src/api/server.js"]),
          child("frontend", ["criterion-4"], ["src/ui/tower.js"])
        ])
      ]
    });

    const result = await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    expect(model.seen).toHaveLength(2);
    expect(model.seen[0]!.repairIssues).toHaveLength(0);
    expect(model.seen[1]!.repairIssues.join(" ")).toContain("children");
    expect(result.root.kind).toBe("composite");
  });

  it("marks only the failing unit unresolved and keeps every resolved ancestor and sibling", async () => {
    const model = scriptedModel({
      root: cut("Split by layer", [
        child("backend", ["criterion-1", "criterion-2", "criterion-3"], ["src/domain/orders.js", "src/application/service.js", "src/api/server.js"]),
        child("frontend", ["criterion-4"], ["src/ui/tower.js"])
      ]),
      backend: cut("Split again", [
        child("core", ["criterion-1", "criterion-2"], ["src/domain/orders.js", "src/application/service.js"]),
        child("edge", ["criterion-3"], ["src/api/server.js"])
      ]),
      core: "not json at all"
    });

    const result = await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    expect(result.root.kind).toBe("composite");
    expect(result.unresolved.map((unit) => unit.unit.key)).toEqual(["core"]);
    expect(result.unresolved[0]!.diagnostics.join(" ")).not.toHaveLength(0);
    // The sibling that did resolve is still a leaf, and so is the whole other branch.
    const leaves = flatten(result.root).filter((unit) => unit.kind === "leaf").map((unit) => unit.unit.key);
    expect(leaves).toContain("edge");
    expect(leaves).toContain("frontend");
  });

  it("rejects a cut whose children claim criteria their parent does not own", async () => {
    const model = scriptedModel({
      root: [
        cut("Invents a criterion", [
          child("a", ["criterion-9"], ["src/domain/orders.js"]),
          child("b", ["criterion-2"], ["src/api/server.js"])
        ]),
        cut("Corrected", [
          child("a", ["criterion-1", "criterion-3", "criterion-4"], ["src/domain/orders.js"]),
          child("b", ["criterion-2"], ["src/api/server.js"])
        ])
      ]
    });

    const result = await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    expect(model.seen[1]!.repairIssues.join(" ")).toContain("criterion-9");
    expect(result.root.kind).toBe("composite");
  });

  it("states the exact JSON shape in the prompt it sends", async () => {
    const model = scriptedModel({
      root: cut("Split by layer", [
        child("backend", ["criterion-1", "criterion-2", "criterion-3"], ["src/api/server.js"]),
        child("frontend", ["criterion-4"], ["src/ui/tower.js"])
      ])
    });

    await plannerFor(model).plan({
      root: root(["src/domain/orders.js", "src/application/service.js", "src/api/server.js", "src/ui/tower.js"]),
      criteria: CRITERIA,
      evidence: EVIDENCE
    });

    const prompt = `${model.seen[0]!.system}\n${model.seen[0]!.user}`;
    for (const field of ["rationale", "children", "key", "objective", "criterionIds", "existingPaths", "plannedPaths"]) {
      expect(prompt).toContain(field);
    }
    // The SP2 lesson: a field named but never shaped is the field the model gets wrong.
    expect(prompt).toContain('"children": [');
  });
});
