import type { DigestHasher } from "@manyhands/contracts";
import { LegacyGraphRevisionV2Schema, type LegacyGraphRevisionV2 } from "./graph-revision.js";
import { GraphRevisionSchema, validateGraphRevision, type GraphRevision } from "./canonical-graph.js";

export type GraphRevisionRead =
  | { kind: "canonical"; graph: GraphRevision; readOnly: false; requiresReplan: false }
  | { kind: "legacy_v2"; graph: LegacyGraphRevisionV2; readOnly: true; requiresReplan: true }
  | { kind: "legacy_v1"; graph: unknown; readOnly: true; requiresReplan: true }
  | { kind: "unknown"; graph: unknown; readOnly: true; requiresReplan: true };

export function readGraphRevision(input: unknown, hasher: DigestHasher): GraphRevisionRead {
  const canonical = GraphRevisionSchema.safeParse(input);
  if (canonical.success) {
    const findings = validateGraphRevision(canonical.data, { hasher });
    if (findings.length === 0) return { kind: "canonical", graph: canonical.data, readOnly: false, requiresReplan: false };
    return { kind: "unknown", graph: input, readOnly: true, requiresReplan: true };
  }
  return readLegacyGraphForCompatibility(input);
}

export function readLegacyGraphForCompatibility(input: unknown): Exclude<GraphRevisionRead, { kind: "canonical" }> {
  const v2 = LegacyGraphRevisionV2Schema.safeParse(input);
  if (v2.success) return { kind: "legacy_v2", graph: v2.data, readOnly: true, requiresReplan: true };
  if (isLegacyV1Graph(input)) return { kind: "legacy_v1", graph: input, readOnly: true, requiresReplan: true };
  return { kind: "unknown", graph: input, readOnly: true, requiresReplan: true };
}

function isLegacyV1Graph(input: unknown): boolean {
  if (input === null || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.planId === "string" && typeof record.rootId === "string" && record.nodes !== null && typeof record.nodes === "object" && Array.isArray(record.dependencies);
}
