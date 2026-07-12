/**
 * B-005 — cancellation that is terminal only when verified (CF-06).
 *
 * Order of operations:
 *
 *  1. Claim the `cancelling` transition (CAS) and invalidate the operation
 *     lease — no writer holding the old lease may persist anything after this.
 *  2. Fire the cooperative AbortSignal (drive loop + every supervised child).
 *  3. Force-kill every registered process tree of the run and WAIT for the
 *     verification report.
 *  4. Only `allDead=true` finishes the job: GC the run's worktrees and move
 *     the run to the resumable `interrupted` state. Any survivor leaves the
 *     run in `cancelling`; retrying cancel is allowed and completes it.
 *
 * The audit event is durable before the caller sees the outcome.
 */
import {
  SimpleGitRunner,
  WorktreeManager,
  killOwnedProcessTrees as killOwnedProcessTreesDefault,
  type AgentExecutionResult,
  type IntegrationResult,
  type KillReport,
  type RunExecutionResult
} from "@manyhands/execution-core";
import { appendStatusEventOrRollback } from "./audited-mutation";
import { assertRunActionAllowed, assertTransition } from "./lifecycle";
import { claimRunMutation } from "./mutation-guard";
import { appendRunEventRequired } from "./run-model-event-log";
import { invalidateRunOperation } from "./run-operation-lease";
import { abortRun } from "./run-abort-registry";
import type { RunOperationLease, RunRecord } from "./schema";

export interface CancelRunDeps {
  killOwnedProcessTrees?: (ownerId: string) => Promise<KillReport>;
  gcWorktrees?: (run: RunRecord) => Promise<{ removed: string[]; failed: string[] }>;
  now?: () => string;
  /** Background callers fence cancellation to the operation that armed it. */
  operationLease?: Pick<RunOperationLease, "operationId" | "fencingToken">;
  actor?: "human" | "system";
  reason?: string;
}

export interface CancelRunOutcome {
  run: RunRecord;
  killReport: KillReport;
  cleaned: { removed: string[]; failed: string[] };
  /** True when the run reached the resumable `interrupted` state. */
  terminal: boolean;
}

async function defaultGcWorktrees(run: RunRecord): Promise<{ removed: string[]; failed: string[] }> {
  if (run.provisioned === undefined) return { removed: [], failed: [] };
  const manager = new WorktreeManager({
    git: new SimpleGitRunner(),
    repoRoot: run.provisioned.repoRoot
  });
  return manager.gcRun(run.runId, { preserveBranchesFor: evidenceTaskIds(run) });
}

/** TaskIds whose recorded results carry an evidence commit worth anchoring. */
function evidenceTaskIds(run: RunRecord): Set<string> {
  const execution = run.execution as Partial<RunExecutionResult> | undefined;
  const ids = new Set<string>();
  for (const result of (execution?.leafResults ?? []) as AgentExecutionResult[]) {
    if (result.commitSha !== undefined) ids.add(result.taskId);
  }
  for (const result of (execution?.integrationResults ?? []) as IntegrationResult[]) {
    if (result.integrationCommitSha !== undefined) ids.add(result.compositeTaskId);
  }
  return ids;
}

const CANCELLABLE: ReadonlyArray<RunRecord["status"]> = ["generating", "running", "paused", "cancelling"];

export async function cancelRun(runId: string, deps: CancelRunDeps = {}): Promise<CancelRunOutcome> {
  const now = deps.now?.() ?? new Date().toISOString();
  const kill = deps.killOwnedProcessTrees ?? killOwnedProcessTreesDefault;
  const gc = deps.gcWorktrees ?? defaultGcWorktrees;

  // 1) Claim `cancelling` and invalidate the lease atomically.
  let previous: RunRecord | undefined;
  const claimed = await claimRunMutation(runId, {
    status: CANCELLABLE,
    ...(deps.operationLease !== undefined ? { operationLease: deps.operationLease } : {})
  }, (current) => {
    previous = current;
    assertRunActionAllowed(current, "cancel");
    assertTransition(current.status, "cancelling");
    const interruptedDuring: "generating" | "running" =
      current.interruptedDuring ??
      (current.status === "running" || current.pausedDuring === "running" ? "running" : "generating");
    const next: RunRecord = {
      ...invalidateRunOperation(current),
      status: "cancelling",
      interruptedDuring,
      errorMessage: deps.reason ?? "interrupted: cancelled by user"
    };
    delete next.pausedDuring;
    return next;
  });
  if (previous !== undefined && previous.status !== "cancelling") {
    await appendStatusChanged(previous, claimed, now, deps.actor ?? "human");
  }

  // 2) Cooperative abort: the drive loop cuts the stream between supersteps
  //    and every supervised subprocess receives the signal.
  abortRun(claimed.runId);

  // 3) Hard kill + verification.
  const killReport = await kill(claimed.runId);

  let run = claimed;
  let cleaned: { removed: string[]; failed: string[] } = { removed: [], failed: [] };
  let terminal = false;

  if (killReport.allDead) {
    // 4) Worktree GC only under a verified-dead run (never sweep directories
    //    that may still be a survivor's cwd), then finish the transition.
    cleaned = await gc(run);
    const beforeFinal = await claimRunMutation(runId, { status: ["cancelling"] }, (current) => {
      assertTransition(current.status, "interrupted");
      return { ...current, status: "interrupted" };
    });
    run = beforeFinal;
    await appendStatusChanged({ ...claimed, status: "cancelling" }, run, now, deps.actor ?? "human");
    terminal = true;
  }

  // Awaited (not fire-and-forget): the cancellation audit must be durable
  // before the caller sees the outcome (INV-6).
  await appendRunEventRequired(claimed.runId, {
    actor: deps.actor ?? "human",
    at: now,
    type: "run.cancelled",
    payload: {
      killedProcesses: killReport.verifications.length,
      escalatedKills: killReport.verifications.filter((v) => v.outcome === "escalated").length,
      survivors: killReport.verifications.filter((v) => v.outcome === "survived").map((v) => v.pid),
      cleanedWorktrees: cleaned.removed,
      gcFailures: cleaned.failed,
      allDead: killReport.allDead
    }
  });

  return { run, killReport, cleaned, terminal };
}

async function appendStatusChanged(
  previous: RunRecord,
  saved: RunRecord,
  at: string,
  actor: "human" | "system"
): Promise<void> {
  await appendStatusEventOrRollback(previous, saved, { at, actor });
}
