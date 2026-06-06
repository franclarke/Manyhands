/**
 * Timeline / audit-trail (U-B) — a SECONDARY lens, not the primary surface.
 *
 * Presentational only: paints a `TimelineView` (built by `buildTimelineView` over
 * the raw event log). It derives nothing. Rendered collapsed by default so the
 * phase-adaptive surface stays the protagonist; `focusedNodeId` dims entries that
 * do not concern the focused node (per-node audit without leaving the control room).
 */
import type { TimelineEntry, TimelineTone, TimelineView } from "@/lib/run-model/timeline-view";

const TONE_COLOR: Record<TimelineTone, string> = {
  info: "var(--text-3, #9a927f)",
  good: "var(--done, #6bbf73)",
  warn: "var(--gated, #d0953a)",
  bad: "var(--error, #cf5b5b)",
  human: "var(--copper, #d08a5a)"
};

export function Timeline({
  view,
  focusedNodeId
}: {
  view: TimelineView;
  focusedNodeId?: string | null;
}): React.ReactElement {
  const label = focusedNodeId != null ? `Auditoría · timeline — foco en ${focusedNodeId}` : "Auditoría · timeline";
  return (
    <details
      style={{
        background: "var(--surface, #1a1915)",
        border: "1px solid var(--border, rgba(241,234,216,0.12))",
        borderRadius: "var(--r-md, 8px)",
        padding: "8px 12px"
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--copper, #d08a5a)"
        }}
      >
        {label} ({view.count})
      </summary>
      <ol style={{ listStyle: "none", margin: "10px 0 2px", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {view.entries.map((entry) => (
          <Row key={entry.seq} entry={entry} dim={focusedNodeId != null && entry.nodeId !== focusedNodeId} />
        ))}
      </ol>
    </details>
  );
}

function Row({ entry, dim }: { entry: TimelineEntry; dim: boolean }): React.ReactElement {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "32px 96px 1fr",
        gap: 10,
        alignItems: "baseline",
        padding: "3px 6px",
        borderRadius: 4,
        opacity: dim ? 0.4 : 1,
        borderLeft: `2px solid ${TONE_COLOR[entry.tone]}`
      }}
    >
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: "var(--text-4, #6f6857)" }}>#{entry.seq}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3, #9a927f)" }}>
        {entry.category}
      </span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: 12.5, color: TONE_COLOR[entry.tone] }}>{entry.title}</strong>
        {entry.detail !== undefined ? (
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3, #9a927f)" }}>{entry.detail}</span>
        ) : null}
        {entry.nodeId !== undefined ? (
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: "var(--text-4, #6f6857)" }}>{entry.nodeId}</span>
        ) : null}
      </span>
    </li>
  );
}
