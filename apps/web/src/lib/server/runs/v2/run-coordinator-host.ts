import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { WorkBreakdownPlanner, compileGraphRevision, type WorkBreakdownModelRequest } from "@manyhands/decomposer";
import { buildRepositorySnapshot } from "@manyhands/repository-index";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { killCliProcessTree, resolveCliBinaryPath, resolveCliProcessInvocation } from "@manyhands/shared/node-cli-process";
import { planningSelection } from "../executor-selection";
import type { RunRecord } from "../schema";
import { supervisedSpawnFn } from "../process-supervision";
import { resolveRunsDirectory } from "../runs-directory";
import { resolveRunTargetPath } from "../target-context";
import { claimRunOperation, releaseRunOperationWithRetry, updateRunForOperation } from "../run-operation-lease";
import { projectPlanningV2ToRunRecord } from "./legacy-run-projection";
import { runPlanningV2 } from "./planning-host";
import { approvePlanningV2 } from "./planning-host";
import { DEFAULT_STALE_MS } from "../interrupted";
import { startHeartbeat } from "../runner-heartbeat";

export async function runPlanningV2Pipeline(runId: string): Promise<void> {
  const claimed = await claimRunOperation(runId, "planning", { expectedStatuses: ["created", "generating", "interrupted"], allowTakeover: true, takeoverStaleAfterMs: DEFAULT_STALE_MS });
  const { run, lease } = claimed;
  const stopHeartbeat = startHeartbeat(runId, lease);
  try {
    const repoPath = await resolveRunTargetPath(run);
    if (repoPath === undefined || run.targetContext === undefined) throw new Error("Planning V2 requires a captured local repository target.");
    const directory = resolveRunsDirectory();
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const stage = planningSelection(run);
    const planner = new WorkBreakdownPlanner({
      model: { generate: (request) => invokeSelectedPlanningCli(runId, repoPath, stage, lease.operationId, request) },
      maxAttempts: 3
    });
    const authority = { operationId: lease.operationId, fencingToken: lease.fencingToken };
    const state = await runPlanningV2({
      runId,
      goal: run.userPrompt,
      repoPath,
      targetFingerprint: run.targetContext.fingerprint,
      baseCommit: run.targetContext.sourceBaseCommit,
      authority
    }, {
      events,
      snapshots,
      inspect: (input) => buildRepositorySnapshot({ rootPath: input.repoPath, targetFingerprint: input.targetFingerprint, baseCommit: input.baseCommit }),
      plan: (input) => planner.plan(input),
      compile: (input) => compileGraphRevision(input, { idFor: stableId, now: () => new Date().toISOString() }),
      now: () => new Date().toISOString()
    });
    const persistedEvents = await events.load(runId);
    await updateRunForOperation(runId, lease, (current) => projectPlanningV2ToRunRecord(current, state, persistedEvents));
  } finally {
    stopHeartbeat();
    await releaseRunOperationWithRetry(runId, lease);
  }
}

export async function approvePlanningV2Pipeline(runId: string, revision: number): Promise<RunRecord> {
  const claimed = await claimRunOperation(runId, "planning", { expectedStatuses: ["needs_review"] });
  const { lease } = claimed;
  try {
    const directory = resolveRunsDirectory();
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const authority = { operationId: lease.operationId, fencingToken: lease.fencingToken };
    await events.advanceFence(runId, authority);
    const current = await events.load(runId);
    const state = await approvePlanningV2(runId, authority, revision, current.length, {
      events,
      snapshots,
      inspect: async () => { throw new Error("Inspection is not part of approval."); },
      plan: async () => { throw new Error("Planning is not part of approval."); },
      compile: () => { throw new Error("Compilation is not part of approval."); },
      now: () => new Date().toISOString()
    });
    const persistedEvents = await events.load(runId);
    return await updateRunForOperation(runId, lease, (currentRun) => projectPlanningV2ToRunRecord(currentRun, state, persistedEvents));
  } finally {
    await releaseRunOperationWithRetry(runId, lease);
  }
}

function stableId(kind: string, key: string): string {
  const readable = key.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 48);
  return `${kind}-${readable}-${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 10)}`;
}

async function invokeSelectedPlanningCli(
  runId: string,
  cwd: string,
  stage: { executorId: string; model: string; effort?: string },
  operationId: string,
  request: WorkBreakdownModelRequest
): Promise<string> {
  const repair = request.repairIssues.length === 0
    ? ""
    : `\n\nThe previous attempt was invalid. Repair every issue below and return the complete JSON again:\n- ${request.repairIssues.join("\n- ")}`;
  const prompt = `${request.system}\n\n${request.user}${repair}`;
  const isCodex = stage.executorId === "codex-cli";
  if (!isCodex && stage.executorId !== "claude-code-cli") throw new Error(`Planning V2 does not support executor ${stage.executorId}.`);
  const binary = resolveCliBinaryPath(isCodex ? (process.env.MANYHANDS_CODEX_BIN ?? "codex") : (process.env.MANYHANDS_CLAUDE_BIN ?? "claude"));
  const args = isCodex
    ? ["exec", "--model", stage.model, "--sandbox", "read-only", "--skip-git-repo-check", ...(stage.effort !== undefined ? ["-c", `model_reasoning_effort=\"${stage.effort}\"`] : []), "-"]
    : ["-p", "-", "--model", stage.model, "--output-format", "text", "--permission-mode", "plan"];
  const invocation = resolveCliProcessInvocation(binary, args);
  const spawn = supervisedSpawnFn({ runId, operationId, label: `planning-v2-attempt-${request.attempt}` });
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32", ...(invocation.windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}) });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const configuredTimeout = Number(process.env.MANYHANDS_PLANNING_STEP_TIMEOUT_MS ?? 300_000);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300_000;
    const timer = setTimeout(() => {
      void killCliProcessTree(child, spawn).finally(() => finish(() => reject(new Error(`${stage.executorId} planning timed out after ${timeoutMs}ms.`))));
    }, timeoutMs);
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete();
    };
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0 ? resolve(stdout) : reject(new Error(`${stage.executorId} planning failed with exit code ${code}: ${stderr || stdout}`))));
    child.stdin?.end(prompt);
  });
}
