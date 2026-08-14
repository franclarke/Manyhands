import type { ResourceClaim } from "@manyhands/contracts";

/**
 * Refuses a wave whose selected nodes would write the same resource at once.
 *
 * The frontier selector already filters these, so in a correct system this
 * never fires. It exists because the consequence of a selector defect changed:
 * while a wave executed serially, two conflicting nodes in one selection merely
 * ran one after the other. Now they would run at the same time and write the
 * same file, and the damage would show up as a confusing candidate rather than
 * as a scheduler bug.
 *
 * Failing loudly here keeps a readiness or selection defect diagnosable instead
 * of letting it corrupt a tree.
 */
export function assertNoConcurrentResourceConflict(
  resourceClaims: readonly ResourceClaim[],
  selectedNodeIds: readonly string[]
): void {
  const selected = new Set(selectedNodeIds);
  const claims = resourceClaims.filter((claim) => selected.has(claim.nodeId));
  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      const one = claims[left]!;
      const other = claims[right]!;
      if (one.nodeId === other.nodeId) continue;
      if (one.resourceId !== other.resourceId) continue;
      // Two readers coexist. Anything else races.
      if (one.access !== "modify" && other.access !== "modify") continue;
      const [first, second] = [one.nodeId, other.nodeId].sort();
      throw new Error(
        `Selected wave would run ${first} and ${second} concurrently against ${one.resourceId}. `
        + "Selection must not admit two concurrent claims on one resource when either modifies it."
      );
    }
  }
}
