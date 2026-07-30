import { NextResponse } from "next/server";
import { z } from "zod";

import { RunValidationError } from "@/lib/server/runs/errors";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import {
  startRunBackgroundTask,
  startRunBackgroundTaskAfterCurrent
} from "@/lib/server/runs/runner-state";
import {
  loadRunProjectionV2,
  resolveDecisionV2
} from "@/lib/server/runs/v2/command-host";
import { approvePlanningV2Pipeline } from "@/lib/server/runs/v2/run-coordinator-host";
import { runPlanningV2Pipeline } from "@/lib/server/runs/v2/run-coordinator-host";
import { markRunFailedAfterBackgroundTask } from "@/lib/server/runs/v2/background-failure";
import {
  runDecisionContinuationV2Pipeline,
  startDecisionContinuationV2Pipeline,
  startExecutionV2Pipeline
} from "@/lib/server/runs/v2/execution-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DecisionRequestSchema = z.object({
  optionId: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  action: z.string().min(1).optional()
}).strict().refine((value) => value.optionId !== undefined || value.answer !== undefined || value.action !== undefined, {
  message: "A decision requires optionId, answer, or action."
});

interface RouteContext {
  params: Promise<{ id: string; decisionId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, decisionId } = await context.params;
  try {
    const parsed = DecisionRequestSchema.safeParse(await request.json());
    if (!parsed.success) throw new RunValidationError(parsed.error.issues[0]?.message ?? "Invalid decision request.");
    const state = await loadRunProjectionV2(id);
    const decision = state.decisions[decisionId];
    if (decision === undefined) throw new RunValidationError(`Decision ${decisionId} does not exist.`);

    const optionId = parsed.data.optionId ?? parsed.data.action;
    if (decision.kind === "approve_plan") {
      if (optionId !== "approve") throw new RunValidationError("Plan revision requests are not yet represented by this command; approve the plan or create a revised run.");
      if (state.graphRevision === undefined) throw new RunValidationError("The run has no graph revision to approve.");
      let run = await approvePlanningV2Pipeline(id, state.graphRevision);
      run = await startExecutionV2Pipeline(id, "route:decision:execution-v2");
      return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId, optionId });
    }

    if (decision.kind === "clarify_goal") {
      const resolved = await resolveDecisionV2(id, decisionId, {
        ...(optionId !== undefined ? { optionId } : {}),
        ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {})
      });
      const hasPendingClarification = Object.values(resolved.state.decisions)
        .some((candidate) => candidate.kind === "clarify_goal" && candidate.status === "pending");
      if (!hasPendingClarification) {
        startRunBackgroundTask(
          id,
          "route:decision:replan-v2",
          () => runPlanningV2Pipeline(id),
          (error) => markRunFailedAfterBackgroundTask(id, error, "domain")
        );
      }
      return NextResponse.json({
        ...(await toCanonicalRunResponse(resolved.run)),
        decisionId,
        ...(optionId !== undefined ? { optionId } : {}),
        ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {})
      });
    }

    const resolved = await resolveDecisionV2(id, decisionId, {
      ...(optionId !== undefined ? { optionId } : {}),
      ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {})
    });
    let run = resolved.run;
    if (resolved.state.lifecycle !== "failed") {
      if (resolved.run.activeOperation?.kind === "execution") {
        startRunBackgroundTaskAfterCurrent(
          id,
          "route:decision:resume-execution-v2",
          () => runDecisionContinuationV2Pipeline(id),
          (error) => markRunFailedAfterBackgroundTask(id, error, "execution")
        );
      } else {
        run = await startDecisionContinuationV2Pipeline(
          id,
          "route:decision:resume-execution-v2"
        );
      }
    }
    return NextResponse.json({ ...(await toCanonicalRunResponse(run)), decisionId, ...(optionId !== undefined ? { optionId } : {}), ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {}) });
  } catch (error) {
    return runErrorResponse(error);
  }
}
