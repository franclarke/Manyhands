import {
  DEFAULT_EXECUTOR_SELECTION,
  normalizeExecutorSelection,
  type ExecutorId,
  type ExecutorSelection
} from "../executor/registry";
import {
  escalateTier,
  scoreNodeComplexity,
  type ComplexityScore,
  type ComplexityTier,
  type TaskNodeLike
} from "./complexity";

/**
 * Routes a DAG node to the executor/model that fits its complexity: powerful
 * and expensive agents for hard nodes, fast and cheap ones for trivial nodes.
 * Repairs escalate one tier — if the cheap model failed the validation loop,
 * the retry deserves a stronger brain.
 */
export interface RouteInput {
  node: TaskNodeLike;
  dependents: number;
  /** 0 for the first execution, ≥1 for repair attempts (escalates the tier). */
  attempt: number;
}

export interface ExecutorRouter {
  route(input: RouteInput): ExecutorSelection;
  /** Full routing decision with the complexity evidence, for traces/UI. */
  describe(input: RouteInput): RoutingDecision;
}

export interface RoutingDecision {
  selection: ExecutorSelection;
  tier: ComplexityTier;
  complexity: ComplexityScore;
  /** True when the ranked choice was skipped because its CLI is unavailable. */
  degraded: boolean;
}

export type TierRoutes = Record<ComplexityTier, ExecutorSelection[]>;

/**
 * Default lanes. Order inside each tier is preference; unavailable CLIs are
 * skipped at runtime, so a claude-only machine degrades to claude everywhere.
 */
export const DEFAULT_TIER_ROUTES: TierRoutes = {
  trivial: [
    { executorId: "claude-code-cli", model: "haiku" },
    { executorId: "codex-cli", model: "gpt-5.4-mini" },
    { executorId: "claude-code-cli", model: "sonnet" }
  ],
  standard: [
    { executorId: "claude-code-cli", model: "sonnet" },
    { executorId: "codex-cli", model: "gpt-5.4" }
  ],
  complex: [
    { executorId: "claude-code-cli", model: "sonnet" },
    { executorId: "codex-cli", model: "gpt-5.5" },
    { executorId: "claude-code-cli", model: "opus" }
  ],
  critical: [
    { executorId: "claude-code-cli", model: "opus" },
    { executorId: "codex-cli", model: "gpt-5.5" },
    { executorId: "claude-code-cli", model: "sonnet" }
  ]
};

export interface ComplexityRoutingPolicyConfig {
  /** Executors with a working CLI on this machine (see probeExecutorAvailability). */
  available: ReadonlySet<ExecutorId>;
  routes?: TierRoutes;
  fallback?: ExecutorSelection;
}

export class ComplexityRoutingPolicy implements ExecutorRouter {
  private readonly available: ReadonlySet<ExecutorId>;
  private readonly routes: TierRoutes;
  private readonly fallback: ExecutorSelection;

  constructor(config: ComplexityRoutingPolicyConfig) {
    this.available = config.available;
    this.routes = config.routes ?? DEFAULT_TIER_ROUTES;
    this.fallback = config.fallback ?? DEFAULT_EXECUTOR_SELECTION;
  }

  route(input: RouteInput): ExecutorSelection {
    return this.describe(input).selection;
  }

  describe(input: RouteInput): RoutingDecision {
    const complexity = scoreNodeComplexity({ node: input.node, dependents: input.dependents });
    const tier = input.attempt > 0 ? escalateTier(complexity.tier, input.attempt) : complexity.tier;
    const ranked = this.routes[tier];

    const preferred = ranked[0];
    const selection =
      ranked.find((candidate) => this.available.has(candidate.executorId)) ??
      (this.available.has(this.fallback.executorId) ? this.fallback : preferred);

    return {
      selection: selection ?? this.fallback,
      tier,
      complexity,
      degraded: preferred !== undefined && selection !== undefined && selection !== preferred
    };
  }
}

export interface ResolveRoutedSelectionInput {
  node: TaskNodeLike;
  dependents: number;
  defaultSelection: ExecutorSelection;
  /** When set, node metadata may not change the selected executor/model. */
  lockedSelection?: ExecutorSelection;
  router?: ExecutorRouter | undefined;
  attempt?: number;
}

/**
 * Selection precedence for a node: explicit per-node metadata override → the
 * complexity router → the run-level default. Pure, so it is unit-testable
 * without the RunExecutor machinery.
 */
export function resolveRoutedSelection(input: ResolveRoutedSelectionInput): ExecutorSelection {
  const metadata = input.node.metadata as
    | { executorSelection?: unknown; executorOverride?: unknown }
    | undefined;
  const explicit =
    normalizeExecutorSelection(metadata?.executorSelection) ??
    normalizeExecutorSelection(metadata?.executorOverride);
  if (explicit !== undefined) {
    if (input.lockedSelection !== undefined && !sameSelection(explicit, input.lockedSelection)) {
      throw new Error(
        `Node "${input.node.id}" requests executor/model "${explicit.executorId}/${explicit.model}", ` +
          `but this run is fixed to "${input.lockedSelection.executorId}/${input.lockedSelection.model}".`
      );
    }
    return explicit;
  }
  if (input.lockedSelection !== undefined) {
    return input.lockedSelection;
  }
  if (input.router !== undefined) {
    return input.router.route({
      node: input.node,
      dependents: input.dependents,
      attempt: input.attempt ?? 0
    });
  }
  return input.defaultSelection;
}

function sameSelection(left: ExecutorSelection, right: ExecutorSelection): boolean {
  return left.executorId === right.executorId && left.model === right.model;
}
