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
import path from "node:path";
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
import { TASK_ATTEMPT_EVENT_TYPES, JsonTaskAttemptJournal } from "./task-attempt-journal";
import { invalidateRunOperation } from "./run-operation-lease";
import { abortRun } from "./run-abort-registry";
import type { RunOperationLease, RunRecord } from "./schema";
import { resolveRunsDirectory } from "./repository";

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

  // Fence every in-flight attempt before killing processes. The old operation
  // lease is the evidence that owned the attempt; no stale executor can later
  // advance it after cancellation.
  if (previous?.activeOperation !== undefined) {
    const journal = new JsonTaskAttemptJournal({ directory: path.join(resolveRunsDirectory(), "attempts") });
    for (const attempt of await journal.list(runId)) {
      if (["result_persisted", "adopted", "discarded", "failed", "cancelled", "recovery_required"].includes(attempt.state)) continue;
      try {
        const cancelled = await journal.transition(attempt.attemptId, {
          expectedVersion: attempt.version,
          lease: previous.activeOperation,
          state: "cancelled",
          nodeDisposition: "cancelled",
          error: { code: "cancelled", message: deps.reason ?? "cancelled" }
        });
        const eventType = TASK_ATTEMPT_EVENT_TYPES.cancelled;
        if (eventType !== undefined) {
          await appendRunEventRequired(runId, {
            actor: deps.actor ?? "human",
            type: eventType as never,
            payload: {
              attemptId: cancelled.attemptId,
              nodeId: cancelled.nodeId,
              operationId: cancelled.operationId,
              fencingToken: cancelled.fencingToken,
              state: cancelled.state,
              kind: cancelled.kind
            } as never
          });
        }
      } catch {
        // A newer fenced writer already settled this attempt; cancellation's
        // run-level event remains the authoritative terminal audit.
      }
    }
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
  }

  // The cancellation audit is a required fact. Persist it before exposing an
  // interrupted terminal state, otherwise a watcher can observe the terminal
  // RunRecord while the durable allDead evidence is still absent.
  await appendRunEventRequired(claimed.runId, {
    eventId: `run.cancelled:${claimed.runId}:${claimed.version}`,
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

  if (killReport.allDead) {
    const beforeFinal = await claimRunMutation(runId, { status: ["cancelling"] }, (current) => {
      assertTransition(current.status, "interrupted");
      return { ...current, status: "interrupted" };
    });
    run = beforeFinal;
    await appendStatusChanged({ ...claimed, status: "cancelling" }, run, now, deps.actor ?? "human");
    terminal = true;
  }

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
