import {
  EffectIntentSchema,
  EffectKindSchema,
  PhysicalEffectReceiptSchema,
  buildPhysicalEffectReceipt,
  canonicalJson,
  replayPhysicalEffectReceipts,
  validateEffectIntentIdentity,
  validatePhysicalEffectReceiptBinding,
  validatePhysicalEffectReceiptIdentity,
  type DigestHasher,
  type EffectIntent,
  type EffectKind,
  type PhysicalEffectObservation,
  type PhysicalEffectReceipt,
  type ProcessIdentity
} from "@manyhands/contracts";

export interface PhysicalEffectReceiptStorePort {
  list(): Promise<readonly unknown[]>;
  put(receipt: PhysicalEffectReceipt): Promise<PhysicalEffectReceipt>;
}

export interface PhysicalEffectObservationInput {
  observation: PhysicalEffectObservation;
  observedAt: string;
  processIdentity?: ProcessIdentity;
  resultDigest?: string;
}

export interface PhysicalEffectAdapterContext {
  readonly observerDaemonEpoch: string;
  readonly priorReceipts: readonly Readonly<PhysicalEffectReceipt>[];
  record(observation: PhysicalEffectObservationInput): Promise<Readonly<PhysicalEffectReceipt>>;
}

export interface PhysicalEffectAdapter {
  readonly kind: EffectKind;
  execute(
    intent: Readonly<EffectIntent>,
    context: PhysicalEffectAdapterContext
  ): Promise<void>;
  reconcile(
    intent: Readonly<EffectIntent>,
    context: PhysicalEffectAdapterContext
  ): Promise<void>;
}

export interface KindAwarePhysicalEffectDispatcherOptions {
  receiptStore: PhysicalEffectReceiptStorePort;
  hasher: DigestHasher;
  adapters: readonly PhysicalEffectAdapter[];
}

/**
 * Selects a physical adapter by the canonical effect kind and derives dispatch
 * decisions only from immutable receipts. The receipt protocol provides
 * replay-safe evidence; it deliberately does not promise exactly-once effects.
 */
export class KindAwarePhysicalEffectDispatcher {
  private readonly adapters: ReadonlyMap<EffectKind, PhysicalEffectAdapter>;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly options: KindAwarePhysicalEffectDispatcherOptions) {
    this.adapters = buildAdapterRegistry(options.adapters);
  }

  async observe(input: EffectIntent): Promise<PhysicalEffectReceipt[]> {
    const intent = parseIntent(input, this.options.hasher);
    return this.enqueue(intent.effectId, () => this.dispatch(intent, intent.daemonEpoch));
  }

  async reconcile(
    input: EffectIntent,
    observerDaemonEpoch: string
  ): Promise<PhysicalEffectReceipt[]> {
    const intent = parseIntent(input, this.options.hasher);
    assertObserverEpoch(observerDaemonEpoch);
    return this.enqueue(intent.effectId, () => this.dispatch(intent, observerDaemonEpoch));
  }

  private enqueue<T>(effectId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.inFlight.get(effectId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    const settled = current.then(() => undefined, () => undefined);
    this.inFlight.set(effectId, settled);
    return current.finally(() => {
      if (this.inFlight.get(effectId) === settled) this.inFlight.delete(effectId);
    });
  }

  private async dispatch(
    intent: Readonly<EffectIntent>,
    observerDaemonEpoch: string
  ): Promise<PhysicalEffectReceipt[]> {
    assertObserverEpoch(observerDaemonEpoch);
    const priorReceipts = await this.loadBoundReceipts(intent);
    if (authoritativeTerminal(priorReceipts) !== undefined) return priorReceipts;

    const adapter = this.adapters.get(intent.kind);
    if (adapter === undefined) {
      throw new Error(`No physical effect adapter is registered for ${intent.kind}.`);
    }
    const context = this.createContext(intent, observerDaemonEpoch, priorReceipts);
    if (priorReceipts.length === 0) {
      await adapter.execute(intent, context);
    } else {
      await adapter.reconcile(intent, context);
    }

    const completedReceipts = await this.loadBoundReceipts(intent);
    if (authoritativeTerminal(completedReceipts) === undefined) {
      throw new Error(
        `Physical effect adapter ${intent.kind} returned without a durable terminal receipt for ${intent.effectId}.`
      );
    }
    return completedReceipts;
  }

  private createContext(
    intent: Readonly<EffectIntent>,
    observerDaemonEpoch: string,
    priorReceipts: readonly PhysicalEffectReceipt[]
  ): PhysicalEffectAdapterContext {
    return Object.freeze({
      observerDaemonEpoch,
      priorReceipts: Object.freeze(priorReceipts.map((receipt) => Object.freeze(structuredClone(receipt)))),
      record: async (observation: PhysicalEffectObservationInput) => {
        const candidate = buildPhysicalEffectReceipt({
          ...observation,
          effectId: intent.effectId,
          inputDigest: intent.inputDigest,
          daemonEpoch: observerDaemonEpoch,
        }, this.options.hasher);
        const published = await this.options.receiptStore.put(candidate);
        return Object.freeze(this.assertPublishedReceipt(published, candidate, intent, observerDaemonEpoch));
      }
    });
  }

  private async loadBoundReceipts(
    intent: Readonly<EffectIntent>
  ): Promise<PhysicalEffectReceipt[]> {
    const replay = replayPhysicalEffectReceipts(
      await this.options.receiptStore.list(),
      this.options.hasher
    );
    if (!replay.ok) {
      throw new Error(
        `Physical effect receipt store is corrupt: ${replay.issues
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }

    const receipts = replay.receipts
      .filter((receipt) => receipt.effectId === intent.effectId)
      .sort(compareReceipts);
    for (const receipt of receipts) {
      const binding = validatePhysicalEffectReceiptBinding(receipt, intent, this.options.hasher);
      if (!binding.ok) {
        throw new Error(
          `Physical receipt ${receipt.receiptId} does not bind to effect ${intent.effectId}: ${binding.issues
            .map((issue) => issue.message)
            .join("; ")}`
        );
      }
    }
    authoritativeTerminal(receipts);
    return receipts;
  }

  private assertPublishedReceipt(
    input: unknown,
    candidate: PhysicalEffectReceipt,
    intent: Readonly<EffectIntent>,
    observerDaemonEpoch: string
  ): PhysicalEffectReceipt {
    const parsed = PhysicalEffectReceiptSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Receipt store returned an invalid physical receipt: ${parsed.error.message}`);
    }
    const identity = validatePhysicalEffectReceiptIdentity(parsed.data, this.options.hasher);
    const binding = validatePhysicalEffectReceiptBinding(parsed.data, intent, this.options.hasher);
    if (!identity.ok || !binding.ok) {
      throw new Error(`Receipt store returned invalid evidence for effect ${intent.effectId}.`);
    }
    if (parsed.data.daemonEpoch !== observerDaemonEpoch) {
      throw new Error(`Receipt store returned evidence from a different observer daemon epoch.`);
    }
    if (canonicalJson(parsed.data) !== canonicalJson(candidate)) {
      throw new Error(`Receipt store did not durably publish the requested physical observation.`);
    }
    return parsed.data;
  }
}

function buildAdapterRegistry(
  adapters: readonly PhysicalEffectAdapter[]
): ReadonlyMap<EffectKind, PhysicalEffectAdapter> {
  const registry = new Map<EffectKind, PhysicalEffectAdapter>();
  for (const adapter of adapters) {
    const kind = EffectKindSchema.safeParse(adapter.kind);
    if (!kind.success) throw new Error(`Physical effect adapter has an invalid kind.`);
    if (registry.has(kind.data)) {
      throw new Error(`Duplicate physical effect adapter for ${kind.data}.`);
    }
    registry.set(kind.data, adapter);
  }

  const missing = EffectKindSchema.options.filter((kind) => !registry.has(kind));
  if (missing.length > 0) {
    throw new Error(`Missing physical effect adapters: ${missing.join(", ")}.`);
  }
  return registry;
}

function parseIntent(input: unknown, hasher: DigestHasher): Readonly<EffectIntent> {
  const parsed = EffectIntentSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Physical effect intent is schema-invalid: ${parsed.error.message}`);
  const identity = validateEffectIntentIdentity(parsed.data, hasher);
  if (!identity.ok) {
    throw new Error(
      `Physical effect intent has invalid canonical identity: ${identity.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }
  return Object.freeze(structuredClone(parsed.data));
}

function authoritativeTerminal(
  receipts: readonly PhysicalEffectReceipt[]
): PhysicalEffectReceipt | undefined {
  const terminal = receipts.filter((receipt) => receipt.observation !== "started");
  if (terminal.length > 1) {
    throw new Error(`Effect has multiple terminal physical receipts and no authoritative outcome.`);
  }
  return terminal[0];
}

function compareReceipts(left: PhysicalEffectReceipt, right: PhysicalEffectReceipt): number {
  return left.observedAt.localeCompare(right.observedAt)
    || left.receiptId.localeCompare(right.receiptId);
}

function assertObserverEpoch(value: string): void {
  if (value.trim().length === 0) throw new TypeError("observerDaemonEpoch must not be empty.");
}
