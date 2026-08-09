import path from "node:path";

import type { GoalCriterion, SemanticPlanDraft } from "./semantic-plan.js";
import type { RepositoryEvidence } from "./schema.js";
import type { PlannedUnit, UnitProposal } from "./recursive-planner.js";

/**
 * Derived relations and projection (redesign stage 3B).
 *
 * A dependency between two units is a fact of the repository, not an opinion of
 * the model: unit A depends on unit B exactly when A reads a file B writes. The
 * materialization is `files` because the dependency literally is files, so a
 * `logical` executable seam stops being illegal and becomes unrepresentable —
 * which is how SP1q and retry-10's false `artifact_cycle` are eliminated by
 * construction rather than by another gate.
 */

export interface DerivedRelation {
  producerKey: string;
  consumerKey: string;
  /** Exact files that create the dependency. */
  paths: string[];
  /** Always `files`: the dependency is files. */
  materialization: "files";
}

/** Every executable unit in the tree, in parent-first order. */
export function flattenPlannedUnits(node: PlannedUnit): PlannedUnit[] {
  return node.kind === "composite" ? [node, ...node.children.flatMap(flattenPlannedUnits)] : [node];
}

function leavesOf(node: PlannedUnit): PlannedUnit[] {
  return flattenPlannedUnits(node).filter((unit) => unit.kind === "leaf");
}

/**
 * One relation per (producer, consumer) pair, carrying every file that binds
 * them. Only leaves produce and consume: a composite owns its children's work
 * rather than doing its own.
 */
export function deriveRelations(tree: PlannedUnit): DerivedRelation[] {
  const leaves = leavesOf(tree);
  const producerOf = new Map<string, string>();
  for (const leaf of leaves) {
    for (const written of leaf.unit.writes) producerOf.set(normalize(written), leaf.unit.key);
  }

  const relations = new Map<string, DerivedRelation>();
  for (const consumer of leaves) {
    for (const read of consumer.unit.reads) {
      const producerKey = producerOf.get(normalize(read));
      if (producerKey === undefined || producerKey === consumer.unit.key) continue;
      const id = `${producerKey}->${consumer.unit.key}`;
      const existing = relations.get(id);
      if (existing === undefined) {
        relations.set(id, { producerKey, consumerKey: consumer.unit.key, paths: [read], materialization: "files" });
        continue;
      }
      existing.paths.push(read);
    }
  }
  return [...relations.values()];
}

export interface ProjectionInput {
  tree: PlannedUnit;
  goal: string;
  criteria: readonly GoalCriterion[];
  evidence: readonly RepositoryEvidence[];
  repositorySnapshotId: string;
}

export interface ProjectedPlan {
  draft: SemanticPlanDraft;
  /** The canonical run criteria; child units reference these ids as lineage. */
  criteria: GoalCriterion[];
  relations: DerivedRelation[];
}

/**
 * Projects the planned tree onto the existing `SemanticPlan` shape so the
 * current Graph Compiler keeps working unchanged. Its twelve invariants stop
 * being lotteries a model has to win and become theorems of this construction:
 * criteria are owned exactly once because the cut partitions them, seams have a
 * producer and consumers because they are derived, and executable
 * materialization is `files` because the dependency is files.
 */
export function projectPlannedTree(input: ProjectionInput): ProjectedPlan {
  const unresolved = flattenPlannedUnits(input.tree).filter((unit) => unit.kind === "unresolved");
  if (unresolved.length > 0) {
    throw new Error(`Cannot project a tree with unresolved units: ${unresolved.map((unit) => unit.unit.key).join(", ")}.`);
  }

  const evidenceIdByPath = new Map(input.evidence
    .filter((item) => item.kind === "path")
    .map((item) => [normalize(item.reference), item.id] as const));
  const relations = deriveRelations(input.tree);
  const testPathsByKey = new Map(leavesOf(input.tree)
    .map((leaf) => [leaf.unit.key, leaf.unit.writes.filter(isTestPath)] as const));

  // Child units inherit criterion objects from their parent. The semantic plan
  // declares the goal criteria once; flattening the tree here would duplicate
  // those ids and make a valid lineage fail schema validation.
  const criteria: GoalCriterion[] = [...input.criteria];

  const root = projectUnit(input.tree, evidenceIdByPath, testPathsByKey);
  // The plan must carry the evidence its units cite; a reference to an item the
  // plan does not declare is exactly the kind of dangling id the schema rejects.
  const cited = new Set(collectEvidenceIds(root));
  const draft: SemanticPlanDraft = {
    root,
    seams: relations.map((relation) => ({
      id: `seam-${relation.producerKey}-to-${relation.consumerKey}`,
      producerUnitKey: relation.producerKey,
      consumerUnitKeys: [relation.consumerKey],
      purpose: `${relation.consumerKey} reads ${relation.paths.join(", ")} produced by ${relation.producerKey}.`,
      paths: [...new Set(relation.paths)],
      interface: {
        kind: seamKindFor(relation.paths),
        promise: `${relation.producerKey} writes ${relation.paths.join(", ")}.`,
        compatibility: `${relation.consumerKey} reads those files from the integrated base.`,
        materialization: relation.materialization,
        verification: verificationFor(testPathsByKey.get(relation.consumerKey) ?? [])
      },
      evidenceIds: []
    })),
    repositoryEvidence: input.evidence.filter((item) => cited.has(item.id)),
    uncertainties: [],
    questions: []
  };

  return { draft, criteria, relations };
}

function collectEvidenceIds(node: SemanticPlanDraft["root"]): string[] {
  return node.kind === "composite"
    ? [...node.evidenceIds, ...node.children.flatMap(collectEvidenceIds)]
    : [...node.evidenceIds];
}

function projectUnit(
  node: PlannedUnit,
  evidenceIdByPath: ReadonlyMap<string, string>,
  testPathsByKey: ReadonlyMap<string, string[]>
): SemanticPlanDraft["root"] {
  const unit = node.unit;
  const known = [...unit.reads, ...unit.writes].filter((item) => evidenceIdByPath.has(normalize(item)));
  const evidenceIds = unique(known.map((item) => evidenceIdByPath.get(normalize(item))!));
  const plannedPaths = unit.writes.filter((item) => !evidenceIdByPath.has(normalize(item)));
  const common = {
    key: unit.key,
    title: titleFor(unit),
    objective: unit.objective,
    concerns: concernsFor(unit),
    evidenceIds,
    ...(plannedPaths.length > 0 ? { plannedPaths } : {}),
    // The full write set, which `plannedPaths` cannot express: it drops the
    // files that already exist, and those are exactly the ones a shared-read
    // conflict used to be invented from.
    ...(unit.writes.length > 0 ? { writePaths: [...unit.writes] } : {})
  };

  if (node.kind === "composite") {
    return {
      ...common,
      kind: "composite" as const,
      // A composite proves its own claims by integrating its children.
      outcomes: unit.criteria.map((criterion) => ({
        id: `outcome-${unit.key}-${slug(criterion.id)}`,
        description: `${criterion.description} (proven by integrating ${unit.key})`,
        criterionIds: [criterion.id],
        verification: { kind: "existing" as const, references: ["repository validation"] }
      })),
      cut: {
        criterion: cutCriterionFor(node),
        rationale: node.rationale
      },
      children: node.children.map((child) => projectUnit(child, evidenceIdByPath, testPathsByKey))
    };
  }

  const testPaths = testPathsByKey.get(unit.key) ?? [];
  return {
    ...common,
    kind: "leaf" as const,
    outcomes: unit.criteria.map((criterion) => ({
      id: `outcome-${unit.key}-${slug(criterion.id)}`,
      description: criterion.description,
      criterionIds: [criterion.id],
      verification: verificationFor(testPaths)
    }))
  };
}

/**
 * The cut's own nature, read off the tree rather than asked for: children bound
 * by a derived dependency were cut along an integration boundary; independent
 * children were cut along a cohesion boundary.
 */
function cutCriterionFor(node: Extract<PlannedUnit, { kind: "composite" }>): "cohesion" | "integration" {
  const keys = new Set(node.children.map((child) => child.unit.key));
  return deriveRelations(node).some((relation) => keys.has(relation.producerKey) || keys.has(relation.consumerKey))
    ? "integration"
    : "cohesion";
}

function verificationFor(testPaths: readonly string[]) {
  return testPaths.length > 0
    ? { kind: "author_test" as const, references: [...testPaths] }
    : { kind: "existing" as const, references: ["repository validation"] };
}

/** A source dependency is a type contract; anything else is data. */
function seamKindFor(paths: readonly string[]): "type" | "data" {
  return paths.some((item) => /\.[cm]?[tj]sx?$/u.test(normalize(item))) ? "type" : "data";
}

function isTestPath(candidate: string): boolean {
  const normalized = normalize(candidate);
  return /\.(?:test|spec)\.[cm]?[tj]sx?$/u.test(normalized) || /(?:^|\/)tests?\//u.test(normalized);
}

function concernsFor(unit: UnitProposal): string[] {
  const directories = unique([...unit.reads, ...unit.writes]
    .map((item) => path.posix.dirname(normalize(item.replaceAll("\\", "/"))).split("/").filter(Boolean).at(-1))
    .filter((item): item is string => item !== undefined));
  return directories.length > 0 ? directories : ["implementation"];
}

function titleFor(unit: UnitProposal): string {
  return unit.key.split(/[-_]/u).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || unit.key;
}

/** Entity ids reject most punctuation, so a derived id becomes a safe suffix. */
function slug(candidate: string): string {
  return candidate.replace(/[^A-Za-z0-9._-]/gu, "-");
}

function normalize(candidate: string): string {
  return candidate.replaceAll("\\", "/").toLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
