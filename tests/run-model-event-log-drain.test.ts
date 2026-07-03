/**
 * `publishRunModelEvent` is fire-and-forget (`void append…`). In tests that
 * override MANYHANDS_RUNS_DIR, a publish still in flight when afterEach
 * restores the env resolves the REAL .manyhands/runs and leaks an events file
 * into the app (UUID .events.jsonl appeared after `pnpm test`). The log must
 * track its pending writes and expose a drain so tests can await them BEFORE
 * flipping the env back.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  drainRunModelEventWritesForTests,
  publishRunModelEvent
} from "@/lib/server/runs/run-model-event-log";

let dirA: string;
let dirB: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  dirA = await mkdtemp(path.join(os.tmpdir(), "mh-event-drain-a-"));
  dirB = await mkdtemp(path.join(os.tmpdir(), "mh-event-drain-b-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(dirA, { recursive: true, force: true }).catch(() => undefined);
  await rm(dirB, { recursive: true, force: true }).catch(() => undefined);
});

it("a drained publish lands in the runs dir that was active when it was fired", async () => {
  process.env.MANYHANDS_RUNS_DIR = dirA;
  publishRunModelEvent("run-drain-test", {
    actor: "system",
    type: "run.status.changed",
    payload: { status: "generating" }
  });

  await drainRunModelEventWritesForTests();
  // Only after the drain is it safe to point the env somewhere else.
  process.env.MANYHANDS_RUNS_DIR = dirB;

  expect(await readdir(dirA)).toContain("run-drain-test.events.jsonl");
  expect(await readdir(dirB)).toEqual([]);
});
