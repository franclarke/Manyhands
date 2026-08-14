export type RepairRoute =
  | { readonly kind: "retry_node"; readonly nodeId: string }
  | { readonly kind: "amend_plan"; readonly reason: string }
  | { readonly kind: "effect_policy"; readonly reason: string };

export interface RepairRoutingGraph {
  readonly seamBindings: readonly {
    readonly id: string;
    readonly producerNodeId: string;
    readonly consumerNodeId: string;
  }[];
}

export interface ConsumedArtifactOrigin {
  readonly artifactId: string;
  readonly producerNodeId: string;
}

/**
 * Causes the environment owns. A retry against the same environment repeats the
 * failure, so these must not become an attempt.
 */
const ENVIRONMENT_MARKERS = [
  "SANDBOX_UNAVAILABLE",
  "environment_auth_executor",
  "binary_missing",
  "executor_unavailable",
  "quota",
  "model_not_found",
  "auth"
];

const OWNERSHIP_MARKER = "ownership_violation";
const TOPOLOGY_MARKERS = ["topology_error", "unowned_acceptance", "amend_plan"];

/**
 * Send a failure to the lowest authority that can actually fix it.
 *
 * The default before Stage 9 was to raise a conflict on whichever node failed.
 * For a composite that is almost always the wrong address: the parent cannot
 * fix a defect inside a child's artifact, and asking it to try invites exactly
 * the unrestricted super-agent this stage removes.
 *
 * When no single authority is identifiable the route is a plan amendment, not a
 * guess. Picking one of several indicted children would move the repair to a
 * node that cannot complete it.
 */
export function routeRepair(input: {
  readonly failedNodeId: string;
  readonly failureReason: string;
  readonly graph: RepairRoutingGraph;
  readonly consumedArtifacts: readonly ConsumedArtifactOrigin[];
}): RepairRoute {
  const reason = input.failureReason;

  if (ENVIRONMENT_MARKERS.some((marker) => reason.includes(marker))) {
    return { kind: "effect_policy", reason };
  }
  if (reason.includes(OWNERSHIP_MARKER) || TOPOLOGY_MARKERS.some((marker) => reason.includes(marker))) {
    return { kind: "amend_plan", reason };
  }

  // Only artifacts this attempt actually consumed can be indicted. A failure
  // that merely mentions an artifact it never read indicts nothing.
  const indictedByArtifact = new Set(input.consumedArtifacts
    .filter((artifact) => reason.includes(artifact.artifactId))
    .map((artifact) => artifact.producerNodeId));

  const consumedProducers = new Set(input.consumedArtifacts.map((artifact) => artifact.producerNodeId));
  const indictedBySeam = new Set(input.graph.seamBindings
    .filter((binding) => reason.includes(binding.id) && binding.consumerNodeId === input.failedNodeId)
    .map((binding) => binding.producerNodeId)
    .filter((producerNodeId) => consumedProducers.has(producerNodeId)));

  const indicted = [...new Set([...indictedByArtifact, ...indictedBySeam])].sort();
  if (indicted.length === 1) {
    return { kind: "retry_node", nodeId: indicted[0]! };
  }
  if (indicted.length > 1) {
    return {
      kind: "amend_plan",
      reason: `${reason} (indicts ${indicted.join(", ")}; no single lowest authority)`
    };
  }
  return { kind: "retry_node", nodeId: input.failedNodeId };
}
