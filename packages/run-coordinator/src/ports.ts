import type { RunEvent, RunEventInput } from "./domain/events.js";
import type { DeliveryReceipt } from "./domain/outcomes.js";
import type { DeliveryApproval } from "./domain/outcomes.js";
import type { AdoptedArtifact } from "./domain/artifacts.js";
import type { AttemptRecord } from "./domain/attempts.js";

export interface RunEventJournalPort {
  load(runId: string): Promise<RunEvent[]>;
  append(runId: string, expectedSequence: number, events: RunEventInput[]): Promise<RunEvent[]>;
}

export interface DeliveryPublisherPort {
  publish(input: { runId: string; approval: DeliveryApproval }): Promise<DeliveryReceipt>;
}

export interface CancellationPort {
  invalidateAuthority(input: { runId: string; reason: string }): Promise<{ invalidationReceiptId: string }>;
  stopProcesses(input: { runId: string }): Promise<{ processReceiptId: string; allDead: boolean }>;
}

export interface ArtifactRegistryPort { list(runId: string): Promise<AdoptedArtifact[]>; adopt(artifact: AdoptedArtifact): Promise<AdoptedArtifact>; }
export interface AttemptJournalPort { list(runId: string): Promise<AttemptRecord[]>; create(attempt: Omit<AttemptRecord, "schemaVersion" | "status"> & Partial<Pick<AttemptRecord, "schemaVersion" | "status">>): Promise<AttemptRecord>; }
