"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { RunSnapshot } from "@manyhands/core";
import {
  buildInspectorView,
  type RunGraphViewModel
} from "@/lib/graph-view-model";
import type { ConflictListItem } from "@/lib/conflict-view-model";
import type { TimelineRunInput } from "@/lib/run-timeline";
import {
  EMPTY_FILTERS,
  filtersAreEmpty,
  visibleNodeIds,
  type GraphFilterState
} from "@/lib/graph-filters";
import { DagCanvas } from "./DagCanvas";
import { GraphToolbar } from "./GraphToolbar";
import { MethodologyBanner } from "./MethodologyBanner";
import { RiskLegend } from "./RiskLegend";
import { RunBoard } from "./run-board.client";
import { TaskInspector } from "./TaskInspector";
import { ConflictBottomSheet } from "./conflict-bottom-sheet.client";
import { RunTimeline } from "./run-timeline.client";

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
  editableRunId?: string;
  onEdited?: () => void;
  patches?: readonly unknown[];
  timelineRun?: TimelineRunInput;
  conflicts?: ConflictListItem[];
  conflictError?: string;
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
  editableRunId,
  onEdited,
  patches = [],
  timelineRun,
  conflicts = [],
  conflictError
}: DagWorkspaceProps): React.ReactElement {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [highlightTaskIds, setHighlightTaskIds] = useState<ReadonlySet<string> | null>(null);
  const [filters, setFilters] = useState<GraphFilterState>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<"canvas" | "timeline" | "board">("canvas");

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
  const canvasHighlights = highlightTaskIds ?? matched;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showMethodologyBanner ? <MethodologyBanner /> : null}
      {headerSlot}
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
      <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
      {viewMode === "timeline" && timelineRun !== undefined ? (
        <RunTimeline run={timelineRun} snapshot={snapshot} patches={patches} />
      ) : viewMode === "board" ? (
        <RunBoard
          graph={graph}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      ) : (
      <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        <div
          className="mh-tick-frame"
          style={{
            position: "relative",
            flex: "1 1 0",
            minWidth: 0,
            height: 760,
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
          {...(editableRunId !== undefined ? { editableRunId } : {})}
          {...(onEdited !== undefined ? { onEdited } : {})}
        />
      </div>
      )}
    </div>
  );
}

function ViewToggle({
  viewMode,
  onViewModeChange
}: {
  viewMode: "canvas" | "timeline" | "board";
  onViewModeChange: (mode: "canvas" | "timeline" | "board") => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Run view"
      style={{
        alignSelf: "flex-start",
        display: "inline-flex",
        border: "1px solid var(--rule)",
        background: "transparent",
        borderRadius: 6,
        padding: 2
      }}
    >
      {(["canvas", "timeline", "board"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={viewMode === mode}
          onClick={() => onViewModeChange(mode)}
          style={{
            border: "none",
            background: viewMode === mode ? "rgba(229,222,204,0.06)" : "transparent",
            color: viewMode === mode ? "var(--text)" : "var(--text-2)",
            borderRadius: 4,
            padding: "6px 11px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            cursor: "pointer",
            textTransform: "capitalize"
          }}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
