"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { RunSnapshot } from "@manyhands/core";
import type { RunExecutionResult } from "@manyhands/execution-core";
import {
  buildInspectorView,
  type RunGraphViewModel
} from "@/lib/graph-view-model";
import type { RunStatusKey } from "@/lib/api-types";
import type { ConflictListItem } from "@/lib/conflict-view-model";
import type { TimelineRunInput } from "@/lib/run-timeline";
import {
  EMPTY_FILTERS,
  filtersAreEmpty,
  visibleNodeIds,
  type GraphFilterState
} from "@/lib/graph-filters";
import { selectionRelations } from "@/lib/run-presentation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { derivePhase } from "@/lib/run-phase";
import { buildRunSummary } from "@/lib/run-summary";
import { RunSummaryPanel } from "./RunSummaryPanel";
import { DagCanvas } from "./DagCanvas";
import { GraphToolbar } from "./GraphToolbar";
import { MethodologyBanner } from "./MethodologyBanner";
import { RiskLegend } from "./RiskLegend";
import { RunBoard } from "./run-board.client";
import { RunPhaseBar } from "./RunPhaseBar";
import { TaskInspector } from "./TaskInspector";
import { ConflictBottomSheet } from "./conflict-bottom-sheet.client";
import { RunTimeline } from "./run-timeline.client";

type ViewMode = "canvas" | "timeline" | "board";

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: "canvas", label: "canvas" },
  { value: "timeline", label: "timeline" },
  { value: "board", label: "board" }
];

interface DagWorkspaceProps {
  snapshot: RunSnapshot;
  graph: RunGraphViewModel;
  benchmarkLabel: string;
  configLabel: string;
  mode?: "Replay" | "Lab" | "Build";
  /** When false, the deterministic-mock methodology banner is omitted (e.g. real persisted runs). */
  showMethodologyBanner?: boolean;
  /** Optional banner / lifecycle hint shown above the toolbar (persisted runs render `RunHeader` here). */
  headerSlot?: ReactNode;
  /** Optional action bar shown above the canvas (Approve / Run / Pause CTAs). */
  actionSlot?: ReactNode;
  /** Live run status for persisted runs — drives the phase-aware chrome. */
  runStatus?: RunStatusKey;
  editableRunId?: string;
  onEdited?: () => void;
  patches?: readonly unknown[];
  timelineRun?: TimelineRunInput;
  conflicts?: ConflictListItem[];
  conflictError?: string;
  /** Real execution-core result; when present the summary shows real evidence. */
  execution?: RunExecutionResult;
}

export function DagWorkspace({
  snapshot,
  graph,
  benchmarkLabel,
  configLabel,
  mode = "Replay",
  showMethodologyBanner = true,
  headerSlot,
  actionSlot,
  runStatus,
  editableRunId,
  onEdited,
  patches = [],
  timelineRun,
  conflicts = [],
  conflictError,
  execution
}: DagWorkspaceProps): React.ReactElement {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [highlightTaskIds, setHighlightTaskIds] = useState<ReadonlySet<string> | null>(null);
  const [filters, setFilters] = useState<GraphFilterState>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>("canvas");

  const inspector = useMemo(() => {
    if (selectedTaskId === null) {
      return null;
    }
    return buildInspectorView(snapshot, selectedTaskId);
  }, [snapshot, selectedTaskId]);

  const isFiltered = !filtersAreEmpty(filters);
  const matched = useMemo(
    () => (isFiltered ? visibleNodeIds(graph.nodes, filters) : null),
    [graph.nodes, filters, isFiltered]
  );
  const relations = useMemo(() => selectionRelations(graph, selectedTaskId), [graph, selectedTaskId]);
  const canvasHighlights = highlightTaskIds ?? relations?.related ?? matched;

  const phase = runStatus !== undefined ? derivePhase(runStatus, graph) : undefined;
  const summary = useMemo(
    () => (phase === "done" ? buildRunSummary(snapshot, execution) : null),
    [phase, snapshot, execution]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showMethodologyBanner ? <MethodologyBanner /> : null}
      {headerSlot}
      {runStatus !== undefined ? <RunPhaseBar status={runStatus} graph={graph} /> : null}
      <GraphToolbar
        graph={graph}
        benchmarkLabel={benchmarkLabel}
        configLabel={configLabel}
        mode={mode}
        filters={filters}
        onFiltersChange={setFilters}
        matchedCount={matched?.size ?? graph.summary.taskCount}
      />
      {actionSlot}
      <SegmentedControl
        ariaLabel="Run view"
        options={VIEW_OPTIONS}
        value={viewMode}
        onChange={setViewMode}
      />
      {viewMode === "timeline" && timelineRun !== undefined ? (
        <RunTimeline
          run={timelineRun}
          snapshot={snapshot}
          patches={patches}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      ) : viewMode === "board" ? (
        <RunBoard
          graph={graph}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      ) : (
      <div className="dag-workspace-shell" style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        <div
          className="mh-tick-frame dag-canvas-frame"
          style={{
            position: "relative",
            flex: "1 1 0",
            minWidth: 0,
            height: "min(820px, calc(100vh - 280px))",
            minHeight: 680,
            border: "1px solid var(--rule)",
            background: "var(--bg)",
            borderRadius: "var(--r-lg)",
            overflow: "hidden",
            boxShadow: "none"
          }}
        >
          <ReactFlowProvider>
            <DagCanvas
              graph={graph}
              selectedTaskId={selectedTaskId}
              highlightTaskIds={canvasHighlights}
              selectionRelations={relations}
              onSelectTask={(taskId) => {
                setSelectedTaskId(taskId);
                if (taskId === null) {
                  setHighlightTaskIds(null);
                }
              }}
            />
          </ReactFlowProvider>
          <RiskLegend graph={graph} />
          {editableRunId !== undefined ? (
            <ConflictBottomSheet
              runId={editableRunId}
              conflicts={conflicts}
              {...(conflictError !== undefined ? { error: conflictError } : {})}
              onChanged={() => onEdited?.()}
              onOpenNodes={(taskIds) => {
                setSelectedTaskId(taskIds[0]);
                setHighlightTaskIds(new Set(taskIds));
              }}
            />
          ) : null}
        </div>
        <TaskInspector
          view={inspector}
          onClose={() => setSelectedTaskId(null)}
          {...(phase !== undefined ? { phase } : {})}
          {...(editableRunId !== undefined ? { editableRunId } : {})}
          {...(onEdited !== undefined ? { onEdited } : {})}
        />
      </div>
      )}
      {summary !== null ? <RunSummaryPanel summary={summary} /> : null}
    </div>
  );
}
