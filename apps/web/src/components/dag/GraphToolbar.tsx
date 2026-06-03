"use client";

import type {
  GraphNodeStatus,
  GraphRiskLevel,
  RunGraphViewModel
} from "@/lib/graph-view-model";
import type { GraphFilterState } from "@/lib/graph-filters";
import { filtersAreEmpty } from "@/lib/graph-filters";

interface GraphToolbarProps {
  graph: RunGraphViewModel;
  benchmarkLabel: string;
  configLabel: string;
  mode: "Replay" | "Lab" | "Run";
  filters: GraphFilterState;
  onFiltersChange: (next: GraphFilterState) => void;
  matchedCount: number;
}

export function GraphToolbar({
  graph,
  benchmarkLabel,
  configLabel,
  mode,
  filters,
  onFiltersChange,
  matchedCount
}: GraphToolbarProps): React.ReactElement {
  const empty = filtersAreEmpty(filters);

  function clear(): void {
    onFiltersChange({
      text: "",
      statuses: new Set(),
      risks: new Set(),
      kinds: new Set(),
      gateOnly: false
    });
  }

  function filterStatuses(statuses: GraphNodeStatus[]): void {
    onFiltersChange({
      ...filters,
      statuses: new Set(statuses),
      risks: new Set(),
      gateOnly: false
    });
  }

  function filterRisks(risks: GraphRiskLevel[]): void {
    onFiltersChange({
      ...filters,
      statuses: new Set(),
      risks: new Set(risks),
      gateOnly: false
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "8px 0"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
        <ModeBadge mode={mode} deterministic={graph.deterministic} />
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {benchmarkLabel}
        </span>
        <span style={{ color: "var(--text-4)" }}>/</span>
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {configLabel}
        </span>
        <span style={{ color: "var(--text-4)" }}>/</span>
        <span className="mh-serif" style={{ fontSize: 15, color: "var(--text)" }}>
          {graph.featureId}
        </span>
      </div>

      <span style={{ flex: 1 }} />

      <SearchInput
        value={filters.text}
        onChange={(value) => onFiltersChange({ ...filters, text: value })}
      />

      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", maxWidth: "100%" }}>
        <FilterButton active={empty} label="All" onClick={clear} />
        <FilterButton
          active={setEquals(filters.statuses, ["ready"])}
          color="var(--ready)"
          label="Ready"
          onClick={() => filterStatuses(["ready"])}
        />
        <FilterButton
          active={setEquals(filters.statuses, ["running", "generating"])}
          color="var(--running)"
          label="Running"
          onClick={() => filterStatuses(["running", "generating"])}
        />
        <FilterButton
          active={setEquals(filters.statuses, ["blocked", "gated"])}
          color="var(--blocked)"
          label="Blocked"
          onClick={() => filterStatuses(["blocked", "gated"])}
        />
        <FilterButton
          active={setEquals(filters.risks, ["high", "blocking"])}
          color="var(--risk-high)"
          label="Risk"
          onClick={() => filterRisks(["high", "blocking"])}
        />
        <FilterButton
          active={setEquals(filters.statuses, ["failed"])}
          color="var(--error)"
          label="Failed"
          onClick={() => filterStatuses(["failed"])}
        />
      </div>

      {!empty ? (
        <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {matchedCount}/{graph.summary.taskCount} visible
        </span>
      ) : null}
    </div>
  );
}

function ModeBadge({ mode, deterministic }: { mode: "Replay" | "Lab" | "Run"; deterministic: boolean }): React.ReactElement {
  return (
    <span
      className="mh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 28,
        padding: "0 8px",
        borderRadius: 999,
        border: "1px solid var(--rule-strong)",
        color: "var(--copper)",
        fontSize: 12,
        textTransform: "uppercase"
      }}
    >
      <span className="mh-dot" style={{ width: 5, height: 5 }} />
      {mode}
      {deterministic ? " / mock" : ""}
    </span>
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
        border: "1px solid var(--rule-control)",
        borderRadius: 5,
        minHeight: 36,
        background: "rgba(241,234,216,0.035)"
      }}
    >
      <span style={{ color: "var(--text-2)", fontSize: 12 }}>search</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="node, path, title"
        spellCheck={false}
        style={{
          width: 220,
          minHeight: 34,
          border: "none",
          background: "transparent",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.35
        }}
      />
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
  color = "var(--text-3)"
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 36,
        padding: "0 10px",
        border: `1px solid ${active ? color : "var(--rule-control)"}`,
        background: active ? "rgba(241,234,216,0.10)" : "rgba(241,234,216,0.025)",
        color: active ? "var(--text)" : "var(--text-2)",
        borderRadius: 5,
        fontSize: 12,
        cursor: "pointer"
      }}
    >
      <span className="mh-dot" style={{ color }} />
      {label}
    </button>
  );
}

function setEquals<T extends string>(set: ReadonlySet<T>, values: T[]): boolean {
  return set.size === values.length && values.every((value) => set.has(value));
}

