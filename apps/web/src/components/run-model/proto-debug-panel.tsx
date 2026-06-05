/**
 * Proto model-debug panel (PR 06). A prototype-only inspector of the derived
 * model: fixture, last applied event, cursor, and the live selector outputs.
 * This is NOT the final focus/inspector surface (PR 10) — it exists to make the
 * projection legible while validating it.
 */
import type { ProtoDebug } from "@/lib/run-model/proto-view";

export function ProtoDebugPanel({ debug }: { debug: ProtoDebug }): React.ReactElement {
  const rows: Array<[string, string]> = [
    ["fixture", debug.fixtureName ?? "—"],
    ["último seq", debug.lastEventSeq !== undefined ? String(debug.lastEventSeq) : "—"],
    ["último evento", debug.lastEventType ?? "—"],
    ["cursor", String(debug.cursor)],
    ["phase", debug.phase],
    ["health", debug.health],
    ["wavefront", fmt(debug.wavefront)],
    ["attention (pending)", fmt(debug.pendingDecisionIds)],
    ["blocked", fmt(debug.blockedNodeIds)],
    ["conflicts (active)", String(debug.activeConflictCount)],
    ["invalidated", fmt(debug.invalidatedNodes)],
    ["pending re-exec", fmt(debug.pendingReexecution)]
  ];

  return (
    <section
      style={{
        marginTop: 16,
        padding: "12px 14px",
        background: "rgba(241,234,216,0.02)",
        border: "1px dashed var(--border, rgba(241,234,216,0.18))",
        borderRadius: "var(--r-md, 8px)"
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-3, #9a927f)",
          marginBottom: 8
        }}
      >
        Debug del modelo (prototipo)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, auto) 1fr", gap: "4px 16px" }}>
        {rows.map(([key, value]) => (
          <DebugRow key={key} label={key} value={value} />
        ))}
      </div>
    </section>
  );
}

function DebugRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-3, #9a927f)" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-1, #f1ead8)" }}>
        {value}
      </span>
    </>
  );
}

function fmt(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "—";
}
