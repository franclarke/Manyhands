/**
 * RU1 (F2B-1) — durable process evidence journal.
 *
 * Every supervised process must leave durable evidence as soon as its identity
 * is known, and that evidence must be closed on normal exit so cancel never
 * treats a finished process as potentially alive.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProcessEvidenceSink, registerLiveProcess, unregisterLiveProcess, type ProcessSnapshot } from "@manyhands/execution-core";
import {
  configureProcessEvidenceWatchForTests,
  JsonRunProcessJournal,
  killRunProcessesVerified,
  installProcessEvidenceSink,
  uninstallProcessEvidenceSinkForTests,
  drainProcessEvidenceForTests
} from "@/lib/server/runs/process-evidence";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-proc-evidence-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
});

afterEach(async () => {
  await drainProcessEvidenceForTests();
  uninstallProcessEvidenceSinkForTests();
  setProcessEvidenceSink(undefined);
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("JsonRunProcessJournal", () => {
  it("records a started process as open and closes it on exit", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-1", { pid: 4242, label: "executor", command: "claude" });

    let open = await journal.listOpen("run-1");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ pid: 4242, label: "executor", command: "claude" });
    expect(open[0]!.registeredAt).toBeTypeOf("string");

    await journal.recordExit("run-1", 4242);
    open = await journal.listOpen("run-1");
    expect(open).toHaveLength(0);

    const all = await journal.list("run-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.exitedAt).toBeTypeOf("string");
  });

  it("close() marks an entry with a reason and is idempotent", async () => {
    const journal = new JsonRunProcessJournal();
    const rec = await journal.recordStart("run-2", { pid: 77, label: "executor" });
    await journal.close("run-2", 77, rec.registeredAt, "pid_recycled");
    await journal.close("run-2", 77, rec.registeredAt, "pid_recycled");

    expect(await journal.listOpen("run-2")).toHaveLength(0);
    const all = await journal.list("run-2");
    expect(all[0]!.closed).toMatchObject({ reason: "pid_recycled" });
  });

  it("a run without any journal file has no open processes (historic compatibility)", async () => {
    const journal = new JsonRunProcessJournal();
    expect(await journal.listOpen("run-never-seen")).toEqual([]);
    expect(await journal.list("run-never-seen")).toEqual([]);
  });

  it("recordExit on an unknown pid is a no-op, not an error", async () => {
    const journal = new JsonRunProcessJournal();
    await expect(journal.recordExit("run-3", 999999)).resolves.toBeUndefined();
  });
});

describe("evidence sink wiring (registry → journal)", () => {
  it("registerLiveProcess persists durable evidence and unregister closes it", async () => {
    installProcessEvidenceSink();
    const fakeChild = { pid: 5151, kill: () => true, spawnfile: "node" };
    registerLiveProcess("run-sink", fakeChild, { runId: "run-sink", label: "executor" });
    await drainProcessEvidenceForTests();

    const journal = new JsonRunProcessJournal();
    const open = await journal.listOpen("run-sink");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ pid: 5151, label: "executor" });

    unregisterLiveProcess("run-sink", fakeChild);
    await drainProcessEvidenceForTests();
    expect(await journal.listOpen("run-sink")).toHaveLength(0);
  });

  it("records a live descendant before the executor exits", async () => {
    const snapshots: ProcessSnapshot[] = [
      new Map([
        [5152, { pid: 5152, ppid: 1, createdAtMs: Date.now() - 1000, command: "node" }],
        [5153, { pid: 5153, ppid: 5152, createdAtMs: Date.now() - 500, command: "smoke-server" }]
      ]),
      new Map([[5153, { pid: 5153, ppid: 1, createdAtMs: Date.now() - 500, command: "smoke-server" }]])
    ];
    configureProcessEvidenceWatchForTests({
      intervalMs: 5,
      snapshot: async () => snapshots.shift() ?? new Map([
        [5153, { pid: 5153, ppid: 1, createdAtMs: Date.now() - 500, command: "smoke-server" }]
      ])
    });
    installProcessEvidenceSink();
    const fakeChild = { pid: 5152, kill: () => true, spawnfile: "node" };
    registerLiveProcess("run-descendant", fakeChild, { runId: "run-descendant", label: "executor" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    unregisterLiveProcess("run-descendant", fakeChild);
    await drainProcessEvidenceForTests();

    const journal = new JsonRunProcessJournal();
    expect(await journal.listOpen("run-descendant")).toEqual(expect.arrayContaining([
      expect.objectContaining({ pid: 5153, label: "executor:descendant", command: "smoke-server" })
    ]));

    const killTree = vi.fn().mockResolvedValue(true);
    const report = await killRunProcessesVerified("run-descendant", {
      journal,
      inspector: {
        snapshot: async () => new Map([
          [5153, { pid: 5153, ppid: 1, createdAtMs: Date.now() - 500, command: "smoke-server" }]
        ])
      },
      killOwned: async () => ({ ownerId: "run-descendant", verifications: [], allDead: true }),
      killPidTree: killTree,
      isAlive: () => false,
      killTimeoutMs: 1
    });
    expect(report.allDead).toBe(true);
    expect(killTree).toHaveBeenCalledWith(5153);
    expect(await journal.listOpen("run-descendant")).toHaveLength(0);
  });
});
