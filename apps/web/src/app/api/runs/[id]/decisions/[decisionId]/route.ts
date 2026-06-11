import { NextResponse } from "next/server";
import { z } from "zod";
import { AmendmentsEngine, type RunExecutionResult, computeGranularityVector } from "@manyhands/execution-core";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import type { Decision, DecisionChoice, RunEvent } from "@/lib/run-model/types";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  claimRunMutation,
  ensureRunModelEventLogForRun,
  getRunRepository,
  publishRunEvent,
  publishRunModelEvent,
  resumeExecutionPipeline,
  resumePlanningPipeline,
  runExecutionPipeline
} from "@/lib/server/runs";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import {
  clearExecutionPause,
  decisionFromAnswer,
  isReplanRequest,
  resetExecutionThread
} from "@/lib/server/runs/execution-host";
import { replanSubtree } from "@/lib/server/runs/replan-service";
import {
  executionResultsFromRun,
  integrationDurationMs,
  provisionedFromRecord,
  resolveExecutionGraph
} from "@/lib/server/runs/execution-state";
import type { RunRecord } from "@/lib/server/runs/schema";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import { toRunResponse } from "@/lib/server/runs/presenter";

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
    acknowledgeCriticErrors: z.boolean().optional()
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
    const choice = choiceFor(decision, body);
    const now = new Date().toISOString();

    if (decision.kind === "approve_plan") {
      if (!("action" in choice) || choice.action !== "approve") {
        throw new RunValidationError("approve_plan only supports { action: 'approve' }");
      }
      // Claims the approval atomically (INV-4) and resumes the suspended
      // approvalGate natively; a concurrent duplicate approval gets a 409.
      run = await processPlanApproval(run.runId, body.acknowledgeCriticErrors === true);
      // Resolving the approval gate IS the go-ahead in the agent-first model (there
      // is no separate "run" affordance). Start execution; the pipeline transitions
      // "approved" → "running" itself (mirrors the restart route).
      void runExecutionPipeline(run.runId).catch(() => undefined);
    }

    if (decision.kind === "clarify") {
      if (!("answer" in choice)) {
        throw new RunValidationError("clarify requires { answer }");
      }

      // Execution-gate clarifications resume the suspended LangGraph thread
      // natively (Command({ resume })) instead of the planning pipeline.
      if (run.status === "paused" && run.pausedDuring === "running" && run.pendingDecision !== undefined) {
        // Pin the claim to the exact suspension we read: if the gate was
        // resolved or re-minted meanwhile, the clear below 409s (INV-4).
        const expectedGateId = run.pendingDecision.gateId;
        // Selective re-decomposition: rebuild the failed subtree out-of-band.
        if (isReplanRequest({ answer: choice.answer })) {
          const failedTaskId = run.pendingDecision.taskId;
          const reason = run.pendingDecision.validationOutput ?? "leaf failed irrecoverably";
          run = await clearExecutionPause(run.runId, "running", expectedGateId);
          publishRunModelEvent(run.runId, {
            actor: "human",
            at: now,
            type: "decision.resolved",
            payload: { decisionId: decision.id, choice, actor: "human" }
          });
          void replanSubtree(run.runId, failedTaskId, reason).catch(() => undefined);
          return NextResponse.json({ ...toRunResponse(run), decisionId: decision.id, choice });
        }

        const resumeDecision = decisionFromAnswer(run.pendingDecision.gate, choice.answer);
        if (resumeDecision === null) {
          throw new RunValidationError(
            `"${choice.answer}" is not a valid option for the ${run.pendingDecision.gate} gate.`
          );
        }
        run = await clearExecutionPause(run.runId, "running", expectedGateId);
        publishRunModelEvent(run.runId, {
          actor: "human",
          at: now,
          type: "decision.resolved",
          payload: { decisionId: decision.id, choice, actor: "human" }
        });
        void resumeExecutionPipeline(run.runId, resumeDecision).catch(() => undefined);
        return NextResponse.json({ ...toRunResponse(run), decisionId: decision.id, choice });
      }

      const nodeId = decision.context.nodeIds?.[0];
      if (nodeId === undefined) {
        throw new RunValidationError("Node ID does not match the pending question");
      }
      // Atomic claim (INV-4): the pending question must still match `nodeId`
      // inside the write lock; the mutator consumes it, so a duplicate answer
      // gets a deterministic 409.
      const answer = choice.answer;
      run = await claimRunMutation(
        run.runId,
        { status: ["paused"], pausedDuring: "generating", pendingQuestionNodeId: nodeId },
        (current) => {
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
      publishRunEvent(run.runId, { kind: "status.changed", status: run.status, at: now });
      // Native resume into the suspended planning questionGate.
      void resumePlanningPipeline(run.runId, { answer }).catch(() => undefined);
    }

    publishRunModelEvent(run.runId, {
      actor: "human",
      at: now,
      type: "decision.resolved",
      payload: { decisionId: decision.id, choice, actor: "human" }
    });

    if (decision.kind === "resolve_conflict" && decision.context.conflictId !== undefined && "resolutionId" in choice) {
      publishRunModelEvent(run.runId, {
        actor: "human",
        at: now,
        type: "conflict.resolved",
        payload: { conflictId: decision.context.conflictId, by: "human", resolutionId: choice.resolutionId }
      });
    }

    if (
      decision.kind === "approve_amendment" &&
      decision.context.amendmentId !== undefined &&
      "action" in choice &&
      choice.action === "approve"
    ) {
      publishRunModelEvent(run.runId, {
        actor: "human",
        at: now,
        type: "amendment.applied",
        payload: { amendmentId: decision.context.amendmentId }
      });

      const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
      const amendment = model.amendments.get(decision.context.amendmentId);
      const seamId = amendment?.detail?.seamId || decision.context.amendmentId;

      const amendmentsEngine = new AmendmentsEngine();
      const graph = await resolveExecutionGraph(run);
      const existing = executionResultsFromRun(run);
      const provisioned = provisionedFromRecord(run.provisioned);

      if (provisioned !== undefined) {
        const invalidation = await amendmentsEngine.amendSeam({
          repoRoot: provisioned.repoRoot,
          runId: run.runId,
          graph,
          seamId,
          leafResults: existing.leafResults,
          integrationResults: existing.integrationResults
        });

        const totalDurationMs =
          invalidation.leafResults.reduce((sum, r) => sum + r.executorDurationMs, 0) +
          invalidation.integrationResults.reduce((sum, r) => sum + integrationDurationMs(r), 0);

        const updatedExecution: RunExecutionResult = {
          runId: run.runId,
          status: "failed",
          leafResults: invalidation.leafResults,
          integrationResults: invalidation.integrationResults,
          totalDurationMs,
          granularityVector: computeGranularityVector({
            graph,
            leafResults: invalidation.leafResults,
            integrationResults: invalidation.integrationResults,
            totalDurationMs
          })
        };

        // Restart the execution thread from scratch; the pipeline seeds the
        // surviving (non-invalidated) results from the filtered artifact, so
        // only the invalidated closure re-enters the frontier.
        await resetExecutionThread(run.runId);

        // Version-CAS (INV-4): `run.version` is the snapshot this amendment was
        // computed against. A concurrent duplicate approval bumped it with its
        // own save, so the loser 409s instead of double-seeding the pipeline.
        run = await claimRunMutation(run.runId, { version: run.version }, (current) => ({
          ...current,
          execution: updatedExecution,
          status: "running" as const
        }));

        void runExecutionPipeline(run.runId).catch(() => undefined);
      }
    }

    return NextResponse.json({ ...toRunResponse(run), decisionId: decision.id, choice });
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
  if (explicit !== null) return explicit;
  if (body.answer !== undefined) return { answer: body.answer };
  if (body.resolutionId !== undefined) return { resolutionId: body.resolutionId };
  if (body.action !== undefined) return { action: body.action };

  switch (decision.kind) {
    case "clarify": {
      const answer = decision.context.options?.[0];
      if (answer === undefined) throw new RunValidationError("clarify requires an answer");
      return { answer };
    }
    case "resolve_conflict":
      return { resolutionId: "human-selected" };
    case "approve_merge":
      return { action: "accept" };
    case "approve_plan":
    case "approve_amendment":
    default:
      return { action: "approve" };
  }
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

