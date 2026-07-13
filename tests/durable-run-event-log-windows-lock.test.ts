import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renameFailure = vi.hoisted(() => ({ remaining: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (renameFailure.remaining > 0) {
        renameFailure.remaining -= 1;
        const error = Object.assign(new Error("transient Windows file lock"), { code: "EPERM" });
        throw error;
      }
      return actual.rename(...args);
    }
  };
});

import { appendRunEventRequired, readRunModelEvents } from "@/lib/server/runs/run-model-event-log";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-event-log-lock-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = tempDir;
  renameFailure.remaining = 0;
});

afterEach(async () => {
  renameFailure.remaining = 0;
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe("durable event log Windows publication", () => {
  it("persists a required cancellation event after one transient EPERM on atomic publish", async () => {
    renameFailure.remaining = 1;

    await appendRunEventRequired("run-cancelled", {
      eventId: "cancelled-once",
      actor: "system",
      type: "run.cancelled",
      payload: {
        killedProcesses: 1,
        escalatedKills: 0,
        survivors: [],
        cleanedWorktrees: [],
        gcFailures: [],
        allDead: true
      }
    });

    expect(await readRunModelEvents("run-cancelled")).toMatchObject([
      { eventId: "cancelled-once", type: "run.cancelled", payload: { allDead: true } }
    ]);
  });
});
