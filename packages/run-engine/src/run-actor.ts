import {
  EffectInputSchema,
  buildEffectInput,
  canonicalJson,
  computeCanonicalDigest,
  validateEffectIntentIdentity,
  validateEffectInputIdentity,
  validatePhysicalEffectReceiptBinding,
  validatePhysicalEffectReceiptIdentity,
  type DigestHasher,
  type EffectInput,
  type EffectInputSpec,
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
import type { EffectInputStorePort } from "./effect-dispatcher.js";

export type RunActorJournalEvent = Extract<
  RunEvent,
  {
    type:
      | "command.accepted"
      | "effect.requested"
      | "effect.observed"
      | "effect.completed"
      | "effect.failed"
      | "effect.interrupted"
  }
>;
export type RunActorJournalInput = Extract<
  RunEventInput,
  {
    type:
      | "command.accepted"
      | "effect.requested"
      | "effect.observed"
      | "effect.completed"
      | "effect.failed"
      | "effect.interrupted"
  }
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

export interface RunActorEffectRequest {
  readonly intent: EffectIntent;
  readonly inputSpec: EffectInputSpec;
}

export interface RunActorOptions {
  runId: string;
  daemonEpoch: string;
  journal: RunActorJournalPort;
  dispatcher: RunActorDispatcherPort;
  inputStore: Pick<EffectInputStorePort, "put">;
  decide(
    command: RunCommandEnvelope,
    context: RunActorDecisionContext
  ): Promise<readonly RunActorEffectRequest[]> | readonly RunActorEffectRequest[];
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
    const requests = await this.options.decide(envelope, {
      runId: this.options.runId,
      daemonEpoch: this.options.daemonEpoch,
      acceptedRevision
    });
    const prepared = requests.map((request) => this.prepareEffectRequest(request));
    for (const request of prepared) {
      const published = await this.options.inputStore.put(structuredClone(request.effectInput.spec));
      this.assertPublishedEffectInput(published, request.effectInput, request.intent);
    }
    const intents = prepared.map((request) => request.intent);

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
    const receipts = new Map<string, PhysicalEffectReceipt>();
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
        const prior = receipts.get(receipt.receiptId);
        if (prior !== undefined && canonicalJson(prior) !== canonicalJson(receipt)) {
          throw new Error(`Physical receipt id ${receipt.receiptId} identifies conflicting observations.`);
        }
        receipts.set(receipt.receiptId, receipt);
      }
      if (
        fact.type === "effect.completed"
        || fact.type === "effect.failed"
        || fact.type === "effect.interrupted"
      ) {
        const { effectId } = fact.payload;
        if (!intents.has(effectId)) throw new Error(`Terminal effect ${effectId} has no persisted intent.`);
        if (terminal.has(effectId)) throw new Error(`Effect ${effectId} has multiple terminal actor events.`);
        if (fact.payload.receiptId !== undefined) {
          const receipt = receipts.get(fact.payload.receiptId);
          if (receipt === undefined || receipt.effectId !== effectId) {
            throw new Error(`Terminal effect ${effectId} does not bind to physical receipt ${fact.payload.receiptId}.`);
          }
          if (fact.type === "effect.completed" && receipt.observation !== "succeeded") {
            throw new Error(`Completed effect ${effectId} does not bind to succeeded physical evidence.`);
          }
          if (fact.type === "effect.failed" && receipt.observation !== "failed") {
            throw new Error(`Failed effect ${effectId} does not bind to failed physical evidence.`);
          }
        }
        terminal.add(effectId);
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
      await this.enqueue(() => this.recordObservations(intent, receipts, mode));
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
    mode: "observe" | "reconcile"
  ): Promise<void> {
    for (const receipt of receipts) {
      const identity = validatePhysicalEffectReceiptIdentity(receipt, this.options.hasher);
      const binding = validatePhysicalEffectReceiptBinding(receipt, intent, this.options.hasher);
      if (!identity.ok || !binding.ok) {
        throw new Error(`Physical receipt ${receipt.receiptId} is not valid evidence for effect ${intent.effectId}.`);
      }
      if (mode === "observe" && receipt.daemonEpoch !== this.options.daemonEpoch) {
        throw new Error(`New physical receipt ${receipt.receiptId} was produced under a stale daemon epoch.`);
      }
    }

    await this.options.journal.assertAuthority(this.options.runId, this.options.daemonEpoch);
    const current = await this.options.journal.load(this.options.runId);
    const persisted = new Map<string, PhysicalEffectReceipt>();
    for (const event of current) {
      if (event.type !== "effect.observed") continue;
      const receipt = event.payload.receipt;
      const existing = persisted.get(receipt.receiptId);
      if (existing !== undefined && canonicalJson(existing) !== canonicalJson(receipt)) {
        throw new Error(`Physical receipt id ${receipt.receiptId} identifies conflicting observations.`);
      }
      persisted.set(receipt.receiptId, receipt);
    }
    if (hasTerminalEvent(current, intent.effectId)) return;

    const unseen = receipts.filter((receipt) => {
      const existing = persisted.get(receipt.receiptId);
      if (existing === undefined) return true;
      if (canonicalJson(existing) !== canonicalJson(receipt)) {
        throw new Error(`Physical receipt id ${receipt.receiptId} identifies conflicting observations.`);
      }
      return false;
    });

    const boundReceipts = new Map<string, PhysicalEffectReceipt>();
    for (const receipt of persisted.values()) {
      if (receipt.effectId === intent.effectId) boundReceipts.set(receipt.receiptId, receipt);
    }
    for (const receipt of receipts) boundReceipts.set(receipt.receiptId, receipt);
    const terminalReceipts = [...boundReceipts.values()]
      .filter((receipt) => receipt.observation !== "started")
      .sort(comparePhysicalReceipts);
    if (terminalReceipts.length > 1) {
      throw new Error(`Effect ${intent.effectId} has multiple terminal physical receipts and no authoritative outcome.`);
    }
    const terminalReceipt = terminalReceipts[0];
    const interruptedReason = persistedInterruptionReason(current, intent);
    const terminalInput = interruptedReason !== undefined
      ? interruptedEffectInput(intent, terminalReceipt, interruptedReason, this.options)
      : terminalReceipt?.observation === "succeeded"
        ? completedEffectInput(intent, terminalReceipt, this.options)
        : terminalReceipt?.observation === "failed"
          ? failedEffectInput(intent, terminalReceipt, this.options)
          : mode === "reconcile"
            && intent.idempotency === "never_repeat_unknown"
            && boundReceipts.size === 0
            ? interruptedEffectInput(
              intent,
              undefined,
              "Unknown prior execution has no physical evidence and must not be repeated.",
              this.options
            )
            : undefined;

    const revision = journalRevision(current);
    const inputs: RunActorJournalInput[] = unseen.map((receipt): RunActorJournalInput => ({
      eventId: computeCanonicalDigest({ type: "effect.observed", receiptId: receipt.receiptId }, this.options.hasher),
      occurredAt: receipt.observedAt,
      type: "effect.observed",
      payload: { receipt }
    }));
    if (terminalInput !== undefined) inputs.push(terminalInput);
    if (inputs.length === 0) return;
    const appended = await this.options.journal.appendAndFlush({
      runId: this.options.runId,
      expectedRevision: revision,
      daemonEpoch: this.options.daemonEpoch,
      events: inputs
    });
    if (appended.length !== inputs.length || journalRevision(appended) !== revision + inputs.length) {
      throw new Error("Journal returned an impossible revision after recording physical observations and actor outcome.");
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

  private prepareEffectRequest(request: RunActorEffectRequest): {
    intent: EffectIntent;
    effectInput: EffectInput;
  } {
    this.assertDispatchableIntent(request.intent);
    const effectInput = buildEffectInput(request.inputSpec, this.options.hasher);
    if (effectInput.inputDigest !== request.intent.inputDigest) {
      throw new Error(
        `Effect input digest ${effectInput.inputDigest} does not match intent ${request.intent.effectId} digest ${request.intent.inputDigest}.`
      );
    }
    if (effectInput.spec.kind !== request.intent.kind) {
      throw new Error(
        `Effect input kind ${effectInput.spec.kind} does not match intent kind ${request.intent.kind}.`
      );
    }
    return {
      intent: structuredClone(request.intent),
      effectInput
    };
  }

  private assertPublishedEffectInput(
    input: unknown,
    expected: EffectInput,
    intent: EffectIntent
  ): void {
    const parsed = EffectInputSchema.safeParse(input);
    if (!parsed.success || !validateEffectInputIdentity(input, this.options.hasher).ok) {
      throw new Error(`Input store returned invalid canonical input for effect ${intent.effectId}.`);
    }
    if (
      parsed.data.inputDigest !== intent.inputDigest
      || parsed.data.spec.kind !== intent.kind
      || canonicalJson(parsed.data) !== canonicalJson(expected)
    ) {
      throw new Error(`Input store did not durably publish the exact input for effect ${intent.effectId}.`);
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

function hasTerminalEvent(events: readonly RunEvent[], effectId: string): boolean {
  const matches = events.filter((event) =>
    (event.type === "effect.completed"
      || event.type === "effect.failed"
      || event.type === "effect.interrupted")
    && event.payload.effectId === effectId);
  if (matches.length > 1) throw new Error(`Effect ${effectId} has multiple terminal actor events.`);
  return matches.length === 1;
}

function completedEffectInput(
  intent: EffectIntent,
  receipt: PhysicalEffectReceipt,
  options: Pick<RunActorOptions, "hasher">
): RunActorJournalInput {
  return {
    eventId: computeCanonicalDigest({
      type: "effect.completed",
      effectId: intent.effectId,
      receiptId: receipt.receiptId
    }, options.hasher),
    occurredAt: receipt.observedAt,
    type: "effect.completed",
    payload: { effectId: intent.effectId, receiptId: receipt.receiptId }
  };
}

function failedEffectInput(
  intent: EffectIntent,
  receipt: PhysicalEffectReceipt,
  options: Pick<RunActorOptions, "hasher">
): RunActorJournalInput {
  const reason = "Physical effect adapter reported a failed observation.";
  return {
    eventId: computeCanonicalDigest({
      type: "effect.failed",
      effectId: intent.effectId,
      receiptId: receipt.receiptId,
      reason
    }, options.hasher),
    occurredAt: receipt.observedAt,
    type: "effect.failed",
    payload: { effectId: intent.effectId, receiptId: receipt.receiptId, reason }
  };
}

function interruptedEffectInput(
  intent: EffectIntent,
  receipt: PhysicalEffectReceipt | undefined,
  reason: string,
  options: Pick<RunActorOptions, "hasher" | "clock">
): RunActorJournalInput {
  const identity = {
    type: "effect.interrupted",
    effectId: intent.effectId,
    ...(receipt === undefined ? {} : { receiptId: receipt.receiptId }),
    reason
  };
  return {
    eventId: computeCanonicalDigest(identity, options.hasher),
    occurredAt: receipt?.observedAt ?? options.clock(),
    type: "effect.interrupted",
    payload: receipt === undefined
      ? { effectId: intent.effectId, reason }
      : { effectId: intent.effectId, receiptId: receipt.receiptId, reason }
  };
}

function persistedInterruptionReason(
  events: readonly RunEvent[],
  intent: EffectIntent
): string | undefined {
  const requestedSequence = events.find((event) =>
    event.type === "effect.requested" && event.payload.intent.effectId === intent.effectId)?.sequence;
  if (requestedSequence === undefined) {
    throw new Error(`Effect ${intent.effectId} has no persisted request.`);
  }

  const reasons: Array<{ sequence: number; reason: string }> = [];
  for (const event of events) {
    if (event.type === "operation.cancel_requested" && event.sequence > requestedSequence) {
      reasons.push({
        sequence: event.sequence,
        reason: `Run cancellation applies to effect ${intent.effectId}: ${event.payload.reason}`
      });
    }
    if (
      event.type === "attempt.stale"
      && intent.attemptId !== undefined
      && event.payload.attemptId === intent.attemptId
    ) {
      reasons.push({
        sequence: event.sequence,
        reason: `Attempt ${intent.attemptId} is stale: ${event.payload.reason}`
      });
    }
  }
  reasons.sort((left, right) => right.sequence - left.sequence);
  return reasons[0]?.reason;
}

function comparePhysicalReceipts(
  left: PhysicalEffectReceipt,
  right: PhysicalEffectReceipt
): number {
  return left.observedAt.localeCompare(right.observedAt)
    || left.receiptId.localeCompare(right.receiptId);
}

function journalRevision(events: readonly RunEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}
