export type ComplexityLevel = "low" | "medium" | "high";

export interface ThesisMetricNode {
  nodeId: string;
  parentId: string | null;
  complexityScore: number;
  isLeaf: boolean;
  successful?: boolean;
}

export interface ThesisMetricsInput {
  runId: string;
  nodes: readonly ThesisMetricNode[];
  executionTimeSeconds: number;
  tokenCost: number;
  coalescedUnitsCount: number;
}

export interface ComplexitySuccessRate {
  attempts: number;
  successes: number;
  successRate: number;
}

export interface ThesisRunMetrics {
  runId: string;
  granularityEfficiencyIndex: number;
  maxGraphDepth: number;
  totalLeafCount: number;
  averageBranchingFactor: number;
  coalescedUnitsCount: number;
  attemptSuccessRateByComplexity: Record<ComplexityLevel, ComplexitySuccessRate>;
}

export interface ThesisMetricsStore {
  save(runId: string, metrics: ThesisRunMetrics): void | Promise<void>;
}

export class ThesisMetricsCollector {
  constructor(private readonly store: ThesisMetricsStore) {}

  async collect(input: ThesisMetricsInput): Promise<ThesisRunMetrics> {
    validateInput(input);
    const attemptedNodes = input.nodes.filter((node) => node.successful !== undefined);
    const successes = attemptedNodes.filter((node) => node.successful).length;
    const successRatePercent = attemptedNodes.length === 0 ? 0 : successes / attemptedNodes.length * 100;
    const denominator = input.executionTimeSeconds * input.tokenCost;
    const compositeNodes = input.nodes.filter((node) => !node.isLeaf);
    const childCounts = new Map(compositeNodes.map((node) => [node.nodeId, 0]));
    for (const node of input.nodes) {
      if (node.parentId !== null && childCounts.has(node.parentId)) {
        childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
      }
    }

    const metrics: ThesisRunMetrics = {
      runId: input.runId,
      granularityEfficiencyIndex: denominator === 0 ? 0 : roundTo(successRatePercent / denominator, 6),
      maxGraphDepth: maximumDepth(input.nodes),
      totalLeafCount: input.nodes.filter((node) => node.isLeaf).length,
      averageBranchingFactor:
        compositeNodes.length === 0
          ? 0
          : roundTo([...childCounts.values()].reduce((sum, count) => sum + count, 0) / compositeNodes.length, 4),
      coalescedUnitsCount: input.coalescedUnitsCount,
      attemptSuccessRateByComplexity: successRates(attemptedNodes)
    };
    await this.store.save(input.runId, metrics);
    return metrics;
  }
}

export class InMemoryThesisMetricsStore implements ThesisMetricsStore {
  private readonly metricsByRun = new Map<string, ThesisRunMetrics>();

  save(runId: string, metrics: ThesisRunMetrics): void {
    this.metricsByRun.set(runId, structuredClone(metrics));
  }

  get(runId: string): ThesisRunMetrics | undefined {
    const metrics = this.metricsByRun.get(runId);
    return metrics === undefined ? undefined : structuredClone(metrics);
  }
}

function maximumDepth(nodes: readonly ThesisMetricNode[]): number {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  let maximum = 0;
  for (const node of nodes) {
    const visited = new Set<string>();
    let depth = 0;
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) throw new Error(`Cycle detected while computing depth for ${node.nodeId}.`);
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (parent === undefined) throw new Error(`Node ${node.nodeId} references missing parent ${parentId}.`);
      depth += 1;
      parentId = parent.parentId;
    }
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}

function successRates(nodes: readonly ThesisMetricNode[]): Record<ComplexityLevel, ComplexitySuccessRate> {
  const output: Record<ComplexityLevel, ComplexitySuccessRate> = {
    low: { attempts: 0, successes: 0, successRate: 0 },
    medium: { attempts: 0, successes: 0, successRate: 0 },
    high: { attempts: 0, successes: 0, successRate: 0 }
  };
  for (const node of nodes) {
    const level = complexityLevel(node.complexityScore);
    output[level].attempts += 1;
    if (node.successful) output[level].successes += 1;
  }
  for (const level of Object.keys(output) as ComplexityLevel[]) {
    const bucket = output[level];
    bucket.successRate = bucket.attempts === 0 ? 0 : roundTo(bucket.successes / bucket.attempts, 4);
  }
  return output;
}

function complexityLevel(score: number): ComplexityLevel {
  if (score <= 3.5) return "low";
  if (score <= 7) return "medium";
  return "high";
}

function validateInput(input: ThesisMetricsInput): void {
  if (input.runId.trim().length === 0) throw new TypeError("runId must be non-empty.");
  if (!Number.isFinite(input.executionTimeSeconds) || input.executionTimeSeconds < 0) {
    throw new RangeError("executionTimeSeconds must be finite and non-negative.");
  }
  if (!Number.isFinite(input.tokenCost) || input.tokenCost < 0) {
    throw new RangeError("tokenCost must be finite and non-negative.");
  }
  const ids = input.nodes.map((node) => node.nodeId);
  if (new Set(ids).size !== ids.length) throw new Error("Thesis metric node ids must be unique.");
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
