/**
 * Decision channel (PR 07) — the single surface for human judgement.
 *
 * It is NOT a notification center: it shows only what the system needs decided,
 * blocking-first, with the context embedded; empty is rendered as operational
 * SUCCESS, not as a void. It paints a `DecisionChannelView` (built by
 * `buildDecisionChannelView`) and never reads the raw model or derives attention.
 * Resolution is simulated: the primary action calls `onResolve(decisionId)`,
 * which fast-forwards the fixture (see `useFixturePlayback`). When a decision has
 * no resolution ahead in the fixture, its action is disabled with a clear note.
 */
import type {
  DecisionChannelItem,
  DecisionChannelView
} from "@/lib/run-model/decision-channel-view";

export function DecisionChannel({
  view,
  resolvableIds,
  onResolve,
  onFocus,
  focusedDecisionId
}: {
  view: DecisionChannelView;
  resolvableIds: ReadonlySet<string>;
  onResolve: (decisionId: string) => void;
  /** Opens the focus panel for a decision (does not resolve it, does not pause playback). */
  onFocus?: (decisionId: string) => void;
  focusedDecisionId?: string | null;
}): React.ReactElement {
  return (
    <section
      style={{
        padding: "12px 14px",
        background: "var(--surface, #1a1915)",
        border: `1px solid ${view.empty ? "var(--border, rgba(241,234,216,0.12))" : "rgba(208,149,58,0.4)"}`,
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
          marginBottom: 10
        }}
      >
        Canal de decisiones
      </div>

      {view.empty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--done, #6bbf73)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 14
            }}
          >
            <span aria-hidden>✓</span>
            <span>{view.emptyCopy}</span>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-3, #9a927f)", paddingLeft: 22 }}>
            El sistema te trae solo lo que necesita tu juicio.
          </span>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {view.items.map((item) => (
            <DecisionCard
              key={item.id}
              item={item}
              resolvable={resolvableIds.has(item.id)}
              onResolve={onResolve}
              selected={focusedDecisionId === item.id}
              {...(onFocus !== undefined ? { onFocus } : {})}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionCard({
  item,
  resolvable,
  onResolve,
  onFocus,
  selected = false
}: {
  item: DecisionChannelItem;
  resolvable: boolean;
  onResolve: (decisionId: string) => void;
  onFocus?: (decisionId: string) => void;
  selected?: boolean;
}): React.ReactElement {
  const accent = item.blocking ? "var(--gated, #d0953a)" : "var(--border, rgba(241,234,216,0.2))";
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        background: "rgba(241,234,216,0.02)",
        border: `1px solid ${selected ? "var(--copper, #d08a5a)" : "var(--border, rgba(241,234,216,0.12))"}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ color: "var(--text-1, #f1ead8)", fontSize: 14 }}>{item.label}</strong>
        {item.blocking ? (
          <Pill text="bloqueante" color="var(--gated, #d0953a)" />
        ) : (
          <Pill text="advisory" />
        )}
        <code style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3, #9a927f)" }}>{item.id}</code>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2, #cfc7b4)" }}>{item.summary}</p>

      <DecisionContext item={item} />

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={resolvable ? () => onResolve(item.id) : undefined}
          disabled={!resolvable}
          style={{
            minHeight: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: `1px solid ${resolvable ? "var(--copper, #d08a5a)" : "var(--rule-control, rgba(241,234,216,0.2))"}`,
            background: resolvable ? "rgba(208,138,90,0.16)" : "rgba(241,234,216,0.03)",
            color: resolvable ? "var(--copper-hi, #e0a070)" : "var(--text-4, #6f6857)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            cursor: resolvable ? "pointer" : "not-allowed"
          }}
        >
          {item.primaryActionLabel}
        </button>
        {onFocus !== undefined ? (
          <button
            type="button"
            onClick={() => onFocus(item.id)}
            aria-pressed={selected}
            style={{
              minHeight: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: `1px solid ${selected ? "var(--copper, #d08a5a)" : "var(--rule-control, rgba(241,234,216,0.2))"}`,
              background: selected ? "rgba(208,138,90,0.12)" : "rgba(241,234,216,0.035)",
              color: "var(--text-2, #cfc7b4)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            Inspeccionar
          </button>
        ) : null}
        {!resolvable ? (
          <span style={{ fontSize: 11, color: "var(--text-3, #9a927f)" }}>
            Sin resolución en este fixture
          </span>
        ) : null}
      </div>
    </li>
  );
}

function DecisionContext({ item }: { item: DecisionChannelItem }): React.ReactElement | null {
  const rows: React.ReactNode[] = [];

  if (item.question !== undefined) {
    rows.push(<Row key="q" label="Pregunta" value={item.question} />);
  }
  if (item.options !== undefined && item.options.length > 0) {
    rows.push(<Row key="opt" label="Opciones" value={item.options.join(" · ")} />);
  }
  if (item.conflict !== undefined) {
    rows.push(<Row key="cf-dim" label="Conflicto" value={`${item.conflict.dimension} · ${item.conflict.status}`} />);
    rows.push(<Row key="cf-diag" label="Diagnóstico" value={item.conflict.diagnosisRef} mono />);
    if (item.conflict.nodeIds.length > 0) {
      rows.push(<Row key="cf-nodes" label="Nodos" value={item.conflict.nodeIds.join(", ")} mono />);
    }
  }
  if (item.amendment !== undefined) {
    rows.push(<Row key="am-kind" label="Enmienda" value={`${item.amendment.kind} · ${item.amendment.changeKind}`} />);
    rows.push(<Row key="am-affects" label="Afecta" value={item.amendment.affects.join(", ")} mono />);
  }
  if (item.seam !== undefined) {
    rows.push(
      <Row key="seam" label="Costura" value={`${item.seam.name} · rev ${item.seam.revision} · ${item.seam.state}`} />
    );
  }
  if (item.evidence !== undefined) {
    rows.push(
      <Row key="ev-tests" label="Tests" value={`${item.evidence.tests.pass}/${item.evidence.tests.total}`} />
    );
    rows.push(<Row key="ev-diff" label="Diff" value={item.evidence.aggregateDiffRef} mono />);
    rows.push(<Row key="ev-narr" label="Narrativa" value={item.evidence.narrativeRef} mono />);
  }
  // Decision-level affected nodes (when not already covered by a conflict ref).
  if (item.conflict === undefined && item.affectedNodeIds.length > 0) {
    rows.push(<Row key="nodes" label="Nodos" value={item.affectedNodeIds.join(", ")} mono />);
  }

  if (rows.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(96px, auto) 1fr", gap: "3px 12px" }}>{rows}</div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <>
      <span style={{ fontSize: 12, color: "var(--text-3, #9a927f)" }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-2, #cfc7b4)",
          fontFamily: mono ? "var(--font-mono, monospace)" : "inherit",
          wordBreak: "break-word"
        }}
      >
        {value}
      </span>
    </>
  );
}

function Pill({ text, color }: { text: string; color?: string }): React.ReactElement {
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: "2px 7px",
        borderRadius: 999,
        border: `1px solid ${color ?? "var(--border, rgba(241,234,216,0.2))"}`,
        color: color ?? "var(--text-3, #9a927f)",
        fontFamily: "var(--font-mono, monospace)"
      }}
    >
      {text}
    </span>
  );
}
