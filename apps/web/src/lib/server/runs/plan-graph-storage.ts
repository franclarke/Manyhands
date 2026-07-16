import type { TaskGraph } from "@manyhands/task-graph";
import { parseRunPatches, type RunPatch } from "./patches";
import type { RunRecord } from "./schema";

function containsMaterializedReplan(graph: TaskGraph): boolean {
  return Object.values(graph.nodes).some((node) => {
    const revision = node.metadata?.["replanRevision"];
    return typeof revision === "number" && Number.isInteger(revision) && revision > 0;
  });
}

/**
 * Select the authoritative patch sequence for every graph reader.
 *
 * Before `planGraphStorage` existed, replan baked the current graft into the
 * planning graph while retaining historical SUBTREE_REGENERATED patches.
 * Replaying those patches resurrects obsolete subtrees. Marked records always
 * use immutable-base replay; unmarked baked replans keep their materialized
 * subtree shape and still replay later idempotent edits.
 */
export function compatibleGraphPatches(run: RunRecord, baseGraph: TaskGraph): RunPatch[] {
  const patches = parseRunPatches(run.patches);
  if (run.planGraphStorage !== undefined || !containsMaterializedReplan(baseGraph)) {
    return patches;
  }
  return patches.filter((patch) => patch.type !== "SUBTREE_REGENERATED");
}
