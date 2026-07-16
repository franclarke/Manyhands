import { cancelRun } from "./cancel-service";
import { getRunRepository } from "./store";
import type { RunOperationLease } from "./schema";
import { RunMutationConflictError, RunNotFoundError } from "./errors";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface BudgetWatchdogHandle {
  /** Settles only after an already-fired cancellation has finished durably. */
  readonly settled: Promise<void>;
  /** Cancel a pending timer and wait for any cancellation already in flight. */
  stop(): Promise<void>;
}

export interface BudgetWatchdogDependencies {
  readStatus?: (runId: string) => Promise<"running" | "not_running" | "missing">;
  cancel?: typeof cancelRun;
  /** Durable beginning of the whole-run wall-clock budget. */
  executionStartedAt?: string;
  /** Injectable wall clock for deterministic deadline tests. */
  now?: () => number;
}

export function startBudgetWatchdog(
  runId: string,
  maxWallClockMs: number | undefined,
  lease?: RunOperationLease,
  dependencies: BudgetWatchdogDependencies = {}
): BudgetWatchdogHandle {
  if (maxWallClockMs === undefined) {
    const settled = Promise.resolve();
    return { settled, stop: () => settled };
  }

  const now = dependencies.now ?? Date.now;
  const persistedStartMs = dependencies.executionStartedAt === undefined
    ? Number.NaN
    : Date.parse(dependencies.executionStartedAt);
  // `executionStartedAt` is persisted on the RunRecord. Deriving the deadline from it
  // makes the ceiling survive pause/resume and process restart instead of
  // granting a fresh maxWallClockMs on every pipeline invocation.
  const deadlineMs = (Number.isFinite(persistedStartMs) ? persistedStartMs : now()) + maxWallClockMs;

  let started = false;
  let resolveSettled!: () => void;
  let rejectSettled!: (error: unknown) => void;
  const settled = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve;
    rejectSettled = reject;
  });
  // The owner observes the same rejection through stop()/settled. Attaching a
  // handler immediately prevents a fast failure from becoming an unhandled
  // rejection before the pipeline reaches its finally block.
  void settled.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout>;
  const fire = (): void => {
    started = true;
    void (async () => {
      const readStatus = dependencies.readStatus ?? readPersistedRunStatus;
      const status = await readStatus(runId);
      if (status === "running") {
        try {
          await (dependencies.cancel ?? cancelRun)(runId, {
            ...(lease !== undefined ? { operationLease: lease } : {}),
            actor: "system",
            reason: `interrupted: wall-clock budget of ${maxWallClockMs}ms exceeded`
          });
        } catch (error) {
          // Completion and the deadline can race after the initial read. If a
          // terminal writer won the durable CAS, the budget did not fail; only
          // a still-running owner makes this cancellation conflict actionable.
          if (error instanceof RunMutationConflictError && await readStatus(runId) !== "running") return;
          throw error;
        }
      }
    })().then(resolveSettled, rejectSettled);
  };
  const arm = (): void => {
    const remainingMs = Math.max(0, deadlineMs - now());
    timer = setTimeout(remainingMs > MAX_TIMER_DELAY_MS ? arm : fire, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    if (typeof timer.unref === "function") timer.unref();
  };
  arm();

  return {
    settled,
    async stop(): Promise<void> {
      clearTimeout(timer);
      if (!started) resolveSettled();
      await settled;
    }
  };
}

async function readPersistedRunStatus(runId: string): Promise<"running" | "not_running" | "missing"> {
  try {
    const current = await getRunRepository().get(runId);
    return current.status === "running" ? "running" : "not_running";
  } catch (error) {
    if (error instanceof RunNotFoundError) return "missing";
    throw error;
  }
}
