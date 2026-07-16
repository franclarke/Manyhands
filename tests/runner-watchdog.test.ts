import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startBudgetWatchdog,
  type BudgetWatchdogDependencies
} from "@/lib/server/runs/runner-watchdog";
import { RunMutationConflictError } from "@/lib/server/runs/errors";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("budget watchdog lifecycle", () => {
  it("stops immediately without invoking cancellation before the timer fires", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const watchdog = startBudgetWatchdog("run-pending", 1_000, undefined, {
      readStatus: async () => "running",
      cancel: cancel as BudgetWatchdogDependencies["cancel"]
    });

    await watchdog.stop();
    await watchdog.settled;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not settle stop until an already-fired durable cancellation finishes", async () => {
    vi.useFakeTimers();
    const cancellationStarted = deferred();
    const cancellationFinished = deferred();
    const cancel = vi.fn(async () => {
      cancellationStarted.resolve();
      await cancellationFinished.promise;
      return undefined;
    });
    const watchdog = startBudgetWatchdog("run-fired", 10, undefined, {
      readStatus: async () => "running",
      cancel: cancel as BudgetWatchdogDependencies["cancel"]
    });

    vi.advanceTimersByTime(10);
    await cancellationStarted.promise;
    let stopSettled = false;
    const stopping = watchdog.stop().then(() => {
      stopSettled = true;
    });
    await Promise.resolve();

    expect(stopSettled).toBe(false);
    cancellationFinished.resolve();
    await stopping;
    await watchdog.settled;
    expect(stopSettled).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("surfaces cancellation failures to the owner", async () => {
    vi.useFakeTimers();
    const failure = new Error("durable cancellation failed");
    const cancel = vi.fn(async () => {
      throw failure;
    });
    const watchdog = startBudgetWatchdog("run-failed", 10, undefined, {
      readStatus: async () => "running",
      cancel: cancel as BudgetWatchdogDependencies["cancel"]
    });

    vi.advanceTimersByTime(10);
    await Promise.resolve();

    await expect(watchdog.stop()).rejects.toBe(failure);
    await expect(watchdog.settled).rejects.toBe(failure);
  });

  it("keeps one durable whole-run deadline across stop and resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    const executionStartedAt = new Date(Date.now()).toISOString();
    const cancel = vi.fn(async () => undefined);
    const dependencies: BudgetWatchdogDependencies = {
      executionStartedAt,
      readStatus: async () => "running",
      cancel: cancel as BudgetWatchdogDependencies["cancel"]
    };

    const initial = startBudgetWatchdog("run-deadline", 1_000, undefined, dependencies);
    await vi.advanceTimersByTimeAsync(600);
    await initial.stop();

    const resumed = startBudgetWatchdog("run-deadline", 1_000, undefined, dependencies);
    await vi.advanceTimersByTimeAsync(399);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await resumed.settled;

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("treats a terminal completion that wins the deadline CAS as benign", async () => {
    vi.useFakeTimers();
    let status: "running" | "not_running" = "running";
    const watchdog = startBudgetWatchdog("run-completion-race", 10, undefined, {
      readStatus: async () => status,
      cancel: (async () => {
        status = "not_running";
        throw new RunMutationConflictError("completion won", "completed", 4);
      }) as BudgetWatchdogDependencies["cancel"]
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(watchdog.settled).resolves.toBeUndefined();
  });

  it("surfaces status-store failures instead of silently disabling the ceiling", async () => {
    vi.useFakeTimers();
    const failure = new Error("run store unavailable");
    const watchdog = startBudgetWatchdog("run-read-failure", 10, undefined, {
      readStatus: async () => {
        throw failure;
      }
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(watchdog.settled).rejects.toBe(failure);
  });
});
