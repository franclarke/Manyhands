import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPhysicalEffectReceipt,
  type DigestHasher,
  type PhysicalEffectReceipt,
  type PhysicalEffectReceiptMaterial
} from "@manyhands/contracts";
import {
  FilePhysicalEffectReceiptStore,
  PhysicalEffectReceiptCorruptionError
} from "@manyhands/run-store";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-effect-receipts-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("physical effect receipt store", () => {
  it("returns the immutable original for an exact replay", async () => {
    const store = new FilePhysicalEffectReceiptStore({ directory, hasher: sha256 });
    const receipt = makeReceipt();

    const first = await store.put(receipt);
    const replayed = await store.put({ ...receipt });

    expect(first).toEqual(receipt);
    expect(replayed).toEqual(first);
    expect(await store.get(receipt.receiptId)).toEqual(first);
    expect(await store.list()).toEqual([first]);
  });

  it("fails closed when one receiptId is reused for different content", async () => {
    const collidingHasher: DigestHasher = () => "digest:forced-collision";
    const store = new FilePhysicalEffectReceiptStore({ directory, hasher: collidingHasher });
    const started = makeReceipt({}, collidingHasher);
    const conflicting = makeReceipt({
      observation: "failed",
      observedAt: "2026-08-12T20:00:01.000Z"
    }, collidingHasher);
    expect(conflicting.receiptId).toBe(started.receiptId);

    await store.put(started);

    await expect(store.put(conflicting)).rejects.toBeInstanceOf(
      PhysicalEffectReceiptCorruptionError
    );
    expect(await store.get(started.receiptId)).toEqual(started);
  });

  it("publishes one immutable file when concurrent writers race", async () => {
    const firstStore = new FilePhysicalEffectReceiptStore({ directory, hasher: sha256 });
    const secondStore = new FilePhysicalEffectReceiptStore({ directory, hasher: sha256 });
    const receipt = makeReceipt();

    const results = await Promise.all([
      firstStore.put(receipt),
      secondStore.put({ ...receipt })
    ]);

    expect(results).toEqual([receipt, receipt]);
    expect(await firstStore.list()).toEqual([receipt]);
    expect(await readdir(directory)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}\.receipt\.json$/u)
    ]);
  });

  it("cleans its temporary file when failure is injected before publish and permits retry", async () => {
    let publishAttempts = 0;
    const store = new FilePhysicalEffectReceiptStore({
      directory,
      hasher: sha256,
      beforePublish: () => {
        publishAttempts += 1;
        if (publishAttempts === 1) throw new Error("injected failure before publish");
      }
    });
    const receipt = makeReceipt();

    await expect(store.put(receipt)).rejects.toThrow("injected failure before publish");
    expect(await store.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);

    await expect(store.put(receipt)).resolves.toEqual(receipt);
    expect(await store.list()).toEqual([receipt]);
  });

  it("does not let temporary cleanup failure hide publication or the primary error", async () => {
    const cleanupFailure = async (): Promise<void> => {
      throw new Error("injected cleanup failure");
    };
    const receipt = makeReceipt();
    const successfulStore = new FilePhysicalEffectReceiptStore({
      directory: path.join(directory, "successful"),
      hasher: sha256,
      removeTemporaryFile: cleanupFailure
    });

    await expect(successfulStore.put(receipt)).resolves.toEqual(receipt);
    expect(await successfulStore.list()).toEqual([receipt]);

    const failingStore = new FilePhysicalEffectReceiptStore({
      directory: path.join(directory, "failed"),
      hasher: sha256,
      beforePublish: () => {
        throw new Error("primary publish failure");
      },
      removeTemporaryFile: cleanupFailure
    });

    await expect(failingStore.put(receipt)).rejects.toThrow("primary publish failure");
    expect(await failingStore.list()).toEqual([]);
  });

  it("preserves started and terminal observations as separate receipts", async () => {
    const store = new FilePhysicalEffectReceiptStore({ directory, hasher: sha256 });
    const started = makeReceipt();
    const succeeded = makeReceipt({
      observation: "succeeded",
      resultDigest: "sha256:result",
      observedAt: "2026-08-12T20:00:02.000Z"
    });

    expect(succeeded.receiptId).not.toBe(started.receiptId);
    await store.put(started);
    await store.put(succeeded);

    expect(await store.list()).toEqual(
      [started, succeeded].sort((left, right) => left.receiptId.localeCompare(right.receiptId))
    );
  });

  it("rejects a receipt whose claimed identity does not match its canonical material", async () => {
    const store = new FilePhysicalEffectReceiptStore({ directory, hasher: sha256 });
    const receipt = makeReceipt();

    await expect(store.put({ ...receipt, observedAt: "2026-08-12T20:00:03.000Z" }))
      .rejects.toBeInstanceOf(PhysicalEffectReceiptCorruptionError);
    expect(await store.list()).toEqual([]);
  });
});

function makeReceipt(
  overrides: Partial<PhysicalEffectReceiptMaterial> = {},
  hasher: DigestHasher = sha256
): PhysicalEffectReceipt {
  return buildPhysicalEffectReceipt({
    effectId: "sha256:effect",
    observation: "started",
    inputDigest: "sha256:input",
    daemonEpoch: "daemon-epoch-1",
    observedAt: "2026-08-12T20:00:00.000Z",
    ...overrides
  }, hasher);
}
