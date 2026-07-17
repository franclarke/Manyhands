export interface ConflictConstraintEvidence {
  id: string; leftNodeId: string; rightNodeId: string; reason: string;
  risk: "unknown" | "low" | "medium" | "high" | "blocking";
  signals: Array<{ type: string; detail: string; sourceRef?: string }>;
  confidence: number; observedAt: string; expiresAt: string;
}

export function createConflictConstraintEvidence(input: Omit<ConflictConstraintEvidence, "risk" | "expiresAt"> & { risk?: Exclude<ConflictConstraintEvidence["risk"], "unknown">; expiresAt?: string }): ConflictConstraintEvidence {
  if (input.confidence < 0 || input.confidence > 1) throw new Error("Conflict confidence must be between 0 and 1.");
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed)) throw new Error("Conflict evidence requires a valid observedAt timestamp.");
  return { ...input, risk: input.signals.length === 0 ? "unknown" : input.risk ?? "unknown", expiresAt: input.expiresAt ?? new Date(observed + 24 * 60 * 60 * 1_000).toISOString() };
}
