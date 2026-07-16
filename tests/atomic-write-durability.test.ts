import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson, durableWritesEnabled } from "@/lib/server/workspaces/atomic-write";

describe("atomic write durability policy", () => {
  const previous = process.env.MANYHANDS_FSYNC;

  afterEach(() => {
    if (previous === undefined) delete process.env.MANYHANDS_FSYNC;
    else process.env.MANYHANDS_FSYNC = previous;
  });

  it("enables fsync by default and permits an explicit disposable-data opt-out", () => {
    delete process.env.MANYHANDS_FSYNC;
    expect(durableWritesEnabled()).toBe(true);
    process.env.MANYHANDS_FSYNC = "0";
    expect(durableWritesEnabled()).toBe(false);
  });

  it("publishes complete JSON atomically and removes its temporary file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-atomic-"));
    try {
      const target = path.join(directory, "record.json");
      await atomicWriteJson(target, { version: 1, value: "durable" });
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1, value: "durable" });
      expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retries transient Windows sharing violations without publishing partial JSON", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-atomic-retry-"));
    try {
      const target = path.join(directory, "record.json");
      let attempts = 0;
      await atomicWriteJson(
        target,
        { version: 2, value: "survived-transient-lock" },
        {
          fsync: false,
          renameFile: async (source, destination) => {
            attempts += 1;
            if (attempts < 3) {
              const error = new Error("simulated Windows sharing violation") as NodeJS.ErrnoException;
              error.code = "EPERM";
              throw error;
            }
            await rename(source, destination);
          }
        }
      );

      expect(attempts).toBe(3);
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
        version: 2,
        value: "survived-transient-lock"
      });
      expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
