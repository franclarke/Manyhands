import { createHash } from "node:crypto";
import type { RunEventInput } from "@manyhands/run-coordinator";

export interface LegacyRunImportAudit {
  sourceHash: string;
  importerVersion: 1;
  approvedBy: string;
  importedAt: string;
  warnings: string[];
}

export interface LegacyRunImport {
  audit: LegacyRunImportAudit;
  events: RunEventInput[];
}

/**
 * Legacy records are never interpreted as if they already were domain events.
 * A caller must explicitly approve the import and supply the lossy mapping.
 */
export class LegacyRunRecordImporter {
  import(input: {
    record: unknown;
    approvedBy: string;
    importedAt: string;
    map: (record: unknown) => { events: RunEventInput[]; warnings: string[] };
  }): LegacyRunImport {
    if (input.approvedBy.trim().length === 0) throw new Error("Legacy import requires an explicit approving actor.");
    const mapped = input.map(input.record);
    if (mapped.events.length === 0) throw new Error("Legacy import must produce an explicit audited event mapping.");
    return {
      audit: {
        sourceHash: createHash("sha256").update(stableJson(input.record)).digest("hex"),
        importerVersion: 1,
        approvedBy: input.approvedBy,
        importedAt: input.importedAt,
        warnings: [...mapped.warnings]
      },
      events: [...mapped.events]
    };
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
