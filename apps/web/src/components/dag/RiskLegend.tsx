import type { RunGraphViewModel } from "@/lib/graph-view-model";

interface RiskLegendProps {
  graph: RunGraphViewModel;
}

export function RiskLegend({ graph }: RiskLegendProps): React.ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 12px",
        background: "rgba(15,16,18,0.78)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        backdropFilter: "blur(10px)",
        fontSize: 11,
        color: "var(--text-2)"
      }}
    >
      <span className="mh-coord">distribution</span>
      <LegendDot color="var(--planned)" label="planned" value={graph.status.planned} />
      <LegendDot color="var(--ready)" label="ready" value={graph.status.ready + graph.status.approved} />
      <LegendDot color="var(--running)" label="running" value={graph.status.running + graph.status.generating} />
      <LegendDot color="var(--done)" label="done" value={graph.status.done + graph.status.integrated} />
      <LegendDot color="var(--blocked)" label="blocked" value={graph.status.blocked + graph.status.gated} />
      {graph.summary.riskCount > 0 ? (
        <LegendDot color="var(--risk-high)" label="risk" value={graph.summary.riskCount} />
      ) : null}
    </div>
  );
}

function LegendDot({
  color,
  label,
  value
}: {
  color: string;
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span className="mh-dot" style={{ color }} />
      <span>{label}</span>
      <span className="mh-mono" style={{ color: value === 0 ? "var(--text-3)" : "var(--text)" }}>
        {value}
      </span>
    </span>
  );
}
