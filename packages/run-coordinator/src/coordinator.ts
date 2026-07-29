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
      if ((state.lifecycle !== "result_ready" && state.lifecycle !== "delivering") || candidate === undefined) {
        throw new Error("Delivery requires an evidence-eligible result_ready or recovering delivering candidate.");
      }
      if (state.lifecycle === "result_ready") {
        persisted = await this.append(runId, persisted, [{ type: "delivery.started", payload: { approval: command.approval } }]);
      } else if (JSON.stringify(state.deliveryApproval) !== JSON.stringify(command.approval)) {
        throw new Error("The in-progress delivery belongs to a different approval.");
      }
      let receipt;
      try {
        receipt = await this.ports.delivery.publish({ runId, approval: command.approval });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.append(runId, persisted, [{ type: "delivery.failed", payload: { manifestId: command.approval.manifestId, reason, retryable: true } }]);
        throw error;
      }
      persisted = await this.append(runId, persisted, [{ type: "delivery.published", payload: { receipt } }]);
      return foldRun(persisted);
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

  /**
   * Persists facts produced by an external side-effect adapter. Callers supply
   * stable event ids so crash recovery can retry the exact observation without
   * fabricating a second lifecycle history.
   */
  async record(runId: string, inputs: RunEventInput[]): Promise<RunProjection> {
    if (inputs.length === 0) return this.load(runId);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.ports.events.load(runId);
      const existing = new Map(current.map((event) => [event.eventId, event]));
      const duplicates = inputs.map((input) => existing.get(input.eventId));
      if (duplicates.every((event) => event !== undefined)) {
        duplicates.forEach((event, index) => assertSameInput(event!, inputs[index]!));
        return foldRun(current);
      }
      if (duplicates.some((event) => event !== undefined)) throw new Error("A fact batch cannot mix persisted and new event ids.");
      try {
        await this.ports.events.append(runId, current.length, inputs);
        return foldRun(await this.ports.events.load(runId));
      } catch (error) {
        const latest = await this.ports.events.load(runId);
        const latestById = new Map(latest.map((event) => [event.eventId, event]));
        const persisted = inputs.map((input) => latestById.get(input.eventId));
        if (persisted.every((event) => event !== undefined)) {
          persisted.forEach((event, index) => assertSameInput(event!, inputs[index]!));
          return foldRun(latest);
        }
        if (persisted.some((event) => event !== undefined)) {
          throw new Error("A fact batch cannot be partially persisted.");
        }
        if (latest.length === current.length) throw error;
      }
    }
    throw new Error(`Run ${runId} event journal remained contended after 8 retries.`);
  }

  /**
   * Derives external facts from the projection protected by the journal's
   * optimistic append. Contention reruns the derivation, so an adoption cannot
   * be committed from a freshness decision made against an older revision.
   */
  async recordDerived(
    runId: string,
    derive: (state: RunProjection) => Promise<RunEventInput[]> | RunEventInput[]
  ): Promise<RunProjection> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.ports.events.load(runId);
      const inputs = await derive(foldRun(current));
      if (inputs.length === 0) return foldRun(current);
      const existing = new Map(current.map((event) => [event.eventId, event]));
      const duplicates = inputs.map((input) => existing.get(input.eventId));
      if (duplicates.every((event) => event !== undefined)) {
        duplicates.forEach((event, index) => assertSameInput(event!, inputs[index]!));
        return foldRun(current);
      }
      if (duplicates.some((event) => event !== undefined)) {
        throw new Error("A derived fact batch cannot mix persisted and new event ids.");
      }
      try {
        await this.ports.events.append(runId, current.length, inputs);
        return foldRun(await this.ports.events.load(runId));
      } catch (error) {
        const latest = await this.ports.events.load(runId);
        const latestById = new Map(latest.map((event) => [event.eventId, event]));
        const persisted = inputs.map((input) => latestById.get(input.eventId));
        if (persisted.every((event) => event !== undefined)) {
          persisted.forEach((event, index) => assertSameInput(event!, inputs[index]!));
          return foldRun(latest);
        }
        if (persisted.some((event) => event !== undefined)) {
          throw new Error("A derived fact batch cannot be partially persisted.");
        }
        if (latest.length === current.length) throw error;
      }
    }
    throw new Error(`Run ${runId} event journal remained contended after 8 derived-fact retries.`);
  }

  private async append(runId: string, existing: RunEvent[], drafts: RunEventDraft[]): Promise<RunEvent[]> {
    let current = existing;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const expectedSequence = current.length;
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
      foldRun([...current, ...provisional]);
      try {
        const appended = await this.ports.events.append(runId, expectedSequence, inputs);
        return [...current, ...appended];
      } catch (error) {
        const latest = await this.ports.events.load(runId);
        if (latest.length === expectedSequence) throw error;
        current = latest;
      }
    }
    throw new Error(`Run ${runId} event journal remained contended after 8 retries.`);
  }
}

function assertSameInput(event: RunEvent, input: RunEventInput): void {
  const persisted = { eventId: event.eventId, occurredAt: event.occurredAt, type: event.type, payload: event.payload };
  if (JSON.stringify(persisted) !== JSON.stringify(input)) {
    throw new Error(`Event id ${input.eventId} was already persisted with different content.`);
  }
}
