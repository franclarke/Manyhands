import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RunFailureReceiptPersistenceError,
  RunFailureReceiptStore,
  persistExecutionFailure,
  persistRunFailure,
  reconcilePendingExecutionFailures,
  reconcilePendingRunFailures
} from "@/lib/server/runs/v2/run-failure-receipt";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("run failure receipts", () => {
  it("writes to the neutral directory while retaining pending legacy receipts", async () => {
    const directory = await temporaryDirectory();
    const legacyDirectory = path.join(directory, "execution-failure-receipts");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(path.join(legacyDirectory, "legacy-run--legacy-receipt.json"), JSON.stringify({
      schemaVersion: 1,
      receiptId: "legacy-receipt",
      runId: "legacy-run",
      operationId: "legacy-operation",
      fencingToken: 1,
      failedAt: "2026-08-01T00:00:00.000Z",
      area: "planning",
      reason: "legacy planner failure",
      status: "pending"
    }));
    const store = new RunFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });

    await store.create({
      runId: "legacy-run",
      operationId: "new-operation",
      fencingToken: 2,
      area: "execution",
      error: new Error("new execution failure")
    });

    await expect(store.listPending("legacy-run")).resolves.toEqual([
      expect.objectContaining({ receiptId: "legacy-receipt", reason: "legacy planner failure" }),
      expect.objectContaining({ operationId: "new-operation", reason: "new execution failure" })
    ]);
    await expect(reconcilePendingRunFailures({
      store,
      area: "planning",
      runId: "legacy-run",
      recordTerminalFailure: async () => undefined
    })).resolves.toEqual({ reconciledReceiptIds: ["legacy-receipt"] });
    await expect(store.listPending("legacy-run")).resolves.toEqual([
      expect.objectContaining({ operationId: "new-operation", area: "execution" })
    ]);
    await expect(readdir(path.join(directory, "run-failure-receipts"))).resolves.toHaveLength(2);
  });

  it("preserves a pending receipt when the terminal journal write fails", async () => {
    const directory = await temporaryDirectory();
    const store = new RunFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });
    const recordTerminalFailure = vi.fn(async () => { throw new Error("journal unavailable"); });

    await expect(persistExecutionFailure({
      store,
      runId: "run-execution-failed",
      operationId: "operation-1",
      fencingToken: 4,
      error: new Error("agent exited 1"),
      recordTerminalFailure
    })).rejects.toBeInstanceOf(RunFailureReceiptPersistenceError);

    expect(recordTerminalFailure).toHaveBeenCalledTimes(1);
    await expect(store.listPending("run-execution-failed")).resolves.toEqual([
      expect.objectContaining({
        runId: "run-execution-failed",
        operationId: "operation-1",
        fencingToken: 4,
        reason: "agent exited 1",
        status: "pending",
        recordingFailure: "journal unavailable"
      })
    ]);
  });

  it("reconciles a preserved receipt exactly once without losing its original cause", async () => {
    const directory = await temporaryDirectory();
    const store = new RunFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });
    const failedWrite = vi.fn(async () => { throw new Error("journal unavailable"); });
    await persistExecutionFailure({
      store,
      runId: "run-reconcile-failure",
      operationId: "operation-1",
      fencingToken: 4,
      error: new Error("agent exited 1"),
      recordTerminalFailure: failedWrite
    }).catch(() => undefined);
    const recordTerminalFailure = vi.fn(async () => undefined);

    await expect(reconcilePendingExecutionFailures({ store, runId: "run-reconcile-failure", recordTerminalFailure }))
      .resolves.toEqual({ reconciledReceiptIds: [expect.any(String)] });
    expect(recordTerminalFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: "agent exited 1" }));
    await expect(store.listPending("run-reconcile-failure")).resolves.toEqual([]);
    await expect(reconcilePendingExecutionFailures({ store, runId: "run-reconcile-failure", recordTerminalFailure }))
      .resolves.toEqual({ reconciledReceiptIds: [] });
    expect(recordTerminalFailure).toHaveBeenCalledTimes(1);
  });

  it("keeps planning failure receipts separate from execution reconciliation", async () => {
    const directory = await temporaryDirectory();
    const store = new RunFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });

    await expect(persistRunFailure({
      store,
      area: "planning",
      runId: "run-planning-failed",
      operationId: "planning-operation-1",
      fencingToken: 5,
      error: new Error("planner unavailable"),
      recordTerminalFailure: async () => { throw new Error("event store unavailable"); }
    })).rejects.toBeInstanceOf(RunFailureReceiptPersistenceError);

    await expect(store.listPending("run-planning-failed")).resolves.toEqual([
      expect.objectContaining({ area: "planning", reason: "planner unavailable", status: "pending" })
    ]);
    await expect(reconcilePendingExecutionFailures({
      store,
      runId: "run-planning-failed",
      recordTerminalFailure: async () => undefined
    })).resolves.toEqual({ reconciledReceiptIds: [] });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-failure-receipt-"));
  temporaryRoots.push(directory);
  return directory;
}
