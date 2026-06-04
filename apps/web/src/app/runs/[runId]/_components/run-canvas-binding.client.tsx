"use client";

import type { RunSnapshot } from "@manyhands/core";
import type { RunExecutionResult } from "@manyhands/execution-core";
import { useRouter } from "next/navigation";
import type { RunStatusKey } from "@/lib/api-types";
import type { ConflictListItem } from "@/lib/conflict-view-model";
import type { RunFailurePhase } from "@/lib/run-phase";
import type { PlanReviewSummary } from "@/lib/plan-review";
import type { TimelineRunInput } from "@/lib/run-timeline";
import { RunCanvasShell, useLiveRun, type LivePlanNode } from "@/components/dag/RunCanvasShell";
import { RunActionBar } from "./run-action-bar.client";

interface RunCanvasBindingProps {
  runId: string;
  initialStatus: RunStatusKey;
  defaultModelId: string;
  snapshot: RunSnapshot | null;
  configLabel: string;
  readyTaskCount: number;
  activeConflictCount: number;
  planReview: PlanReviewSummary | null;
  headerSlot: React.ReactNode;
  patches: readonly unknown[];
  timelineRun: TimelineRunInput;
  conflicts: ConflictListItem[];
  conflictError?: string;
  execution?: RunExecutionResult;
  errorMessage?: string;
  failedPhase?: RunFailurePhase;
  initialPendingQuestion: { nodeId: string; question: string; options: string[] } | null;
  initialLivePlanNodes?: readonly LivePlanNode[];
}

export function RunCanvasBinding(props: RunCanvasBindingProps): React.ReactElement {
  const router = useRouter();
  const { status, visibleTaskIds, livePlanNodes, pendingQuestion, cliLogs, nodeStatusOverrides } = useLiveRun(
    props.runId,
    props.initialStatus,
    props.initialPendingQuestion,
    props.initialLivePlanNodes
  );

  return (
    <RunCanvasShell
      source={{ kind: "persisted-run", runId: props.runId, initialStatus: status }}
      snapshot={props.snapshot}
      configLabel={props.configLabel}
      mode="Run"
      showMethodologyBanner={false}
      headerSlot={props.headerSlot}
      editableRunId={props.runId}
      defaultModelId={props.defaultModelId}
      onEdited={() => router.refresh()}
      patches={props.patches}
      timelineRun={props.timelineRun}
      conflicts={props.conflicts}
      {...(props.conflictError !== undefined ? { conflictError: props.conflictError } : {})}
      {...(props.execution !== undefined ? { execution: props.execution } : {})}
      {...(props.errorMessage !== undefined ? { errorMessage: props.errorMessage } : {})}
      {...(props.failedPhase !== undefined ? { failedPhase: props.failedPhase } : {})}
      actionSlot={
        <RunActionBar
          runId={props.runId}
          status={status}
          readyTaskCount={props.readyTaskCount}
          activeConflictCount={props.activeConflictCount}
          planReview={props.planReview}
        />
      }
      visibleTaskIds={visibleTaskIds}
      livePlanNodes={livePlanNodes}
      pendingQuestion={pendingQuestion}
      cliLogs={cliLogs}
      nodeStatusOverrides={nodeStatusOverrides}
    />
  );
}
