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
import { StatusBadge } from "@/components/ui/status-badge";
import { derivePhase } from "@/lib/run-phase";
import { buildRunSummary } from "@/lib/run-summary";
import { runUiStatus } from "@/lib/status";
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

type ViewMode = "overview" | "canvas" | "timeline" | "board";

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: "overview", label: "overview" },
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
  errorMessage?: string;
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
  errorMessage,
  execution
}: DagWorkspaceProps): React.ReactElement {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [highlightTaskIds, setHighlightTaskIds] = useState<ReadonlySet<string> | null>(null);
  const [filters, setFilters] = useState<GraphFilterState>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>(runStatus !== undefined ? "overview" : "canvas");

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
      {viewMode === "overview" ? (
        <RunOverviewPanel
          graph={graph}
          status={runStatus}
          summary={summary}
          conflicts={conflicts}
          conflictError={conflictError}
          errorMessage={errorMessage}
        />
      ) : viewMode === "timeline" && timelineRun !== undefined ? (
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
            // Explicit width so React Flow's first measurement never sees a 0-width
            // flex container (the "parent container needs a width and a height"
            // warning); flex-basis: 0 still drives the actual sizing in the row.
            width: "100%",
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
      {summary !== null && viewMode !== "overview" ? <RunSummaryPanel summary={summary} /> : null}
    </div>
  );
}

function RunOverviewPanel({
  graph,
  status,
  summary,
  conflicts,
  conflictError,
  errorMessage
}: {
  graph: RunGraphViewModel;
  status: RunStatusKey | undefined;
  summary: ReturnType<typeof buildRunSummary> | null;
  conflicts: ConflictListItem[];
  conflictError: string | undefined;
  errorMessage: string | undefined;
}): React.ReactElement {
  const highRisk = graph.nodes.filter((node) => node.riskLevel === "high" || node.riskLevel === "blocking").length;
  const ready = graph.status.ready + graph.status.approved;
  const failed = graph.status.failed;
  const activeConflicts = conflicts.filter((conflict) => !conflict.acknowledged).length;
  const nextAction = nextActionForStatus(status, ready, activeConflicts);
  const hasIncident = status === "failed" || status === "interrupted" || failed > 0 || activeConflicts > 0 || errorMessage !== undefined;

  return (
    <section
      className="mh-tick-frame"
      style={{
        border: `1px solid ${hasIncident ? "var(--status-failed-border)" : "var(--rule)"}`,
        background: hasIncident ? "var(--status-failed-bg)" : "rgba(24,26,28,0.74)",
        borderRadius: "var(--r-lg)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 18
      }}
    >
      <div style={{ display: "flex", gap: 18, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: "1 1 420px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="mh-coord" style={{ color: hasIncident ? "var(--status-failed-fg)" : "var(--copper-hi)" }}>
              run overview
            </span>
            {status !== undefined ? <StatusBadge status={runUiStatus(status)} label={status.replace("_", " ")} /> : null}
          </div>
          <h2 className="mh-serif" style={{ margin: 0, color: "var(--text)", fontSize: 28, lineHeight: 1.12 }}>
            {hasIncident ? "Attention needed before this run can move forward." : "Run is ready for the next operational step."}
          </h2>
          <p style={{ margin: "10px 0 0", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, maxWidth: 760 }}>
            {nextAction}
          </p>
        </div>

        <div
          style={{
            border: "1px solid var(--rule-control)",
            background: "rgba(15,16,18,0.46)",
            borderRadius: "var(--r-md)",
            padding: "12px 14px",
            minWidth: 240
          }}
        >
          <div className="mh-coord" style={{ color: "var(--text-2)", marginBottom: 8 }}>
            next action
          </div>
          <div style={{ color: hasIncident ? "var(--status-failed-fg)" : "var(--copper-hi)", fontWeight: 700, fontSize: 14, lineHeight: 1.4 }}>
            {shortNextAction(status)}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <OverviewMetric label="nodes" value={graph.summary.taskCount} />
        <OverviewMetric label="ready" value={ready} tone="ready" />
        <OverviewMetric label="high risk" value={highRisk} tone={highRisk > 0 ? "failed" : undefined} />
        <OverviewMetric label="conflicts" value={activeConflicts} tone={activeConflicts > 0 ? "failed" : undefined} />
      </div>

      {errorMessage !== undefined && errorMessage.length > 0 ? (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            border: "1px solid var(--status-failed-border)",
            background: "rgba(0,0,0,0.30)",
            color: "var(--text)",
            borderRadius: "var(--r-md)",
            padding: "12px 14px",
            maxHeight: 220,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.55
          }}
        >
          {errorMessage}
        </pre>
      ) : null}

      {conflictError !== undefined ? (
        <div
          role="alert"
          style={{
            border: "1px solid var(--status-failed-border)",
            background: "rgba(0,0,0,0.24)",
            color: "var(--status-failed-fg)",
            borderRadius: "var(--r-md)",
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.45
          }}
        >
          {conflictError}
        </div>
      ) : null}

      {summary !== null ? <RunSummaryPanel summary={summary} /> : null}
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: "ready" | "failed" | undefined;
}): React.ReactElement {
  const color =
    tone === "ready" ? "var(--status-ready-fg)" : tone === "failed" ? "var(--status-failed-fg)" : "var(--text)";
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "rgba(15,16,18,0.40)",
        borderRadius: "var(--r-md)",
        padding: "11px 12px"
      }}
    >
      <div className="mh-mono" style={{ color, fontSize: 24, lineHeight: 1 }}>
        {value}
      </div>
      <div className="mh-coord" style={{ marginTop: 7 }}>
        {label}
      </div>
    </div>
  );
}

function nextActionForStatus(status: RunStatusKey | undefined, ready: number, conflicts: number): string {
  if (conflicts > 0) {
    return "Resolve active conflicts first, then return to the graph or board view to inspect the affected nodes.";
  }
  switch (status) {
    case "failed":
      return "Restart the run or inspect the failed node evidence before approving another execution pass.";
    case "interrupted":
      return "Resume or restart execution after reviewing the last recorded event.";
    case "needs_review":
      return "Review contracts, scopes and high-risk nodes. Approve the plan only after the graph is coherent.";
    case "approved":
      return ready > 0 ? `Run the ${ready} ready ${ready === 1 ? "node" : "nodes"}.` : "No node is ready yet; inspect blockers and dependencies.";
    case "running":
    case "paused":
      return "Monitor execution progress and pause only if the trace shows a blocking problem.";
    case "completed":
      return "Review output evidence and integration metrics before considering the run complete.";
    case "generating":
    case "created":
      return "Wait for the planner to finish building the task graph.";
    default:
      return "Use the graph, board and timeline views to inspect operational evidence.";
  }
}

function shortNextAction(status: RunStatusKey | undefined): string {
  switch (status) {
    case "failed":
    case "interrupted":
      return "Restart or inspect failure";
    case "needs_review":
      return "Review plan";
    case "approved":
      return "Run ready nodes";
    case "running":
    case "paused":
      return "Monitor execution";
    case "completed":
      return "Review outputs";
    case "generating":
    case "created":
      return "Wait for planning";
    default:
      return "Inspect graph";
  }
}
