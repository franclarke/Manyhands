import {
  computeCanonicalDigest,
  validateEffectIntentIdentity,
  validatePhysicalEffectReceiptBinding,
  validatePhysicalEffectReceiptIdentity,
  type DigestHasher,
  type EffectIntent,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  CommandReceiptSchema,
  RunCommandEnvelopeSchema,
  buildCommandReceipt,
  validateCommandReceiptIdentity,
  validateRunCommandEnvelopeIdentity,
  type CommandReceipt,
  type RunCommandEnvelope,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

export type RunActorJournalEvent = Extract<
  RunEvent,
  { type: "command.accepted" | "effect.requested" | "effect.observed" }
>;
export type RunActorJournalInput = Extract<
  RunEventInput,
  { type: "command.accepted" | "effect.requested" | "effect.observed" }
>;

export interface RunActorJournalPort {
  load(runId: string): Promise<RunEvent[]>;
  assertAuthority(runId: string, daemonEpoch: string): Promise<void>;
  appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunActorJournalInput[];
  }): Promise<RunActorJournalEvent[]>;
}

export interface RunActorDispatcherPort {
  observe(intent: EffectIntent): Promise<PhysicalEffectReceipt[]>;
  reconcile(intent: EffectIntent, observerDaemonEpoch: string): Promise<PhysicalEffectReceipt[]>;
}

export interface RunActorDecisionContext {
  runId: string;
  daemonEpoch: string;
  acceptedRevision: number;
}

export interface RunActorOptions {
  runId: string;
  daemonEpoch: string;
  journal: RunActorJournalPort;
  dispatcher: RunActorDispatcherPort;
  decide(
    command: RunCommandEnvelope,
    context: RunActorDecisionContext
  ): Promise<EffectIntent[]> | EffectIntent[];
  hasher: DigestHasher;
  clock(): string;
}

export class RunActor {
  private readonly options: RunActorOptions;
  private mailbox: Promise<unknown> = Promise.resolve();
  private readonly effectTasks = new Map<string, Promise<void>>();
  private readonly effectFailures: unknown[] = [];

  constructor(options: RunActorOptions) {
    this.options = options;
  }

  async submit(input: unknown): Promise<CommandReceipt> {
    const accepted = await this.enqueue(() => this.accept(input));
    for (const intent of accepted.intents) this.startEffect(intent, "observe");
    return accepted.receipt;
  }

  async recoverPendingEffects(): Promise<void> {
    const intents = await this.enqueue(() => this.pendingEffects());
    await Promise.all(intents.map((intent) => this.startEffect(intent, "reconcile")));
  }

  /** Waits for actor-owned physical work and surfaces any background failure. */
  async drainEffects(): Promise<void> {
    while (this.effectTasks.size > 0) {
      await Promise.allSettled([...this.effectTasks.values()]);
    }
    const failure = this.effectFailures.shift();
    if (failure !== undefined) throw failure;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.mailbox.then(operation, operation);
    this.mailbox = current.catch(() => undefined);
    return current;
  }

  private async accept(input: unknown): Promise<{
    receipt: CommandReceipt;
    intents: EffectIntent[];
  }> {
    const envelope = parseEnvelope(input, this.options.hasher);
    if (envelope.runId !== this.options.runId) {
      throw new Error(`Command ${envelope.commandId} belongs to run ${envelope.runId}, not ${this.options.runId}.`);
    }

    await this.options.journal.assertAuthority(this.options.runId, this.options.daemonEpoch);
    const events = await this.options.journal.load(this.options.runId);
    const currentRevision = journalRevision(events);
    const existing = commandReceipt(events, envelope.commandId, this.options.hasher);
    if (existing !== undefined) {
      if (existing.commandDigest !== envelope.commandDigest) {
        throw new Error(`Command id ${envelope.commandId} was already accepted with different content.`);
      }
      return { receipt: existing, intents: [] };
    }
    if (currentRevision !== envelope.expectedRevision) {
      throw new Error(
        `Run revision conflict for ${envelope.commandId}: expected ${envelope.expectedRevision}, current ${currentRevision}.`
      );
    }

    const acceptedRevision = currentRevision + 1;
    const acceptedAt = this.options.clock();
    const receipt = buildCommandReceipt({
      schemaVersion: 1,
      commandId: envelope.commandId,
      runId: envelope.runId,
      commandDigest: envelope.commandDigest,
      acceptedRevision,
      daemonEpoch: this.options.daemonEpoch,
      acceptedAt
    }, this.options.hasher);
    const intents = await this.options.decide(envelope, {
      runId: this.options.runId,
      daemonEpoch: this.options.daemonEpoch,
      acceptedRevision
    });
    for (const intent of intents) this.assertDispatchableIntent(intent);

    const journalInputs: RunActorJournalInput[] = [
      {
        eventId: computeCanonicalDigest({ type: "command.accepted", receiptId: receipt.receiptId }, this.options.hasher),
        occurredAt: acceptedAt,
        type: "command.accepted",
        payload: { receipt }
      },
      ...intents.map((intent): RunActorJournalInput => ({
        eventId: computeCanonicalDigest({ type: "effect.requested", effectId: intent.effectId }, this.options.hasher),
        occurredAt: intent.requestedAt,
        type: "effect.requested",
        payload: { intent }
      }))
    ];
    const appended = await this.options.journal.appendAndFlush({
      runId: this.options.runId,
      expectedRevision: currentRevision,
      daemonEpoch: this.options.daemonEpoch,
      events: journalInputs
    });
    if (appended.length !== journalInputs.length || journalRevision(appended) !== currentRevision + journalInputs.length) {
      throw new Error("Journal returned an impossible revision after durable command acceptance.");
    }

    return { receipt, intents };
  }

  private async pendingEffects(): Promise<EffectIntent[]> {
    await this.options.journal.assertAuthority(this.options.runId, this.options.daemonEpoch);
    const events = await this.options.journal.load(this.options.runId);
    const intents = new Map<string, EffectIntent>();
    const terminal = new Set<string>();

    for (const fact of events) {
      if (fact.type === "effect.requested") {
        const validation = validateEffectIntentIdentity(fact.payload.intent, this.options.hasher);
        if (!validation.ok || fact.payload.intent.runId !== this.options.runId) {
          throw new Error(`Persisted effect intent ${fact.payload.intent.effectId} is corrupt.`);
        }
        const prior = intents.get(fact.payload.intent.effectId);
        if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(fact.payload.intent)) {
          throw new Error(`Effect id ${fact.payload.intent.effectId} identifies conflicting intents.`);
        }
        intents.set(fact.payload.intent.effectId, fact.payload.intent);
      }
      if (fact.type === "effect.observed") {
        const receipt = fact.payload.receipt;
        const validation = validatePhysicalEffectReceiptIdentity(receipt, this.options.hasher);
        if (!validation.ok) throw new Error(`Persisted physical receipt ${receipt.receiptId} is corrupt.`);
        const intent = intents.get(receipt.effectId);
        if (intent === undefined || intent.inputDigest !== receipt.inputDigest) {
          throw new Error(`Physical receipt ${receipt.receiptId} does not bind to a persisted intent.`);
        }
        if (receipt.observation !== "started") terminal.add(receipt.effectId);
      }
    }

    return [...intents.values()].filter((intent) => !terminal.has(intent.effectId));
  }

  private startEffect(intent: EffectIntent, mode: "observe" | "reconcile"): Promise<void> {
    const existing = this.effectTasks.get(intent.effectId);
    if (existing !== undefined) return existing;

    const operation = (async () => {
      await this.options.journal.assertAuthority(this.options.runId, this.options.daemonEpoch);
      const receipts = mode === "observe"
        ? await this.options.dispatcher.observe(intent)
        : await this.options.dispatcher.reconcile(intent, this.options.daemonEpoch);
      await this.enqueue(() => this.recordObservations(intent, receipts, mode === "observe"));
    })();
    const task = operation.catch((error) => {
      this.effectFailures.push(error);
      throw error;
    }).finally(() => {
      if (this.effectTasks.get(intent.effectId) === task) this.effectTasks.delete(intent.effectId);
    });
    this.effectTasks.set(intent.effectId, task);
    void task.catch(() => undefined);
    return task;
  }

  private async recordObservations(
    intent: EffectIntent,
    receipts: readonly PhysicalEffectReceipt[],
    requireCurrentEpoch: boolean
  ): Promise<void> {
    for (const receipt of receipts) {
      const identity = validatePhysicalEffectReceiptIdentity(receipt, this.options.hasher);
      const binding = validatePhysicalEffectReceiptBinding(receipt, intent, this.options.hasher);
      if (!identity.ok || !binding.ok) {
        throw new Error(`Physical receipt ${receipt.receiptId} is not valid evidence for effect ${intent.effectId}.`);
      }
      if (requireCurrentEpoch && receipt.daemonEpoch !== this.options.daemonEpoch) {
        throw new Error(`New physical receipt ${receipt.receiptId} was produced under a stale daemon epoch.`);
      }
    }
    if (receipts.length === 0) return;

    await this.options.journal.assertAuthority(this.options.runId, this.options.daemonEpoch);
    const current = await this.options.journal.load(this.options.runId);
    const persisted = new Map(
      current
        .filter((event): event is Extract<RunEvent, { type: "effect.observed" }> => event.type === "effect.observed")
        .map((event) => [event.payload.receipt.receiptId, event.payload.receipt])
    );
    const unseen = receipts.filter((receipt) => {
      const existing = persisted.get(receipt.receiptId);
      if (existing === undefined) return true;
      if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
        throw new Error(`Physical receipt id ${receipt.receiptId} identifies conflicting observations.`);
      }
      return false;
    });
    if (unseen.length === 0) return;

    const revision = journalRevision(current);
    const inputs = unseen.map((receipt): RunActorJournalInput => ({
      eventId: computeCanonicalDigest({ type: "effect.observed", receiptId: receipt.receiptId }, this.options.hasher),
      occurredAt: receipt.observedAt,
      type: "effect.observed",
      payload: { receipt }
    }));
    const appended = await this.options.journal.appendAndFlush({
      runId: this.options.runId,
      expectedRevision: revision,
      daemonEpoch: this.options.daemonEpoch,
      events: inputs
    });
    if (appended.length !== inputs.length || journalRevision(appended) !== revision + inputs.length) {
      throw new Error("Journal returned an impossible revision after recording physical observations.");
    }
  }

  private assertDispatchableIntent(intent: EffectIntent): void {
    const validation = validateEffectIntentIdentity(intent, this.options.hasher);
    if (!validation.ok) throw new Error(`Effect intent ${intent.effectId} has invalid canonical identity.`);
    if (intent.runId !== this.options.runId) {
      throw new Error(`Effect intent ${intent.effectId} belongs to another run.`);
    }
    if (intent.daemonEpoch !== this.options.daemonEpoch) {
      throw new Error(`New effect intent ${intent.effectId} was created under a stale daemon epoch.`);
    }
  }
}

function parseEnvelope(input: unknown, hasher: DigestHasher): RunCommandEnvelope {
  const envelope = RunCommandEnvelopeSchema.parse(input);
  const validation = validateRunCommandEnvelopeIdentity(envelope, hasher);
  if (!validation.ok) throw new Error(`Command ${envelope.commandId} has invalid canonical identity.`);
  return envelope;
}

function commandReceipt(
  facts: readonly RunEvent[],
  commandId: string,
  hasher: DigestHasher
): CommandReceipt | undefined {
  const matches = facts
    .filter((fact): fact is Extract<RunEvent, { type: "command.accepted" }> =>
      fact.type === "command.accepted" && fact.payload.receipt.commandId === commandId)
    .map((fact) => {
      const receipt = CommandReceiptSchema.parse(fact.payload.receipt);
      if (!validateCommandReceiptIdentity(receipt, hasher).ok) {
        throw new Error(`Command receipt ${receipt.receiptId} has invalid canonical identity.`);
      }
      return receipt;
    });
  if (matches.length > 1) throw new Error(`Command id ${commandId} has duplicate durable receipts.`);
  return matches[0];
}

function journalRevision(events: readonly RunEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}
