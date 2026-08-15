import type { ResourceClaim } from "@manyhands/contracts";

export interface ResourceAuthorityViolation {
  readonly kind: "ownership_violation";
  readonly path: string;
  readonly ownedByNodeId: string;
  readonly attemptedByNodeId: string;
}

/** The subset of a compiled artifact contract that carries write title. */
export interface ArtifactPathOwnership {
  readonly id: string;
  readonly producerNodeId: string;
  readonly expectedPaths: readonly string[];
}

/**
 * Which node holds write title over each path.
 *
 * A `modify` claim names a resource, not a path; the path comes from the
 * artifact that claim produces. `observe` grants no title at all.
 */
function writeTitles(
  resourceClaims: readonly ResourceClaim[],
  artifactContracts: readonly ArtifactPathOwnership[]
): Map<string, Set<string>> {
  const pathsByArtifactId = new Map(artifactContracts.map((contract) => [contract.id, contract.expectedPaths]));
  const titles = new Map<string, Set<string>>();
  for (const claim of resourceClaims) {
    if (claim.access !== "modify") continue;
    for (const path of pathsByArtifactId.get(claim.outputArtifact.id) ?? []) {
      const owners = titles.get(path) ?? new Set<string>();
      owners.add(claim.nodeId);
      titles.set(path, owners);
    }
  }
  return titles;
}

/**
 * Paths this node wrote that another node holds write title over.
 *
 * This is deliberately not a scope check. A composite's scope contract
 * legitimately spans its children's paths — it summarizes the surface it
 * integrates — so the scope enforcer admits a parent writing a child's file.
 * Authority is the separate question of who may change a resource, and the
 * answer does not change because the writer happens to be the parent.
 *
 * A path no one claims is not reported here. That is the scope enforcer's
 * business, and reporting it twice would blur which invariant failed.
 *
 * `composedArtifactIds` names the artifacts this attempt composed rather than
 * authored. An integration diffs its candidate against the target base, so
 * every path in every child artifact it composes appears in `changedPaths` by
 * construction; reading those as writes refuses the composite for doing the one
 * thing it exists to do. Only the paths those artifacts actually carry are
 * excused, so a composite that reaches a sibling path outside them is still
 * reported.
 */
export function checkResourceAuthority(input: {
  readonly nodeId: string;
  readonly resourceClaims: readonly ResourceClaim[];
  readonly artifactContracts: readonly ArtifactPathOwnership[];
  readonly changedPaths: readonly string[];
  readonly composedArtifactIds?: readonly string[];
}): ResourceAuthorityViolation[] {
  const titles = writeTitles(input.resourceClaims, input.artifactContracts);
  const composed = new Set(input.composedArtifactIds ?? []);
  const composedPaths = new Set(input.artifactContracts
    .filter((contract) => composed.has(contract.id))
    .flatMap((contract) => contract.expectedPaths));
  const violations: ResourceAuthorityViolation[] = [];
  for (const path of [...new Set(input.changedPaths)].sort()) {
    if (composedPaths.has(path)) continue;
    const owners = titles.get(path);
    if (owners === undefined) continue;
    // A parent claiming the same resource does not dilute the child's title.
    const foreignOwners = [...owners].filter((owner) => owner !== input.nodeId).sort();
    if (foreignOwners.length === 0) continue;
    violations.push({
      kind: "ownership_violation",
      path,
      ownedByNodeId: foreignOwners[0]!,
      attemptedByNodeId: input.nodeId
    });
  }
  return violations;
}

/** A single-line reason suitable for a durable attempt failure. */
export function describeResourceAuthorityViolations(
  violations: readonly ResourceAuthorityViolation[]
): string {
  const detail = violations
    .map((violation) => `${violation.path} is owned by ${violation.ownedByNodeId}`)
    .join("; ");
  return `ownership_violation: ${violations[0]!.attemptedByNodeId} wrote resources it does not claim: ${detail}. Amend the plan instead of repairing the attempt.`;
}
