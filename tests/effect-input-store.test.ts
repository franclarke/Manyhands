import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, type DigestHasher, type EffectInputSpec } from "@manyhands/contracts";
import { EffectInputCorruptionError, FileEffectInputStore } from "@manyhands/run-store";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-effect-inputs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("effect input store", () => {
  it("publishes canonical spec bytes and returns the immutable original on exact replay", async () => {
    const store = new FileEffectInputStore({ directory, hasher: sha256 });
    const spec = makeSpec();

    const first = await store.put(spec);
    const replayed = await store.put({
      payload: { argv: ["test"], command: "pnpm" },
      kind: "process_spawn",
      schemaVersion: 1
    });

    expect(replayed).toEqual(first);
    expect(await store.get(first.inputDigest)).toEqual(first);

    const entries = await readdir(directory);
    expect(entries).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.effect-input\.json$/u)]);
    expect(await readFile(path.join(directory, entries[0]!), "utf8"))
      .toBe(`${canonicalJson(first.spec)}\n`);
  });

  it("fails closed when distinct specs collide on one digest", async () => {
    const collidingHasher: DigestHasher = () => "digest:forced-collision";
    const store = new FileEffectInputStore({ directory, hasher: collidingHasher });
    const first = makeSpec();
    const conflicting = makeSpec({ payload: { command: "node", argv: ["server.js"] } });

    await store.put(first);

    await expect(store.put(conflicting)).rejects.toBeInstanceOf(EffectInputCorruptionError);
    expect((await store.get("digest:forced-collision"))?.spec).toEqual(first);
  });

  it("publishes one immutable file when identical writers race", async () => {
    const firstStore = new FileEffectInputStore({ directory, hasher: sha256 });
    const secondStore = new FileEffectInputStore({ directory, hasher: sha256 });
    const spec = makeSpec();

    const [first, second] = await Promise.all([
      firstStore.put(spec),
      secondStore.put({ ...spec, payload: { argv: ["test"], command: "pnpm" } })
    ]);

    expect(second).toEqual(first);
    expect(await readdir(directory)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}\.effect-input\.json$/u)
    ]);
  });

  it("fails one writer closed when colliding specs race", async () => {
    let waiting = 0;
    let releasePublish!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const beforePublish = async (): Promise<void> => {
      waiting += 1;
      if (waiting === 2) releasePublish();
      await bothReady;
    };
    const collidingHasher: DigestHasher = () => "digest:race-collision";
    const firstStore = new FileEffectInputStore({ directory, hasher: collidingHasher, beforePublish });
    const secondStore = new FileEffectInputStore({ directory, hasher: collidingHasher, beforePublish });

    const results = await Promise.allSettled([
      firstStore.put(makeSpec()),
      secondStore.put(makeSpec({ payload: { command: "node", argv: ["server.js"] } }))
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ reason: expect.any(EffectInputCorruptionError) });
    expect(await readdir(directory)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}\.effect-input\.json$/u)
    ]);
  });

  it("detects tampered or incomplete persisted content on get", async () => {
    const store = new FileEffectInputStore({ directory, hasher: sha256 });
    const stored = await store.put(makeSpec());
    const [entry] = await readdir(directory);
    const targetPath = path.join(directory, entry!);

    await writeFile(targetPath, `${canonicalJson(makeSpec({ payload: { command: "tampered" } }))}\n`);
    await expect(store.get(stored.inputDigest)).rejects.toBeInstanceOf(EffectInputCorruptionError);

    await writeFile(targetPath, '{"schemaVersion":1');
    await expect(store.get(stored.inputDigest)).rejects.toBeInstanceOf(EffectInputCorruptionError);
  });

  it("rejects persisted bytes that are valid JSON but not the canonical encoding", async () => {
    const store = new FileEffectInputStore({ directory, hasher: sha256 });
    const stored = await store.put(makeSpec());
    const [entry] = await readdir(directory);

    await writeFile(path.join(directory, entry!), JSON.stringify(stored.spec, null, 2));

    await expect(store.get(stored.inputDigest)).rejects.toBeInstanceOf(EffectInputCorruptionError);
  });

  it("cleans unpublished temporary input files after an injected failure", async () => {
    let attempts = 0;
    const store = new FileEffectInputStore({
      directory,
      hasher: sha256,
      beforePublish: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("injected publish failure");
      }
    });

    await expect(store.put(makeSpec())).rejects.toThrow("injected publish failure");
    expect(await readdir(directory)).toEqual([]);
    await expect(store.put(makeSpec())).resolves.toEqual(
      expect.objectContaining({ spec: makeSpec() })
    );
  });
});

function makeSpec(overrides: Partial<EffectInputSpec> = {}): EffectInputSpec {
  return {
    schemaVersion: 1,
    kind: "process_spawn",
    payload: { command: "pnpm", argv: ["test"] },
    ...overrides
  };
}
