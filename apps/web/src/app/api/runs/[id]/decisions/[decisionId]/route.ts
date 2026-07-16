import { NextResponse } from "next/server";
import { z } from "zod";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import type { Decision, DecisionChoice, RunEvent } from "@/lib/run-model/types";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  appendStatusEventOrRollback,
  assertRunActionAllowed,
  claimRunMutation,
  ensureRunModelEventLogForRun,
  getRunRepository,
  requireCapturedRunRecord,
  resumePlanningPipeline,
  runExecutionPipeline
} from "@/lib/server/runs";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";
import { planningResumeFor } from "@/lib/server/runs/planning-host";
import { DEFAULT_STALE_MS } from "@/lib/server/runs/interrupted";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { answerExecutionGate } from "@/lib/server/runs/execution-gate-service";
import { resumeReplanWithAnswer } from "@/lib/server/runs/replan-service";
import type { RunRecord } from "@/lib/server/runs/schema";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { isRunnerActive, startRunBackgroundTask } from "@/lib/server/runs/runner-state";
import { approvalDecisionId } from "@/lib/server/runs/decision-identity";
import { approveAmendment } from "@/lib/server/runs/amendment-approval-service";
import { appendPendingDecisionEventsRequired } from "@/lib/server/runs/run-model-event-log";
import {
  assertRunOperationCurrent,
  claimRunOperation,
  releaseRunOperation
} from "@/lib/server/runs/run-operation-lease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; decisionId: string }>;
}

const DecisionRequestSchema = z
  .object({
    choice: z.unknown().optional(),
    answer: z.string().min(1).optional(),
    resolutionId: z.string().min(1).optional(),
    action: z.enum(["approve", "reject", "accept"]).optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    criticOverride: z.object({
      actor: z.string().min(1),
      acknowledgedErrors: z.array(z.string().min(1)).min(1)
    }).optional()
  })
  .strict();

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, decisionId } = await context.params;
  let body: z.infer<typeof DecisionRequestSchema>;
  try {
    const text = await request.text();
    const parsed = DecisionRequestSchema.safeParse(text.length > 0 ? JSON.parse(text) : {});
    if (!parsed.success) {
      throw new RunValidationError(parsed.error.issues[0]?.message ?? "Invalid decision request");
    }
    body = parsed.data;
  } catch (error) {
    if (error instanceof RunValidationError) return runErrorResponse(error);
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const repo = getRunRepository();
    let run = await repo.get(id);
    const events = await ensureRunModelEventLogForRun(run);
    const decision = pendingDecisionFor(run, events, decisionId);
    if (decision.kind === "approve_merge") {
      throw new RunLifecycleError(
        "approve_merge is no longer an actionable decision; use the explicit delivery operation."
      );
    }
    const choice = choiceFor(decision, body);
    const now = new Date().toISOString();

    if (decision.kind === "approve_plan") {
      const expectedDecisionId = approvalDecisionId(run.planRevision ?? 1);
      if (decision.id !== expectedDecisionId) {
        throw new RunLifecycleError(
          `Decision "${decision.id}" is stale; plan revision ${run.planRevision ?? 1} requires "${expectedDecisionId}".`
        );
      }
      if (!("action" in choice) || choice.action !== "approve") {
        throw new RunValidationError("approve_plan only supports { action: 'approve' }");
      }
      assertRunActionAllowed(run, "approve_plan");
      if (isRunnerActive(run.runId)) {
        throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
      }
      // Claims the approval atomically (INV-4) and resumes the suspended
      // approvalGate natively; a concurrent duplicate approval gets a 409.
      run = await processPlanApproval(run.runId, {
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
        ...(body.criticOverride !== undefined ? { criticOverride: body.criticOverride } : {})
      });
      // Resolving the approval gate IS the go-ahead in the agent-first model (there
      // is no separate "run" affordance). Start execution; the pipeline transitions
      // "approved" → "running" itself (mirrors the restart route).
      startRunBackgroundTask(run.runId, "route:decision:approve-plan-execution", () =>
        runExecutionPipeline(run.runId)
      );
    }

    if (decision.kind === "clarify") {
      if (!("answer" in choice)) {
        throw new RunValidationError("clarify requires { answer }");
      }

      // Execution-gate clarifications resume the suspended LangGraph thread
      // natively (Command({ resume })) instead of the planning pipeline. The
      // shared service keeps this path identical to POST /answer.
      if (run.status === "paused" && run.pausedDuring === "running" && run.pendingDecision !== undefined) {
        const gateResult = await answerExecutionGate(run, choice.answer, now);
        return NextResponse.json({ ...(await toCanonicalRunResponse(gateResult.run)), decisionId: decision.id, choice });
      }

      const nodeId = decision.context.nodeIds?.[0];
      if (nodeId === undefined) {
        throw new RunValidationError("Node ID does not match the pending question");
      }
      const answer = choice.answer;

      // Replan clarifying question (U2): paused during "running" with a
      // resumable replan context — the answer re-enters the replan.
      if (run.status === "paused" && run.pausedDuring === "running" && run.pendingReplan !== undefined) {
        run = await resumeReplanWithAnswer(run.runId, nodeId, answer);
        return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId: decision.id, choice });
      }

      // Atomic claim (INV-4): the pending question must still match `nodeId`
      // inside the write lock; the mutator consumes it, so a duplicate answer
      // gets a deterministic 409.
      let previous: RunRecord | undefined;
      run = await claimRunMutation(
        run.runId,
        {
          status: ["paused", "interrupted"],
          pausedDuring: "generating",
          pendingQuestionNodeId: nodeId,
          rejectFreshOperationAfterMs: DEFAULT_STALE_MS
        },
        (current) => {
          previous = current;
          const nextRun = {
            ...current,
            status: "generating" as const,
            questionAnswers: { ...(current.questionAnswers ?? {}), [nodeId]: answer }
          } as typeof current;
          delete nextRun.pausedDuring;
          delete nextRun.pendingQuestion;
          return nextRun;
        }
      );
      await appendStatusEventOrRollback(requireCapturedRunRecord(previous, run.runId), run, { at: now, actor: "human" });
      // Native resume into the suspended planning gate (the degraded-plan
      // gate takes a typed retry/abort action).
      startRunBackgroundTask(run.runId, "route:decision:planning-question", () =>
        resumePlanningPipeline(run.runId, planningResumeFor(nodeId, answer))
      );
    }

    if (decision.kind === "approve_amendment") {
      if (!("action" in choice) || (choice.action !== "approve" && choice.action !== "reject")) {
        throw new RunValidationError("approve_amendment requires { action: 'approve' | 'reject' }");
      }
      const amendmentId = decision.context.amendmentId;
      if (amendmentId === undefined) {
        throw new RunValidationError(`Decision ${decision.id} has no amendment identity.`);
      }
      const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
      const amendment = model.amendments.get(amendmentId);
      if (amendment === undefined) {
        throw new RunValidationError(`Decision ${decision.id} refers to missing amendment ${amendmentId}.`);
      }
      if (choice.action === "approve") {
        run = await approveAmendment({
          run,
          decisionId: decision.id,
          amendment,
          seam: amendment.detail.seamId !== undefined ? model.seams.get(amendment.detail.seamId) : undefined,
          ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
          at: now
        });
        return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId: decision.id, choice });
      }

      const claimed = await claimRunOperation(run.runId, "replan", {
        expectedStatuses: [run.status],
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
        now
      });
      try {
        await assertRunOperationCurrent(run.runId, claimed.lease);
        await appendPendingDecisionEventsRequired(claimed.run, decision.id, [{
          eventId: `decision-resolved:${run.runId}:${decision.id}:reject`,
          actor: "human",
          at: now,
          type: "decision.resolved",
          payload: { decisionId: decision.id, choice, actor: "human" }
        }, {
          eventId: `amendment-rejected:${run.runId}:${amendment.id}:${decision.id}`,
          actor: "human",
          at: now,
          type: "amendment.rejected",
          payload: { amendmentId: amendment.id, decisionId: decision.id }
        }]);
        await assertRunOperationCurrent(run.runId, claimed.lease);
      } finally {
        await releaseRunOperation(run.runId, claimed.lease);
      }
      run = await repo.get(run.runId);
      return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId: decision.id, choice });
    }

    if (decision.kind === "resolve_conflict" && decision.context.conflictId !== undefined && "resolutionId" in choice) {
      const claimed = await claimRunOperation(run.runId, "replan", {
        expectedStatuses: [run.status],
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
        now
      });
      try {
        await assertRunOperationCurrent(run.runId, claimed.lease);
        await appendPendingDecisionEventsRequired(claimed.run, decision.id, [{
          eventId: `decision-resolved:${run.runId}:${decision.id}:${choice.resolutionId}`,
          actor: "human",
          at: now,
          type: "decision.resolved",
          payload: { decisionId: decision.id, choice, actor: "human" }
        }, {
          eventId: `conflict-resolved:${run.runId}:${decision.context.conflictId}:${choice.resolutionId}`,
          actor: "human",
          at: now,
          type: "conflict.resolved",
          payload: { conflictId: decision.context.conflictId, by: "human", resolutionId: choice.resolutionId }
        }]);
        await assertRunOperationCurrent(run.runId, claimed.lease);
      } finally {
        await releaseRunOperation(run.runId, claimed.lease);
      }
      run = await repo.get(run.runId);
      return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId: decision.id, choice });
    }

    if (decision.kind !== "approve_plan") {
      await appendPendingDecisionEventsRequired(run, decision.id, [{
        eventId: `decision-resolved:${run.runId}:${decision.id}:${decision.kind}`,
        actor: "human",
        at: now,
        type: "decision.resolved",
        payload: { decisionId: decision.id, choice, actor: "human" }
      }]);
    }

    return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId: decision.id, choice });
  } catch (error) {
    return runErrorResponse(error);
  }
}

function pendingDecisionFor(run: RunRecord, events: RunEvent[], id: string): Decision {
  const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
  const decision = model.decisions.get(id);
  if (decision === undefined) {
    throw new RunNotFoundError(`decision:${id}`);
  }
  if (decision.status !== "pending") {
    throw new RunLifecycleError(`Decision "${id}" is already resolved`);
  }
  if (!buildDecisionChannelView(model).items.some((item) => item.id === id)) {
    throw new RunLifecycleError(`Decision "${id}" is not currently actionable`);
  }
  return decision;
}

function choiceFor(decision: Decision, body: z.infer<typeof DecisionRequestSchema>): DecisionChoice {
  const explicit = parseChoice(body.choice);
  if (explicit !== null) return validateChoiceForDecision(decision, explicit);
  if (body.answer !== undefined) return validateChoiceForDecision(decision, { answer: body.answer });
  if (body.resolutionId !== undefined) return validateChoiceForDecision(decision, { resolutionId: body.resolutionId });
  if (body.action !== undefined) return validateChoiceForDecision(decision, { action: body.action });

  switch (decision.kind) {
    case "clarify": {
      const answer = decision.context.options?.[0];
      if (answer === undefined) throw new RunValidationError("clarify requires an answer");
      return { answer };
    }
    case "resolve_conflict":
      throw new RunValidationError("resolve_conflict requires { resolutionId }");
    case "approve_merge":
      return { action: "accept" };
    case "approve_plan":
    case "approve_amendment":
    default:
      return { action: "approve" };
  }
}

function validateChoiceForDecision(decision: Decision, choice: DecisionChoice): DecisionChoice {
  if (decision.kind === "resolve_conflict" && !("resolutionId" in choice)) {
    throw new RunValidationError("resolve_conflict requires { resolutionId }");
  }
  return choice;
}

function parseChoice(value: unknown): DecisionChoice | null {
  if (typeof value !== "object" || value === null) return null;
  if ("answer" in value && typeof value.answer === "string" && value.answer.length > 0) {
    return { answer: value.answer };
  }
  if ("resolutionId" in value && typeof value.resolutionId === "string" && value.resolutionId.length > 0) {
    return { resolutionId: value.resolutionId };
  }
  if ("action" in value && (value.action === "approve" || value.action === "reject" || value.action === "accept")) {
    return { action: value.action };
  }
  return null;
}

