import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  EffectKindSchema,
  buildEffectInput,
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type EffectInput,
  type EffectInputSpec,
  type EffectIntent,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  buildRunCommandEnvelope,
  foldRun,
  type RunCommandPayload,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import {
  KindAwarePhysicalEffectDispatcher,
  RunActor,
  type EffectInputStorePort,
  type PhysicalEffectAdapter,
  type PhysicalEffectReceiptStorePort,
  type RunActorJournalPort
} from "@manyhands/run-engine";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 3 cancellation during the dispatcher pre-dispatch window", () => {
  it.each(["input", "receipts"] as const)(
    "does not invoke process_spawn when cancellation becomes durable while effect %s are loading",
    assertNoObsoleteSpawn
  );

  async function assertNoObsoleteSpawn(blockedRead: "input" | "receipts"): Promise<void> {
    const journal = new MemoryJournal();
    const inputStore = new BlockingEffectInputStore(blockedRead === "input");
    const receiptStore = new MemoryReceiptStore(blockedRead === "receipts");
    const adapterCalls: Array<{ kind: EffectIntent["kind"]; mode: "execute" | "reconcile" }> = [];
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      inputStore,
      receiptStore,
      hasher: sha256,
      adapters: EffectKindSchema.options.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute(intent, context) {
          adapterCalls.push({ kind: intent.kind, mode: "execute" });
          await context.record({
            observation: "succeeded",
            observedAt: "2026-08-13T13:00:04.000Z",
            resultDigest: `sha256:${kind}-result`
          });
        },
        async reconcile(intent) {
          adapterCalls.push({ kind: intent.kind, mode: "reconcile" });
        }
      }))
    });
    const spawn = effect("process_spawn", "attempt:spawn", {
      executable: "C:/runtime/node.exe",
      argv: ["worker.mjs"],
      cwd: "C:/work/run",
      env: {}
    });
    const cleanup = effect("cleanup", "attempt:cleanup", {
      resourceKind: "run_control",
      resourceId: "run:dispatch-window"
    });
    inputStore.blockDigest = spawn.intent.inputDigest;
    const dispatchGate = blockedRead === "input" ? inputStore : receiptStore;
    const actor = new RunActor({
      runId: "run:dispatch-window",
      daemonEpoch: "epoch:stage3",
      journal,
      dispatcher,
      inputStore,
      decide: (command) => command.command.type === "start_run"
        ? { effects: [spawn] }
        : {
            eventsAfterAcceptance: [{
              eventId: "event:cancel-requested",
              occurredAt: "2026-08-13T13:00:02.000Z",
              type: "operation.cancel_requested",
              payload: {
                invalidationReceiptId: "command:cancel",
                reason: "operator cancelled during pre-dispatch"
              }
            }],
            effects: [cleanup]
          },
      hasher: sha256,
      clock: () => "2026-08-13T13:00:03.000Z"
    });

    await actor.submit(command("command:start", 1, { type: "start_run" }));
    await dispatchGate.blocked.promise;
    await actor.submit(command("command:cancel", 3, {
      type: "cancel_run",
      reason: "operator cancelled during pre-dispatch"
    }));
    expect(journal.events.some((event) => event.type === "operation.cancel_requested")).toBe(true);

    dispatchGate.release.resolve();
    await actor.drainEffects();

    expect(adapterCalls).toEqual([{ kind: "cleanup", mode: "execute" }]);
    const projection = foldRun(journal.events);
    expect(projection.effectTerminals[spawn.intent.effectId]?.status).toBe("interrupted");
    expect(projection.effectTerminals[cleanup.intent.effectId]?.status).toBe("completed");
    expect(receiptStore.receipts.filter((receipt) => receipt.effectId === spawn.intent.effectId)).toEqual([]);
  }

  it("does not invoke a reconcile adapter that can start physical work for an invalidated first observe", async () => {
    const inputStore = new BlockingEffectInputStore(false);
    const receiptStore = new MemoryReceiptStore(false);
    const modelCall = effect("model_call", "attempt:model", {
      repositoryViewDigest: "sha256:repository-view",
      requestDigest: "sha256:request",
      modelProfileDigest: "sha256:model-profile"
    });
    await inputStore.put(modelCall.inputSpec);
    const execute = vi.fn();
    const reconcile = vi.fn<PhysicalEffectAdapter["reconcile"]>(async (_intent, context) => {
      await context.record({
        observation: "succeeded",
        resultDigest: "sha256:forbidden-post-cancel-work",
        observedAt: "2026-08-13T13:00:05.000Z"
      });
    });
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      inputStore,
      receiptStore,
      hasher: sha256,
      adapters: EffectKindSchema.options.map((kind): PhysicalEffectAdapter => kind === "model_call"
        ? { kind, execute, reconcile }
        : { kind, execute: async () => undefined, reconcile: async () => undefined })
    });

    const receipts = await dispatcher.observe(modelCall.intent, {
      reason: async () => "Run cancellation is durable."
    });

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(receipts).toEqual([]);
  });

  it("reconciles durable physical state after cancellation instead of short-circuiting recovery", async () => {
    const inputStore = new BlockingEffectInputStore(false);
    const receiptStore = new MemoryReceiptStore(false);
    const spawn = effect("process_spawn", "attempt:spawn", {
      executable: "C:/runtime/node.exe",
      argv: ["worker.mjs"],
      cwd: "C:/work/run",
      env: {}
    });
    await inputStore.put(spawn.inputSpec);
    receiptStore.receipts.push(buildPhysicalEffectReceipt({
      effectId: spawn.intent.effectId,
      observation: "started",
      inputDigest: spawn.intent.inputDigest,
      daemonEpoch: spawn.intent.daemonEpoch,
      processIdentity: {
        pid: 4242,
        creationIdentity: "windows-filetime:durable-start",
        supervisorNonce: "nonce:durable-start"
      },
      observedAt: "2026-08-13T13:00:02.000Z"
    }, sha256));
    const execute = vi.fn();
    const reconcile = vi.fn<PhysicalEffectAdapter["reconcile"]>(async (_intent, context) => {
      await context.record({
        observation: "failed",
        resultDigest: "sha256:terminated-after-recovery",
        observedAt: "2026-08-13T13:00:05.000Z"
      });
    });
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      inputStore,
      receiptStore,
      hasher: sha256,
      adapters: EffectKindSchema.options.map((kind): PhysicalEffectAdapter => kind === "process_spawn"
        ? { kind, execute, reconcile }
        : { kind, execute: async () => undefined, reconcile: async () => undefined })
    });

    const receipts = await dispatcher.reconcile(spawn.intent, "epoch:recovered", {
      reason: async () => "Run cancellation is durable."
    });

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(receipts.map((receipt) => receipt.observation)).toEqual(["started", "failed"]);
  });
});

class BlockingEffectInputStore implements EffectInputStorePort {
  readonly inputs = new Map<string, EffectInput>();
  readonly blocked = deferred();
  readonly release = deferred();
  blockDigest: string | undefined;

  constructor(private readonly blockReads: boolean) {}

  async put(spec: EffectInputSpec): Promise<EffectInput> {
    const input = buildEffectInput(spec, sha256);
    this.inputs.set(input.inputDigest, structuredClone(input));
    return structuredClone(input);
  }

  async get(inputDigest: string): Promise<EffectInput | undefined> {
    if (this.blockReads && inputDigest === this.blockDigest) {
      this.blocked.resolve();
      await this.release.promise;
    }
    const input = this.inputs.get(inputDigest);
    return input === undefined ? undefined : structuredClone(input);
  }
}

class MemoryReceiptStore implements PhysicalEffectReceiptStorePort {
  readonly receipts: PhysicalEffectReceipt[] = [];
  readonly blocked = deferred();
  readonly release = deferred();
  private blockedOnce = false;

  constructor(private readonly blockReads: boolean) {}

  async list(): Promise<PhysicalEffectReceipt[]> {
    if (this.blockReads && !this.blockedOnce) {
      this.blockedOnce = true;
      this.blocked.resolve();
      await this.release.promise;
    }
    return structuredClone(this.receipts);
  }

  async put(receipt: PhysicalEffectReceipt): Promise<PhysicalEffectReceipt> {
    this.receipts.push(structuredClone(receipt));
    return structuredClone(receipt);
  }
}

class MemoryJournal implements RunActorJournalPort {
  readonly events: RunEvent[] = [{
    eventId: "event:run-created",
    runId: "run:dispatch-window",
    sequence: 1,
    occurredAt: "2026-08-13T13:00:00.000Z",
    type: "run.created",
    payload: { goal: "Cancel in the dispatcher window" }
  }];

  async load(): Promise<RunEvent[]> {
    return structuredClone(this.events);
  }

  async assertAuthority(_runId: string, daemonEpoch: string): Promise<void> {
    if (daemonEpoch !== "epoch:stage3") throw new Error("stale daemon epoch");
  }

  async appendAndFlush(input: {
    runId: string;
    expectedRevision: number;
    daemonEpoch: string;
    events: RunEventInput[];
  }): Promise<RunEvent[]> {
    if (input.daemonEpoch !== "epoch:stage3") throw new Error("stale daemon epoch");
    if (input.expectedRevision !== this.events.length) throw new Error("revision conflict");
    const appended = input.events.map((event, index) => ({
      ...structuredClone(event),
      runId: input.runId,
      sequence: input.expectedRevision + index + 1
    })) as RunEvent[];
    this.events.push(...appended);
    return structuredClone(appended);
  }
}

function effect(
  kind: EffectIntent["kind"],
  attemptId: string,
  payload: EffectInputSpec["payload"]
) {
  const inputSpec: EffectInputSpec = { schemaVersion: 1, kind, payload };
  return {
    inputSpec,
    intent: buildEffectIntent({
      runId: "run:dispatch-window",
      attemptId,
      kind,
      inputDigest: buildEffectInput(inputSpec, sha256).inputDigest,
      daemonEpoch: "epoch:stage3",
      idempotency: kind === "process_spawn" ? "reconcile_then_repeat" : "repeat_safe",
      requestedAt: "2026-08-13T13:00:01.000Z"
    }, sha256)
  };
}

function command(commandId: string, expectedRevision: number, payload: RunCommandPayload) {
  return buildRunCommandEnvelope({
    commandId,
    runId: "run:dispatch-window",
    expectedRevision,
    submittedAt: "2026-08-13T13:00:00.000Z",
    command: payload
  }, sha256);
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
