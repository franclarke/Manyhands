import { describe, expect, it } from "vitest";
import {
  createSemanticPlan,
  deriveRelations,
  projectPlannedTree,
  type PlannedUnit
} from "@manyhands/decomposer";

/**
 * Stage 3B of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * Relations are computed from `reads ∩ writes`, never declared by the model.
 * That is what makes `logical` unrepresentable for an executable dependency
 * rather than merely illegal, which is how SP1q and retry-10 died.
 */

const CRITERIA = [
  { id: "criterion-1", description: "Domain records the backorder", required: true },
  { id: "criterion-2", description: "Application emits the event", required: true }
];

const EVIDENCE = [
  { id: "path-0", kind: "path" as const, reference: "src/domain/orders.js", observation: "domain", confidence: 1 },
  { id: "path-1", kind: "path" as const, reference: "src/application/service.js", observation: "application", confidence: 1 }
];

const DOMAIN: PlannedUnit = {
  kind: "leaf",
  depth: 1,
  unit: {
    key: "domain",
    objective: "Record backorders in the domain",
    criteria: [{ id: "criterion:domain", description: "The domain records the backorder", required: true }],
    reads: ["src/domain/orders.js"],
    writes: ["src/domain/backorders.js", "test/domain.test.js"]
  }
};

const APPLICATION: PlannedUnit = {
  kind: "leaf",
  depth: 1,
  unit: {
    key: "application",
    objective: "Emit the backorder event",
    criteria: [{ id: "criterion:application", description: "The application emits the event", required: true }],
    reads: ["src/domain/backorders.js", "src/application/service.js"],
    writes: ["test/application.test.js"]
  }
};

const TREE: PlannedUnit = {
  kind: "composite",
  depth: 0,
  rationale: "Domain and application are separately verifiable",
  unit: {
    key: "backorders",
    objective: "Add backorders",
    criteria: [{ id: "criterion-goal", description: "Backorders work end to end", required: true }],
    reads: ["src/domain/orders.js", "src/application/service.js"],
    writes: []
  },
  children: [DOMAIN, APPLICATION]
};

describe("derived relations", () => {
  it("derives one dependency per file a consumer reads and a producer writes", () => {
    const relations = deriveRelations(TREE);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      producerKey: "domain",
      consumerKey: "application",
      paths: ["src/domain/backorders.js"]
    });
  });

  it("always materializes as files, because the dependency is files", () => {
    expect(deriveRelations(TREE).every((relation) => relation.materialization === "files")).toBe(true);
  });

  it("derives nothing from a read the repository already satisfies", () => {
    const independent: PlannedUnit = {
      ...TREE,
      children: [DOMAIN, { ...APPLICATION, unit: { ...APPLICATION.unit, reads: ["src/application/service.js"] } }]
    };

    expect(deriveRelations(independent)).toHaveLength(0);
  });

  it("orders the graph so a producer always precedes its consumer", () => {
    const relations = deriveRelations(TREE);
    const producers = new Set(relations.map((relation) => relation.producerKey));

    expect(producers.has("domain")).toBe(true);
    expect(producers.has("application")).toBe(false);
  });
});

describe("projection to a semantic plan", () => {
  function project() {
    return projectPlannedTree({
      tree: TREE,
      goal: "Add backorders across the slice",
      criteria: CRITERIA,
      evidence: EVIDENCE,
      repositorySnapshotId: "sha256:fixture"
    });
  }

  it("produces a plan the existing schema accepts, with no logical seam", () => {
    const projected = project();
    const plan = createSemanticPlan({
      goal: "Add backorders across the slice",
      repositorySnapshotId: "sha256:fixture",
      criteria: [...projected.criteria],
      draft: projected.draft
    });

    expect(plan.seams).toHaveLength(1);
    expect(plan.seams[0]!.interface.materialization).toBe("files");
    expect(plan.seams.some((seam) => seam.interface.materialization === "logical")).toBe(false);
  });

  it("lets a composite own its own criteria, proven by integrating its children", () => {
    const projected = project();

    expect(projected.criteria.map((criterion) => criterion.id).sort())
      .toEqual(["criterion-goal", "criterion:application", "criterion:domain"]);
    expect(projected.draft.root.outcomes.flatMap((outcome) => outcome.criterionIds)).toEqual(["criterion-goal"]);
    expect(projected.draft.root.outcomes[0]!.verification.kind).toBe("existing");
  });

  it("declares a write absent from the snapshot as a planned path, and a present one as evidence", () => {
    const projected = project();
    const domain = projected.draft.root.children[0]!;

    expect(domain.plannedPaths).toEqual(["src/domain/backorders.js", "test/domain.test.js"]);
    expect(domain.evidenceIds).toEqual(["path-0"]);
  });

  it("keeps each declared criterion owned by exactly one leaf outcome", () => {
    const projected = project();
    const owners = projected.draft.root.children.flatMap((child) =>
      child.outcomes.flatMap((outcome) => outcome.criterionIds));

    expect(owners.sort()).toEqual(["criterion:application", "criterion:domain"]);
  });

  it("refuses to project a tree that still has an unresolved unit", () => {
    const broken: PlannedUnit = {
      ...TREE,
      children: [DOMAIN, { kind: "unresolved", depth: 1, unit: APPLICATION.unit, diagnostics: ["P1 application: no test"] }]
    };

    expect(() => projectPlannedTree({
      tree: broken,
      goal: "Add backorders across the slice",
      criteria: CRITERIA,
      evidence: EVIDENCE,
      repositorySnapshotId: "sha256:fixture"
    })).toThrow(/unresolved/iu);
  });
});
