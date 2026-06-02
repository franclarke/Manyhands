"use client";

import { useMemo, useState } from "react";
import type { RunSnapshot } from "@manyhands/core";
import { toRunGraphViewModel, type GraphNodeView } from "@/lib/graph-view-model";
import { mergeRunTimeline, type TimelineRunInput } from "@/lib/run-timeline";
import { graphStatusColor } from "@/lib/status";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";

interface RunTimelineProps {
  run: TimelineRunInput;
  snapshot: RunSnapshot;
  patches: readonly unknown[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

type EventFilter = "all" | "errors" | "retries" | "node";

export function RunTimeline({ run, snapshot, patches, selectedTaskId, onSelectTask }: RunTimelineProps): React.ReactElement {
  const [filter, setFilter] = useState<EventFilter>("all");
  const graph = useMemo(() => toRunGraphViewModel(snapshot), [snapshot]);
  const entries = useMemo(() => mergeRunTimeline({ run, snapshot, patches }), [run, snapshot, patches]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => entryMatchesFilter(entry, filter, selectedTaskId)),
    [entries, filter, selectedTaskId]
  );
  const rows = useMemo(() => timelineRows(graph.nodes), [graph.nodes]);
  const maxDepth = Math.max(0, ...graph.nodes.map((node) => node.depth ?? 0));
  const hasExecution = snapshot.agentRunResults.length > 0;

  return (
    <section
      style={{
        minHeight: 760,
        border: "1px solid var(--rule)",
        background: "rgba(15,16,18,0.72)",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <header
        style={{
          padding: "14px 18px 10px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          alignItems: "center"
        }}
      >
        <div>
          <div className="mh-coord" style={{ color: "var(--copper)" }}>
            execution timeline
          </div>
          <h3 className="mh-serif" style={{ margin: "4px 0 0", color: "var(--text)", fontSize: 21 }}>
            Oscilloscope
          </h3>
        </div>
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          {hasExecution ? "recorded execution" : "planning trace"} / units arbitrary
        </span>
      </header>

      <div style={{ overflow: "auto", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ minWidth: Math.max(980, 260 + (maxDepth + 2) * 190) }}>
          <Ruler maxDepth={maxDepth} />
          {rows.map((row) =>
            row.kind === "phase" ? (
              <PhaseRow key={`phase-${row.depth}`} depth={row.depth} count={row.count} />
            ) : (
              <NodeRow
                key={row.node.id}
                node={row.node}
                index={row.index}
                selected={selectedTaskId === row.node.id}
                onSelect={() => onSelectTask(row.node.id)}
              />
            )
          )}
        </div>
      </div>

      <div style={{ padding: "12px 18px 18px", overflowY: "auto", maxHeight: 230 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <span className="mh-coord">event stream</span>
          <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
          <TimelineFilter value={filter} onChange={setFilter} selectedTaskId={selectedTaskId} />
          <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{visibleEntries.length} events</span>
        </div>
        {visibleEntries.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 12.5 }}>
            No timeline events have been recorded for this run yet.
          </div>
        ) : (
          visibleEntries.slice(0, 18).map((entry) => (
            <article
              key={entry.id}
              onClick={() => {
                const taskId = entry.taskIds[0];
                if (taskId !== undefined) onSelectTask(taskId);
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "132px 1fr",
                gap: 14,
                padding: "8px 0",
                borderBottom: "1px solid var(--rule-soft)",
                cursor: entry.taskIds.length > 0 ? "pointer" : "default"
              }}
            >
              <div className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                <div>{formatTimestamp(entry.timestamp)}</div>
                <div style={{ marginTop: 3, color: entry.actor === "human" ? "var(--copper)" : "var(--text-2)" }}>
                  {entry.actor}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mh-mono" style={{ color: "var(--text)", fontSize: 11 }}>
                    {entry.kind}
                  </span>
                  <span style={{ color: "var(--text)", fontSize: 12.5, fontWeight: 600 }}>
                    {entry.title}
                  </span>
                </div>
                {entry.summary !== undefined ? (
                  <p style={{ margin: "4px 0 0", color: "var(--text-2)", fontSize: 12, lineHeight: 1.45 }}>
                    {entry.summary}
                  </p>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Ruler({ maxDepth }: { maxDepth: number }): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: 34, borderBottom: "1px solid var(--rule)" }}>
      <div style={{ borderRight: "1px solid var(--rule)", padding: "10px 14px" }}>
        <span className="mh-coord">phase / lane</span>
      </div>
      <div style={{ position: "relative" }}>
        {Array.from({ length: maxDepth + 2 }).map((_, depth) => (
          <div key={depth} style={{ position: "absolute", left: depth * 190, top: 0, bottom: 0 }}>
            <div style={{ width: 1, height: "100%", background: "var(--rule-soft)" }} />
            <span className="mh-mono" style={{ position: "absolute", top: 9, left: 6, fontSize: 10, color: "var(--text-3)" }}>
              d{depth}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseRow({ depth, count }: { depth: number; count: number }): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 24, borderBottom: "1px solid var(--rule-soft)" }}>
      <div style={{ borderRight: "1px solid var(--rule)", padding: "5px 14px" }}>
        <span className="mh-coord" style={{ color: "var(--copper)" }}>phase {depth}</span>
        <span className="mh-mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--text-3)" }}>{count} tasks</span>
      </div>
      <div
        style={{
          background: "repeating-linear-gradient(135deg, transparent 0 8px, var(--rule-soft) 8px 9px)"
        }}
      />
    </div>
  );
}

function NodeRow({
  node,
  index,
  selected,
  onSelect
}: {
  node: GraphNodeView;
  index: number;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const depth = node.depth ?? 0;
  const color = graphStatusColor(node.status);
  const filled = node.status === "done" || node.status === "running" || node.status === "generating";
  const blocked = node.status === "blocked" || node.status === "gated";
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        height: 34,
        width: "100%",
        border: "none",
        borderBottom: "1px solid var(--rule-soft)",
        background: selected ? "rgba(180,113,72,0.08)" : "transparent",
        padding: 0,
        textAlign: "left",
        cursor: "pointer"
      }}
    >
      <div style={{ borderRight: "1px solid var(--rule)", padding: "8px 14px 0 28px" }}>
        <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
          lane {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 17, left: 0, right: 0, height: 1, background: "var(--rule-soft)" }} />
        <div
          style={{
            position: "absolute",
            left: depth * 190 + 12,
            top: 6,
            width: 220,
            height: 22,
            borderRadius: 3,
            background: filled ? `${color}22` : "transparent",
            border: `1px ${blocked || node.status === "planned" ? "dashed" : "solid"} ${color}`,
            opacity: blocked ? 0.58 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 8px",
            overflow: "hidden",
            whiteSpace: "nowrap"
          }}
        >
          <span className="mh-mono" style={{ fontSize: 10.5, color: filled ? "var(--text)" : color }}>
            {node.id} / {node.status.replace("_", " ")}
          </span>
        </div>
      </div>
    </button>
  );
}

function TimelineFilter({
  value,
  onChange,
  selectedTaskId
}: {
  value: EventFilter;
  onChange: (value: EventFilter) => void;
  selectedTaskId: string | null;
}): React.ReactElement {
  const options: ReadonlyArray<SegmentedOption<EventFilter>> = [
    { value: "all", label: "All" },
    { value: "errors", label: "Errors" },
    { value: "retries", label: "Retries" },
    {
      value: "node",
      label: "Selected node",
      ...(selectedTaskId === null
        ? { disabled: true, title: "Select a node to filter its events" }
        : {})
    }
  ];
  return <SegmentedControl ariaLabel="Event filter" options={options} value={value} onChange={onChange} />;
}

function entryMatchesFilter(
  entry: ReturnType<typeof mergeRunTimeline>[number],
  filter: EventFilter,
  selectedTaskId: string | null
): boolean {
  if (filter === "all") return true;
  const haystack = `${entry.type} ${entry.title} ${entry.summary ?? ""}`.toLowerCase();
  if (filter === "errors") return /fail|error|conflict|violation/.test(haystack);
  if (filter === "retries") return /retry|rerun|restart/.test(haystack);
  return selectedTaskId !== null && entry.taskIds.includes(selectedTaskId);
}

type TimelineRow =
  | { kind: "phase"; depth: number; count: number }
  | { kind: "node"; node: GraphNodeView; index: number };

function timelineRows(nodes: GraphNodeView[]): TimelineRow[] {
  const byDepth = new Map<number, GraphNodeView[]>();
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    const bucket = byDepth.get(depth) ?? [];
    bucket.push(node);
    byDepth.set(depth, bucket);
  }
  const rows: TimelineRow[] = [];
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const bucket = [...(byDepth.get(depth) ?? [])].sort((left, right) => left.id.localeCompare(right.id));
    rows.push({ kind: "phase", depth, count: bucket.length });
    bucket.forEach((node, index) => rows.push({ kind: "node", node, index }));
  }
  return rows;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 19);
}
