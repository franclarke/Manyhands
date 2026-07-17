import { eventsForCommand, type RunCommand } from "./commands.js";
import { RunEventSchema, type RunEvent, type RunEventDraft, type RunEventInput } from "./domain/events.js";
import { assertLifecycleTransition } from "./domain/lifecycle.js";
import type { CancellationPort, DeliveryPublisherPort, RunEventJournalPort } from "./ports.js";
import { foldRun, type RunProjection } from "./reducer.js";

export interface RunCoordinatorOptions {
  events: RunEventJournalPort;
  delivery: DeliveryPublisherPort;
  cancellation?: CancellationPort;
  clock(): string;
  eventId(type: string, sequence: number): string;
}

export class RunCoordinator {
  private readonly ports: RunCoordinatorOptions;

  constructor(options: RunCoordinatorOptions) {
    this.ports = options;
  }

  async load(runId: string): Promise<RunProjection> {
    return foldRun(await this.ports.events.load(runId));
  }

  async execute(runId: string, command: RunCommand): Promise<RunProjection> {
    let persisted = await this.ports.events.load(runId);
    let state = foldRun(persisted);
    if (command.type === "publish_delivery") {
      const candidate = state.finalCandidate;
      if (state.lifecycle !== "result_ready" || candidate === undefined) throw new Error("Delivery requires an evidence-eligible result_ready candidate.");
      persisted = await this.append(runId, persisted, [{ type: "delivery.started", payload: { approval: command.approval } }]);
      try {
        const receipt = await this.ports.delivery.publish({ runId, approval: command.approval });
        persisted = await this.append(runId, persisted, [{ type: "delivery.published", payload: { receipt } }]);
        return foldRun(persisted);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.append(runId, persisted, [{ type: "delivery.failed", payload: { manifestId: command.approval.manifestId, reason, retryable: true } }]);
        throw error;
      }
    }
    if (command.type === "cancel") {
      if (this.ports.cancellation === undefined) throw new Error("Cancellation port is not configured.");
      assertLifecycleTransition(state.lifecycle, "cancelling");
      const invalidation = await this.ports.cancellation.invalidateAuthority({ runId, reason: command.reason });
      persisted = await this.append(runId, persisted, [{ type: "operation.cancel_requested", payload: { invalidationReceiptId: invalidation.invalidationReceiptId, reason: command.reason } }]);
      const stopped = await this.ports.cancellation.stopProcesses({ runId });
      if (stopped.allDead) persisted = await this.append(runId, persisted, [{ type: "operation.interrupted", payload: { processReceiptId: stopped.processReceiptId, allDead: true } }]);
      return foldRun(persisted);
    }
    persisted = await this.append(runId, persisted, eventsForCommand(state, command));
    state = foldRun(persisted);
    return state;
  }

  private async append(runId: string, existing: RunEvent[], drafts: RunEventDraft[]): Promise<RunEvent[]> {
    const expectedSequence = existing.length;
    const inputs = drafts.map((draft, index) => ({
      ...draft,
      eventId: this.ports.eventId(draft.type, expectedSequence + index + 1),
      occurredAt: this.ports.clock()
    })) as RunEventInput[];
    const provisional = inputs.map((input, index) => RunEventSchema.parse({
      ...input,
      runId,
      sequence: expectedSequence + index + 1
    }));
    foldRun([...existing, ...provisional]);
    const appended = await this.ports.events.append(runId, expectedSequence, inputs);
    return [...existing, ...appended];
  }
}
