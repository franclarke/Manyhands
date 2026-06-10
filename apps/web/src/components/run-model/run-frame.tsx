/**
 * Persistent run frame (PR 06) — the always-visible "what are we building and where
 * are we?" header. Renders exactly the three derived things of the interaction
 * model (intent · phase · health) plus operative counters and a SUCCESS-FIRST
 * attention summary ("nada requiere tu atención" instead of an empty void).
 *
 * Pure presentational: it paints a `ProtoFrame` and derives nothing.
 */
import type { ProtoFrame } from "@/lib/run-model/proto-view";

const PHASE_LABEL: Record<ProtoFrame["phase"], string> = {
  framing: "Encuadre",
  proposal: "Propuesta",
  foundation: "Cimientos",
  supervision: "Supervisión",
  reconciliation: "Reconciliación",
  disposition: "Cierre"
};

const HEALTH_LABEL: Record<ProtoFrame["health"], string> = {
  failing: "Fallando",
  attention: "Requiere atención",
  working: "Trabajando",
  settled: "Estable"
};

const HEALTH_COLOR: Record<ProtoFrame["health"], string> = {
  failing: "var(--error)",
  attention: "var(--gated)",
  working: "var(--running)",
  settled: "var(--done)"
};

export function RunFrame({ frame }: { frame: ProtoFrame }): React.ReactElement {
  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: "var(--surface, #1a1915)",
        border: "1px solid var(--border, rgba(241,234,216,0.12))",
        borderRadius: "var(--r-md, 8px)"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--copper, #d08a5a)"
          }}
        >
          Run
        </span>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-1, #f1ead8)" }}>
          {frame.intent.length > 0 ? frame.intent : "—"}
        </h1>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Chip label="Fase" value={PHASE_LABEL[frame.phase]} accent="var(--copper, #d08a5a)" />
        <Chip label="Salud" value={HEALTH_LABEL[frame.health]} accent={HEALTH_COLOR[frame.health]} dot />
        <Chip label="Nodos" value={String(frame.nodeCount)} />
        <Chip label="Wavefront" value={String(frame.wavefrontCount)} />
        <Chip label="Decisiones" value={String(frame.pendingDecisionCount)} />
        <Chip label="Conflictos" value={String(frame.activeConflictCount)} />
      </div>
    </header>
  );
}

function Chip({
  label,
  value,
  accent,
  dot = false
}: {
  label: string;
  value: string;
  accent?: string;
  dot?: boolean;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 6,
        background: "rgba(241,234,216,0.035)",
        border: "1px solid var(--border, rgba(241,234,216,0.12))",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: 12,
        color: "var(--text-2, #cfc7b4)"
      }}
    >
      {dot ? (
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: 999, background: accent ?? "var(--text-3, #9a927f)" }}
        />
      ) : null}
      <span style={{ color: "var(--text-3, #9a927f)", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ color: accent ?? "var(--text-1, #f1ead8)", fontWeight: 600 }}>{value}</span>
    </span>
  );
}
