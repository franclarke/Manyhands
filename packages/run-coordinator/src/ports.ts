import type { RunEvent, RunEventInput } from "./domain/events.js";
import type { DeliveryReceipt } from "./domain/outcomes.js";

export interface RunEventJournalPort {
  load(runId: string): Promise<RunEvent[]>;
  append(runId: string, expectedSequence: number, events: RunEventInput[]): Promise<RunEvent[]>;
}

export interface DeliveryPublisherPort {
  publish(input: { runId: string; manifestId: string; destination: string }): Promise<DeliveryReceipt>;
}

export interface CancellationPort {
  invalidateAuthority(input: { runId: string; reason: string }): Promise<{ invalidationReceiptId: string }>;
  stopProcesses(input: { runId: string }): Promise<{ processReceiptId: string; allDead: boolean }>;
}
