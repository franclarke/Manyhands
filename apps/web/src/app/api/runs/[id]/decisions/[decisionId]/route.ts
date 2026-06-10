import { NextResponse } from "next/server";
import { z } from "zod";
import { AmendmentsEngine, type RunExecutionResult, computeGranularityVector } from "@manyhands/execution-core";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import type { Decision, DecisionChoice, RunEvent } from "@/lib/run-model/types";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  ensureRunModelEventLogForRun,
  getRunRepository,
  parseRunPatches,
  publishRunEvent,
  publishRunModelEvent,
  hasPlanningCheckpoint,
  resumeExecutionPipeline,
  resumePlanningPipeline,
  runExecutionPipeline
} from "@/lib/server/runs";
import {
  clearExecutionPause,
  decisionFromAnswer,
  resetExecutionThread
} from "@/lib/server/runs/execution-host";
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
    if (error instanceof RunValidationError) return errorResponse(error);
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
      if (body.acknowledgeCriticErrors !== true) {
        const summary = buildPlanReviewSummary(projectRunRecordToSnapshot(run), parseRunPatches(run.patches));
        if (summary !== null && summary.issueCounts.errors > 0) {
          const detail = summary.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.title)
            .join(", ");
          throw new RunLifecycleError(
            `Plan has ${summary.issueCounts.errors} blocking error(s): ${detail}. ` +
              "Resolve them, or approve explicitly from the plan review gate."
          );
        }
      }
      assertTransition(run.status, "approved");
      if (await hasPlanningCheckpoint(run.runId)) {
        // Native approval: Command({ resume: { action: "approve" } }) into the
        // suspended approvalGate; the pipeline projects "approved".
        await resumePlanningPipeline(run.runId, { action: "approve" });
        run = await repo.get(run.runId);
      } else {
        run = await repo.save({ ...run, status: "approved", approvedAt: now });
        publishRunEvent(run.runId, { kind: "status.changed", status: run.status, at: now });
      }
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
        const resumeDecision = decisionFromAnswer(run.pendingDecision.gate, choice.answer);
        if (resumeDecision === null) {
          throw new RunValidationError(
            `"${choice.answer}" is not a valid option for the ${run.pendingDecision.gate} gate.`
          );
        }
        run = await clearExecutionPause(run.runId, "running");
        publishRunModelEvent(run.runId, {
          actor: "human",
          at: now,
          type: "decision.resolved",
          payload: { decisionId: decision.id, choice, actor: "human" }
        });
        void resumeExecutionPipeline(run.runId, resumeDecision).catch(() => undefined);
        return NextResponse.json({ ...toRunResponse(run), decisionId: decision.id, choice });
      }

      if (run.status !== "paused" || run.pausedDuring !== "generating" || !run.pendingQuestion) {
        throw new RunLifecycleError("Run is not currently waiting for a planning question response");
      }
      const nodeId = decision.context.nodeIds?.[0];
      if (nodeId === undefined || run.pendingQuestion.nodeId !== nodeId) {
        throw new RunValidationError("Node ID does not match the pending question");
      }

      const nextRun = {
        ...run,
        status: "generating" as const,
        questionAnswers: { ...(run.questionAnswers ?? {}), [nodeId]: choice.answer }
      } as typeof run;
      delete nextRun.pausedDuring;
      delete nextRun.pendingQuestion;
      run = await repo.save(nextRun);
      publishRunEvent(run.runId, { kind: "status.changed", status: run.status, at: now });
      // Native resume into the suspended planning questionGate.
      void resumePlanningPipeline(run.runId, { answer: choice.answer }).catch(() => undefined);
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

        run = await repo.save({
          ...run,
          execution: updatedExecution,
          status: "running"
        });

        void runExecutionPipeline(run.runId).catch(() => undefined);
      }
    }

    return NextResponse.json({ ...toRunResponse(run), decisionId: decision.id, choice });
  } catch (error) {
    return errorResponse(error);
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

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
