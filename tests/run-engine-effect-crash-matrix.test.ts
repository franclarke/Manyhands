import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EffectKindSchema,
  buildEffectInput,
  buildEffectIntent,
  type DigestHasher,
  type EffectInput,
  type EffectInputSpec,
  type EffectKind,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  type RunCommandEnvelope,
  type RunEvent
} from "@manyhands/run-coordinator";
import {
  KindAwarePhysicalEffectDispatcher,
  RunActor,
  type EffectInputStorePort,
  type PhysicalEffectAdapter,
  type PhysicalEffectReceiptStorePort,
  type RunActorJournalEvent,
  type RunActorJournalInput,
  type RunActorJournalPort
} from "@manyhands/run-engine";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const allEffectKinds = [...EffectKindSchema.options];

describe("RunActor GD1 physical-effect crash matrix", () => {
  for (const kind of allEffectKinds) {
    describe(kind, () => {
      it("recovers a crash before the durable intent through command redelivery", async () => {
        const harness = new CrashHarness(kind);
        harness.journal.failBeforeIntentAppend = true;

        await expect(harness.actor("daemon:epoch-1").submit(harness.command))
          .rejects.toThrow("crash before intent flush");
        expect(harness.journal.events.map((event) => event.type)).toEqual(["run.created"]);
        expect(harness.inputStore.inputs.size).toBe(1);
        expect(harness.physicalExecutionCount).toBe(0);

        harness.journal.currentEpoch = "daemon:epoch-2";
        await harness.actor("daemon:epoch-2").recoverPendingEffects();
        expect(harness.physicalExecutionCount).toBe(0);

        const redelivered = harness.actor("daemon:epoch-2");
        await redelivered.submit(harness.command);
        await redelivered.drainEffects();
        assertRecoveredOutcome(harness);
      });

      it("loads the exact cold-recovery input before invoking the adapter", async () => {
        const harness = new CrashHarness(kind);
        harness.journal.epochAfterIntentAppend = "daemon:epoch-2";

        const firstActor = harness.actor("daemon:epoch-1");
        await firstActor.submit(harness.command);
        await expect(firstActor.drainEffects()).rejects.toThrow("stale daemon epoch");
        expect(harness.inputStore.putCalls).toBe(1);

        await harness.actor("daemon:epoch-2").recoverPendingEffects();

        expect(harness.inputStore.putCalls).toBe(1);
        expect(harness.adapterInputSpecs).toEqual([{
          schemaVersion: 1,
          kind,
          payload: { scenario: "gd1", kind }
        }]);
        assertRecoveredOutcome(harness);
      });

      it("recovers a crash after the durable intent and before physical dispatch", async () => {
        const harness = new CrashHarness(kind);
        harness.journal.epochAfterIntentAppend = "daemon:epoch-2";

        const firstActor = harness.actor("daemon:epoch-1");
        await expect(firstActor.submit(harness.command)).resolves.toEqual(
          expect.objectContaining({ commandId: harness.command.commandId })
        );
        await expect(firstActor.drainEffects()).rejects.toThrow("stale daemon epoch");
        expect(harness.physicalExecutionCount).toBe(0);
        expect(harness.journal.events.map((event) => event.type)).toEqual([
          "run.created",
          "command.accepted",
          "effect.requested"
        ]);

        await harness.actor("daemon:epoch-2").recoverPendingEffects();
        assertRecoveredOutcome(harness);
      });

      it("does not lose success or repeat the effect after physical success precedes the authoritative event", async () => {
        const harness = new CrashHarness(kind);
        harness.journal.failBeforeObservationAppend = true;

        const firstActor = harness.actor("daemon:epoch-1");
        await expect(firstActor.submit(harness.command)).resolves.toEqual(
          expect.objectContaining({ commandId: harness.command.commandId })
        );
        await expect(firstActor.drainEffects())
          .rejects.toThrow("crash before authoritative observation flush");
        expect(harness.physicalExecutionCount).toBe(1);
        expect(harness.receiptStore.receipts).toEqual([
          expect.objectContaining({ observation: "succeeded" })
        ]);
        expect(terminalActorEvents(harness.journal.events)).toHaveLength(0);

        harness.journal.currentEpoch = "daemon:epoch-2";
        await harness.actor("daemon:epoch-2").recoverPendingEffects();
        assertRecoveredOutcome(harness);
      });

      it("retries reconciliation after a crash during reconciliation without repeating the non-idempotent effect", async () => {
        const harness = new CrashHarness(kind);
        harness.crashAfterStartedReceipt = true;

        const firstActor = harness.actor("daemon:epoch-1");
        await expect(firstActor.submit(harness.command)).resolves.toEqual(
          expect.objectContaining({ commandId: harness.command.commandId })
        );
        await expect(firstActor.drainEffects()).rejects.toThrow("crash after durable started receipt");
        expect(harness.physicalExecutionCount).toBe(1);
        expect(harness.receiptStore.receipts).toEqual([
          expect.objectContaining({ observation: "started" })
        ]);

        harness.journal.currentEpoch = "daemon:epoch-2";
        harness.crashDuringReconciliation = true;
        await expect(harness.actor("daemon:epoch-2").recoverPendingEffects())
          .rejects.toThrow("crash during reconciliation");
        expect(harness.physicalExecutionCount).toBe(1);

        harness.journal.currentEpoch = "daemon:epoch-3";
        await harness.actor("daemon:epoch-3").recoverPendingEffects();

        expect(harness.reconciliationCount).toBe(2);
        assertRecoveredOutcome(harness);
      });

      it("replays the durable command when the transport loses its acknowledgement", async () => {
        const harness = new CrashHarness(kind);
        harness.journal.failAfterObservationAppend = true;

        const firstActor = harness.actor("daemon:epoch-1");
        // The actor acknowledges durable command acceptance before physical work.
        // Treat the returned value as lost at the transport boundary, then prove
        // replay returns the same receipt after the terminal event was flushed.
        await firstActor.submit(harness.command);
        await expect(firstActor.drainEffects())
          .rejects.toThrow("crash after authoritative observation flush");
        expect(terminalActorEvents(harness.journal.events)).toHaveLength(1);
        expect(harness.physicalExecutionCount).toBe(1);

        harness.journal.currentEpoch = "daemon:epoch-2";
        const recovered = harness.actor("daemon:epoch-2");
        await recovered.recoverPendingEffects();
        const replayedReceipt = await recovered.submit(harness.command);

        expect(replayedReceipt.commandId).toBe(harness.command.commandId);
        assertRecoveredOutcome(harness);
      });
    });
  }
});

function assertRecoveredOutcome(harness: CrashHarness): void {
  const intents = harness.journal.events.filter(
    (event): event is Extract<RunEvent, { type: "effect.requested" }> =>
      event.type === "effect.requested"
  );
  const journalTerminals = terminalActorEvents(harness.journal.events);
  const physicalTerminals = harness.receiptStore.receipts.filter(
    (receipt) => receipt.observation !== "started"
  );

  expect(intents).toHaveLength(1);
  expect(intents[0]!.payload.intent).toEqual(expect.objectContaining({
    kind: harness.kind,
    idempotency: "reconcile_then_repeat"
  }));
  // This deterministic adapter counter detects duplicate non-idempotent work;
  // the persisted policy remains evidence-based recovery, not exactly-once.
  expect(harness.physicalExecutionCount).toBe(1);
  expect(physicalTerminals).toHaveLength(1);
  expect(journalTerminals).toHaveLength(1);
  expect(journalTerminals[0]).toEqual(expect.objectContaining({
    type: "effect.completed",
    payload: {
      effectId: intents[0]!.payload.intent.effectId,
      receiptId: physicalTerminals[0]!.receiptId
    }
  }));
  expect(physicalTerminals[0]).toEqual(expect.objectContaining({
    observation: "succeeded",
    resultDigest: `sha256:result:${harness.kind}`
  }));
  const terminalBatchTypes = harness.journal.appendBatches.at(-1)?.map((event) => event.type) ?? [];
  expect(terminalBatchTypes.at(-1)).toBe("effect.completed");
  expect(terminalBatchTypes.slice(0, -1).every((type) => type === "effect.observed")).toBe(true);
  expect(terminalBatchTypes.length).toBeGreaterThanOrEqual(2);
}

function terminalActorEvents(events: readonly RunEvent[]): Array<Extract<
  RunEvent,
  { type: "effect.completed" | "effect.failed" | "effect.interrupted" }
>> {
  return events
    .filter((event): event is Extract<
      RunEvent,
      { type: "effect.completed" | "effect.failed" | "effect.interrupted" }
    > => event.type === "effect.completed"
      || event.type === "effect.failed"
      || event.type === "effect.interrupted");
}

class CrashHarness {
  readonly runId: string;
  readonly command: RunCommandEnvelope;
  readonly journal: FaultInjectingJournal;
  readonly receiptStore = new MemoryReceiptStore();
  readonly inputStore = new MemoryEffectInputStore();
  physicalExecutionCount = 0;
  reconciliationCount = 0;
  readonly adapterInputSpecs: EffectInputSpec[] = [];
  crashAfterStartedReceipt = false;
  crashDuringReconciliation = false;

  constructor(readonly kind: EffectKind) {
    this.runId = `run:gd1:${kind}`;
    this.journal = new FaultInjectingJournal(this.runId, "daemon:epoch-1");
    this.command = buildRunCommandEnvelope({
      commandId: `command:gd1:${kind}`,
      runId: this.runId,
      expectedRevision: 1,
      submittedAt: "2026-08-12T22:00:00.000Z",
      command: { type: "start" }
    }, sha256);
  }

  actor(daemonEpoch: string): RunActor {
    const inputSpec: EffectInputSpec = {
      schemaVersion: 1,
      kind: this.kind,
      payload: { scenario: "gd1", kind: this.kind }
    };
    const effectInput = buildEffectInput(inputSpec, sha256);
    return new RunActor({
      runId: this.runId,
      daemonEpoch,
      journal: this.journal,
      dispatcher: this.dispatcher(),
      inputStore: this.inputStore,
      hasher: sha256,
      clock: () => "2026-08-12T22:00:01.000Z",
      decide: (_command, context) => [{
        inputSpec,
        intent: buildEffectIntent({
          runId: context.runId,
          attemptId: `attempt:gd1:${this.kind}`,
          kind: this.kind,
          inputDigest: effectInput.inputDigest,
          daemonEpoch: context.daemonEpoch,
          idempotency: "reconcile_then_repeat",
          requestedAt: "2026-08-12T22:00:02.000Z"
        }, sha256)
      }]
    });
  }

  private dispatcher(): KindAwarePhysicalEffectDispatcher {
    return new KindAwarePhysicalEffectDispatcher({
      receiptStore: this.receiptStore,
      inputStore: this.inputStore,
      hasher: sha256,
      adapters: allEffectKinds.map((adapterKind): PhysicalEffectAdapter => ({
        kind: adapterKind,
        execute: async (_intent, context) => {
          if (adapterKind !== this.kind) throw new Error(`unexpected execute for ${adapterKind}`);
          this.physicalExecutionCount += 1;
          if (this.crashAfterStartedReceipt) {
            this.crashAfterStartedReceipt = false;
            await context.record({
              observation: "started",
              observedAt: "2026-08-12T22:00:03.000Z"
            });
            throw new Error("crash after durable started receipt");
          }
          await context.record({
            observation: "succeeded",
            resultDigest: `sha256:result:${this.kind}`,
            observedAt: "2026-08-12T22:00:05.000Z"
          });
        },
        reconcile: async (_intent, context) => {
          if (adapterKind !== this.kind) throw new Error(`unexpected reconcile for ${adapterKind}`);
          this.reconciliationCount += 1;
          this.adapterInputSpecs.push(structuredClone(context.inputSpec));
          if (this.crashDuringReconciliation) {
            this.crashDuringReconciliation = false;
            throw new Error("crash during reconciliation");
          }
          if (context.priorReceipts.length === 0) {
            this.physicalExecutionCount += 1;
          }
          await context.record({
            observation: "succeeded",
            resultDigest: `sha256:result:${this.kind}`,
            observedAt: "2026-08-12T22:00:05.000Z"
          });
        }
      }))
    });
  }
}

class MemoryReceiptStore implements PhysicalEffectReceiptStorePort {
  readonly receipts: PhysicalEffectReceipt[] = [];

  async list(): Promise<PhysicalEffectReceipt[]> {
    return structuredClone(this.receipts);
  }

  async put(receipt: PhysicalEffectReceipt): Promise<PhysicalEffectReceipt> {
    this.receipts.push(structuredClone(receipt));
    return structuredClone(receipt);
  }
}

class MemoryEffectInputStore implements EffectInputStorePort {
  readonly inputs = new Map<string, EffectInput>();
  putCalls = 0;

  async put(spec: EffectInputSpec): Promise<EffectInput> {
    this.putCalls += 1;
    const input = buildEffectInput(spec, sha256);
    this.inputs.set(input.inputDigest, structuredClone(input));
    return structuredClone(input);
  }

  async get(inputDigest: string): Promise<EffectInput | undefined> {
    const input = this.inputs.get(inputDigest);
    return input === undefined ? undefined : structuredClone(input);
  }
}

class FaultInjectingJournal implements RunActorJournalPort {
  readonly events: RunEvent[];
  readonly appendBatches: RunActorJournalInput[][] = [];
  failBeforeIntentAppend = false;
  failBeforeObservationAppend = false;
  failAfterObservationAppend = false;
  epochAfterIntentAppend: string | undefined;

  constructor(
    private readonly runId: string,
    public currentEpoch: string
  ) {
    this.events = [{
      eventId: `event:created:${runId}`,
      runId,
      sequence: 1,
      occurredAt: "2026-08-12T21:59:59.000Z",
      type: "run.created",
      payload: { goal: `Exercise ${runId}` }
    }];
  }

  async load(runId: string): Promise<RunEvent[]> {
    if (runId !== this.runId) throw new Error("run mismatch");
    return structuredClone(this.events);
  }

  async assertAuthority(runId: string, daemonEpoch: string): Promise<void> {
    if (runId !== this.runId) throw new Error("run mismatch");
    if (daemonEpoch !== this.currentEpoch) throw new Error("stale daemon epoch");
  }

  async appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunActorJournalInput[];
  }): Promise<RunActorJournalEvent[]> {
    await this.assertAuthority(input.runId, input.daemonEpoch);
    if (input.expectedRevision !== (this.events.at(-1)?.sequence ?? 0)) {
      throw new Error("revision conflict");
    }

    const includesIntent = input.events.some((event) => event.type === "effect.requested");
    const includesActorTerminal = input.events.some((event) =>
      event.type === "effect.completed"
      || event.type === "effect.failed"
      || event.type === "effect.interrupted");
    if (includesIntent && this.failBeforeIntentAppend) {
      this.failBeforeIntentAppend = false;
      throw new Error("crash before intent flush");
    }
    if (includesActorTerminal && this.failBeforeObservationAppend) {
      this.failBeforeObservationAppend = false;
      throw new Error("crash before authoritative observation flush");
    }

    const appended = input.events.map((event, index) => ({
      ...structuredClone(event),
      runId: input.runId,
      sequence: input.expectedRevision + index + 1
    })) as RunActorJournalEvent[];
    this.appendBatches.push(structuredClone(input.events));
    this.events.push(...appended);

    if (includesIntent && this.epochAfterIntentAppend !== undefined) {
      this.currentEpoch = this.epochAfterIntentAppend;
      this.epochAfterIntentAppend = undefined;
    }
    if (includesActorTerminal && this.failAfterObservationAppend) {
      this.failAfterObservationAppend = false;
      throw new Error("crash after authoritative observation flush");
    }
    return structuredClone(appended);
  }
}
