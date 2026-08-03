import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionFailureReceiptPersistenceError,
  ExecutionFailureReceiptStore,
  persistExecutionFailure,
  persistRunFailure,
  reconcilePendingExecutionFailures
} from "@/lib/server/runs/v2/execution-failure-receipt";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("execution failure receipts", () => {
  it("preserves a pending receipt when the terminal journal write fails", async () => {
    const directory = await temporaryDirectory();
    const store = new ExecutionFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });
    const recordTerminalFailure = vi.fn(async () => { throw new Error("journal unavailable"); });

    await expect(persistExecutionFailure({
      store,
      runId: "run-execution-failed",
      operationId: "operation-1",
      fencingToken: 4,
      error: new Error("agent exited 1"),
      recordTerminalFailure
    })).rejects.toBeInstanceOf(ExecutionFailureReceiptPersistenceError);

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
    const store = new ExecutionFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });
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
    const store = new ExecutionFailureReceiptStore({ directory, clock: () => "2026-08-02T00:00:00.000Z" });

    await expect(persistRunFailure({
      store,
      area: "planning",
      runId: "run-planning-failed",
      operationId: "planning-operation-1",
      fencingToken: 5,
      error: new Error("planner unavailable"),
      recordTerminalFailure: async () => { throw new Error("event store unavailable"); }
    })).rejects.toBeInstanceOf(ExecutionFailureReceiptPersistenceError);

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
  const directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-execution-failure-receipt-"));
  temporaryRoots.push(directory);
  return directory;
}
