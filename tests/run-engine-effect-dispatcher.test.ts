import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EffectKindSchema,
  buildEffectIntent,
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type EffectIntent,
  type EffectKind,
  type PhysicalEffectReceipt
} from "@manyhands/contracts";
import {
  KindAwarePhysicalEffectDispatcher,
  type PhysicalEffectAdapter,
  type PhysicalEffectReceiptStorePort
} from "../packages/run-engine/src/effect-dispatcher.js";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const allEffectKinds = [...EffectKindSchema.options];

describe("KindAwarePhysicalEffectDispatcher", () => {
  it("routes every physical effect kind to its only registered adapter", async () => {
    for (const kind of allEffectKinds) {
      const store = new MemoryReceiptStore();
      const calls: EffectKind[] = [];
      const dispatcher = new KindAwarePhysicalEffectDispatcher({
        receiptStore: store,
        hasher: sha256,
        adapters: allEffectKinds.map((adapterKind): PhysicalEffectAdapter => ({
          kind: adapterKind,
          async execute(received, context) {
            calls.push(adapterKind);
            expect(received).toEqual(intent(kind));
            await context.record({
              observation: "succeeded",
              resultDigest: `sha256:result:${adapterKind}`,
              observedAt: "2026-08-12T21:00:01.000Z"
            });
          },
          async reconcile() {
            throw new Error("new effects must not reconcile");
          }
        }))
      });

      const receipts = await dispatcher.observe(intent(kind));

      expect(calls).toEqual([kind]);
      expect(receipts).toEqual([
        expect.objectContaining({
          effectId: intent(kind).effectId,
          inputDigest: intent(kind).inputDigest,
          daemonEpoch: "daemon:epoch-1",
          observation: "succeeded"
        })
      ]);
    }
  });

  it("reconciles a durable started receipt after a crash without executing the effect again", async () => {
    const store = new MemoryReceiptStore();
    const effect = intent("process_spawn");
    let executeCount = 0;
    let reconcileCount = 0;
    const adapters = allEffectKinds.map((kind): PhysicalEffectAdapter => ({
      kind,
      async execute(_received, context) {
        if (kind !== "process_spawn") throw new Error(`unexpected execute for ${kind}`);
        executeCount += 1;
        await context.record({
          observation: "started",
          processIdentity: {
            pid: 4120,
            creationIdentity: "process:created-2100",
            supervisorNonce: "nonce:dispatcher"
          },
          observedAt: "2026-08-12T21:00:01.000Z"
        });
        throw new Error("simulated crash after durable started receipt");
      },
      async reconcile(received, context) {
        if (kind !== "process_spawn") throw new Error(`unexpected reconcile for ${kind}`);
        reconcileCount += 1;
        expect(received).toEqual(effect);
        expect(context.priorReceipts).toEqual([
          expect.objectContaining({ observation: "started", daemonEpoch: "daemon:epoch-1" })
        ]);
        await context.record({
          observation: "succeeded",
          resultDigest: "sha256:reconciled-process-result",
          observedAt: "2026-08-12T21:00:02.000Z"
        });
      }
    }));

    const firstDispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters
    });
    await expect(firstDispatcher.observe(effect)).rejects.toThrow("simulated crash");

    const recoveredDispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters
    });
    const receipts = await recoveredDispatcher.reconcile(effect, "daemon:epoch-2");

    expect(executeCount).toBe(1);
    expect(reconcileCount).toBe(1);
    expect(receipts.map((receipt) => receipt.observation)).toEqual(["started", "succeeded"]);
    expect(receipts.at(-1)).toEqual(expect.objectContaining({ daemonEpoch: "daemon:epoch-2" }));
  });

  it("replays one durable terminal receipt without invoking an adapter again", async () => {
    const store = new MemoryReceiptStore();
    let executeCount = 0;
    let reconcileCount = 0;
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: allEffectKinds.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute(_received, context) {
          executeCount += 1;
          await context.record({
            observation: "succeeded",
            resultDigest: "sha256:terminal-result",
            observedAt: "2026-08-12T21:00:01.000Z"
          });
        },
        async reconcile() {
          reconcileCount += 1;
        }
      }))
    });
    const effect = intent("delivery");

    const first = await dispatcher.observe(effect);
    const replay = await dispatcher.observe(effect);

    expect(replay).toEqual(first);
    expect(executeCount).toBe(1);
    expect(reconcileCount).toBe(0);
    expect(store.receipts).toHaveLength(1);
  });

  it("fails closed when the adapter registry is missing or duplicates a kind", () => {
    const store = new MemoryReceiptStore();
    const complete = allEffectKinds.map((kind): PhysicalEffectAdapter => ({
      kind,
      async execute() {},
      async reconcile() {}
    }));

    expect(() => new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: complete.slice(1)
    })).toThrow(/missing physical effect adapters: model_call/i);
    expect(() => new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: [...complete, complete[0]!]
    })).toThrow(/duplicate physical effect adapter for model_call/i);
  });

  it("rejects a successful adapter return that did not durably record a terminal observation", async () => {
    const store = new MemoryReceiptStore();
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: allEffectKinds.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute(_received, context) {
          await context.record({
            observation: "started",
            observedAt: "2026-08-12T21:00:01.000Z"
          });
        },
        async reconcile() {}
      }))
    });

    await expect(dispatcher.observe(intent("model_call"))).rejects.toThrow(
      /returned without a durable terminal receipt/i
    );
    expect(store.receipts).toEqual([
      expect.objectContaining({ observation: "started" })
    ]);
  });

  it("validates canonical intent and receipt identities before invoking an adapter", async () => {
    const store = new MemoryReceiptStore();
    let adapterCalls = 0;
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: allEffectKinds.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute() {
          adapterCalls += 1;
        },
        async reconcile() {
          adapterCalls += 1;
        }
      }))
    });
    const effect = intent("cleanup");

    await expect(dispatcher.observe({ ...effect, daemonEpoch: "daemon:tampered" }))
      .rejects.toThrow(/invalid canonical identity/i);

    const validReceipt = buildPhysicalEffectReceipt({
      effectId: effect.effectId,
      observation: "started",
      inputDigest: effect.inputDigest,
      daemonEpoch: effect.daemonEpoch,
      observedAt: "2026-08-12T21:00:01.000Z"
    }, sha256);
    store.receipts.push({ ...validReceipt, observation: "failed" });

    await expect(dispatcher.observe(effect)).rejects.toThrow(/receipt store is corrupt/i);
    expect(adapterCalls).toBe(0);
  });

  it("rejects an identity-valid receipt bound to different effect inputs", async () => {
    const store = new MemoryReceiptStore();
    const effect = intent("artifact_materialize");
    store.receipts.push(buildPhysicalEffectReceipt({
      effectId: effect.effectId,
      observation: "started",
      inputDigest: "sha256:different-input",
      daemonEpoch: effect.daemonEpoch,
      observedAt: "2026-08-12T21:00:01.000Z"
    }, sha256));
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: allEffectKinds.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute() {},
        async reconcile() {}
      }))
    });

    await expect(dispatcher.observe(effect)).rejects.toThrow(/does not bind to effect/i);
  });

  it("owns receipt binding fields even when an adapter supplies unexpected runtime keys", async () => {
    const store = new MemoryReceiptStore();
    const effect = intent("validation");
    const dispatcher = new KindAwarePhysicalEffectDispatcher({
      receiptStore: store,
      hasher: sha256,
      adapters: allEffectKinds.map((kind): PhysicalEffectAdapter => ({
        kind,
        async execute(_received, context) {
          await context.record({
            observation: "succeeded",
            observedAt: "2026-08-12T21:00:01.000Z",
            effectId: "sha256:adapter-controlled",
            inputDigest: "sha256:adapter-controlled",
            daemonEpoch: "daemon:adapter-controlled"
          } as Parameters<typeof context.record>[0]);
        },
        async reconcile() {}
      }))
    });

    const receipts = await dispatcher.reconcile(effect, "daemon:epoch-2");

    expect(receipts).toEqual([
      expect.objectContaining({
        effectId: effect.effectId,
        inputDigest: effect.inputDigest,
        daemonEpoch: "daemon:epoch-2"
      })
    ]);
  });
});

function intent(kind: EffectKind): EffectIntent {
  return buildEffectIntent({
    runId: "run:dispatcher",
    attemptId: `attempt:${kind}:1`,
    kind,
    inputDigest: `sha256:input:${kind}`,
    daemonEpoch: "daemon:epoch-1",
    idempotency: "reconcile_then_repeat",
    requestedAt: "2026-08-12T21:00:00.000Z"
  }, sha256);
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
