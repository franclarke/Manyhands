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
    return (
      <div
        style={{
          padding: 48,
          border: "1px dashed var(--border)",
          background: "var(--bg-1)",
          borderRadius: "var(--r-lg)",
          color: "var(--text-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          textAlign: "center"
        }}
      >
        {source.kind === "persisted-run" && source.initialStatus === "generating"
          ? "Esperando descomposición…"
          : source.kind === "persisted-run" && source.initialStatus === "created"
            ? "Inicializando run…"
            : "No hay snapshot disponible todavía."}
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
}

/**
 * Client hook that subscribes to a persisted run's SSE stream, accumulates
 * `node.added` events into a visibleTaskIds set, and triggers `router.refresh()`
 * whenever the status changes (so the server component re-fetches RunRecord).
 */
export function useLiveRun(runId: string, initialStatus: RunStatusKey): UseLiveRunResult {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatusKey>(initialStatus);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = `/api/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as { kind: string; status?: RunStatusKey; taskId?: string };
        if (event.kind === "node.added" && typeof event.taskId === "string") {
          const taskId = event.taskId;
          setVisible((current) => {
            if (current.has(taskId)) return current;
            const next = new Set(current);
            next.add(taskId);
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
    if (status === "needs_review" || status === "approved" || status === "completed" || status === "failed") {
      setVisible((current) => (current.size === 0 ? current : new Set()));
    }
  }, [status]);

  return {
    status,
    visibleTaskIds: status === "generating" ? visible : null
  };
}
