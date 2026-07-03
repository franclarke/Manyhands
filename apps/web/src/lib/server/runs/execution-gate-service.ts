/**
 * Shared resolution path for execution-gate answers.
 *
 * Both POST /decisions/[decisionId] (gate option buttons) and POST /answer
 * (chat composer) land here when the run is paused during "running" with a
 * pendingDecision. Keeping one implementation guarantees the chat input and
 * the decision cards accept exactly the same answers — the postmortem run got
 * stuck precisely because they didn't.
 */
import { RunLifecycleError, RunValidationError } from "./errors";
import {
  clearExecutionPause,
  decisionFromAnswer,
  gateOptionsFor,
  isReplanRequest
} from "./execution-host";
import { resumeExecutionPipeline } from "./execution-pipeline";
import { assertRunActionAllowed } from "./lifecycle";
import { isRunnerActive, startRunBackgroundTask } from "./runner-state";
import { replanSubtree } from "./replan-service";
import type { RunRecord } from "./schema";

export interface ExecutionGateAnswerResult {
  run: RunRecord;
  /** Run-model decision id the gate was published under (clarify:<taskId>). */
  decisionId: string;
  outcome: "resumed" | "replanning";
}

export interface ExecutionGateAnswerOptions {
  expectedGateId?: string;
  expectedVersion?: number;
}

/**
 * Resolve a pending execution gate with a human answer (option label or raw
 * action id). Throws RunValidationError when the answer doesn't match any
 * gate option — the message lists the valid options so the caller's 400 is
 * actionable. Concurrency: the pause is cleared via a gateId-pinned claim, so
 * a double submit gets a deterministic 409 (INV-4).
 */
export async function answerExecutionGate(
  run: RunRecord,
  answer: string,
  now: string,
  options: ExecutionGateAnswerOptions = {}
): Promise<ExecutionGateAnswerResult> {
  assertRunActionAllowed(run, "answer_gate");
  if (isRunnerActive(run.runId)) {
    throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
  }
  const pending = run.pendingDecision;
  if (run.status !== "paused" || run.pausedDuring !== "running" || pending === undefined) {
    throw new RunValidationError("The run is not paused at an execution gate.");
  }

  // Pin the claim to the exact suspension we read: if the gate was resolved
  // or re-minted meanwhile, the clear below 409s (INV-4).
  const expectedGateId = options.expectedGateId ?? pending.gateId;
  const decisionId = `clarify:${pending.taskId}`;

  // Selective re-decomposition: rebuild the failed subtree out-of-band.
  if (isReplanRequest({ action: answer, answer }, pending.gate)) {
    const failedTaskId = pending.taskId;
    const reason = pending.validationOutput ?? "leaf failed irrecoverably";
    const cleared = await clearExecutionPause(run.runId, "running", expectedGateId, options.expectedVersion, [
      {
        actor: "human",
        at: now,
        type: "decision.resolved",
        payload: { decisionId, choice: { answer }, actor: "human" }
      }
    ]);
    startRunBackgroundTask(cleared.runId, "execution-gate:replan", async () => {
      await replanSubtree(cleared.runId, failedTaskId, reason);
    });
    return { run: cleared, decisionId, outcome: "replanning" };
  }

  const resumeDecision = decisionFromAnswer(pending.gate, answer);
  if (resumeDecision === null) {
    const validLabels = gateOptionsFor(pending.gate)
      .map((option) => `"${option.label}"`)
      .join(", ");
    throw new RunValidationError(
      `"${answer}" is not a valid option for the ${pending.gate} gate. Valid options: ${validLabels}.`
    );
  }

  const cleared = await clearExecutionPause(run.runId, "running", expectedGateId, options.expectedVersion, [
    {
      actor: "human",
      at: now,
      type: "decision.resolved",
      payload: { decisionId, choice: { answer }, actor: "human" }
    }
  ]);
  startRunBackgroundTask(cleared.runId, "execution-gate:resume", () =>
    resumeExecutionPipeline(cleared.runId, resumeDecision)
  );
  return { run: cleared, decisionId, outcome: "resumed" };
}
