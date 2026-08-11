import {
  SemanticPlanSchema,
  flattenSemanticWorkUnits,
  type SemanticPlan,
  type SemanticSeam,
  type SemanticWorkUnit
} from "../planner/semantic-plan.js";
import type { GranularityAssessment } from "./granularity-policy.js";

export interface ApplyGranularitySelectionInput {
  plan: SemanticPlan;
  assessments: Record<string, GranularityAssessment>;
}

export interface ApplyGranularitySelectionResult {
  plan: SemanticPlan;
  /** Composites the policy collapsed, outermost first. */
  collapsedUnitKeys: string[];
}

/**
 * Applies the granularity decision to the plan the compiler will read.
 *
 * The policy evaluates a `WorkBreakdown`, but the compiler consumes a
 * `SemanticPlan`, and the decision is applied here rather than by inverting the
 * legacy projection: reconstructing a plan from a breakdown would make a second
 * representation of the same tree that has to be kept in step. Unit keys survive
 * the projection unchanged, so an assessment addresses a semantic unit directly.
 *
 * A collapsed composite keeps its own identity and absorbs everything its
 * descendants owned — outcomes, evidence, planned and written paths — because a
 * dropped outcome is a dropped acceptance criterion, and the criterion would
 * then have no owner to prove it. Seams that no longer cross a boundary are
 * removed: both sides became one unit, so there is no interface left to freeze.
 */
export function applyGranularitySelection(
  input: ApplyGranularitySelectionInput
): ApplyGranularitySelectionResult {
  const collapsedUnitKeys: string[] = [];
  const root = select(input.plan.root, input.assessments, collapsedUnitKeys);
  if (collapsedUnitKeys.length === 0) return { plan: input.plan, collapsedUnitKeys };

  const surviving = new Set(flattenSemanticWorkUnits(root).map((unit) => unit.key));
  const parentByKey = parentMap(input.plan.root);
  const plan = SemanticPlanSchema.parse({
    ...input.plan,
    root,
    seams: input.plan.seams.flatMap((seam) => remapSeam(seam, surviving, parentByKey))
  }) as SemanticPlan;
  return { plan, collapsedUnitKeys };
}

function select(
  unit: SemanticWorkUnit,
  assessments: Record<string, GranularityAssessment>,
  collapsedUnitKeys: string[]
): SemanticWorkUnit {
  if (unit.kind === "leaf") return unit;
  if (assessments[unit.key]?.selected === "leaf") {
    collapsedUnitKeys.push(unit.key);
    return collapse(unit);
  }
  return { ...unit, children: unit.children.map((child) => select(child, assessments, collapsedUnitKeys)) };
}

function collapse(unit: SemanticWorkUnit): SemanticWorkUnit {
  const units = flattenSemanticWorkUnits(unit);
  const plannedPaths = unique(units.flatMap((item) => item.plannedPaths ?? []));
  const writePaths = unique(units.flatMap((item) => item.writePaths ?? []));
  return {
    key: unit.key,
    kind: "leaf",
    title: unit.title,
    objective: unit.objective,
    concerns: unique(units.flatMap((item) => item.concerns)),
    evidenceIds: unique(units.flatMap((item) => item.evidenceIds)),
    outcomes: uniqueBy(units.flatMap((item) => item.outcomes), (outcome) => outcome.id),
    ...(unit.complexitySignals === undefined ? {} : { complexitySignals: unit.complexitySignals }),
    ...(plannedPaths.length === 0 ? {} : { plannedPaths }),
    ...(writePaths.length === 0 ? {} : { writePaths })
  };
}

function remapSeam(
  seam: SemanticSeam,
  surviving: ReadonlySet<string>,
  parentByKey: ReadonlyMap<string, string>
): SemanticSeam[] {
  const producerUnitKey = nearestSurviving(seam.producerUnitKey, surviving, parentByKey);
  const consumerUnitKeys = unique(
    seam.consumerUnitKeys.map((key) => nearestSurviving(key, surviving, parentByKey))
  ).filter((key) => key !== producerUnitKey);
  return consumerUnitKeys.length === 0 ? [] : [{ ...seam, producerUnitKey, consumerUnitKeys }];
}

function nearestSurviving(
  key: string,
  surviving: ReadonlySet<string>,
  parentByKey: ReadonlyMap<string, string>
): string {
  let candidate: string | undefined = key;
  while (candidate !== undefined) {
    if (surviving.has(candidate)) return candidate;
    candidate = parentByKey.get(candidate);
  }
  throw new Error(`No surviving ancestor exists for semantic unit ${key}.`);
}

function parentMap(root: SemanticWorkUnit): Map<string, string> {
  const output = new Map<string, string>();
  const visit = (unit: SemanticWorkUnit): void => {
    if (unit.kind === "leaf") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
