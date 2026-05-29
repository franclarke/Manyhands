"use client";

import type { GraphNodeStatus, GraphNodeView, RunGraphViewModel } from "@/lib/graph-view-model";

interface RunBoardProps {
  graph: RunGraphViewModel;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

interface BoardColumn {
  id: string;
  label: string;
  color: string;
  statuses: GraphNodeStatus[];
}

const COLUMNS: BoardColumn[] = [
  { id: "planned", label: "Planned", color: "var(--planned)", statuses: ["planned"] },
  { id: "ready", label: "Ready", color: "var(--ready)", statuses: ["ready", "approved"] },
  { id: "running", label: "Running", color: "var(--running)", statuses: ["running", "generating"] },
  { id: "needs-review", label: "Needs review", color: "var(--ready)", statuses: ["gated", "blocked", "needs_review", "failed"] },
  { id: "done", label: "Done", color: "var(--done)", statuses: ["done"] },
  { id: "integrated", label: "Integrated", color: "var(--copper)", statuses: ["integrated"] }
];

const STATUS_COLOR: Record<GraphNodeStatus, string> = {
  planned: "var(--planned)",
  ready: "var(--ready)",
  running: "var(--running)",
  gated: "var(--gated)",
  done: "var(--done)",
  failed: "var(--error)",
  blocked: "var(--blocked)",
  generating: "var(--running)",
  needs_review: "var(--ready)",
  approved: "var(--done)",
  integrated: "var(--copper)"
};

export function RunBoard({ graph, selectedTaskId, onSelectTask }: RunBoardProps): React.ReactElement {
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
        <span className="mh-coord" style={{ color: "var(--copper)" }}>board / secondary</span>
        <div style={{ flex: 1, height: 1, background: "var(--rule)" }} />
        <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          group by state / drag updates are future
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(168px, 1fr))",
          gap: 12,
          minWidth: 1080
        }}
      >
        {COLUMNS.map((column) => {
          const nodes = graph.nodes.filter((node) => column.statuses.includes(node.status));
          return (
            <div key={column.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 10px" }}>
                <span className="mh-dot" style={{ color: column.color }} />
                <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{column.label}</span>
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
                      fontSize: 11
                    }}
                  >
                    empty
                  </div>
                ) : (
                  nodes.map((node) => (
                    <BoardCard
                      key={node.id}
                      node={node}
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
  selected,
  onClick
}: {
  node: GraphNodeView;
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
        background: selected ? "rgba(180,113,72,0.04)" : "var(--bg-1)",
        borderRadius: 6,
        padding: "9px 10px",
        cursor: "pointer",
        color: "var(--text)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <TypeGlyph kind={node.kind} />
        <span className="mh-mono" style={{ fontSize: 10.5, color: "var(--text-2)" }}>{node.id}</span>
        <span style={{ flex: 1 }} />
        <span className="mh-dot" style={{ width: 5, height: 5, color: STATUS_COLOR[node.status] }} />
      </div>
      <div className="mh-serif" style={{ fontSize: 13.5, color: "var(--text)", marginTop: 8, lineHeight: 1.25 }}>
        {node.title}
      </div>
      <div className="mh-mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
        {(node.expectedFiles?.length ?? 0) > 0 ? `${node.expectedFiles!.length} paths` : "no paths"} / {node.kind}
      </div>
    </button>
  );
}

function TypeGlyph({ kind }: { kind: string }): React.ReactElement {
  const letter = kind === "composite" ? "C" : kind === "leaf" ? "L" : kind.slice(0, 1).toUpperCase();
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        borderRadius: 2,
        border: "1px solid var(--rule-strong)",
        color: kind === "leaf" ? "var(--copper)" : "var(--text-2)",
        fontSize: 8.5
      }}
    >
      {letter}
    </span>
  );
}
