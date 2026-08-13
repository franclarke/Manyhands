import {
  CommandReceiptSchema,
  RunCommandEnvelopeSchema,
  foldRun,
  validateCommandReceiptIdentity,
  validateRunCommandEnvelopeIdentity,
  type CommandReceipt,
  type RunCommandEnvelope,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";
import type { DigestHasher } from "@manyhands/contracts";

export interface DurableRunEngineActor {
  submit(command: RunCommandEnvelope): Promise<CommandReceipt>;
  recoverPendingEffects(): Promise<void>;
}

export interface DurableRunEngineActorRegistry {
  getOrCreate(runId: string): Promise<DurableRunEngineActor>;
}

export interface DurableRunEngineEventStore {
  load(runId: string): Promise<RunEvent[]>;
}

export interface DurableRunEngineOptions {
  actorRegistry: DurableRunEngineActorRegistry;
  eventStore: DurableRunEngineEventStore;
  assertInstallationAuthority(): Promise<void>;
  hasher: DigestHasher;
}

export interface RunEventPage {
  events: RunEvent[];
  nextSequence: number;
}

/**
 * Application-facing boundary for the durable daemon kernel. Productive
 * mutations always enter a per-run actor; reads rebuild from the canonical
 * journal and never create an actor or mutate liveness.
 */
export class DurableRunEngine {
  constructor(private readonly options: DurableRunEngineOptions) {}

  async submit(input: unknown): Promise<CommandReceipt> {
    const command = RunCommandEnvelopeSchema.parse(input);
    if (!validateRunCommandEnvelopeIdentity(command, this.options.hasher).ok) {
      throw new Error(`Command ${command.commandId} has invalid canonical identity.`);
    }
    const actor = await this.options.actorRegistry.getOrCreate(command.runId);
    const receipt = CommandReceiptSchema.parse(await actor.submit(command));
    if (!validateCommandReceiptIdentity(receipt, this.options.hasher).ok) {
      throw new Error(`Actor returned an invalid receipt for command ${command.commandId}.`);
    }
    if (
      receipt.commandId !== command.commandId
      || receipt.runId !== command.runId
      || receipt.commandDigest !== command.commandDigest
    ) {
      throw new Error(`Actor returned a receipt for a different command.`);
    }
    return receipt;
  }

  async query(runId: string): Promise<RunProjection> {
    const events = await this.readAuthoritativeEvents(runId);
    return foldRun(events);
  }

  async eventsReady(runId: string, afterSequence: number): Promise<RunEventPage> {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError("afterSequence must be a non-negative integer.");
    }
    const events = await this.readAuthoritativeEvents(runId);
    const projection = foldRun(events);
    if (afterSequence > projection.sequence) {
      throw new RangeError(
        `Event cursor ${afterSequence} is ahead of journal sequence ${projection.sequence}.`
      );
    }
    return {
      events: events.filter((event) => event.sequence > afterSequence),
      nextSequence: projection.sequence
    };
  }

  private async readAuthoritativeEvents(runId: string): Promise<RunEvent[]> {
    assertRunId(runId);
    await this.options.assertInstallationAuthority();
    const events = await this.options.eventStore.load(runId);
    await this.options.assertInstallationAuthority();
    return events;
  }
}

function assertRunId(runId: string): void {
  if (runId.trim().length === 0) throw new TypeError("runId must not be empty.");
}
