"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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
  { value: "canvas", label: "graph" },
  { value: "board", label: "board" },
  { value: "timeline", label: "timeline" }
];

interface DagWorkspaceProps {
  snapshot: RunSnapshot;
  graph: RunGraphViewModel;
  benchmarkLabel: string;
  configLabel: string;
  mode?: "Replay" | "Lab" | "Run";
  showMethodologyBanner?: boolean;
  headerSlot?: ReactNode;
  actionSlot?: ReactNode;
  runStatus?: RunStatusKey;
  editableRunId?: string;
  defaultModelId?: string;
  onEdited?: () => void;
  patches?: readonly unknown[];
  timelineRun?: TimelineRunInput;
  conflicts?: ConflictListItem[];
  conflictError?: string;
  errorMessage?: string;
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
  defaultModelId = "gemini-2.5-pro",
  onEdited,
  patches = [],
  timelineRun,
  conflicts = [],
  conflictError,
  errorMessage: _errorMessage,
  execution
}: DagWorkspaceProps): React.ReactElement {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [highlightTaskIds, setHighlightTaskIds] = useState<ReadonlySet<string> | null>(null);
  const [filters, setFilters] = useState<GraphFilterState>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>("canvas");
  const canvasFrameRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    const el = canvasFrameRef.current;
    if (el === null) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

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
        <div className="dag-workspace-shell" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            ref={canvasFrameRef}
            className="mh-tick-frame dag-canvas-frame"
            style={{
              position: "relative",
              width: "100%",
              height: "min(920px, calc(100vh - 200px))",
              minHeight: 740,
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
                onToggleFullscreen={toggleFullscreen}
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
            defaultModelId={defaultModelId}
            {...(onEdited !== undefined ? { onEdited } : {})}
            availableNodes={graph.nodes.map((node) => ({ id: node.id, title: node.title }))}
            dependencyEdges={graph.edges
              .filter((edge) => edge.kind === "dependency")
              .map((edge) => ({
                source: edge.source,
                target: edge.target,
                ...(edge.label !== undefined ? { label: edge.label } : {})
              }))}
          />
        </div>
      )}
      {editableRunId !== undefined && viewMode !== "canvas" ? (
        <ConflictBottomSheet
          runId={editableRunId}
          conflicts={conflicts}
          {...(conflictError !== undefined ? { error: conflictError } : {})}
          showTrigger={false}
          onChanged={() => onEdited?.()}
          onOpenNodes={(taskIds) => {
            setViewMode("canvas");
            setSelectedTaskId(taskIds[0]);
            setHighlightTaskIds(new Set(taskIds));
          }}
        />
      ) : null}
      {summary !== null ? <RunSummaryPanel summary={summary} /> : null}
    </div>
  );
}
