import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { WorkBreakdownPlanner, compileGraphRevision, parseWorkBreakdownProgressLine, type WorkBreakdownModelRequest } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { buildRepositorySnapshot } from "@manyhands/repository-index";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { killCliProcessTree, resolveCliBinaryPath, resolveCliProcessInvocation } from "@manyhands/shared/node-cli-process";
import { planningSelection } from "../executor-selection";
import type { RunRecord } from "../schema";
import { supervisedSpawnFn } from "../process-supervision";
import { resolveRunsDirectory } from "../runs-directory";
import { resolveRunTargetPath } from "../target-context";
import { claimRunOperation, releaseRunOperationWithRetry, updateRunForOperation } from "../run-operation-lease";
import { projectV2RunRecordCache } from "./run-record-cache";
import { runPlanningV2 } from "./planning-host";
import { approvePlanningV2 } from "./planning-host";
import { DEFAULT_STALE_MS } from "../interrupted";
import { startHeartbeat } from "../runner-heartbeat";

export async function runPlanningV2Pipeline(runId: string): Promise<void> {
  const claimed = await claimRunOperation(runId, "planning", {
    expectedLifecycles: ["planning"],
    allowTakeover: true,
    takeoverStaleAfterMs: DEFAULT_STALE_MS
  });
  const { run, lease } = claimed;
  const stopHeartbeat = startHeartbeat(runId, lease);
  try {
    const repoPath = await resolveRunTargetPath(run);
    if (repoPath === undefined || run.targetContext === undefined) throw new Error("Planning V2 requires a captured local repository target.");
    const directory = resolveRunsDirectory();
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const existingEvents = await events.load(runId);
    const questionAnswers = resolvedPlanningAnswers(existingEvents.length === 0 ? undefined : foldRun(existingEvents));
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
      authority,
      ...(Object.keys(questionAnswers).length > 0 ? { questionAnswers } : {})
    }, {
      events,
      snapshots,
      inspect: (input) => buildRepositorySnapshot({ rootPath: input.repoPath, targetFingerprint: input.targetFingerprint, baseCommit: input.baseCommit }),
      plan: (input, observer) => planner.plan(input, observer),
      compile: (input) => compileGraphRevision(input, { idFor: stableId, now: () => new Date().toISOString() }),
      nodeIdFor: (key) => stableId("node", key),
      now: () => new Date().toISOString()
    });
    const persistedEvents = await events.load(runId);
    await updateRunForOperation(runId, lease, (current) => projectV2RunRecordCache(current, state, persistedEvents));
  } finally {
    stopHeartbeat();
    await releaseRunOperationWithRetry(runId, lease);
  }
}

export async function approvePlanningV2Pipeline(runId: string, revision: number): Promise<RunRecord> {
  const claimed = await claimRunOperation(runId, "planning", { expectedLifecycles: ["needs_approval"] });
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
    return await updateRunForOperation(runId, lease, (currentRun) => projectV2RunRecordCache(currentRun, state, persistedEvents));
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
    : ["-p", "-", "--model", stage.model, "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", "plan"];
  const invocation = resolveCliProcessInvocation(binary, args);
  const spawn = supervisedSpawnFn({ runId, operationId, label: `planning-v2-attempt-${request.attempt}` });
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32", ...(invocation.windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}) });
    let stdout = "";
    let stderr = "";
    let cliBuffer = "";
    let assistantText = "";
    let resultText: string | undefined;
    let progressBuffer = "";
    let progressQueue = Promise.resolve();
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
    const enqueueProgress = (line: string) => {
      const unit = parseWorkBreakdownProgressLine(line.trim());
      if (unit !== undefined) progressQueue = progressQueue.then(() => request.onProgress(unit));
    };
    const consumeAssistantText = (text: string) => {
      assistantText += text;
      progressBuffer += text;
      const lines = progressBuffer.split(/\r?\n/u);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) enqueueProgress(line);
    };
    const consumeClaudeLine = (line: string) => {
      const decoded = decodeClaudePlanningStreamLine(line);
      if (decoded.textDelta !== undefined) consumeAssistantText(decoded.textDelta);
      if (decoded.result !== undefined) {
        resultText = decoded.result;
        if (assistantText.length === 0) consumeAssistantText(decoded.result);
      }
    };
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (isCodex) {
        consumeAssistantText(text);
        return;
      }
      cliBuffer += text;
      const lines = cliBuffer.split(/\r?\n/u);
      cliBuffer = lines.pop() ?? "";
      for (const line of lines) consumeClaudeLine(line);
    });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (!isCodex) consumeClaudeLine(cliBuffer);
      enqueueProgress(progressBuffer);
      void progressQueue.then(
        () => finish(() => code === 0 ? resolve(isCodex ? assistantText : resultText ?? assistantText) : reject(new Error(`${stage.executorId} planning failed with exit code ${code}: ${stderr || stdout}`))),
        (error) => finish(() => reject(error))
      );
    });
    child.stdin?.end(prompt);
  });
}

function resolvedPlanningAnswers(state: ReturnType<typeof foldRun> | undefined): Record<string, string> {
  if (state === undefined) return {};
  const answers: Record<string, string> = {};
  for (const decision of Object.values(state.decisions)) {
    if (decision.kind !== "clarify_goal" || decision.status !== "resolved" || decision.resolution === undefined) continue;
    const source = decision.evidenceRefs.find((reference) => reference.startsWith("work-question:") || reference.startsWith("work-uncertainty:"));
    if (source === undefined) continue;
    const key = source.slice(source.indexOf(":") + 1);
    const selected = decision.resolution.optionId === undefined
      ? undefined
      : decision.options.find((option) => option.id === decision.resolution?.optionId)?.label;
    const answer = decision.resolution.answer ?? selected;
    if (answer !== undefined) answers[key] = answer;
  }
  return answers;
}

export function decodeClaudePlanningStreamLine(line: string): { textDelta?: string; result?: string } {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    return {};
  }
  if (!isRecord(candidate)) return {};
  if (candidate.type === "stream_event" && isRecord(candidate.event) && candidate.event.type === "content_block_delta" && isRecord(candidate.event.delta) && candidate.event.delta.type === "text_delta" && typeof candidate.event.delta.text === "string") {
    return { textDelta: candidate.event.delta.text };
  }
  if (candidate.type === "result" && typeof candidate.result === "string") return { result: candidate.result };
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
