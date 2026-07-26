import type { GranularityCriticDecision, ProposedGranularityUnit } from "./coalescing-critic.js";
import { ADAPTIVE_GRANULARITY_POLICY, type GranularityPolicy } from "./policy.js";
import {
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
  /** `c-task/1.0.0`, suffixed with the experiment condition when not productive. */
  formulaVersion: string;
  weights: ComplexityWeights;
  leafThreshold: number;
  assessments: Record<string, AdaptiveUnitAssessment>;
  criticDecisions: GranularityCriticDecision[];
  coalescedUnitsCount: number;
  metrics: AdaptiveStructuralMetrics;
}

export interface AdaptivePlanningInput {
  breakdown: WorkBreakdown;
  /** Defaults to the productive policy; G5 conditions override it per run. */
  policy?: GranularityPolicy;
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
  const policy = input.policy ?? ADAPTIVE_GRANULARITY_POLICY;
  const breakdown = WorkBreakdownSchema.parse(input.breakdown);
  const sources = new Map<string, ComplexitySignalSource>();
  const preserved = new Map<string, PreservedUnitFields>();
  const pathEvidenceById = new Map(
    breakdown.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => [evidence.id, evidence.reference])
  );

  const architectRoot = toArchitectInput(breakdown.root, { sources, preserved, pathEvidenceById });
  const compiled = compileAdaptiveWorkUnitTree(architectRoot, policy);

  const assessments: Record<string, AdaptiveUnitAssessment> = {};
  for (const [key, assessment] of Object.entries(compiled.assessments)) {
    assessments[key] = { ...assessment, signalSource: sources.get(key) ?? "derived" };
  }

  const criticDecisions = [
    ...compiled.criticDecisions,
    ...collapseDecisions(assessments, breakdown.root)
  ];
  const restoredRoot = propagateAncestorAcceptance(restoreSemanticFields(
    compiled.root,
    preserved,
    compiled.mergedFrom,
    breakdown.root.acceptanceIntentIds,
    pathEvidenceById
  ));
  // Reshaping can merge, collapse or re-split units, so relations authored
  // against the planner's original keys must be remapped onto the units that
  // absorbed them. A dangling producer/consumer would fail schema validation
  // and silently lose a real dependency.
  const survivors = unitKeys(restoredRoot);
  const absorbedBy = absorptionMap(breakdown.root, restoredRoot, compiled.mergedFrom, survivors);
  const reshaped = WorkBreakdownSchema.parse({
    ...breakdown,
    root: restoredRoot,
    candidateArtifacts: remapRelations(breakdown.candidateArtifacts, absorbedBy),
    candidateSeams: remapRelations(breakdown.candidateSeams, absorbedBy)
  });
  const metrics = structuralMetrics(reshaped.root, compiled.coalescedUnitsCount);

  return {
    breakdown: reshaped,
    formulaVersion: `${ADAPTIVE_GRANULARITY_FORMULA_VERSION}${policy.versionSuffix}`,
    weights: { ...policy.weights },
    leafThreshold: policy.leafThreshold,
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
  rootAcceptanceIntentIds: string[],
  pathEvidenceById: Map<string, string>
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
        // A synthesized part must own only ITS slice of the parent's surface.
        // Inheriting every evidence id would give each part the parent's whole
        // scope, making the split meaningless and forcing siblings to conflict
        // over the same files.
        evidenceIds: partEvidenceIds(unit.plannedPaths, parentFields, pathEvidenceById),
        // Likewise for declared new outputs: keep only the part's own slice.
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
    children: unit.children.map((child) => restoreSemanticFields(child, preserved, mergedFrom, rootAcceptanceIntentIds, pathEvidenceById))
  };
}

/**
 * A parent intent is inherited coverage for each of its semantic descendants.
 * Keeping that reference on leaves lets completeness review prove executable
 * coverage, while acceptance allocation still compiles the intent once at its
 * lowest common ancestor.
 */
function propagateAncestorAcceptance(unit: WorkUnit, inherited: readonly string[] = []): WorkUnit {
  const acceptanceIntentIds = uniqueValues([...inherited, ...unit.acceptanceIntentIds]);
  if (unit.kind === "leaf") return { ...unit, acceptanceIntentIds };
  return {
    ...unit,
    acceptanceIntentIds,
    children: unit.children.map((child) => propagateAncestorAcceptance(child, acceptanceIntentIds))
  };
}

function unitKeys(root: WorkUnit): Set<string> {
  return new Set(flattenUnits(root).map((unit) => unit.key));
}

/**
 * Maps every original planner unit key onto the surviving unit that absorbed
 * it: itself when it survived, the merged unit when it was coalesced, or the
 * nearest surviving ancestor when its subtree collapsed into a leaf.
 */
function absorptionMap(
  originalRoot: WorkUnit,
  reshapedRoot: WorkUnit,
  mergedFrom: Record<string, string[]>,
  survivors: Set<string>
): Map<string, string> {
  const absorbed = new Map<string, string>();
  for (const [mergedKey, sourceKeys] of Object.entries(mergedFrom)) {
    if (!survivors.has(mergedKey)) continue;
    for (const sourceKey of sourceKeys) absorbed.set(sourceKey, mergedKey);
  }

  const parents = new Map<string, string>();
  const indexParents = (unit: WorkUnit): void => {
    if (unit.kind !== "composite") return;
    for (const child of unit.children) {
      parents.set(child.key, unit.key);
      indexParents(child);
    }
  };
  indexParents(originalRoot);

  for (const unit of flattenUnits(originalRoot)) {
    if (absorbed.has(unit.key)) continue;
    if (survivors.has(unit.key)) {
      absorbed.set(unit.key, unit.key);
      continue;
    }
    // The unit disappeared: walk up until a surviving ancestor is found. The
    // reshaped root always survives, so this terminates.
    let ancestor = parents.get(unit.key);
    while (ancestor !== undefined && !survivors.has(ancestor) && !absorbed.has(ancestor)) {
      ancestor = parents.get(ancestor);
    }
    const target = ancestor === undefined
      ? reshapedRoot.key
      : absorbed.get(ancestor) ?? ancestor;
    absorbed.set(unit.key, survivors.has(target) ? target : reshapedRoot.key);
  }
  return absorbed;
}

interface CandidateRelation {
  producerUnitKey: string;
  consumerUnitKeys: string[];
}

/**
 * Rewrites a relation onto surviving units and drops it when producer and
 * consumers collapse into the same unit — a unit cannot consume its own
 * output, and an intra-unit dependency is no longer a coordination fact.
 */
function remapRelations<T extends CandidateRelation>(relations: readonly T[], absorbedBy: Map<string, string>): T[] {
  const remapped: T[] = [];
  for (const relation of relations) {
    const producer = absorbedBy.get(relation.producerUnitKey) ?? relation.producerUnitKey;
    const consumers = [...new Set(
      relation.consumerUnitKeys
        .map((key) => absorbedBy.get(key) ?? key)
        .filter((key) => key !== producer)
    )];
    if (consumers.length === 0) continue;
    remapped.push({ ...relation, producerUnitKey: producer, consumerUnitKeys: consumers });
  }
  return remapped;
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

/**
 * Evidence a synthesized part inherits: only the parent's path evidence whose
 * reference falls inside the part's assigned scope. Non-path evidence is not
 * inherited because it is not scope-bearing.
 */
function partEvidenceIds(
  assignedPaths: string[] | undefined,
  parentFields: PreservedUnitFields | undefined,
  pathEvidenceById: Map<string, string>
): string[] {
  if (parentFields === undefined) return [];
  if (assignedPaths === undefined) return [...parentFields.evidenceIds];
  const assigned = new Set(assignedPaths);
  return parentFields.evidenceIds.filter((id) => {
    const reference = pathEvidenceById.get(id);
    return reference !== undefined && assigned.has(reference);
  });
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
