/**
 * B-007 — safe archive and journaled purge (CF-05).
 *
 * A run with a lifecycle and side effects (processes, worktrees, checkpoints,
 * event log) cannot be CRUD-deleted:
 *
 *  - ARCHIVE is the logical removal: metadata survives with `archivedAt`; the
 *    list hides archived runs by default. Refused while the run is active.
 *  - PURGE physically removes every resource, only for inactive runs with no
 *    live runner/processes, under a mutation lease, driven by an on-disk
 *    journal so a crash mid-purge is resumable. The run's metadata is the
 *    LAST resource deleted — while anything else may still exist, the run
 *    stays visible and retryable.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { countLiveProcesses } from "@manyhands/execution-core";
import { planningThreadId } from "@manyhands/orchestrator-graph";
import { resolveManyhandsPath } from "../repo-root";
import { RunLifecycleError, RunNotFoundError } from "./errors";
import { claimRunMutation } from "./mutation-guard";
import { claimRunOperation, releaseRunOperation } from "./run-operation-lease";
import { JsonPlanMutationJournal } from "./plan-mutation-journal";
import { resolveRunsDirectory } from "./repository";
import { isRunnerActive } from "./runner-state";
import type { RunOperationLease, RunRecord } from "./schema";
import { getRunRepository } from "./store";

const ACTIVE_STATUSES: ReadonlyArray<RunRecord["status"]> = ["generating", "running", "paused", "cancelling"];

function assertNotActive(run: RunRecord, action: string): void {
  if (ACTIVE_STATUSES.includes(run.status)) {
    throw new RunLifecycleError(
      `Cannot ${action} run ${run.runId} while it is active ("${run.status}"). Cancel it first.`
    );
  }
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export async function archiveRun(runId: string, now: string = new Date().toISOString()): Promise<RunRecord> {
  return claimRunMutation(runId, {}, (current) => {
    assertNotActive(current, "archive");
    if (isRunnerActive(runId)) {
      throw new RunLifecycleError(`Cannot archive run ${runId}: a runner is still active.`);
    }
    return { ...current, archivedAt: current.archivedAt ?? now };
  });
}

export async function unarchiveRun(runId: string): Promise<RunRecord> {
  return claimRunMutation(runId, {}, (current) => {
    const next = { ...current };
    delete next.archivedAt;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

export interface PurgeRunDeps {
  now?: () => string;
  /** Root under which per-run work copies are MANAGED (deletable). */
  workCopyRoot?: string;
  /** Removes one filesystem resource (recursive). Injectable for fault tests. */
  removeResource?: (target: string) => Promise<void>;
  countLiveProcesses?: (runId: string) => number;
  isRunnerActive?: (runId: string) => boolean;
}

export interface PurgeReport {
  runId: string;
  alreadyPurged: boolean;
  steps: string[];
}

/** Conservative B-020 retention defaults. Archive is logical and keeps every evidence class. */
export interface RunRetentionPolicy {
  retainFinalArtifacts: boolean;
  retainAttempts: boolean;
  retainCheckpoints: boolean;
  retainEventLog: boolean;
  retainExecutionRepository: boolean;
  retainFailedRunEvidence: boolean;
}

export const DEFAULT_RUN_RETENTION: Readonly<RunRetentionPolicy> = {
  retainFinalArtifacts: true,
  retainAttempts: true,
  retainCheckpoints: true,
  retainEventLog: true,
  retainExecutionRepository: true,
  retainFailedRunEvidence: true
};

interface PurgeJournal {
  version: 1;
  runId: string;
  startedAt: string;
  /** Absolute paths already targeted; used by residual cleanup after crashes. */
  steps: Record<string, "pending" | "done">;
}

function journalPathFor(runId: string): string {
  return path.join(resolveRunsDirectory(), `${runId}.purge.json`);
}

async function defaultRemoveResource(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

async function readJournal(runId: string): Promise<PurgeJournal | undefined> {
  try {
    const parsed = JSON.parse(await readFile(journalPathFor(runId), "utf8")) as PurgeJournal;
    return parsed.runId === runId ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeJournal(journal: PurgeJournal): Promise<void> {
  await writeFile(journalPathFor(journal.runId), JSON.stringify(journal, null, 2), "utf8");
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function purgeRun(runId: string, deps: PurgeRunDeps = {}): Promise<PurgeReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  const remove = deps.removeResource ?? defaultRemoveResource;
  const liveProcesses = deps.countLiveProcesses ?? countLiveProcesses;
  const runnerActive = deps.isRunnerActive ?? isRunnerActive;
  const workCopyRoot = deps.workCopyRoot ?? resolveManyhandsPath("work");
  const runsDir = resolveRunsDirectory();

  const repo = getRunRepository();
  let run: RunRecord | null;
  try {
    run = await repo.get(runId);
  } catch (error) {
    if (!(error instanceof RunNotFoundError)) throw error;
    run = null;
  }

  if (run === null) {
    // Metadata already gone. Finish a residual journal (crash after the
    // metadata step) so the purge converges.
    const residual = await readJournal(runId);
    if (residual !== undefined) {
      await rm(journalPathFor(runId), { force: true }).catch(() => undefined);
    }
    return { runId, alreadyPurged: true, steps: [] };
  }

  assertNotActive(run, "purge");
  if (runnerActive(runId)) {
    throw new RunLifecycleError(`Cannot purge run ${runId}: a runner is still active.`);
  }
  if (liveProcesses(runId) > 0) {
    throw new RunLifecycleError(
      `Cannot purge run ${runId}: ${liveProcesses(runId)} live process(es) are still registered. Cancel first.`
    );
  }

  // Mutation lease: excludes concurrent operations and fences stale writers.
  const claimed = await claimRunOperation(runId, "purge", {
    expectedStatuses: ["created", "needs_review", "approved", "completed", "completed_with_accepted", "failed", "interrupted"]
  });
  run = claimed.run;
  const lease: RunOperationLease = claimed.lease;

  const journal: PurgeJournal = (await readJournal(runId)) ?? {
    version: 1,
    runId,
    startedAt: now(),
    steps: {}
  };
  const completed: string[] = [];

  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    if (journal.steps[name] === "done") return;
    journal.steps[name] = "pending";
    await writeJournal(journal);
    await fn();
    journal.steps[name] = "done";
    await writeJournal(journal);
    completed.push(name);
  };

  try {
    // 1) Execution work copy (worktrees live inside it since B-001). Only a
    //    path under the managed work root is deletable; anything else (legacy
    //    records pointing at a user repo) only loses its run-scoped worktree
    //    directory, never the repository itself.
    const repoRoot = run.provisioned?.repoRoot;
    if (repoRoot !== undefined) {
      if (isContained(workCopyRoot, repoRoot)) {
        await step("work_copy", async () => {
          await remove(repoRoot);
          // Best-effort: drop the now-empty per-run parent directory.
          const parent = path.dirname(repoRoot);
          if (isContained(workCopyRoot, parent)) {
            await rm(parent, { recursive: true, force: true }).catch(() => undefined);
          }
        });
      } else {
        await step("worktrees", async () => {
          await remove(path.join(repoRoot, ".manyhands", "worktrees", runId));
        });
      }
    }

    // 2) LangGraph checkpoints (planning + execution threads).
    await step("checkpoints", async () => {
      await remove(path.join(runsDir, "checkpoints", runId));
      await remove(path.join(runsDir, "checkpoints", planningThreadId(runId)));
    });

    // 3) Run-model event log.
    await step("event_log", async () => {
      await remove(path.join(runsDir, `${runId}.events.jsonl`));
    });

    // 3b) B-015 durable attempt evidence. Archive never reaches this path;
    // explicit purge removes only the run-namespaced journal file.
    await step("attempt_journal", async () => {
      await remove(path.join(runsDir, "attempts", `${runId}.json`));
    });

    await step("plan_mutation_journal", async () => {
      await new JsonPlanMutationJournal({ directory: path.join(runsDir, "plan-mutations") }).removeForRun(runId);
    });

    // 4) LAST: the run metadata. While any earlier step can still fail, the
    //    run stays visible and the purge stays retryable.
    await step("metadata", async () => {
      await repo.delete(runId);
    });

    await rm(journalPathFor(runId), { force: true }).catch(() => undefined);
    return { runId, alreadyPurged: false, steps: completed };
  } catch (error) {
    // Leave the journal for the retry; free the lease so the retry can claim.
    await releaseRunOperation(runId, lease).catch(() => undefined);
    throw error;
  }
}
