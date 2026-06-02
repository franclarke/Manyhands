"use client";

import { useMemo } from "react";
import type { GraphNodeStatus, GraphNodeView, RunGraphViewModel } from "@/lib/graph-view-model";
import { nodeUiStatus } from "@/lib/status";
import { nodeActionHint, nodeKindLabel, riskLabel } from "@/lib/run-presentation";
import { Signal } from "@/components/ui/signal";

interface RunBoardProps {
  graph: RunGraphViewModel;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

interface BoardColumn {
  id: string;
  label: string;
  statuses: GraphNodeStatus[];
  empty: string;
}

const COLUMNS: BoardColumn[] = [
  { id: "planned", label: "Planned", statuses: ["planned"], empty: "No planned nodes." },
  { id: "blocked", label: "Blocked", statuses: ["blocked"], empty: "No nodes are blocked." },
  { id: "ready", label: "Ready", statuses: ["ready", "approved"], empty: "No nodes are ready to run." },
  { id: "running", label: "Running", statuses: ["running", "generating"], empty: "No agents are running." },
  { id: "needs-review", label: "Needs review", statuses: ["gated", "needs_review"], empty: "No review queue." },
  { id: "completed", label: "Completed", statuses: ["done"], empty: "No completed node outputs." },
  { id: "integrated", label: "Integrated", statuses: ["integrated"], empty: "Nothing integrated yet." },
  { id: "failed", label: "Failed", statuses: ["failed"], empty: "No failed nodes." }
];

export function RunBoard({ graph, selectedTaskId, onSelectTask }: RunBoardProps): React.ReactElement {
  const dependencyCounts = useMemo(() => dependencyCountByNode(graph), [graph]);
  return (
    <section
      style={{
        minHeight: 760,
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        background: "rgba(15,16,18,0.62)",
        overflow: "auto",
        padding: 18
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span className="mh-coord" style={{ color: "var(--copper)" }}>board</span>
        <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          grouped by node status
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, minmax(178px, 1fr))",
          gap: 12,
          minWidth: 1500
        }}
      >
        {COLUMNS.map((column) => {
          const nodes = graph.nodes.filter((node) => column.statuses.includes(node.status));
          return (
            <div key={column.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 10px" }}>
                <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>{column.label}</span>
                <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{nodes.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {nodes.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      border: "1px dashed var(--rule)",
                      borderRadius: 5,
                      color: "var(--text-3)",
                      textAlign: "center",
                      fontSize: 11,
                      lineHeight: 1.45
                    }}
                  >
                    {column.empty}
                  </div>
                ) : (
                  nodes.map((node) => (
                    <BoardCard
                      key={node.id}
                      node={node}
                      dependencyCount={dependencyCounts.get(node.id) ?? 0}
                      selected={selectedTaskId === node.id}
                      onClick={() => onSelectTask(node.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BoardCard({
  node,
  dependencyCount,
  selected,
  onClick
}: {
  node: GraphNodeView;
  dependencyCount: number;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border: `1px solid ${selected ? "var(--copper)" : "var(--rule)"}`,
        background: selected ? "rgba(180,113,72,0.06)" : "var(--bg-1)",
        borderRadius: 6,
        padding: "10px 11px",
        cursor: "pointer",
        color: "var(--text)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Signal status={nodeUiStatus(node.status, { integrator: node.integrator === true })} />
        <span className="mh-mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>
          {nodeKindLabel(node.kind)}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--text)", marginTop: 9, lineHeight: 1.28, fontWeight: 700 }}>
        {node.title}
      </div>
      <div style={{ color: "var(--text-2)", marginTop: 6, fontSize: 11.5, lineHeight: 1.35 }}>
        {node.description}
      </div>
      <div className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 8 }}>
        deps {dependencyCount} / paths {node.expectedFiles?.length ?? 0} / {riskLabel(node.riskLevel)}
      </div>
      <div style={{ marginTop: 8, color: "var(--copper-hi)", fontSize: 11.5, fontWeight: 700 }}>
        {nodeActionHint(node)}
      </div>
    </button>
  );
}

function dependencyCountByNode(graph: RunGraphViewModel): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind !== "dependency") continue;
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
}
