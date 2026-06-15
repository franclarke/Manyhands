/**
 * Shared resolution path for execution-gate answers.
 *
 * Both POST /decisions/[decisionId] (gate option buttons) and POST /answer
 * (chat composer) land here when the run is paused during "running" with a
 * pendingDecision. Keeping one implementation guarantees the chat input and
 * the decision cards accept exactly the same answers — the postmortem run got
 * stuck precisely because they didn't.
 */
import { RunValidationError } from "./errors";
import {
  clearExecutionPause,
  decisionFromAnswer,
  gateOptionsFor,
  isReplanRequest
} from "./execution-host";
import { resumeExecutionPipeline } from "./execution-pipeline";
import { publishRunModelEvent } from "./run-model-event-log";
import { replanSubtree } from "./replan-service";
import type { RunRecord } from "./schema";

export interface ExecutionGateAnswerResult {
  run: RunRecord;
  /** Run-model decision id the gate was published under (clarify:<taskId>). */
  decisionId: string;
  outcome: "resumed" | "replanning";
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
  now: string
): Promise<ExecutionGateAnswerResult> {
  const pending = run.pendingDecision;
  if (run.status !== "paused" || run.pausedDuring !== "running" || pending === undefined) {
    throw new RunValidationError("The run is not paused at an execution gate.");
  }

  // Pin the claim to the exact suspension we read: if the gate was resolved
  // or re-minted meanwhile, the clear below 409s (INV-4).
  const expectedGateId = pending.gateId;
  const decisionId = `clarify:${pending.taskId}`;

  // Selective re-decomposition: rebuild the failed subtree out-of-band.
  if (isReplanRequest({ answer })) {
    const failedTaskId = pending.taskId;
    const reason = pending.validationOutput ?? "leaf failed irrecoverably";
    const cleared = await clearExecutionPause(run.runId, "running", expectedGateId);
    publishRunModelEvent(cleared.runId, {
      actor: "human",
      at: now,
      type: "decision.resolved",
      payload: { decisionId, choice: { answer }, actor: "human" }
    });
    void replanSubtree(cleared.runId, failedTaskId, reason).catch(() => undefined);
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

  const cleared = await clearExecutionPause(run.runId, "running", expectedGateId);
  publishRunModelEvent(cleared.runId, {
    actor: "human",
    at: now,
    type: "decision.resolved",
    payload: { decisionId, choice: { answer }, actor: "human" }
  });
  void resumeExecutionPipeline(cleared.runId, resumeDecision).catch(() => undefined);
  return { run: cleared, decisionId, outcome: "resumed" };
}
