import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

/**
 * Deterministic complexity scoring for DAG nodes. The orchestrator uses it to
 * route hard nodes to stronger (slower, costlier) agents and trivial nodes to
 * fast ones. Deliberately feature-based and explainable: every point comes
 * with a human-readable signal that lands in the execution trace.
 */
export type ComplexityTier = "trivial" | "standard" | "complex" | "critical";

/** Structural subset of TaskNode the scorer needs (keeps tests light). */
export type TaskNodeLike = Pick<
  TaskNode,
  "id" | "kind" | "goal" | "depth" | "metadata" | "contract" | "acceptanceCriteria"
>;

export interface ComplexityScore {
  score: number;
  tier: ComplexityTier;
  /** Why the node scored what it scored — one phrase per contributing feature. */
  signals: string[];
}

export interface ScoreNodeComplexityInput {
  node: TaskNodeLike;
  /** How many other nodes depend on this one (fan-out of its results). */
  dependents: number;
}

const TIER_ORDER: ComplexityTier[] = ["trivial", "standard", "complex", "critical"];

export function escalateTier(tier: ComplexityTier, steps = 1): ComplexityTier {
  const index = Math.min(TIER_ORDER.indexOf(tier) + Math.max(0, steps), TIER_ORDER.length - 1);
  return TIER_ORDER[index] ?? tier;
}

function tierForScore(score: number): ComplexityTier {
  if (score <= 2) return "trivial";
  if (score <= 5) return "standard";
  if (score <= 9) return "complex";
  return "critical";
}

/** Count canonical outgoing dependency edges for `nodeId`. */
export function countDependents(graph: Pick<TaskGraph, "dependencies">, nodeId: string): number {
  return graph.dependencies.filter((dependency) => dependency.fromTaskId === nodeId).length;
}

export function scoreNodeComplexity(input: ScoreNodeComplexityInput): ComplexityScore {
  const { node } = input;
  const contract = node.contract;
  let score = 0;
  const signals: string[] = [];

  const produced = contract?.producedInterfaces?.length ?? 0;
  if (produced > 0) {
    score += produced * 2;
    signals.push(`produces ${produced} shared interface seam(s) others build against`);
  }
  const consumed = contract?.consumedInterfaces?.length ?? 0;
  if (consumed > 0) {
    score += consumed;
    signals.push(`consumes ${consumed} interface seam(s)`);
  }

  const expectedFiles = contract?.expectedOutput?.changedFiles?.length ?? 0;
  if (expectedFiles > 1) {
    score += expectedFiles - 1;
    signals.push(`touches ${expectedFiles} expected files`);
  }

  const acceptance = node.acceptanceCriteria?.length ?? contract?.acceptance?.length ?? 0;
  const acceptancePoints = Math.floor(acceptance / 2);
  if (acceptancePoints > 0) {
    score += acceptancePoints;
    signals.push(`${acceptance} acceptance criteria`);
  }

  const goalWords = `${node.goal ?? ""} ${contract?.objective ?? ""}`.trim().split(/\s+/).filter(Boolean).length;
  if (goalWords > 80) {
    score += 2;
    signals.push("long, multi-concern goal");
  } else if (goalWords > 40) {
    score += 1;
    signals.push("sizeable goal description");
  }

  const fanOut = Math.min(input.dependents, 3);
  if (fanOut > 0) {
    score += fanOut;
    signals.push(`${input.dependents} task(s) depend on its output`);
  }

  const scope = contract?.executionScope;
  const scopeGlobs =
    (scope?.implementationPaths.length ?? 0) + (scope?.testPaths.length ?? 0) + (scope?.configPaths.length ?? 0);
  if (scopeGlobs > 4) {
    score += 2;
    signals.push("very broad file scope");
  } else if (scopeGlobs > 2) {
    score += 1;
    signals.push("broad file scope");
  }

  if (node.kind === "integrator") {
    score += 6;
    signals.push("integrator node: merges sibling work across seams");
  }

  if (node.depth <= 1) {
    score += 1;
    signals.push("near-root node with wide blast radius");
  }

  return { score, tier: tierForScore(score), signals };
}
