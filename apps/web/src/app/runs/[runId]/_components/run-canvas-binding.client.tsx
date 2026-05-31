"use client";

import type { RunSnapshot } from "@manyhands/core";
import type { RunExecutionResult } from "@manyhands/execution-core";
import { useRouter } from "next/navigation";
import type { RunStatusKey } from "@/lib/api-types";
import type { ConflictListItem } from "@/lib/conflict-view-model";
import type { TimelineRunInput } from "@/lib/run-timeline";
import { RunCanvasShell, useLiveRun } from "@/components/dag/RunCanvasShell";
import { RunActionBar } from "./run-action-bar.client";

interface RunCanvasBindingProps {
  runId: string;
  initialStatus: RunStatusKey;
  snapshot: RunSnapshot | null;
  benchmarkLabel: string;
  configLabel: string;
  readyTaskCount: number;
  headerSlot: React.ReactNode;
  patches: readonly unknown[];
  timelineRun: TimelineRunInput;
  conflicts: ConflictListItem[];
  conflictError?: string;
  execution?: RunExecutionResult;
  errorMessage?: string;
}

export function RunCanvasBinding(props: RunCanvasBindingProps): React.ReactElement {
  const router = useRouter();
  const { status, visibleTaskIds, livePlanNodes } = useLiveRun(props.runId, props.initialStatus);

  return (
    <RunCanvasShell
      source={{ kind: "persisted-run", runId: props.runId, initialStatus: status }}
      snapshot={props.snapshot}
      benchmarkLabel={props.benchmarkLabel}
      configLabel={props.configLabel}
      mode="Build"
      showMethodologyBanner={false}
      headerSlot={props.headerSlot}
      editableRunId={props.runId}
      onEdited={() => router.refresh()}
      patches={props.patches}
      timelineRun={props.timelineRun}
      conflicts={props.conflicts}
      {...(props.conflictError !== undefined ? { conflictError: props.conflictError } : {})}
      {...(props.execution !== undefined ? { execution: props.execution } : {})}
      {...(props.errorMessage !== undefined ? { errorMessage: props.errorMessage } : {})}
      actionSlot={
        <RunActionBar
          runId={props.runId}
          status={status}
          readyTaskCount={props.readyTaskCount}
        />
      }
      visibleTaskIds={visibleTaskIds}
      livePlanNodes={livePlanNodes}
    />
  );
}
