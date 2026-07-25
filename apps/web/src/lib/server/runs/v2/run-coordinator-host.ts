import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { buildAgentEnvironment } from "@manyhands/execution-core";
import { NonRetryablePlanningError, PlanningCapacityError, WorkBreakdownPlanner, compileGraphRevision, parseWorkBreakdownProgressLine, type WorkBreakdownModelRequest } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { buildFastRepositorySnapshot } from "@manyhands/repository-index";
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

/**
 * Wording that means the provider refused for capacity, mirroring the execution
 * side's QUOTA_PATTERN (`@manyhands/execution-core` classifyExecutorFailure).
 * Planning reads a CLI stream rather than a finished ExecutorRunOutcome, so it
 * matches the text directly; both layers must recognise the same phrases.
 */
const PROVIDER_CAPACITY_PATTERN = /(429|quota|rate.?limit|resource_exhausted|too many requests|overloaded|capacity|(?:session|usage|message|token)\s+limit)/i;

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
      ...(Object.keys(questionAnswers).length > 0 ? { questionAnswers } : {}),
      ...(run.granularityCondition !== undefined ? { granularityCondition: run.granularityCondition } : {}),
      ...(run.experimentalCandidate !== undefined ? {
        acceptanceCriteria: run.experimentalCandidate.acceptanceCriteria,
        experimentalCandidate: run.experimentalCandidate
      } : {})
    }, {
      events,
      snapshots,
      inspect: (input) => buildFastRepositorySnapshot({ rootPath: input.repoPath, targetFingerprint: input.targetFingerprint, baseCommit: input.baseCommit }),
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
    const child: ChildProcess = spawn(invocation.command, invocation.args, { cwd, env: buildAgentEnvironment() as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32", ...(invocation.windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments } : {}) });
    let stdoutBytes = 0;
    let stderrTail = "";
    let cliBuffer = "";
    let assistantText = "";
    let resultText: string | undefined;
    let terminalError: string | undefined;
    let receivedClaudeDelta = false;
    const observedEnvelopeTypes = new Set<string>();
    let progressBuffer = "";
    let progressQueue = Promise.resolve();
    let settled = false;
    const configuredTimeout = Number(process.env.MANYHANDS_PLANNING_STEP_TIMEOUT_MS ?? 300_000);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300_000;
    const timer = setTimeout(() => {
      void killCliProcessTree(child, spawn).finally(() => finish(() => reject(new Error(`${stage.executorId} planning timed out after ${timeoutMs}ms (${formatPlanningCliDiagnostics({ observedEnvelopeTypes, stdoutBytes, stderrTail })}).`))));
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
      if (decoded.envelopeType !== undefined) observedEnvelopeTypes.add(decoded.envelopeType);
      if (decoded.textDelta !== undefined) {
        receivedClaudeDelta = true;
        consumeAssistantText(decoded.textDelta);
      }
      if (decoded.assistantText !== undefined && !receivedClaudeDelta) consumeAssistantText(decoded.assistantText);
      if (decoded.result !== undefined) {
        resultText = decoded.result;
      }
      if (decoded.terminalError !== undefined) terminalError = decoded.terminalError;
    };
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdoutBytes += Buffer.byteLength(text);
      if (isCodex) {
        consumeAssistantText(text);
        return;
      }
      cliBuffer += text;
      const lines = cliBuffer.split(/\r?\n/u);
      cliBuffer = lines.pop() ?? "";
      for (const line of lines) consumeClaudeLine(line);
    });
    child.stderr?.on("data", (chunk) => { stderrTail = appendPlanningCliDiagnosticTail(stderrTail, String(chunk)); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (!isCodex) consumeClaudeLine(cliBuffer);
      enqueueProgress(progressBuffer);
      void progressQueue.then(
        () => finish(() => {
          if (code !== 0) {
            const diagnostics = formatPlanningCliDiagnostics({ observedEnvelopeTypes, stdoutBytes, stderrTail });
            // Capacity is decided by what the CLI SAID, not by which envelopes
            // it emitted: a direct probe showed `rate_limit_event` present in
            // successful calls too, so keying on the envelope type would have
            // relabelled every non-zero exit as throttling and retried genuine
            // planning failures without ever spending an attempt.
            if (PROVIDER_CAPACITY_PATTERN.test(`${stderrTail}\n${terminalError ?? ""}`)) {
              reject(new PlanningCapacityError(`${stage.executorId} was throttled by the provider (${diagnostics}).`));
              return;
            }
            reject(new Error(`${stage.executorId} planning failed with exit code ${code} (${diagnostics}).`));
            return;
          }
          if (isCodex) {
            resolve(assistantText);
            return;
          }
          try {
            resolve(completeClaudePlanningStream({ resultText, terminalError, observedEnvelopeTypes, stdoutBytes, stderrTail }));
          } catch (error) {
            reject(error);
          }
        }),
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

export interface ClaudePlanningStreamLine {
  envelopeType?: string;
  textDelta?: string;
  assistantText?: string;
  result?: string;
  terminalError?: string;
}

export function decodeClaudePlanningStreamLine(line: string): ClaudePlanningStreamLine {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    return {};
  }
  if (!isRecord(candidate)) return {};
  const envelopeType = typeof candidate.type === "string" ? candidate.type : undefined;
  if (candidate.type === "stream_event" && isRecord(candidate.event) && candidate.event.type === "content_block_delta" && isRecord(candidate.event.delta) && candidate.event.delta.type === "text_delta" && typeof candidate.event.delta.text === "string") {
    return withClaudeEnvelope(envelopeType, { textDelta: candidate.event.delta.text });
  }
  if (candidate.type === "assistant" && isRecord(candidate.message)) {
    const assistantText = assistantMessageText(candidate.message.content);
    return withClaudeEnvelope(envelopeType, assistantText === undefined ? {} : { assistantText });
  }
  if (candidate.type === "result") {
    const subtype = typeof candidate.subtype === "string" ? candidate.subtype : undefined;
    const terminalError = candidate.is_error === true || subtype?.startsWith("error_") === true ? subtype ?? "unknown_error" : undefined;
    if (typeof candidate.result === "string") return withClaudeEnvelope(envelopeType, terminalError === undefined ? { result: candidate.result } : { result: candidate.result, terminalError });
    return withClaudeEnvelope(envelopeType, terminalError === undefined ? {} : { terminalError });
  }
  return withClaudeEnvelope(envelopeType, {});
}

export function completeClaudePlanningStream(input: {
  resultText?: string | undefined;
  terminalError?: string | undefined;
  observedEnvelopeTypes: Iterable<string>;
  stdoutBytes: number;
  stderrTail?: string;
}): string {
  const diagnostics = formatPlanningCliDiagnostics(input);
  if (input.terminalError !== undefined) throw new Error(`Claude planning stream ended with terminal error ${input.terminalError} (${diagnostics}).`);
  if (input.resultText === undefined) {
    throw new NonRetryablePlanningError(`Claude planning stream closed without a successful terminal result (${diagnostics}).`);
  }
  return input.resultText;
}

function withClaudeEnvelope(envelopeType: string | undefined, line: Omit<ClaudePlanningStreamLine, "envelopeType">): ClaudePlanningStreamLine {
  return envelopeType === undefined ? line : { envelopeType, ...line };
}

function assistantMessageText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  return text.length === 0 ? undefined : text;
}

function appendPlanningCliDiagnosticTail(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-600);
}

function formatPlanningCliDiagnostics(input: {
  observedEnvelopeTypes: Iterable<string>;
  stdoutBytes: number;
  stderrTail?: string;
}): string {
  const envelopes = [...new Set(input.observedEnvelopeTypes)].sort().join(",") || "none";
  const stderr = redactPlanningCliDiagnostic(input.stderrTail);
  return `envelopes=${envelopes}; stdoutBytes=${input.stdoutBytes}${stderr === undefined ? "" : `; stderr=${JSON.stringify(stderr)}`}`;
}

function redactPlanningCliDiagnostic(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) return undefined;
  return compact.replace(/(api[_-]?key|authorization|token|password)\s*[=:]\s*\S+/giu, "$1=[redacted]").slice(-500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
