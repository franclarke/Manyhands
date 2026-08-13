import type { FencedRunEventStore, FencingAuthority } from "@manyhands/run-store";
import type { RunEvent } from "@manyhands/run-coordinator";
import type {
  RunActorJournalEvent,
  RunActorJournalPort
} from "./run-actor.js";

export interface FencedRunActorJournalOptions {
  runId: string;
  daemonEpoch: string;
  authority: FencingAuthority;
  store: FencedRunEventStore;
  assertInstallationAuthority?(): Promise<void>;
}

/**
 * Binds one RunActor to one durable event-store fence. The adapter contains no
 * lifecycle policy; it only preserves the actor's single-writer authority.
 */
export class FencedRunActorJournal implements RunActorJournalPort {
  private readonly options: FencedRunActorJournalOptions;

  constructor(options: FencedRunActorJournalOptions) {
    if (options.runId.trim().length === 0 || options.daemonEpoch.trim().length === 0) {
      throw new TypeError("A fenced run journal requires a runId and daemonEpoch.");
    }
    if (options.authority.operationId !== options.daemonEpoch) {
      throw new TypeError("The run fencing authority must be owned by the journal daemon epoch.");
    }
    this.options = options;
  }

  async load(runId: string): Promise<RunEvent[]> {
    this.assertBoundRun(runId);
    return this.options.store.load(runId);
  }

  async assertAuthority(runId: string, daemonEpoch: string): Promise<void> {
    this.assertBoundRun(runId);
    if (daemonEpoch !== this.options.daemonEpoch) {
      throw new Error(`Daemon epoch ${daemonEpoch} does not own run ${runId}.`);
    }
    await this.options.assertInstallationAuthority?.();
    await this.options.store.assertAuthority(runId, this.options.authority);
  }

  async appendAndFlush(input: Parameters<RunActorJournalPort["appendAndFlush"]>[0]): Promise<RunActorJournalEvent[]> {
    await this.assertAuthority(input.runId, input.daemonEpoch);
    const appended = await this.options.store.appendFenced(
      input.runId,
      input.expectedRevision,
      this.options.authority,
      input.events
    );
    await this.options.assertInstallationAuthority?.();
    await this.options.store.assertAuthority(input.runId, this.options.authority);
    if (!appended.every(isActorJournalEvent)) {
      throw new Error("Run actor journal append returned a non-actor event.");
    }
    return appended;
  }

  private assertBoundRun(runId: string): void {
    if (runId !== this.options.runId) {
      throw new Error(`Journal for ${this.options.runId} cannot access run ${runId}.`);
    }
  }
}

function isActorJournalEvent(event: RunEvent): event is RunActorJournalEvent {
  return event.type === "command.accepted"
    || event.type === "effect.requested"
    || event.type === "effect.observed"
    || event.type === "effect.completed"
    || event.type === "effect.failed"
    || event.type === "effect.interrupted";
}
