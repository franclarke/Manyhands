export interface ConflictConstraintEvidence {
  id: string; leftNodeId: string; rightNodeId: string; reason: string;
  risk: "unknown" | "low" | "medium" | "high" | "blocking";
  mode?: "advisory" | "serialize" | "resource_lock";
  resourceId?: string;
  signals: Array<{ type: string; detail: string; sourceRef?: string }>;
  confidence: number; observedAt: string; expiresAt: string;
}

export function createConflictConstraintEvidence(input: Omit<ConflictConstraintEvidence, "risk" | "expiresAt" | "mode"> & { risk?: Exclude<ConflictConstraintEvidence["risk"], "unknown">; mode?: NonNullable<ConflictConstraintEvidence["mode"]>; expiresAt?: string }): ConflictConstraintEvidence {
  if (input.confidence < 0 || input.confidence > 1) throw new Error("Conflict confidence must be between 0 and 1.");
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed)) throw new Error("Conflict evidence requires a valid observedAt timestamp.");
  const risk = input.signals.length === 0 ? "unknown" : input.risk ?? "unknown";
  const mode = input.mode ?? (risk === "low" ? "advisory" : "serialize");
  return { ...input, risk, mode, expiresAt: input.expiresAt ?? new Date(observed + 24 * 60 * 60 * 1_000).toISOString() };
}
