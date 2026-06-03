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
  benchmarkLabel?: string;
  configLabel: string;
  mode?: "Replay" | "Lab" | "Run";
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
  pendingQuestion?: { nodeId: string; question: string; options: string[] } | null;
  cliLogs?: readonly LivePlanCliLog[];
}

export interface LivePlanNode {
  id: string;
  parentId: string | null;
  title: string;
  goal?: string | undefined;
  depth: number;
  state: "pending" | "active" | "complete";
  decision?: "atomic" | "decompose" | "question" | undefined;
  childCount?: number | undefined;
  childIds?: readonly string[] | undefined;
}

interface LivePlanChildNode {
  nodeId: string;
  parentId: string;
  title: string;
  goal: string;
  depth: number;
}

export function RunCanvasShell(props: RunCanvasShellProps): React.ReactElement {
  const { snapshot, source, visibleTaskIds } = props;
  const router = useRouter();
  const livePlanNodes = useMemo(() => props.livePlanNodes ?? EMPTY_LIVE_PLAN_NODES, [props.livePlanNodes]);
  const livePlanSnapshot = useMemo(
    () =>
      snapshot === null && livePlanNodes.length > 0
        ? buildLivePlanningSnapshot({
            nodes: livePlanNodes,
            source,
            benchmarkLabel: props.benchmarkLabel ?? "Run",
            configLabel: props.configLabel
          })
        : null,
    [snapshot, livePlanNodes, source, props.benchmarkLabel, props.configLabel]
  );
  const effectiveSnapshot = snapshot ?? livePlanSnapshot;
  const effectiveVisibleTaskIds = useMemo(() => {
    if (snapshot === null || visibleTaskIds === null || visibleTaskIds === undefined) {
      return null;
    }
    if (livePlanNodes.length === 0) {
      return visibleTaskIds;
    }
    const merged = new Set(visibleTaskIds);
    for (const node of livePlanNodes) {
      merged.add(node.id);
    }
    return merged;
  }, [snapshot, visibleTaskIds, livePlanNodes]);
  const { graph, derivedSnapshot } = useMemo(() => {
    if (effectiveSnapshot === null) {
      return { graph: null, derivedSnapshot: null };
    }
    const fullGraph = toRunGraphViewModel(effectiveSnapshot);
    if (effectiveVisibleTaskIds === null || effectiveVisibleTaskIds === undefined) {
      return { graph: fullGraph, derivedSnapshot: effectiveSnapshot };
    }
    const filteredNodes = fullGraph.nodes.filter((node) => effectiveVisibleTaskIds.has(node.id));
    const filteredEdges = fullGraph.edges.filter(
      (edge) => effectiveVisibleTaskIds.has(edge.source) && effectiveVisibleTaskIds.has(edge.target)
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
    return { graph: partial, derivedSnapshot: effectiveSnapshot };
  }, [effectiveSnapshot, effectiveVisibleTaskIds]);

  if (graph === null || derivedSnapshot === null) {
    const isFailed = source.kind === "persisted-run" && source.initialStatus === "failed";
    const isGenerating = source.kind === "persisted-run" && source.initialStatus === "generating";
    const isCreated = source.kind === "persisted-run" && source.initialStatus === "created";
    const isPaused = source.kind === "persisted-run" && source.initialStatus === "paused";
    const statusMessage = isGenerating
      ? "Esperando descomposición…"
      : isCreated
        ? "Inicializando run…"
        : isPaused
          ? "Planificación pausada. Se requiere aclaración sobre el diseño."
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
            alignItems: "flex-start",
            width: "100%",
            boxSizing: "border-box"
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

          {isPaused && props.pendingQuestion && (
            <QuestionCard
              runId={source.runId}
              nodeId={props.pendingQuestion.nodeId}
              question={props.pendingQuestion.question}
              options={props.pendingQuestion.options}
              onAnswered={() => router.refresh()}
            />
          )}

          {props.cliLogs && props.cliLogs.length > 0 && (
            <PlanningConsole logs={props.cliLogs} />
          )}
        </div>
      </div>
    );
  }

  const showMethodologyBanner = props.showMethodologyBanner ?? source.kind === "deterministic-replay";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <DagWorkspace
        snapshot={derivedSnapshot}
        graph={graph}
        benchmarkLabel={props.benchmarkLabel ?? "Run"}
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
        {...(props.errorMessage !== undefined ? { errorMessage: props.errorMessage } : {})}
        {...(props.execution !== undefined ? { execution: props.execution } : {})}
      />
      {source.kind === "persisted-run" ? (
        <LivePlanningPanels
          runId={source.runId}
          pendingQuestion={props.pendingQuestion ?? null}
          cliLogs={props.cliLogs ?? []}
          onAnswered={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function buildLivePlanningSnapshot(input: {
  nodes: readonly LivePlanNode[];
  source: RunCanvasSource;
  benchmarkLabel: string;
  configLabel: string;
}): RunSnapshot | null {
  const root = input.nodes.find((node) => node.parentId === null) ?? input.nodes[0];
  if (root === undefined) {
    return null;
  }

  const runId = input.source.kind === "persisted-run" ? input.source.runId : "live-planning";
  const childrenByParent = new Map<string, string[]>();
  for (const node of input.nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  const graphNodes = Object.fromEntries(
    input.nodes.map((node) => {
      const childIds = uniqueStrings([...(node.childIds ?? []), ...(childrenByParent.get(node.id) ?? [])]);
      return [
        node.id,
        {
          id: node.id,
          parentId: node.parentId,
          kind: liveNodeKind(node),
          title: node.title,
          goal: node.goal ?? node.title,
          status: node.state === "active" ? "running" : "planned",
          granularity: "auto",
          depth: node.depth,
          childrenIds: childIds,
          dependencies: [],
          metadata: {
            authoredBy: "ai",
            livePlanningState: node.state,
            ...(node.decision !== undefined ? { planningDecision: node.decision } : {})
          }
        }
      ];
    })
  );

  return {
    runId,
    featureId: `${runId}:live-plan`,
    status: "planned",
    decompositionMode: "balanced",
    featureRequest: {
      id: `${runId}:live-feature`,
      title: input.benchmarkLabel,
      description: input.configLabel,
      targetStack: [],
      constraints: [],
      acceptanceCriteria: ["Planning is still generating."]
    },
    graphSnapshot: {
      id: `${runId}:live-graph`,
      planId: `${runId}:live-plan`,
      repo: "live-planning",
      baseBranch: "planning",
      baseCommit: "pending",
      featureRequest: input.benchmarkLabel,
      nodes: graphNodes,
      dependencies: [],
      rootId: root.id,
      createdAt: "1970-01-01T00:00:00.000Z"
    },
    contracts: [],
    riskPredictions: [],
    staticConflictSignals: [],
    scheduledBatches: [],
    blockedTasks: [],
    agentRunResults: [],
    scopeValidationResults: [],
    traceEvents: [],
    summary: {
      runId,
      featureId: `${runId}:live-feature`,
      mode: "balanced",
      schedulerPolicy: "risk_aware",
      taskCount: input.nodes.length,
      leafCount: input.nodes.filter((node) => node.decision === "atomic").length,
      dependencyCount: 0,
      contractCount: 0,
      riskPredictionCount: 0,
      staticConflictSignalCount: 0,
      batchCount: 0,
      batches: [],
      traceEventCount: 0,
      validationIssues: []
    },
    metadata: {
      schemaVersion: "manyhands.run-snapshot.v1",
      createdAt: "1970-01-01T00:00:00.000Z",
      deterministic: false
    }
  } as RunSnapshot;
}

function liveNodeKind(node: LivePlanNode): "root" | "composite" | "leaf" {
  if (node.parentId === null) return "root";
  if (node.decision === "atomic") return "leaf";
  return "composite";
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isLivePlanChildNode(value: unknown): value is LivePlanChildNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LivePlanChildNode>;
  return (
    typeof candidate.nodeId === "string" &&
    typeof candidate.parentId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.goal === "string" &&
    typeof candidate.depth === "number"
  );
}

function livePlanNodeMap(nodes: readonly LivePlanNode[]): Map<string, LivePlanNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function LivePlanningPanels({
  runId,
  pendingQuestion,
  cliLogs,
  onAnswered
}: {
  runId: string;
  pendingQuestion: { nodeId: string; question: string; options: string[] } | null;
  cliLogs: readonly LivePlanCliLog[];
  onAnswered: () => void;
}): React.ReactElement | null {
  if (pendingQuestion === null && cliLogs.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {pendingQuestion !== null ? (
        <QuestionCard
          runId={runId}
          nodeId={pendingQuestion.nodeId}
          question={pendingQuestion.question}
          options={pendingQuestion.options}
          onAnswered={onAnswered}
        />
      ) : null}
      {cliLogs.length > 0 ? <PlanningConsole logs={cliLogs} /> : null}
    </div>
  );
}

export interface LivePlanCliLog {
  nodeId: string;
  chunk: string;
  stream: "stdout" | "stderr";
  at: string;
}

interface UseLiveRunResult {
  status: RunStatusKey;
  visibleTaskIds: ReadonlySet<string> | null;
  livePlanNodes: readonly LivePlanNode[];
  pendingQuestion: { nodeId: string; question: string; options: string[] } | null;
  cliLogs: readonly LivePlanCliLog[];
}

const LIVE_REFRESH_MS = 5_000;
const EMPTY_LIVE_PLAN_NODES: readonly LivePlanNode[] = [];

/**
 * Client hook that subscribes to a persisted run's SSE stream, accumulates
 * `node.added` events into a visibleTaskIds set, and triggers `router.refresh()`
 * whenever the status changes (so the server component re-fetches RunRecord).
 */
export function useLiveRun(
  runId: string,
  initialStatus: RunStatusKey,
  initialPendingQuestion: { nodeId: string; question: string; options: string[] } | null = null,
  initialLivePlanNodes: readonly LivePlanNode[] = EMPTY_LIVE_PLAN_NODES
): UseLiveRunResult {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatusKey>(initialStatus);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [livePlanNodes, setLivePlanNodes] = useState<Map<string, LivePlanNode>>(
    () => livePlanNodeMap(initialLivePlanNodes)
  );
  const [pendingQuestion, setPendingQuestion] = useState<{ nodeId: string; question: string; options: string[] } | null>(
    initialPendingQuestion
  );
  const [cliLogs, setCliLogs] = useState<LivePlanCliLog[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setPendingQuestion(initialPendingQuestion);
  }, [initialPendingQuestion]);

  useEffect(() => {
    setVisible(new Set());
    setLivePlanNodes(livePlanNodeMap(initialLivePlanNodes));
    setCliLogs([]);
  }, [runId, initialLivePlanNodes]);

  useEffect(() => {
    if (initialLivePlanNodes.length === 0) return;
    setLivePlanNodes((current) => {
      const next = new Map(current);
      for (const node of initialLivePlanNodes) {
        next.set(node.id, { ...next.get(node.id), ...node });
      }
      return next;
    });
  }, [initialLivePlanNodes]);

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
          goal?: string;
          depth?: number;
          decision?: "atomic" | "decompose" | "question";
          childIds?: string[];
          childNodes?: LivePlanChildNode[];
          chunk?: string;
          stream?: "stdout" | "stderr";
          question?: string;
          options?: string[];
          at?: string;
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
              ...next.get(event.nodeId!),
              id: event.nodeId!,
              parentId: event.parentId ?? null,
              title: event.title!,
              goal: event.goal ?? event.title!,
              depth: event.depth!,
              state: "active"
            });
            return next;
          });
        } else if (
          event.kind === "planning.node.completed" &&
          typeof event.nodeId === "string" &&
          (event.decision === "atomic" || event.decision === "decompose" || event.decision === "question")
        ) {
          const decision = event.decision;
          const childCount = event.childIds?.length ?? 0;
          const childIds = event.childIds ?? [];
          const childNodes = Array.isArray(event.childNodes) ? event.childNodes.filter(isLivePlanChildNode) : [];
          setLivePlanNodes((current) => {
            const existing = current.get(event.nodeId!);
            if (existing === undefined) return current;
            const next = new Map(current);
            next.set(event.nodeId!, {
              ...existing,
              state: "complete",
              decision,
              childCount,
              childIds
            });
            for (const child of childNodes) {
              const existingChild = next.get(child.nodeId);
              next.set(child.nodeId, {
                ...existingChild,
                id: child.nodeId,
                parentId: child.parentId,
                title: child.title,
                goal: child.goal,
                depth: child.depth,
                state: existingChild?.state ?? "pending"
              });
            }
            return next;
          });
        } else if (event.kind === "planning.cli.output" && typeof event.chunk === "string" && typeof event.nodeId === "string") {
          setCliLogs((current) => [
            ...current,
            {
              nodeId: event.nodeId!,
              chunk: event.chunk!,
              stream: event.stream ?? "stdout",
              at: event.at ?? new Date().toISOString()
            }
          ]);
        } else if (event.kind === "planning.question" && typeof event.question === "string" && typeof event.nodeId === "string") {
          setPendingQuestion({
            nodeId: event.nodeId!,
            question: event.question!,
            options: event.options ?? []
          });
          setStatus("paused");
          router.refresh();
        } else if (event.kind === "status.changed" && event.status !== undefined) {
          setStatus(event.status);
          if (event.status !== "paused") {
            setPendingQuestion(null);
          }
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
  }, [runId, router, initialPendingQuestion]);

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
    ),
    pendingQuestion,
    cliLogs
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
            background:
              node.state === "active"
                ? "rgba(244,195,106,0.08)"
                : node.state === "pending"
                  ? "rgba(241,234,216,0.055)"
                  : "rgba(119,215,200,0.05)",
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
            {node.state === "active" ? "thinking" : node.state === "pending" ? "queued" : node.decision ?? "done"}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuestionCard({
  runId,
  nodeId,
  question,
  options,
  onAnswered
}: {
  runId: string;
  nodeId: string;
  question: string;
  options: readonly string[];
  onAnswered: () => void;
}): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const handleSubmit = async (answer: string) => {
    setSelected(answer);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, answer })
      });
      if (response.ok) {
        onAnswered();
      } else {
        const err = await response.json();
        alert(`Error al enviar respuesta: ${err.error || response.statusText}`);
      }
    } catch (e) {
      alert(`Error al conectar con el servidor: ${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        marginTop: 20,
        padding: "24px 28px",
        background: "rgba(255, 255, 255, 0.02)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.3)",
        display: "flex",
        flexDirection: "column",
        gap: 16
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--copper, #f4c36a)",
            fontFamily: "var(--font-mono)"
          }}
        >
          Aclaración Requerida por Gemini
        </span>
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--text-1)" }}>
          {question}
        </h4>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 10,
          marginTop: 6
        }}
      >
        {options.map((opt) => {
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              disabled={submitting}
              onClick={() => handleSubmit(opt)}
              style={{
                textAlign: "left",
                padding: "12px 18px",
                background: isSelected
                  ? "rgba(244, 195, 106, 0.15)"
                  : "rgba(255, 255, 255, 0.03)",
                border: isSelected
                  ? "1px solid var(--copper, #f4c36a)"
                  : "1px solid var(--border-soft)",
                borderRadius: "var(--r-md)",
                color: isSelected ? "var(--text-1)" : "var(--text-2)",
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12
              }}
            >
              <span>{opt}</span>
              {submitting && isSelected ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-3)",
                    fontStyle: "italic"
                  }}
                >
                  Enviando...
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanningConsole({
  logs
}: {
  logs: readonly LivePlanCliLog[];
}): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        width: "100%",
        marginTop: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          display: "flex",
          alignItems: "center",
          gap: 6
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--copper, #f4c36a)",
            boxShadow: "0 0 8px var(--copper)"
          }}
        />
        Gemini CLI Output (Live Stream)
      </div>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 250,
          background: "rgba(10, 10, 12, 0.75)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--r-md)",
          padding: "14px 18px",
          overflowY: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: "1.6",
          color: "rgba(255, 255, 255, 0.85)",
          boxSizing: "border-box",
          boxShadow: "inset 0 2px 8px rgba(0, 0, 0, 0.5)",
          scrollbarWidth: "thin"
        }}
      >
        {logs.map((log, index) => {
          const isError = log.stream === "stderr";
          return (
            <div
              key={index}
              style={{
                color: isError ? "#f4c36a" : "#94f4d2",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                marginBottom: 2
              }}
            >
              <span style={{ opacity: 0.4, marginRight: 8, fontSize: 9.5 }}>
                [{log.nodeId}]
              </span>
              <span>{log.chunk}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
