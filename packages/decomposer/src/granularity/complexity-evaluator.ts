export const LEAF_COMPLEXITY_THRESHOLD = 3.5;

export interface ComplexityDimensions {
  /** Number or normalized breadth of affected files/modules/packages (0..10). */
  scopeRadius: number;
  /** Impact on exported contracts or public APIs (0..10). */
  interfaceImpact: number;
  /** Breadth of validation obligations and suites (0..10). */
  validationSurface: number;
  /** Estimated context mass, normalized to 0..10. */
  contextTokenMass: number;
}

export interface ComplexityEvaluationInput extends ComplexityDimensions {
  nodeId: string;
  rationale?: string;
}

export interface ComplexityWeights {
  scopeRadius: number;
  interfaceImpact: number;
  validationSurface: number;
  contextTokenMass: number;
}

export interface GranularityAssessment {
  nodeId: string;
  complexityScore: number;
  isLeaf: boolean;
  nodeKind: "LeafNode" | "CompositeNode";
  rationale: string;
  dimensions: ComplexityDimensions;
  recommendedBranchingFactor?: number;
}

export const DEFAULT_COMPLEXITY_WEIGHTS: Readonly<ComplexityWeights> = Object.freeze({
  scopeRadius: 0.3,
  interfaceImpact: 0.25,
  validationSurface: 0.25,
  contextTokenMass: 0.2
});

export function evaluateIntrinsicComplexity(
  input: ComplexityEvaluationInput,
  weights: ComplexityWeights = DEFAULT_COMPLEXITY_WEIGHTS,
  leafThreshold: number = LEAF_COMPLEXITY_THRESHOLD
): GranularityAssessment {
  assertNodeId(input.nodeId);
  const dimensions = {
    scopeRadius: normalizeDimension(input.scopeRadius, "scopeRadius"),
    interfaceImpact: normalizeDimension(input.interfaceImpact, "interfaceImpact"),
    validationSurface: normalizeDimension(input.validationSurface, "validationSurface"),
    contextTokenMass: normalizeDimension(input.contextTokenMass, "contextTokenMass")
  };
  const normalizedWeights = normalizeWeights(weights);
  const complexityScore = roundTo(
    dimensions.scopeRadius * normalizedWeights.scopeRadius +
      dimensions.interfaceImpact * normalizedWeights.interfaceImpact +
      dimensions.validationSurface * normalizedWeights.validationSurface +
      dimensions.contextTokenMass * normalizedWeights.contextTokenMass,
    2
  );
  const isLeaf = complexityScore <= leafThreshold;
  const assessment: GranularityAssessment = {
    nodeId: input.nodeId,
    complexityScore,
    isLeaf,
    nodeKind: isLeaf ? "LeafNode" : "CompositeNode",
    rationale:
      input.rationale ??
      `${isLeaf ? "Leaf" : "Composite"} at C_task=${complexityScore.toFixed(2)} ` +
        `(S_r=${dimensions.scopeRadius}, I_i=${dimensions.interfaceImpact}, ` +
        `V_s=${dimensions.validationSurface}, T_m=${dimensions.contextTokenMass}).`,
    dimensions
  };

  if (!isLeaf) {
    assessment.recommendedBranchingFactor = recommendedBranchingFactor(complexityScore);
  }
  return assessment;
}

export class IntrinsicComplexityEvaluator {
  constructor(private readonly weights: ComplexityWeights = DEFAULT_COMPLEXITY_WEIGHTS) {}

  evaluate(input: ComplexityEvaluationInput): GranularityAssessment {
    return evaluateIntrinsicComplexity(input, this.weights);
  }
}

export function recommendedBranchingFactor(complexityScore: number): number {
  if (!Number.isFinite(complexityScore)) {
    throw new RangeError("complexityScore must be finite.");
  }
  return Math.max(2, Math.min(5, Math.ceil(complexityScore / 2)));
}

function normalizeDimension(value: number, label: keyof ComplexityDimensions): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
  return Math.min(10, value);
}

function normalizeWeights(weights: ComplexityWeights): ComplexityWeights {
  const entries = Object.entries(weights) as Array<[keyof ComplexityWeights, number]>;
  for (const [label, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} weight must be a finite, non-negative number.`);
    }
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) throw new RangeError("Complexity weights must have a positive sum.");
  return Object.fromEntries(entries.map(([label, value]) => [label, value / total])) as unknown as ComplexityWeights;
}

function assertNodeId(nodeId: string): void {
  if (nodeId.trim().length === 0) throw new TypeError("nodeId must be non-empty.");
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
