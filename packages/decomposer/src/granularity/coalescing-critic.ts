import {
  evaluateIntrinsicComplexity,
  type ComplexityDimensions,
  type GranularityAssessment
} from "./complexity-evaluator.js";

export interface ProposedGranularityUnit {
  nodeId: string;
  title: string;
  goal: string;
  targetScopePaths: string[];
  expectedDependencies?: string[];
  complexity: ComplexityDimensions;
  proposedUnits?: ProposedGranularityUnit[];
}

export interface ReviewedGranularityUnit extends ProposedGranularityUnit {
  assessment: GranularityAssessment;
  forceComposite: boolean;
  mergedFrom: string[];
}

export interface GranularityCriticDecision {
  kind: "coalesced" | "resplit_required" | "resplit_declined";
  unitIds: string[];
  rationale: string;
}

export interface GranularityCriticReview {
  units: ReviewedGranularityUnit[];
  decisions: GranularityCriticDecision[];
  coalescedUnitsCount: number;
}

const EXCESSIVE_SCOPE_RADIUS = 3;
const SMALL_DIRECTORY_PATH_LIMIT = 3;

export function reviewGranularityProposal(
  proposedUnits: readonly ProposedGranularityUnit[],
  coalescingEnabled = true
): GranularityCriticReview {
  const assessed = proposedUnits.map(reviewUnit);
  // A fixed fine-split condition keeps every proposed sibling separate; the
  // re-split critic below still runs, since it protects against a unit whose
  // scope is too wide to be a leaf under any condition.
  const groups = coalescingEnabled ? coalescingGroups(assessed) : assessed.map((unit) => [unit]);
  const decisions: GranularityCriticDecision[] = [];
  const units = groups.map((group) => {
    if (group.length === 1) return group[0]!;
    const merged = mergeUnits(group);
    decisions.push({
      kind: "coalesced",
      unitIds: group.map((unit) => unit.nodeId),
      rationale: `Merged trivial, dependency-free siblings sharing ${sharedScopeLabel(group)}.`
    });
    return merged;
  });

  for (const unit of units) {
    if (unit.forceComposite) {
      decisions.push({
        kind: "resplit_required",
        unitIds: [unit.nodeId],
        rationale: `Leaf scope radius ${unit.complexity.scopeRadius} exceeds the maximum of ${EXCESSIVE_SCOPE_RADIUS} modules.`
      });
    }
  }

  return {
    units,
    decisions,
    coalescedUnitsCount: assessed.length - units.length
  };
}

export function requiresResplitting(unit: ProposedGranularityUnit): boolean {
  const assessment = evaluateIntrinsicComplexity({ nodeId: unit.nodeId, ...unit.complexity });
  return assessment.isLeaf && unit.complexity.scopeRadius > EXCESSIVE_SCOPE_RADIUS;
}

function reviewUnit(unit: ProposedGranularityUnit): ReviewedGranularityUnit {
  validateUnit(unit);
  const assessment = evaluateIntrinsicComplexity({ nodeId: unit.nodeId, ...unit.complexity });
  return {
    ...unit,
    targetScopePaths: uniqueSorted(unit.targetScopePaths.map(normalizePath)),
    expectedDependencies: uniqueSorted(unit.expectedDependencies ?? []),
    assessment,
    forceComposite: assessment.isLeaf && unit.complexity.scopeRadius > EXCESSIVE_SCOPE_RADIUS,
    mergedFrom: [unit.nodeId]
  };
}

function coalescingGroups(units: readonly ReviewedGranularityUnit[]): ReviewedGranularityUnit[][] {
  const groups: ReviewedGranularityUnit[][] = [];
  for (const unit of units) {
    const group = groups.find((candidate) => candidate.every((member) => canCoalesce(member, unit)));
    if (group === undefined) groups.push([unit]);
    else group.push(unit);
  }
  return groups;
}

function canCoalesce(left: ReviewedGranularityUnit, right: ReviewedGranularityUnit): boolean {
  if (
    !left.assessment.isLeaf ||
    !right.assessment.isLeaf ||
    left.forceComposite ||
    right.forceComposite ||
    hasCrossDependency(left, right)
  ) {
    return false;
  }
  const overlap = left.targetScopePaths.some((path) => right.targetScopePaths.includes(path));
  if (overlap) return true;

  const paths = uniqueSorted([...left.targetScopePaths, ...right.targetScopePaths]);
  return paths.length <= SMALL_DIRECTORY_PATH_LIMIT && paths.length > 0 && paths.every((path) => directoryOf(path) === directoryOf(paths[0]!));
}

function hasCrossDependency(left: ReviewedGranularityUnit, right: ReviewedGranularityUnit): boolean {
  return (left.expectedDependencies ?? []).includes(right.nodeId) ||
    (right.expectedDependencies ?? []).includes(left.nodeId);
}

function mergeUnits(units: readonly ReviewedGranularityUnit[]): ReviewedGranularityUnit {
  const dimensions: ComplexityDimensions = {
    scopeRadius: average(units.map((unit) => unit.complexity.scopeRadius)),
    interfaceImpact: average(units.map((unit) => unit.complexity.interfaceImpact)),
    validationSurface: average(units.map((unit) => unit.complexity.validationSurface)),
    contextTokenMass: average(units.map((unit) => unit.complexity.contextTokenMass))
  };
  // Merged ids must remain valid EntityIds (WorkUnit keys / node ids), so the
  // join separator is drawn from the schema's allowed character set.
  const nodeId = units.map((unit) => unit.nodeId).join(":");
  const assessment = evaluateIntrinsicComplexity({ nodeId, ...dimensions });
  return {
    nodeId,
    title: units.map((unit) => unit.title).join(" + "),
    goal: units.map((unit) => unit.goal).join("\n"),
    targetScopePaths: uniqueSorted(units.flatMap((unit) => unit.targetScopePaths)),
    expectedDependencies: uniqueSorted(units.flatMap((unit) => unit.expectedDependencies ?? []).filter((id) => !units.some((unit) => unit.nodeId === id))),
    complexity: dimensions,
    proposedUnits: units.flatMap((unit) => unit.proposedUnits ?? []),
    assessment,
    forceComposite: false,
    mergedFrom: units.flatMap((unit) => unit.mergedFrom)
  };
}

function sharedScopeLabel(units: readonly ReviewedGranularityUnit[]): string {
  const paths = uniqueSorted(units.flatMap((unit) => unit.targetScopePaths));
  const sharedFile = paths.find((path) => units.every((unit) => unit.targetScopePaths.includes(path)));
  return sharedFile ?? directoryOf(paths[0] ?? ".");
}

function validateUnit(unit: ProposedGranularityUnit): void {
  if (unit.nodeId.trim().length === 0) throw new TypeError("Proposed unit nodeId must be non-empty.");
  if (unit.targetScopePaths.length === 0) throw new TypeError(`Proposed unit ${unit.nodeId} must declare targetScopePaths.`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
