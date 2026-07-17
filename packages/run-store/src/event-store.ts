import type { RunEvent, RunEventInput, RunEventJournalPort } from "@manyhands/run-coordinator";

export interface FencingAuthority {
  operationId: string;
  fencingToken: number;
}

export interface RunEventLogInspection {
  events: RunEvent[];
  status: "ok" | "degraded" | "corrupt";
  reason?: string;
}

export interface FencedRunEventStore {
  load(runId: string): Promise<RunEvent[]>;
  inspect(runId: string): Promise<RunEventLogInspection>;
  advanceFence(runId: string, authority: FencingAuthority): Promise<void>;
  assertAuthority(runId: string, authority: FencingAuthority): Promise<void>;
  appendFenced(
    runId: string,
    expectedSequence: number,
    authority: FencingAuthority,
    events: RunEventInput[]
  ): Promise<RunEvent[]>;
  withFencedWrite<T>(runId: string, authority: FencingAuthority, operation: () => Promise<T>): Promise<T>;
  bind(authority: FencingAuthority): RunEventJournalPort;
}

export class SequenceConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Run event sequence conflict: expected ${expected}, current sequence is ${actual}.`);
    this.name = "SequenceConflictError";
  }
}

export class StaleFencingTokenError extends Error {
  constructor(runId: string, authority: FencingAuthority) {
    super(`Operation ${authority.operationId}/${authority.fencingToken} no longer owns run ${runId}.`);
    this.name = "StaleFencingTokenError";
  }
}

export class CorruptRunEventLogError extends Error {
  constructor(runId: string, reason: string) {
    super(`Run event log ${runId} is corrupt: ${reason}`);
    this.name = "CorruptRunEventLogError";
  }
}
