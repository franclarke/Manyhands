"use client";

/**
 * Focus panel (PR-U1) — the on-demand deep inspector.
 *
 * Presentational ONLY: it receives a `FocusView` (built by `buildFocusView`) and
 * paints node / seam / conflict / decision / evidence — plus a safe `missing`
 * state. It never receives the raw `RunModel`, never derives domain state, and
 * never pauses playback (the parent keeps playing while this is open).
 *
 * Artifacts (diff / log / diagnosis / narrative) resolve lazily through the
 * run artifact endpoint. Cross links call `onFocus` so the human can navigate
 * depth without leaving the control room.
 */
import { useEffect, useState } from "react";
import type {
  ConflictFocusView,
  DecisionFocusView,
  EvidenceFocusView,
  FocusRef,
  FocusTarget,
  FocusView,
  MissingFocusView,
  NodeFocusView,
  SeamFocusView
} from "@/lib/run-model/focus-view";
import type { GranularityMetrics, NodePlanningStatus } from "@/lib/run-model/types";

export function FocusPanel({
  view,
  onClose,
  onFocus
}: {
  view: FocusView;
  onClose: () => void;
  onFocus?: ((target: FocusTarget) => void) | undefined;
}): React.ReactElement {
  return (
    <aside
      aria-label="Panel de foco"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: "100%",
        padding: "14px 16px",
        background: "var(--surface, #1a1915)",
        borderLeft: "2px solid var(--copper, #d08a5a)"
      }}
    >
      <Header view={view} onClose={onClose} />
      <Body view={view} onFocus={onFocus} />
    </aside>
  );
}

const KIND_LABEL: Record<FocusView["kind"], string> = {
  node: "Nodo",
  seam: "Costura",
  conflict: "Conflicto",
  decision: "Decisión",
  evidence: "Evidencia",
  missing: "Foco"
};

function Header({ view, onClose }: { view: FocusView; onClose: () => void }): React.ReactElement {
  const title = headerTitle(view);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            color: "var(--copper, #d08a5a)"
          }}
        >
          Foco · {KIND_LABEL[view.kind]}
        </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar foco"
        style={{
          minHeight: 28,
          padding: "0 10px",
          borderRadius: 6,
          border: "1px solid var(--rule-control, rgba(241,234,216,0.2))",
          background: "rgba(241,234,216,0.035)",
          color: "var(--text-2, #cfc7b4)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          cursor: "pointer"
        }}
      >
        Cerrar ✕
      </button>
      </div>
      <strong style={{ fontSize: 15, lineHeight: 1.35, color: "var(--text-1, #f1ead8)", overflowWrap: "break-word" }}>
        {title}
      </strong>
    </div>
  );
}

function headerTitle(view: FocusView): string {
  switch (view.kind) {
    case "node":
      return view.title.length > 0 ? view.title : view.id;
    case "seam":
      return view.name;
    case "conflict":
      return `${view.dimension} · ${view.id}`;
    case "decision":
      return view.label;
    case "evidence":
      return "Resultado final";
    case "missing":
      return view.title;
    default:
      return "";
  }
}

function Body({ view, onFocus }: { view: FocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  switch (view.kind) {
    case "node":
      return <NodeBody view={view} onFocus={onFocus} />;
    case "seam":
      return <SeamBody view={view} onFocus={onFocus} />;
    case "conflict":
      return <ConflictBody view={view} onFocus={onFocus} />;
    case "decision":
      return <DecisionBody view={view} onFocus={onFocus} />;
    case "evidence":
      return <EvidenceBody view={view} onFocus={onFocus} />;
    case "missing":
      return <MissingBody view={view} />;
    default:
      return <></>;
  }
}

// ── Node ──────────────────────────────────────────────────────────────────────────

function NodeBody({ view, onFocus }: { view: NodeFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  const showConsole =
    view.console.lines.length > 0 ||
    view.vital.status === "running" ||
    view.vital.status === "verifying" ||
    view.vital.status === "repairing";

  return (
    <Stack>
      {showConsole ? <NodeConsole view={view} /> : null}
      <Field label="Estado" value={`${view.display} · ${view.freshness}`} strong />
      <Field label="Signo vital" value={`${view.vital.label}${view.vital.detail !== undefined ? ` — ${view.vital.detail}` : ""}`} />
      {view.vital.verificationSummary !== undefined ? <Field label="Verificación" value={view.vital.verificationSummary} mono /> : null}
      <Field label="Rol · prof." value={`${view.role} · d${view.depth}`} />
      {view.goal.length > 0 ? <Field label="Objetivo" value={view.goal} /> : null}
      {view.parent !== undefined ? <Field label="Padre" value={`${view.parent.title} (${view.parent.id})`} mono /> : null}
      <Field label="Alcance" value={view.scope.paths.length > 0 ? `${view.scope.paths.join(", ")} · ${view.scope.origin}` : `— · ${view.scope.origin}`} mono />
      {view.commit !== undefined ? <Field label="Commit" value={view.commit} mono /> : null}
      {view.changedFiles.length > 0 ? <Field label="Archivos" value={view.changedFiles.join(", ")} mono /> : null}
      {view.builtAgainst.length > 0 ? (
        <Field label="Construido contra" value={view.builtAgainst.map((b) => `${b.seamId}@${b.revision}`).join(", ")} mono />
      ) : null}
      {view.producedRevision !== undefined ? (
        <Field label="Produce rev." value={`${view.producedRevision.seamId}@${view.producedRevision.revision}`} mono />
      ) : null}
      {view.planning !== undefined ? <Field label="Planning" value={formatPlanning(view.planning)} mono /> : null}

      {view.produces.length > 0 ? (
        <ChipRow label="Produce costuras">
          {view.produces.map((s) => (
            <LinkChip key={s.id} text={`${s.id} (${s.state} r${s.revision})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: s.id }) : undefined} />
          ))}
        </ChipRow>
      ) : null}
      {view.consumes.length > 0 ? (
        <ChipRow label="Consume costuras">
          {view.consumes.map((s) => (
            <LinkChip key={s.id} text={`${s.id} (${s.state} r${s.revision})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: s.id }) : undefined} />
          ))}
        </ChipRow>
      ) : null}

      <ChipRow label="Banderas">
        {view.isInWavefront ? <Chip text="wavefront" color="var(--running)" /> : null}
        {view.isBlocked ? <Chip text="bloqueado" color="var(--blocked, #b08a4a)" /> : null}
        {view.isInvalidated ? <Chip text="obsoleto" color="var(--gated, #d0953a)" /> : null}
        {view.isPendingReexecution ? <Chip text="re-ejecución pendiente" color="var(--gated, #d0953a)" /> : null}
        {view.isAffectedByPendingAmendment ? <Chip text="enmienda pendiente" color="var(--copper, #d08a5a)" /> : null}
        {view.hasActiveConflict ? <Chip text="conflicto" color="var(--error, #cf5b5b)" /> : null}
        {!view.isInWavefront && !view.isBlocked && !view.isInvalidated && !view.isPendingReexecution && !view.isAffectedByPendingAmendment && !view.hasActiveConflict ? (
          <span style={mutedStyle}>—</span>
        ) : null}
      </ChipRow>

      <RefList refs={view.refs} />
    </Stack>
  );
}

// ── Seam ──────────────────────────────────────────────────────────────────────────

function NodeConsole({ view }: { view: NodeFocusView }): React.ReactElement {
  return (
    <section
      aria-label="Consola del agente"
      style={{
        display: "grid",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid rgba(241,234,216,0.16)",
        background: "rgba(0,0,0,0.24)"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={labelStyle}>Consola en vivo</span>
        <span style={{ ...monoValueStyle, fontSize: 10.5 }}>
          {view.console.lines.length} chunks{view.console.truncated ? " · ultimos 200" : ""}
        </span>
      </div>
      {view.console.lines.length === 0 ? (
        <span style={monoValueStyle}>Esperando output visible de Gemini...</span>
      ) : (
        <pre
          style={{
            margin: 0,
            maxHeight: 300,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-2, #cfc7b4)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            lineHeight: 1.45
          }}
        >
          {view.console.lines.map((line) => `[${line.stream}] ${line.chunk}`).join("")}
        </pre>
      )}
    </section>
  );
}

function SeamBody({ view, onFocus }: { view: SeamFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  return (
    <Stack>
      <Field label="Estado" value={`${view.state} · rev ${view.revision}${view.lastChangeKind !== undefined ? ` · último cambio: ${view.lastChangeKind}` : ""}`} strong />
      <ChipRow label="Productor">
        <LinkChip
          text={view.producer !== undefined ? `${view.producer.title} (${view.producerNodeId})` : view.producerNodeId}
          onClick={onFocus !== undefined ? () => onFocus({ kind: "node", id: view.producerNodeId }) : undefined}
        />
      </ChipRow>
      <ChipRow label="Consumidores">
        {view.consumers.length === 0 ? <span style={mutedStyle}>—</span> : null}
        {view.consumers.map((c) => (
          <LinkChip key={c.id} text={`${c.title} (${c.id})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "node", id: c.id }) : undefined} />
        ))}
      </ChipRow>
      <Field label="Firma (draft)" value={view.signatureDraft} mono />
      {view.signatureFrozen !== undefined ? <Field label="Firma (frozen)" value={view.signatureFrozen} mono /> : null}
      {view.contract !== undefined ? (
        <Field label="Contrato" value={Object.entries(view.contract).map(([k, v]) => `${k}=${v}`).join(" · ")} mono />
      ) : null}
      {view.affectedNodeIds.length > 0 ? <Field label="Afecta (enmienda)" value={view.affectedNodeIds.join(", ")} mono /> : null}
      <Note text={view.parallelismNote} />
    </Stack>
  );
}

// ── Conflict ──────────────────────────────────────────────────────────────────────

function ConflictBody({ view, onFocus }: { view: ConflictFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  return (
    <Stack>
      <Field label="Dimensión" value={`${view.dimension} · ${view.status}`} strong />
      <Field label="Auto-resolvible" value={view.autoResolvable ? "sí" : "no — requiere humano"} />
      <Field label="Nodos" value={view.nodeIds.join(", ")} mono />
      {view.seamId !== undefined ? (
        <ChipRow label="Costura">
          <LinkChip text={view.seamId} onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: view.seamId! }) : undefined} />
        </ChipRow>
      ) : null}
      <Field label="Archivos" value={view.files.join(", ")} mono />
      <RefLine refItem={view.diagnosisRef} />
      {view.decision !== undefined ? (
        <ChipRow label="Decisión">
          <LinkChip
            text={`${view.decision.kind} · ${view.decision.status} (${view.decision.id})`}
            onClick={onFocus !== undefined ? () => onFocus({ kind: "decision", id: view.decision!.id }) : undefined}
          />
        </ChipRow>
      ) : null}
      {view.resolution !== undefined ? (
        <Field label="Resolución" value={`${view.resolution.by} · ${view.resolution.resolutionId}`} mono />
      ) : null}
      <Note text={view.judgementNote} tone="warn" />
    </Stack>
  );
}

// ── Decision ──────────────────────────────────────────────────────────────────────

function DecisionBody({ view, onFocus }: { view: DecisionFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  return (
    <Stack>
      <Field label="Tipo" value={`${view.decisionKind} · ${view.blocking ? "bloqueante" : "advisory"} · ${view.status}`} strong />
      <Field label="Resumen" value={view.summary} />
      {view.question !== undefined ? <Field label="Pregunta" value={view.question} /> : null}
      {view.options !== undefined && view.options.length > 0 ? <Field label="Opciones" value={view.options.join(" · ")} /> : null}
      {view.choice !== undefined ? <Field label="Elección" value={formatChoice(view.choice)} mono /> : null}
      {view.resolvedAt !== undefined ? <Field label="Resuelta" value={view.resolvedAt} mono /> : null}
      {view.nodeIds.length > 0 ? <Field label="Nodos" value={view.nodeIds.join(", ")} mono /> : null}

      {view.conflict !== undefined ? (
        <ChipRow label="Conflicto">
          <LinkChip
            text={`${view.conflict.dimension} · ${view.conflict.status} (${view.conflict.id})`}
            onClick={onFocus !== undefined ? () => onFocus({ kind: "conflict", id: view.conflict!.id }) : undefined}
          />
        </ChipRow>
      ) : null}
      {view.amendment !== undefined ? (
        <>
          <Field label="Enmienda" value={`${view.amendment.changeKind} (${view.amendment.id})`} />
          <Field label="Afecta" value={view.affectedNodeIds.join(", ")} mono />
        </>
      ) : null}
      {view.seam !== undefined ? (
        <ChipRow label="Costura">
          <LinkChip
            text={`${view.seam.name} · rev ${view.seam.revision} · ${view.seam.state}`}
            onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: view.seam!.id }) : undefined}
          />
        </ChipRow>
      ) : null}
      {view.evidence !== undefined ? (
        <ChipRow label="Evidencia">
          <LinkChip
            text={`tests ${view.evidence.tests.pass}/${view.evidence.tests.total} · commit ${view.evidence.integrationCommit}`}
            onClick={onFocus !== undefined ? () => onFocus({ kind: "evidence", id: "final" }) : undefined}
          />
        </ChipRow>
      ) : null}

      {view.pendingAction !== undefined ? (
        <Note text={`Acción disponible en el canal: ${view.pendingAction.label}.`} />
      ) : null}
    </Stack>
  );
}

function formatMetrics(m: GranularityMetrics): string {
  const pct = (r: number): string => `${Math.round(r * 100)}%`;
  return [
    `prof ${m.depth}`,
    `hojas ${m.leafCount}`,
    `composites ${m.compositeCount}`,
    `éxito-hoja ${pct(m.leafSuccessRate)}`,
    `éxito-int ${pct(m.integrationSuccessRate)}`,
    `conflicto ${pct(m.conflictRate)}`,
    `líneas ${m.linesChanged}`,
    `${Math.round(m.totalDurationMs / 1000)}s`
  ].join(" · ");
}

function formatPlanning(planning: NodePlanningStatus): string {
  const attempts = planning.attempt !== undefined
    ? ` · intento ${planning.attempt}${planning.maxAttempts !== undefined ? `/${planning.maxAttempts}` : ""}`
    : "";
  const error = planning.errorKind !== undefined ? ` · ${planning.errorKind}` : "";
  return `${planning.state}${attempts}${error}`;
}

function formatChoice(choice: DecisionFocusView["choice"]): string {
  if (choice === undefined) return "—";
  if ("action" in choice) return choice.action;
  if ("answer" in choice) return choice.answer;
  if ("resolutionId" in choice) return choice.resolutionId;
  return "—";
}

// ── Evidence ──────────────────────────────────────────────────────────────────────

function EvidenceBody({ view, onFocus }: { view: EvidenceFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  return (
    <Stack>
      <Field label="Tests" value={`${view.tests.pass}/${view.tests.total}`} strong />
      <Field label="Commit" value={view.integrationCommit} mono />
      <RefLine refItem={view.aggregateDiffRef} />
      <RefLine refItem={view.narrativeRef} />
      {view.metrics !== undefined ? <Field label="Métricas" value={formatMetrics(view.metrics)} mono /> : null}
      {view.invalidationTrace !== undefined && view.invalidationTrace.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Traza de invalidación</span>
          {view.invalidationTrace.map((t) => (
            <span key={t.seamId} style={{ ...monoValueStyle, fontSize: 11 }}>
              {t.seamId} {t.from}→{t.to} · {t.cause}
            </span>
          ))}
          <Field label="Re-ejecutados" value={view.reExecuted.join(", ") || "—"} mono />
          <Field label="Re-integrados" value={view.reIntegrated.join(", ") || "—"} mono />
          <Field label="Preservados" value={view.preserved.join(", ") || "—"} mono />
        </div>
      ) : null}
      {view.approveMergeDecision !== undefined ? (
        <ChipRow label="Aprobación">
          <LinkChip
            text={`approve_merge · ${view.approveMergeDecision.status} (${view.approveMergeDecision.id})`}
            onClick={onFocus !== undefined ? () => onFocus({ kind: "decision", id: view.approveMergeDecision!.id }) : undefined}
          />
        </ChipRow>
      ) : null}
      <Note text={view.acceptanceCopy} tone="success" />
    </Stack>
  );
}

// ── Missing ───────────────────────────────────────────────────────────────────────

function MissingBody({ view }: { view: MissingFocusView }): React.ReactElement {
  return (
    <Stack>
      <Field label="Objetivo" value={`${view.target.kind}:${view.target.id}`} mono />
      <Note text={view.message} tone="warn" />
    </Stack>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-3, #9a927f)" };
const valueStyle: React.CSSProperties = { fontSize: 12.5, color: "var(--text-2, #cfc7b4)", wordBreak: "break-word" };
const monoValueStyle: React.CSSProperties = { ...valueStyle, fontFamily: "var(--font-mono, monospace)" };
const mutedStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-3, #9a927f)" };

function Stack({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>;
}

function Field({ label, value, mono = false, strong = false }: { label: string; value: string; mono?: boolean; strong?: boolean }): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", gap: "2px 12px", alignItems: "baseline" }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...(mono ? monoValueStyle : valueStyle), ...(strong ? { color: "var(--text-1, #f1ead8)", fontWeight: 600 } : {}) }}>{value}</span>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", gap: "2px 12px", alignItems: "baseline" }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function Chip({ text, color }: { text: string; color?: string }): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 10.5,
        padding: "2px 7px",
        borderRadius: 999,
        border: `1px solid ${color ?? "var(--border, rgba(241,234,216,0.18))"}`,
        color: color ?? "var(--text-3, #9a927f)"
      }}
    >
      {text}
    </span>
  );
}

function LinkChip({ text, onClick }: { text: string; onClick?: (() => void) | undefined }): React.ReactElement {
  if (onClick === undefined) return <Chip text={text} />;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 10.5,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid var(--copper, #d08a5a)",
        background: "rgba(208,138,90,0.10)",
        color: "var(--copper-hi, #e0a070)",
        cursor: "pointer"
      }}
    >
      {text} ↗
    </button>
  );
}

function RefLine({ refItem }: { refItem: FocusRef }): React.ReactElement {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", gap: "2px 12px", alignItems: "baseline" }}>
      <span style={labelStyle}>{refItem.label}</span>
      <ArtifactViewer refItem={refItem} />
    </div>
  );
}

function RefList({ refs }: { refs: FocusRef[] }): React.ReactElement | null {
  if (refs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {refs.map((r) => (
        <RefLine key={r.ref} refItem={r} />
      ))}
    </div>
  );
}

interface ArtifactPayload {
  ref: string;
  kind: string;
  title: string;
  content: string;
  language?: string;
}

function ArtifactViewer({ refItem }: { refItem: FocusRef }): React.ReactElement {
  const [payload, setPayload] = useState<ArtifactPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = runIdFromRef(refItem.ref);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    if (!refItem.available || runId === null) return;
    void fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts?ref=${encodeURIComponent(refItem.ref)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? response.statusText);
        return response.json() as Promise<ArtifactPayload>;
      })
      .then((artifact) => {
        if (!cancelled) setPayload(artifact);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refItem.available, refItem.ref, runId]);

  if (!refItem.available || runId === null) {
    return <span style={monoValueStyle}>Artefacto referenciado: {refItem.ref}</span>;
  }

  if (error !== null) {
    const notFound = /not found|404/i.test(error);
    return (
      <span style={{ ...(notFound ? valueStyle : monoValueStyle), color: notFound ? "var(--text-3, #9a927f)" : "var(--gated, #d0953a)" }}>
        {notFound ? "Sin artefacto disponible todavía." : `${refItem.label}: ${error}`}
      </span>
    );
  }

  if (payload === null) {
    return <span style={monoValueStyle}>{refItem.ref} · cargando...</span>;
  }

  return (
    <details style={{ gridColumn: "2 / 3" }}>
      <summary style={{ ...monoValueStyle, cursor: "pointer" }}>{payload.title}</summary>
      <pre
        style={{
          margin: "6px 0 0",
          maxHeight: 260,
          overflow: "auto",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid var(--border, rgba(241,234,216,0.12))",
          background: "rgba(0,0,0,0.22)",
          color: "var(--text-2, #cfc7b4)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          whiteSpace: "pre-wrap"
        }}
      >
        {payload.content}
      </pre>
    </details>
  );
}

function runIdFromRef(ref: string): string | null {
  try {
    const url = new URL(ref);
    const parts = [url.hostname, ...url.pathname.split("/").filter((part) => part.length > 0)];
    return parts[0] === "runs" && parts[1] !== undefined ? parts[1] : null;
  } catch {
    return null;
  }
}

function Note({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "success" }): React.ReactElement {
  const color = tone === "warn" ? "var(--gated, #d0953a)" : tone === "success" ? "var(--done, #6bbf73)" : "var(--text-3, #9a927f)";
  const bg = tone === "warn" ? "rgba(208,149,58,0.08)" : tone === "success" ? "rgba(107,191,115,0.06)" : "rgba(241,234,216,0.02)";
  return (
    <div style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${color}`, background: bg, color, fontSize: 12, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}
