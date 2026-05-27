"use client";

import { useMemo } from "react";
import type {
  GraphNodeStatus,
  GraphRiskLevel,
  GraphStatusCounts,
  RunGraphViewModel
} from "@/lib/graph-view-model";
import type { GraphFilterState, NodeKindFilter } from "@/lib/graph-filters";
import { filtersAreEmpty, toggleSetValue } from "@/lib/graph-filters";

interface GraphToolbarProps {
  graph: RunGraphViewModel;
  benchmarkLabel: string;
  configLabel: string;
  mode: "Replay" | "Lab" | "Build";
  filters: GraphFilterState;
  onFiltersChange: (next: GraphFilterState) => void;
  matchedCount: number;
}

const STATUS_COLOR: Record<GraphNodeStatus, string> = {
  planned:      "var(--planned)",
  ready:        "var(--ready)",
  running:      "var(--running)",
  gated:        "var(--gated)",
  done:         "var(--done)",
  failed:       "var(--error)",
  blocked:      "var(--blocked)",
  generating:   "var(--coral)",
  needs_review: "var(--ready)",
  approved:     "var(--done)",
  integrated:   "var(--done)"
};

const STATUS_ORDER: GraphNodeStatus[] = [
  "generating",
  "planned",
  "ready",
  "running",
  "needs_review",
  "approved",
  "gated",
  "done",
  "integrated",
  "failed",
  "blocked"
];

const RISK_ORDER: GraphRiskLevel[] = ["low", "medium", "high", "blocking"];

const RISK_COLOR: Record<GraphRiskLevel, string> = {
  low: "var(--risk-low)",
  medium: "var(--risk-medium)",
  high: "var(--risk-high)",
  blocking: "var(--risk-blocking)"
};

const KIND_ORDER: NodeKindFilter[] = ["leaf", "composite"];

export function GraphToolbar(props: GraphToolbarProps): React.ReactElement {
  const { graph, benchmarkLabel, configLabel, mode, filters, onFiltersChange, matchedCount } = props;

  const riskCounts = useMemo<Record<GraphRiskLevel, number>>(() => {
    const acc: Record<GraphRiskLevel, number> = { low: 0, medium: 0, high: 0, blocking: 0 };
    for (const node of graph.nodes) {
      if (node.riskLevel !== undefined) {
        acc[node.riskLevel] += 1;
      }
    }
    return acc;
  }, [graph.nodes]);

  const kindCounts = useMemo<Record<NodeKindFilter, number>>(() => {
    let leaf = 0;
    let composite = 0;
    for (const node of graph.nodes) {
      if (node.kind === "leaf") leaf += 1;
      else if (node.kind === "composite") composite += 1;
    }
    return { leaf, composite };
  }, [graph.nodes]);

  const gateCount = useMemo(
    () => graph.nodes.filter((node) => node.gateRequired === true).length,
    [graph.nodes]
  );

  const empty = filtersAreEmpty(filters);

  function patch(partial: Partial<GraphFilterState>): void {
    onFiltersChange({ ...filters, ...partial });
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-lg)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "var(--shadow-lift)"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
          <RepoCrumb
            benchmark={benchmarkLabel}
            config={configLabel}
            featureId={graph.featureId}
            mode={mode}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SearchInput
            value={filters.text}
            onChange={(value) => patch({ text: value })}
          />
          <RunReadyButton ready={graph.status.ready} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          paddingTop: 8,
          borderTop: "1px dashed var(--border-soft)"
        }}
      >
        {STATUS_ORDER.map((status) => (
          <Chip
            key={status}
            label={status}
            value={graph.status[status]}
            color={STATUS_COLOR[status]}
            active={filters.statuses.has(status)}
            onClick={() => patch({ statuses: toggleSetValue(filters.statuses, status) })}
          />
        ))}

        <Divider />

        {RISK_ORDER.map((risk) => (
          <Chip
            key={risk}
            label={`risk:${risk}`}
            value={riskCounts[risk]}
            color={RISK_COLOR[risk]}
            active={filters.risks.has(risk)}
            onClick={() => patch({ risks: toggleSetValue(filters.risks, risk) })}
          />
        ))}

        <Divider />

        {KIND_ORDER.map((kind) => (
          <Chip
            key={kind}
            label={kind}
            value={kindCounts[kind]}
            color="var(--text-3)"
            active={filters.kinds.has(kind)}
            onClick={() => patch({ kinds: toggleSetValue(filters.kinds, kind) })}
          />
        ))}

        <Chip
          label="gate required"
          value={gateCount}
          color="var(--gated)"
          active={filters.gateOnly}
          onClick={() => patch({ gateOnly: !filters.gateOnly })}
        />

        <div style={{ flex: 1 }} />

        {!empty ? (
          <button
            type="button"
            onClick={() => onFiltersChange({
              text: "",
              statuses: new Set(),
              risks: new Set(),
              kinds: new Set(),
              gateOnly: false
            })}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-2)",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "var(--font-mono)"
            }}
          >
            clear ({matchedCount}/{graph.summary.taskCount} visible)
          </button>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              fontFamily: "var(--font-mono)",
              padding: "4px 6px"
            }}
          >
            {graph.summary.taskCount} tasks · {graph.summary.dependencyCount} deps · {graph.summary.riskCount} risks · {graph.summary.traceEventCount} events
          </span>
        )}
      </div>
    </div>
  );
}

function RepoCrumb({
  benchmark,
  config,
  featureId,
  mode
}: {
  benchmark: string;
  config: string;
  featureId: string;
  mode: "Replay" | "Lab" | "Build";
}): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, minWidth: 0, flexWrap: "wrap" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--coral)",
          background: "rgba(204,120,92,0.10)",
          border: "1px solid rgba(204,120,92,0.45)",
          borderRadius: 999,
          letterSpacing: 0.5,
          textTransform: "uppercase"
        }}
      >
        {mode} mode
      </span>
      <span style={{ color: "var(--text-3)" }}>/</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text)"
        }}
      >
        {benchmark}
      </span>
      <span style={{ color: "var(--text-3)" }}>/</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-2)"
        }}
      >
        {config}
      </span>
      <span style={{ color: "var(--text-3)" }}>/</span>
      <span
        className="mh-serif"
        style={{ fontSize: 15, color: "var(--text)" }}
      >
        {featureId}
      </span>
      <span
        style={{
          marginLeft: 4,
          fontSize: 10.5,
          fontFamily: "var(--font-mono)",
          color: "var(--ready)",
          background: "rgba(201,164,92,0.10)",
          border: "1px solid rgba(201,164,92,0.40)",
          padding: "2px 7px",
          borderRadius: 999,
          letterSpacing: 0.4
        }}
      >
        mock · deterministic
      </span>
    </div>
  );
}

function SearchInput({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        border: "1px solid var(--border)",
        background: "var(--bg-1)",
        borderRadius: 6,
        height: 30
      }}
    >
      <svg width={12} height={12} viewBox="0 0 18 18" style={{ color: "var(--text-3)" }}>
        <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="12" y1="12" x2="15" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="tid or title"
        spellCheck={false}
        style={{
          minWidth: 200,
          border: "none",
          background: "transparent",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          outline: "none"
        }}
      />
    </div>
  );
}

function RunReadyButton({ ready }: { ready: number }): React.ReactElement {
  return (
    <button
      type="button"
      disabled
      title="Live mock execution not implemented yet (Phase 5 — read-only canvas)"
      style={{
        height: 30,
        padding: "0 12px",
        borderRadius: 6,
        border: "1px solid rgba(204,120,92,0.40)",
        background: "rgba(204,120,92,0.10)",
        color: "rgba(217,142,115,0.55)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "not-allowed",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        letterSpacing: 0.3
      }}
    >
      <svg width={11} height={11} viewBox="0 0 18 18" fill="currentColor">
        <polygon points="5 3 14 9 5 15" />
      </svg>
      Run {ready} ready · coming next
    </button>
  );
}

function Counters({ status }: { status: GraphStatusCounts }): React.ReactElement {
  return (
    <span style={{ display: "none" }}>{status.planned}</span>
  );
}
void Counters;

function Divider(): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{ width: 1, height: 18, background: "var(--border-soft)", alignSelf: "center" }}
    />
  );
}

function Chip({
  label,
  value,
  color,
  active,
  onClick
}: {
  label: string;
  value: number;
  color: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 10px",
        height: 24,
        borderRadius: 999,
        border: `1px solid ${active ? color : "var(--border)"}`,
        background: active
          ? `color-mix(in oklab, ${color} 14%, var(--surface))`
          : "var(--surface)",
        color: active ? "var(--text)" : "var(--text-2)",
        fontSize: 11.5,
        fontWeight: 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out"
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      <span style={{ fontFamily: "var(--font-sans)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: active ? "var(--text-2)" : "var(--text-3)" }}>
        {value}
      </span>
    </button>
  );
}
