import type { ConflictListItem, ConflictViewRiskLevel } from "@/lib/conflict-view-model";

/** One RISK_ACKNOWLEDGED to persist; carries WHY so it is auditable, not blind. */
export interface ConflictAcknowledgement {
  taskIds: [string, string];
  reason: string;
}

export interface ConflictResolutionPlan {
  acknowledgements: ConflictAcknowledgement[];
}

const ACTIONABLE_LEVELS: ReadonlySet<ConflictViewRiskLevel> = new Set(["medium", "high", "blocking"]);
/** RISK_ACKNOWLEDGED.reason is capped at 1000 chars by the patch schema. */
const MAX_REASON_LENGTH = 1000;

/**
 * Plan-time conflict resolution (Pieza 1). Deterministic: for every actionable,
 * not-yet-acknowledged conflict, emit a RISK_ACKNOWLEDGED spec whose reason
 * captures WHY (the prediction's explanation + shared files).
 *
 * Serialization is intentionally NOT proposed. In the base-branch isolation
 * model every leaf branches from `baseCommit`, so adding a dependency reorders
 * batches without making the dependent leaf see its predecessor's changes — it
 * would cost parallelism while the real conflict still surfaces at integration.
 * The composer (D8), made conflict-aware in Pieza 2, does the actual merge.
 */
export function planConflictResolution(conflicts: readonly ConflictListItem[]): ConflictResolutionPlan {
  const acknowledgements: ConflictAcknowledgement[] = [];
  for (const conflict of conflicts) {
    if (conflict.acknowledged || !ACTIONABLE_LEVELS.has(conflict.level)) {
      continue;
    }
    acknowledgements.push({
      taskIds: [conflict.taskAId, conflict.taskBId],
      reason: buildReason(conflict)
    });
  }
  return { acknowledgements };
}

function buildReason(conflict: ConflictListItem): string {
  const files = conflict.sharedFiles.length > 0 ? ` Shared: ${conflict.sharedFiles.join(", ")}.` : "";
  const reason = `Auto-resolved (${conflict.level}): ${conflict.reason}${files} Reconciled by the composer at integration.`;
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason;
}
