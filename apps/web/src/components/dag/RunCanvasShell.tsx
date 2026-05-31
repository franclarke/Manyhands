"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { RunSnapshot } from "@manyhands/core";
import type { RunExecutionResult } from "@manyhands/execution-core";
import type { RunStatusKey } from "@/lib/api-types";
import type { RunGraphViewModel } from "@/lib/graph-view-model";
import { toRunGraphViewModel } from "@/lib/graph-view-model";
import type { ConflictListItem } from "@/lib/conflict-view-model";
import type { TimelineRunInput } from "@/lib/run-timeline";
import { DagWorkspace } from "./DagWorkspace";

export type RunCanvasSource =
  | { kind: "deterministic-replay" }
  | { kind: "persisted-run"; runId: string; initialStatus: RunStatusKey };

interface RunCanvasShellProps {
  source: RunCanvasSource;
  snapshot: RunSnapshot | null;
  benchmarkLabel: string;
  configLabel: string;
  mode?: "Replay" | "Lab" | "Build";
  showMethodologyBanner?: boolean;
  headerSlot?: ReactNode;
  actionSlot?: ReactNode;
  editableRunId?: string;
  onEdited?: () => void;
  patches?: readonly unknown[];
  timelineRun?: TimelineRunInput;
  conflicts?: ConflictListItem[];
  conflictError?: string;
  /** Real execution-core result (persisted runs); drives the evidence summary. */
  execution?: RunExecutionResult;
  /** When the persisted run is still generating, only nodes whose IDs appear in
   *  the cumulative SSE event log are shown. */
  visibleTaskIds?: ReadonlySet<string> | null;
  /** Draft recursive-planning nodes emitted before the final snapshot exists. */
  livePlanNodes?: readonly LivePlanNode[];
  /** Set when the run failed; shown prominently in the null-graph fallback area. */
  errorMessage?: string;
}

export interface LivePlanNode {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  state: "active" | "complete";
  decision?: "atomic" | "decompose";
  childCount?: number;
}

export function RunCanvasShell(props: RunCanvasShellProps): React.ReactElement {
  const { snapshot, source, visibleTaskIds } = props;
  const { graph, derivedSnapshot } = useMemo(() => {
    if (snapshot === null) {
      return { graph: null, derivedSnapshot: null };
    }
    const fullGraph = toRunGraphViewModel(snapshot);
    if (visibleTaskIds === null || visibleTaskIds === undefined) {
      return { graph: fullGraph, derivedSnapshot: snapshot };
    }
    const filteredNodes = fullGraph.nodes.filter((node) => visibleTaskIds.has(node.id));
    const filteredEdges = fullGraph.edges.filter(
      (edge) => visibleTaskIds.has(edge.source) && visibleTaskIds.has(edge.target)
    );
    const partial: RunGraphViewModel = {
      ...fullGraph,
      nodes: filteredNodes,
      edges: filteredEdges,
      summary: {
        ...fullGraph.summary,
        taskCount: filteredNodes.length,
        dependencyCount: filteredEdges.filter((edge) => edge.kind === "dependency").length,
        riskCount: filteredEdges.filter((edge) => edge.kind === "risk").length
      }
    };
    return { graph: partial, derivedSnapshot: snapshot };
  }, [snapshot, visibleTaskIds]);

  if (graph === null || derivedSnapshot === null) {
    const isFailed = source.kind === "persisted-run" && source.initialStatus === "failed";
    const isGenerating = source.kind === "persisted-run" && source.initialStatus === "generating";
    const isCreated = source.kind === "persisted-run" && source.initialStatus === "created";
    const livePlanNodes = props.livePlanNodes ?? [];
    const statusMessage = isGenerating
      ? "Esperando descomposición…"
      : isCreated
        ? "Inicializando run…"
        : isFailed
          ? "La generación del plan falló."
          : "No hay snapshot disponible todavía.";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {props.headerSlot != null ? props.headerSlot : null}
        <div
          style={{
            padding: 36,
            border: `1px ${isFailed ? "solid" : "dashed"} ${isFailed ? "var(--error, #c25b54)" : "var(--border)"}`,
            background: isFailed ? "rgba(194,91,84,0.06)" : "var(--bg-1)",
            borderRadius: "var(--r-lg)",
            color: isFailed ? "var(--error, #c25b54)" : "var(--text-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-start"
          }}
        >
          <span>{statusMessage}</span>
          {isFailed && props.errorMessage != null && props.errorMessage.length > 0 ? (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 11,
                color: "var(--text-2)",
                background: "rgba(0,0,0,0.25)",
                borderRadius: "var(--r-md)",
                padding: "10px 14px",
                maxHeight: 260,
                overflowY: "auto",
                width: "100%",
                boxSizing: "border-box"
              }}
            >
              {props.errorMessage}
            </pre>
          ) : null}
          {livePlanNodes.length > 0 ? <LivePlanningTree nodes={livePlanNodes} /> : null}
        </div>
      </div>
    );
  }

  const showMethodologyBanner = props.showMethodologyBanner ?? source.kind === "deterministic-replay";

  return (
    <DagWorkspace
      snapshot={derivedSnapshot}
      graph={graph}
      benchmarkLabel={props.benchmarkLabel}
      configLabel={props.configLabel}
      mode={props.mode ?? "Replay"}
      showMethodologyBanner={showMethodologyBanner}
      headerSlot={props.headerSlot}
      actionSlot={props.actionSlot}
      {...(source.kind === "persisted-run" ? { runStatus: source.initialStatus } : {})}
      {...(props.editableRunId !== undefined ? { editableRunId: props.editableRunId } : {})}
      {...(props.onEdited !== undefined ? { onEdited: props.onEdited } : {})}
      patches={props.patches ?? []}
      {...(props.timelineRun !== undefined ? { timelineRun: props.timelineRun } : {})}
      conflicts={props.conflicts ?? []}
      {...(props.conflictError !== undefined ? { conflictError: props.conflictError } : {})}
      {...(props.execution !== undefined ? { execution: props.execution } : {})}
    />
  );
}

interface UseLiveRunResult {
  status: RunStatusKey;
  visibleTaskIds: ReadonlySet<string> | null;
  livePlanNodes: readonly LivePlanNode[];
}

const LIVE_REFRESH_MS = 5_000;

/**
 * Client hook that subscribes to a persisted run's SSE stream, accumulates
 * `node.added` events into a visibleTaskIds set, and triggers `router.refresh()`
 * whenever the status changes (so the server component re-fetches RunRecord).
 */
export function useLiveRun(runId: string, initialStatus: RunStatusKey): UseLiveRunResult {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatusKey>(initialStatus);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [livePlanNodes, setLivePlanNodes] = useState<Map<string, LivePlanNode>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setVisible(new Set());
    setLivePlanNodes(new Map());
  }, [runId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = `/api/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as {
          kind: string;
          status?: RunStatusKey;
          taskId?: string;
          nodeId?: string;
          parentId?: string;
          title?: string;
          depth?: number;
          decision?: "atomic" | "decompose";
          childIds?: string[];
        };
        if (event.kind === "node.added" && typeof event.taskId === "string") {
          const taskId = event.taskId;
          setVisible((current) => {
            if (current.has(taskId)) return current;
            const next = new Set(current);
            next.add(taskId);
            return next;
          });
        } else if (
          event.kind === "planning.node.started" &&
          typeof event.nodeId === "string" &&
          typeof event.title === "string" &&
          typeof event.depth === "number"
        ) {
          setLivePlanNodes((current) => {
            const next = new Map(current);
            next.set(event.nodeId!, {
              id: event.nodeId!,
              parentId: event.parentId ?? null,
              title: event.title!,
              depth: event.depth!,
              state: "active"
            });
            return next;
          });
        } else if (
          event.kind === "planning.node.completed" &&
          typeof event.nodeId === "string" &&
          (event.decision === "atomic" || event.decision === "decompose")
        ) {
          const decision = event.decision;
          const childCount = event.childIds?.length ?? 0;
          setLivePlanNodes((current) => {
            const existing = current.get(event.nodeId!);
            if (existing === undefined) return current;
            const next = new Map(current);
            next.set(event.nodeId!, {
              ...existing,
              state: "complete",
              decision,
              childCount
            });
            return next;
          });
        } else if (event.kind === "status.changed" && event.status !== undefined) {
          setStatus(event.status);
          router.refresh();
        }
      } catch {
        // ignore malformed payloads
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => {
      es.close();
    };
  }, [runId, router]);

  useEffect(() => {
    if (!isLiveRunStatus(status)) return;
    const interval = window.setInterval(() => {
      router.refresh();
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [router, status]);

  useEffect(() => {
    if (status === "needs_review" || status === "approved" || status === "completed" || status === "failed") {
      setVisible((current) => (current.size === 0 ? current : new Set()));
    }
  }, [status]);

  return {
    status,
    visibleTaskIds: status === "generating" ? visible : null,
    livePlanNodes: Array.from(livePlanNodes.values()).sort(
      (left, right) => left.depth - right.depth || left.id.localeCompare(right.id)
    )
  };
}

function isLiveRunStatus(status: RunStatusKey): boolean {
  return status === "created" || status === "generating" || status === "running" || status === "paused";
}

function LivePlanningTree({ nodes }: { nodes: readonly LivePlanNode[] }): React.ReactElement {
  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gap: 8,
        marginTop: 4
      }}
    >
      {nodes.map((node) => (
        <div
          key={node.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 10,
            alignItems: "center",
            marginLeft: node.depth * 18,
            padding: "9px 11px",
            border: "1px solid var(--border-soft)",
            background: node.state === "active" ? "rgba(244,195,106,0.08)" : "rgba(119,215,200,0.05)",
            borderRadius: "var(--r-md)",
            color: "var(--text-2)"
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.title}
          </span>
          <span
            className="mh-mono"
            style={{
              color: node.state === "active" ? "var(--copper)" : "var(--text-3)",
              fontSize: 10.5,
              whiteSpace: "nowrap"
            }}
          >
            {node.state === "active" ? "thinking" : node.decision ?? "done"}
          </span>
        </div>
      ))}
    </div>
  );
}
