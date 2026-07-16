/**
 * RU1 (F2B-1/R2B-4) — merged verified kill over live registry + durable evidence.
 *
 * Invariants under test:
 *  - an empty in-memory registry must NOT produce a vacuous allDead=true while
 *    durable evidence says a process may still be alive;
 *  - a durable pid whose OS creation time postdates its registration is a
 *    recycled pid: it must NOT be killed and counts as dead (the original
 *    process is provably gone);
 *  - an unverifiable identity (inspector failure, pid alive) must NOT be
 *    killed and must NOT allow allDead=true;
 *  - already-dead durable pids close idempotently;
 *  - the process TREE is verified, not just the root pid.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProcessSnapshotEntry } from "@manyhands/execution-core";
import {
  JsonRunProcessJournal,
  killRunProcessesVerified
} from "@/lib/server/runs/process-evidence";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-durable-kill-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function snapshotOf(entries: ProcessSnapshotEntry[]): Map<number, ProcessSnapshotEntry> {
  return new Map(entries.map((entry) => [entry.pid, entry]));
}

const T0 = Date.parse("2026-07-13T00:00:00.000Z");

describe("killRunProcessesVerified", () => {
  it("kills a durable process even when the in-memory registry is empty (post-restart)", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-a", {
      pid: 100,
      label: "executor",
      registeredAt: new Date(T0).toISOString()
    });

    const alive = new Set([100]);
    const killed: number[] = [];
    const report = await killRunProcessesVerified("run-a", {
      journal,
      inspector: {
        snapshot: async () => snapshotOf([{ pid: 100, createdAtMs: T0 - 5_000, command: "node" }])
      },
      isAlive: (pid) => alive.has(pid),
      killPidTree: async (pid) => {
        killed.push(pid);
        alive.delete(pid);
      }
    });

    expect(killed).toEqual([100]);
    expect(report.allDead).toBe(true);
    expect(report.verifications.map((v) => ({ pid: v.pid, outcome: v.outcome }))).toEqual([
      { pid: 100, outcome: "dead" }
    ]);
    // Evidence is closed so a retried cancel is a no-op.
    expect(await journal.listOpen("run-a")).toHaveLength(0);
  });

  it("refuses to kill a recycled pid (creation time after registration) and counts it dead", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-b", {
      pid: 200,
      label: "executor",
      registeredAt: new Date(T0).toISOString()
    });

    const killed: number[] = [];
    const report = await killRunProcessesVerified("run-b", {
      journal,
      inspector: {
        // Same pid, but the process was created a minute AFTER we registered
        // ours: it is somebody else's process.
        snapshot: async () => snapshotOf([{ pid: 200, createdAtMs: T0 + 60_000, command: "notepad" }])
      },
      isAlive: () => true,
      killPidTree: async (pid) => {
        killed.push(pid);
      }
    });

    expect(killed).toEqual([]);
    expect(report.allDead).toBe(true);
    const closed = (await journal.list("run-b"))[0]!;
    expect(closed.closed?.reason).toBe("pid_recycled");
  });

  it("does not declare allDead when identity cannot be verified for a live pid", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-c", {
      pid: 300,
      label: "executor",
      registeredAt: new Date(T0).toISOString()
    });

    const killed: number[] = [];
    const report = await killRunProcessesVerified("run-c", {
      journal,
      inspector: {
        snapshot: async () => {
          throw new Error("ps unavailable");
        }
      },
      isAlive: () => true,
      killPidTree: async (pid) => {
        killed.push(pid);
      }
    });

    expect(killed).toEqual([]);
    expect(report.allDead).toBe(false);
    expect(report.verifications.some((v) => v.pid === 300 && v.outcome === "unverified")).toBe(true);
    // The evidence stays open: a later cancel must reconsider it.
    expect(await journal.listOpen("run-c")).toHaveLength(1);
  });

  it("treats an already-dead durable pid idempotently across repeated cancels", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-d", {
      pid: 400,
      label: "executor",
      registeredAt: new Date(T0).toISOString()
    });

    const deps = {
      journal,
      inspector: { snapshot: async () => snapshotOf([]) },
      isAlive: () => false,
      killPidTree: async () => {
        throw new Error("must not kill a dead process");
      }
    };

    const first = await killRunProcessesVerified("run-d", deps);
    expect(first.allDead).toBe(true);
    expect(first.verifications).toEqual([
      expect.objectContaining({ pid: 400, outcome: "dead" })
    ]);
    expect((await journal.list("run-d"))[0]!.closed?.reason).toBe("not_running");

    const second = await killRunProcessesVerified("run-d", deps);
    expect(second.allDead).toBe(true);
    expect(second.verifications).toEqual([]);
  });

  it("a normally-exited process leaves no open evidence and no kill work", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-e", { pid: 500, label: "executor" });
    await journal.recordExit("run-e", 500);

    const report = await killRunProcessesVerified("run-e", {
      journal,
      inspector: { snapshot: async () => snapshotOf([]) },
      isAlive: () => {
        throw new Error("must not probe closed evidence");
      },
      killPidTree: async () => {
        throw new Error("must not kill closed evidence");
      }
    });
    expect(report.allDead).toBe(true);
    expect(report.verifications).toEqual([]);
  });

  it("verifies the whole descendant tree: a surviving grandchild blocks allDead", async () => {
    const journal = new JsonRunProcessJournal();
    await journal.recordStart("run-f", {
      pid: 600,
      label: "executor",
      registeredAt: new Date(T0).toISOString()
    });

    // 600 → 601 → 602 (grandchild). Killing the root only reaps 600 and 601;
    // 602 survives and must be reported.
    const alive = new Set([600, 601, 602]);
    const report = await killRunProcessesVerified("run-f", {
      journal,
      inspector: {
        snapshot: async () =>
          snapshotOf([
            { pid: 600, createdAtMs: T0 - 1_000, command: "node" },
            { pid: 601, ppid: 600, createdAtMs: T0 - 900, command: "node" },
            { pid: 602, ppid: 601, createdAtMs: T0 - 800, command: "node" }
          ])
      },
      isAlive: (pid) => alive.has(pid),
      killPidTree: async () => {
        alive.delete(600);
        alive.delete(601);
      },
      killTimeoutMs: 300
    });

    expect(report.allDead).toBe(false);
    const survivors = report.verifications.filter((v) => v.outcome === "survived");
    expect(survivors.map((v) => v.pid)).toEqual([602]);
    // Root evidence must NOT be closed while its tree has survivors.
    expect(await journal.listOpen("run-f")).toHaveLength(1);
  });
});
