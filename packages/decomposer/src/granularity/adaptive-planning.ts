import type { GranularityCriticDecision, ProposedGranularityUnit } from "./coalescing-critic.js";
import {
  DEFAULT_COMPLEXITY_WEIGHTS,
  LEAF_COMPLEXITY_THRESHOLD,
  type ComplexityDimensions,
  type ComplexityWeights,
  type GranularityAssessment
} from "./complexity-evaluator.js";
import { compileAdaptiveWorkUnitTree } from "../compiler/graph-compiler-v3.js";
import type { ArchitectTaskInput } from "../llm/architect-pass.js";
import {
  WorkBreakdownSchema,
  type ComplexitySignals,
  type WorkBreakdown,
  type WorkUnit,
  type WorkUnitComposite
} from "../planner/schema.js";

/**
 * Versioned contract of the adaptive granularity formula. Bump when the
 * weights, the leaf threshold, the clamp rules, or the derivation rules
 * change, so persisted assessments always name the formula that produced
 * them.
 */
export const ADAPTIVE_GRANULARITY_FORMULA_VERSION = "c-task/1.0.0";

export type ComplexitySignalSource = "llm" | "clamped" | "derived";

export interface AdaptiveUnitAssessment extends GranularityAssessment {
  /** Where the accepted dimensions came from (D-7 hybrid validation). */
  signalSource: ComplexitySignalSource;
}

export interface AdaptiveStructuralMetrics {
  maxGraphDepth: number;
  totalLeafCount: number;
  averageBranchingFactor: number;
  coalescedUnitsCount: number;
}

export interface AdaptivePlanningResult {
  breakdown: WorkBreakdown;
  formulaVersion: typeof ADAPTIVE_GRANULARITY_FORMULA_VERSION;
  weights: ComplexityWeights;
  leafThreshold: number;
  assessments: Record<string, AdaptiveUnitAssessment>;
  criticDecisions: GranularityCriticDecision[];
  coalescedUnitsCount: number;
  metrics: AdaptiveStructuralMetrics;
}

export interface AdaptivePlanningInput {
  breakdown: WorkBreakdown;
}

interface PreservedUnitFields {
  title: string;
  objective: string;
  concerns: string[];
  expectedOutcomes: string[];
  acceptanceIntentIds: string[];
  evidenceIds: string[];
  /** Paths the planner declared as NEW outputs (never existing repo files). */
  plannedPaths: string[] | undefined;
}

/**
 * Applies the deterministic C_task policy to the Planner's WorkBreakdown
 * before graph compilation (target route, roadmap §9):
 *
 *   Planner (semantic, may emit complexitySignals per unit)
 *     → hybrid signal validation (clamp against the declared unit surface)
 *     → deterministic C_task assessment + coalescing / re-splitting critics
 *     → canonical WorkUnit tree (same shape the Graph Compiler consumes)
 *
 * The reshaped tree deliberately reuses `compileAdaptiveWorkUnitTree` so there
 * is exactly one implementation of the granularity policy and no parallel
 * graph model. Semantic fields authored by the planner are preserved on every
 * unit whose key survives the pass; synthesized units (re-splits, merges)
 * derive their fields from their sources.
 */
export function applyAdaptiveGranularity(input: AdaptivePlanningInput): AdaptivePlanningResult {
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  const sources = new Map<string, ComplexitySignalSource>();
  const preserved = new Map<string, PreservedUnitFields>();
  const pathEvidenceById = new Map(
    breakdown.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => [evidence.id, evidence.reference])
  );

  const architectRoot = toArchitectInput(breakdown.root, { sources, preserved, pathEvidenceById });
  const compiled = compileAdaptiveWorkUnitTree(architectRoot);

  const assessments: Record<string, AdaptiveUnitAssessment> = {};
  for (const [key, assessment] of Object.entries(compiled.assessments)) {
    assessments[key] = { ...assessment, signalSource: sources.get(key) ?? "derived" };
  }

  const criticDecisions = [
    ...compiled.criticDecisions,
    ...collapseDecisions(assessments, breakdown.root)
  ];
  const restoredRoot = restoreSemanticFields(compiled.root, preserved, compiled.mergedFrom, breakdown.root.acceptanceIntentIds);
  const reshaped = WorkBreakdownSchema.parse({ ...breakdown, root: restoredRoot });
  const metrics = structuralMetrics(reshaped.root, compiled.coalescedUnitsCount);

  return {
    breakdown: reshaped,
    formulaVersion: ADAPTIVE_GRANULARITY_FORMULA_VERSION,
    weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
    leafThreshold: LEAF_COMPLEXITY_THRESHOLD,
    assessments,
    criticDecisions,
    coalescedUnitsCount: compiled.coalescedUnitsCount,
    metrics
  };
}

interface BridgeContext {
  sources: Map<string, ComplexitySignalSource>;
  preserved: Map<string, PreservedUnitFields>;
  pathEvidenceById: Map<string, string>;
}

function toArchitectInput(unit: WorkUnit, context: BridgeContext): ArchitectTaskInput {
  const paths = unitPaths(unit, context);
  const { dimensions, source } = acceptSignals(unit, paths);
  context.sources.set(unit.key, source);
  context.preserved.set(unit.key, {
    title: unit.title,
    objective: unit.objective,
    concerns: [...unit.concerns],
    expectedOutcomes: [...unit.expectedOutcomes],
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    evidenceIds: [...unit.evidenceIds],
    plannedPaths: unit.plannedPaths === undefined ? undefined : [...unit.plannedPaths]
  });

  return {
    nodeId: unit.key,
    title: unit.title,
    goal: unit.objective,
    targetScopePaths: paths,
    complexity: dimensions,
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    ...(unit.complexitySignals?.rationale === undefined ? {} : { rationale: unit.complexitySignals.rationale }),
    ...(unit.kind === "composite" && unit.children.length > 0
      ? { proposedUnits: unit.children.map((child) => toProposedUnit(child, context)) }
      : {})
  };
}

function toProposedUnit(unit: WorkUnit, context: BridgeContext): ProposedGranularityUnit {
  const paths = unitPaths(unit, context);
  const { dimensions, source } = acceptSignals(unit, paths);
  context.sources.set(unit.key, source);
  context.preserved.set(unit.key, {
    title: unit.title,
    objective: unit.objective,
    concerns: [...unit.concerns],
    expectedOutcomes: [...unit.expectedOutcomes],
    acceptanceIntentIds: [...unit.acceptanceIntentIds],
    evidenceIds: [...unit.evidenceIds],
    plannedPaths: unit.plannedPaths === undefined ? undefined : [...unit.plannedPaths]
  });

  return {
    nodeId: unit.key,
    title: unit.title,
    goal: unit.objective,
    targetScopePaths: paths,
    complexity: dimensions,
    expectedDependencies: [],
    ...(unit.kind === "composite" && unit.children.length > 0
      ? { proposedUnits: unit.children.map((child) => toProposedUnit(child, context)) }
      : {})
  };
}

/** Resolves the unit's declared surface: planned paths plus cited path evidence. */
function unitPaths(unit: WorkUnit, context: BridgeContext): string[] {
  const fromEvidence = unit.evidenceIds
    .map((id) => context.pathEvidenceById.get(id))
    .filter((reference): reference is string => reference !== undefined);
  const own = [...(unit.plannedPaths ?? []), ...fromEvidence];
  if (own.length > 0) return [...new Set(own)];
  if (unit.kind === "composite") {
    const fromChildren = unit.children.flatMap((child) => unitPaths(child, context));
    if (fromChildren.length > 0) return [...new Set(fromChildren)];
  }
  return [];
}

/**
 * D-7 hybrid acceptance: the planner's semantic signals are kept when they are
 * coherent with the unit's declared surface, clamped when they understate or
 * overstate it, and fully derived from the surface when the planner omitted
 * them.
 */
function acceptSignals(
  unit: WorkUnit,
  paths: string[]
): { dimensions: ComplexityDimensions; source: ComplexitySignalSource } {
  if (unit.complexitySignals === undefined) {
    return { dimensions: deriveSignals(unit, paths), source: "derived" };
  }
  const raw = unit.complexitySignals;
  const clamped: ComplexityDimensions = {
    scopeRadius: clampScopeRadius(raw.scopeRadius, paths.length),
    interfaceImpact: clampDimension(raw.interfaceImpact),
    validationSurface: clampDimension(raw.validationSurface),
    contextTokenMass: clampDimension(raw.contextTokenMass)
  };
  const changed =
    clamped.scopeRadius !== raw.scopeRadius ||
    clamped.interfaceImpact !== raw.interfaceImpact ||
    clamped.validationSurface !== raw.validationSurface ||
    clamped.contextTokenMass !== raw.contextTokenMass;
  return { dimensions: clamped, source: changed ? "clamped" : "llm" };
}

/** Deterministic fallback derivation from the unit's observable surface. */
function deriveSignals(unit: WorkUnit, paths: string[]): ComplexityDimensions {
  const pathCount = Math.max(paths.length, 1);
  return {
    scopeRadius: Math.min(10, pathCount),
    interfaceImpact: Math.min(10, unit.kind === "composite" ? pathCount : Math.ceil(pathCount / 2)),
    validationSurface: Math.min(10, unit.acceptanceIntentIds.length * 2),
    contextTokenMass: Math.min(10, pathCount * 1.5)
  };
}

function clampDimension(value: number): number {
  return Math.min(10, Math.max(0, value));
}

/**
 * The scope radius must stay coherent with the number of declared paths: a
 * unit touching 8 modules cannot claim radius 1, and a single-file unit cannot
 * claim radius 9.
 */
function clampScopeRadius(value: number, pathCount: number): number {
  if (pathCount === 0) return clampDimension(value);
  const floor = Math.min(10, Math.ceil(pathCount / 2));
  const ceiling = Math.min(10, pathCount + 2);
  return Math.min(ceiling, Math.max(floor, clampDimension(value)));
}

/**
 * Rebuilds the reshaped tree with the planner's semantic fields wherever the
 * unit key survived, and derives fields for synthesized units: coalesced units
 * union their sources (provenance from the compiler's `mergedFrom`), re-split
 * parts (":part-N") inherit from their oversized source leaf.
 */
function restoreSemanticFields(
  unit: WorkUnit,
  preserved: Map<string, PreservedUnitFields>,
  mergedFrom: Record<string, string[]>,
  rootAcceptanceIntentIds: string[]
): WorkUnit {
  const own = preserved.get(unit.key);
  const mergedSources = (mergedFrom[unit.key] ?? [])
    .map((part) => preserved.get(part))
    .filter((fields): fields is PreservedUnitFields => fields !== undefined);
  const parentKey = unit.key.includes(":part-") ? unit.key.slice(0, unit.key.lastIndexOf(":part-")) : undefined;
  const parentFields = parentKey === undefined ? undefined : preserved.get(parentKey);

  const fields: PreservedUnitFields = own ?? (mergedSources.length > 0
    ? {
        title: mergedSources.map((source) => source.title).join(" + "),
        objective: mergedSources.map((source) => source.objective).join("\n"),
        concerns: uniqueValues(mergedSources.flatMap((source) => source.concerns)),
        expectedOutcomes: uniqueValues(mergedSources.flatMap((source) => source.expectedOutcomes)),
        acceptanceIntentIds: uniqueValues(mergedSources.flatMap((source) => source.acceptanceIntentIds)),
        evidenceIds: uniqueValues(mergedSources.flatMap((source) => source.evidenceIds)),
        plannedPaths: mergedPlannedPaths(mergedSources)
      }
    : {
        title: unit.title,
        objective: unit.objective,
        concerns: [...unit.concerns],
        expectedOutcomes: [...unit.expectedOutcomes],
        acceptanceIntentIds: parentFields === undefined ? [...rootAcceptanceIntentIds] : [...parentFields.acceptanceIntentIds],
        evidenceIds: parentFields === undefined ? [] : [...parentFields.evidenceIds],
        // A re-split part only keeps the slice of paths its source leaf
        // declared as new outputs; observed repo paths stay evidence.
        plannedPaths: partPlannedPaths(unit.plannedPaths, parentFields)
      });

  const common = {
    key: unit.key,
    title: fields.title,
    objective: fields.objective,
    concerns: fields.concerns,
    expectedOutcomes: fields.expectedOutcomes,
    acceptanceIntentIds: fields.acceptanceIntentIds,
    evidenceIds: fields.evidenceIds,
    ...(fields.plannedPaths === undefined || fields.plannedPaths.length === 0 ? {} : { plannedPaths: fields.plannedPaths })
  };

  if (unit.kind === "leaf") return { ...common, kind: "leaf" };
  return {
    ...common,
    kind: "composite",
    cut: unit.cut,
    children: unit.children.map((child) => restoreSemanticFields(child, preserved, mergedFrom, rootAcceptanceIntentIds))
  };
}

/** Records composites the policy collapsed into a single leaf (leaf-stop rule). */
function collapseDecisions(
  assessments: Record<string, AdaptiveUnitAssessment>,
  originalRoot: WorkUnit
): GranularityCriticDecision[] {
  const originalComposites = new Set(flattenUnits(originalRoot).filter((unit) => unit.kind === "composite").map((unit) => unit.key));
  const decisions: GranularityCriticDecision[] = [];
  for (const [key, assessment] of Object.entries(assessments)) {
    if (assessment.isLeaf && originalComposites.has(key)) {
      decisions.push({
        kind: "coalesced",
        unitIds: [key],
        rationale: `Composite ${key} collapsed into a single leaf at C_task=${assessment.complexityScore.toFixed(2)}.`
      });
    }
  }
  return decisions;
}

function structuralMetrics(root: WorkUnit, coalescedUnitsCount: number): AdaptiveStructuralMetrics {
  let maxDepth = 0;
  let leafCount = 0;
  const branchingFactors: number[] = [];
  const visit = (unit: WorkUnit, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth);
    if (unit.kind === "leaf") {
      leafCount += 1;
      return;
    }
    branchingFactors.push(unit.children.length);
    for (const child of unit.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return {
    maxGraphDepth: maxDepth,
    totalLeafCount: leafCount,
    averageBranchingFactor: branchingFactors.length === 0
      ? 0
      : branchingFactors.reduce((sum, value) => sum + value, 0) / branchingFactors.length,
    coalescedUnitsCount
  };
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...(root as WorkUnitComposite).children.flatMap(flattenUnits)];
}

function mergedPlannedPaths(sources: readonly PreservedUnitFields[]): string[] | undefined {
  const paths = uniqueValues(sources.flatMap((source) => source.plannedPaths ?? []));
  return paths.length === 0 ? undefined : paths;
}

function partPlannedPaths(
  compiledPaths: string[] | undefined,
  parentFields: PreservedUnitFields | undefined
): string[] | undefined {
  if (compiledPaths === undefined || parentFields?.plannedPaths === undefined) return undefined;
  const authored = new Set(parentFields.plannedPaths);
  const kept = compiledPaths.filter((path) => authored.has(path));
  return kept.length === 0 ? undefined : kept;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}
