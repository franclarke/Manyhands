/**
 * Workspace surface (PR 08) — the phase-adaptive central surface.
 *
 * It paints a `WorkspaceView` and changes EMPHASIS by mode (proposal → hypothesis,
 * foundation → frozen seams/waves, supervision → wavefront, reconciliation →
 * conflicts/blast, disposition → evidence protagonist). It derives nothing: node
 * paint state is `view.nodes[i].display` (from `selectRenderableNodeState`), never
 * `execution.kind`, so `integrated + stale` shows as "obsolete", never "done".
 *
 * No React Flow / `DagCanvas`: that needs the legacy `RunGraphViewModel` whose
 * `status` can't express `obsolete`. A column-by-depth surface stays faithful to
 * the operative model and testable; reconciling the real canvas is future work.
 */
import type {
  WorkspaceEvidence,
  WorkspaceNode,
  WorkspaceSeam,
  WorkspaceView,
  WorkspaceWave
} from "@/lib/run-model/workspace-view";
import type { ProtoConflictRow } from "@/lib/run-model/proto-view";

const MODE_LABEL: Record<WorkspaceView["mode"], string> = {
  framing: "Encuadre",
  proposal: "Propuesta",
  foundation: "Cimientos",
  supervision: "Supervisión",
  reconciliation: "Reconciliación",
  disposition: "Cierre"
};

const MODE_DESC: Record<WorkspaceView["mode"], string> = {
  framing: "Capturando intención y contexto.",
  proposal: "El plan es una hipótesis a aprobar.",
  foundation: "Congelando costuras y derivando alcances.",
  supervision: "Olas paralelas en ejecución.",
  reconciliation: "Integrando y resolviendo conflictos.",
  disposition: "La evidencia es protagonista; el DAG queda de contexto."
};

const DISPLAY_COLOR: Record<WorkspaceNode["display"], string> = {
  idle: "var(--text-3, #9a927f)",
  blocked: "var(--blocked, #b08a4a)",
  running: "var(--running, #5a9bd0)",
  verifying: "var(--running, #5a9bd0)",
  done: "var(--done, #6bbf73)",
  failed: "var(--error, #cf5b5b)",
  obsolete: "var(--gated, #d0953a)"
};

export function WorkspaceSurface({
  view,
  selectedNodeId,
  onSelect
}: {
  view: WorkspaceView;
  selectedNodeId?: string | null;
  onSelect?: (nodeId: string) => void;
}): React.ReactElement {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ModeBanner mode={view.mode} />

      {view.emphasis.showEvidenceProtagonist && view.evidence !== null ? (
        <EvidenceBlock evidence={view.evidence} />
      ) : null}

      {view.emphasis.showApprovePlanCallout ? (
        <Callout tone="action" text="El plan está propuesto como hipótesis. Aprobalo en el canal para comenzar." />
      ) : null}

      {view.blastPreview.active ? (
        <Callout
          tone="warn"
          text={`Blast radius proyectado (aún sin invalidar): ${view.blastPreview.nodeIds.join(", ")}`}
        />
      ) : null}

      <NodeColumns
        view={view}
        {...(selectedNodeId !== undefined ? { selectedNodeId } : {})}
        {...(onSelect !== undefined ? { onSelect } : {})}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SeamSection seams={view.seams} highlightFrozen={view.emphasis.showSeamsFrozen} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {view.emphasis.showWaves ? <WaveSection waves={view.waves} /> : null}
          <ConflictSection conflicts={view.conflicts} emphasized={view.emphasis.showConflicts} />
        </div>
      </div>
    </section>
  );
}

function ModeBanner({ mode }: { mode: WorkspaceView["mode"] }): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "8px 12px",
        borderRadius: "var(--r-md, 8px)",
        background: "rgba(208,138,90,0.08)",
        border: "1px solid rgba(208,138,90,0.28)"
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--copper, #d08a5a)"
        }}
      >
        Superficie · {MODE_LABEL[mode]}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-2, #cfc7b4)" }}>{MODE_DESC[mode]}</span>
    </div>
  );
}

function NodeColumns({
  view,
  selectedNodeId,
  onSelect
}: {
  view: WorkspaceView;
  selectedNodeId?: string | null;
  onSelect?: (nodeId: string) => void;
}): React.ReactElement {
  if (view.columns.length === 0) {
    return (
      <div style={{ padding: 20, color: "var(--text-3, #9a927f)", fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>
        El plan todavía no se propuso.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto", padding: 4 }}>
      {view.columns.map((column) => (
        <div key={column.depth} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 248 }}>
          <div
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-3, #9a927f)"
            }}
          >
            Profundidad {column.depth} · {column.nodes.length}
          </div>
          {column.nodes.map((node) => (
            <WorkspaceNodeCard
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              {...(onSelect !== undefined ? { onSelect } : {})}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function WorkspaceNodeCard({
  node,
  selected,
  onSelect
}: {
  node: WorkspaceNode;
  selected: boolean;
  onSelect?: (nodeId: string) => void;
}): React.ReactElement {
  const color = DISPLAY_COLOR[node.display];
  const borderColor = node.hasActiveConflict
    ? "var(--error, #cf5b5b)"
    : selected
      ? "var(--copper, #d08a5a)"
      : node.isAffectedByPendingAmendment
        ? "var(--gated, #d0953a)"
        : "var(--border, rgba(241,234,216,0.12))";
  return (
    <button
      type="button"
      onClick={onSelect !== undefined ? () => onSelect(node.id) : undefined}
      style={{
        textAlign: "left",
        cursor: onSelect !== undefined ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 12px",
        background: "var(--surface, #1a1915)",
        border: `1px solid ${borderColor}`,
        borderLeft: `3px solid ${color}`,
        borderStyle: node.isAffectedByPendingAmendment && !node.isInvalidated ? "dashed" : "solid",
        borderRadius: "var(--r-md, 8px)",
        boxShadow: node.isInWavefront ? `0 0 0 1px ${color}, 0 6px 18px rgba(0,0,0,0.22)` : "none",
        opacity: node.display === "idle" ? 0.7 : 1
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: "0 0 auto" }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1, #f1ead8)" }}>
          {node.title.length > 0 ? node.title : node.id}
        </span>
      </div>

      {/* Vital sign — compact summary of the agent's work (PR 09). */}
      <span style={{ fontSize: 13, fontWeight: 600, color }}>{node.vital.label}</span>
      {node.vital.verificationSummary !== undefined ? (
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-2, #cfc7b4)" }}>
          {node.vital.verificationSummary}
        </span>
      ) : node.vital.detail !== undefined ? (
        <span style={{ fontSize: 11, color: "var(--text-3, #9a927f)" }}>{node.vital.detail}</span>
      ) : null}
      {node.vital.conflictSummary !== undefined ? (
        <span style={{ fontSize: 11, color: "var(--error, #cf5b5b)" }}>conflicto: {node.vital.conflictSummary}</span>
      ) : null}
      {node.vital.amendmentSummary !== undefined ? (
        <span style={{ fontSize: 11, color: "var(--copper, #d08a5a)" }}>{node.vital.amendmentSummary}</span>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Tag text={`${node.role} · d${node.depth}`} />
        {node.isInWavefront ? <Tag text="wavefront" color="var(--running, #5a9bd0)" /> : null}
        {node.isBlocked ? <Tag text="bloqueado" color="var(--blocked, #b08a4a)" /> : null}
        {node.display === "obsolete" ? <Tag text="obsoleto" color="var(--gated, #d0953a)" /> : null}
        {node.isPendingReexecution ? <Tag text="re-ejecución" color="var(--gated, #d0953a)" /> : null}
        {node.isAffectedByPendingAmendment ? <Tag text="enmienda" color="var(--copper, #d08a5a)" /> : null}
        {node.hasActiveConflict ? <Tag text="conflicto" color="var(--error, #cf5b5b)" /> : null}
      </div>

      {node.produces.length > 0 || node.consumes.length > 0 ? (
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10.5, color: "var(--text-3, #9a927f)" }}>
          {node.produces.length > 0 ? `produce ${node.produces.join(", ")}` : ""}
          {node.produces.length > 0 && node.consumes.length > 0 ? " · " : ""}
          {node.consumes.length > 0 ? `consume ${node.consumes.join(", ")}` : ""}
        </div>
      ) : null}
    </button>
  );
}

function SeamSection({ seams, highlightFrozen }: { seams: WorkspaceSeam[]; highlightFrozen: boolean }): React.ReactElement {
  return (
    <SectionPanel title={highlightFrozen ? "Costuras (congelando)" : "Costuras (seams)"}>
      {seams.length === 0 ? (
        <Muted text="Sin costuras todavía." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {seams.map((seam) => (
            <li key={seam.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <SeamStateDot state={seam.state} />
                <strong style={{ color: "var(--text-1, #f1ead8)", fontSize: 13 }}>{seam.id}</strong>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3, #9a927f)" }}>
                  rev {seam.revision} · {seam.state}
                  {seam.lastChangeKind !== undefined ? ` (${seam.lastChangeKind})` : ""}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3, #9a927f)" }}>
                {seam.producerNodeId} → {seam.consumerNodeIds.join(", ") || "—"}
              </span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-2, #cfc7b4)", wordBreak: "break-word" }}>
                {seam.signatureSummary}
              </span>
              {seam.contractSummary !== undefined ? (
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--copper, #d08a5a)" }}>
                  contrato: {seam.contractSummary}
                </span>
              ) : null}
              {seam.affectedNodeIds.length > 0 ? (
                <span style={{ fontSize: 11, color: "var(--gated, #d0953a)" }}>afecta: {seam.affectedNodeIds.join(", ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

function WaveSection({ waves }: { waves: WorkspaceWave[] }): React.ReactElement {
  return (
    <SectionPanel title="Olas planificadas">
      {waves.length === 0 ? (
        <Muted text="Sin olas todavía." />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {waves.map((wave) => (
            <li key={wave.id} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-2, #cfc7b4)" }}>
              <strong style={{ color: "var(--text-1, #f1ead8)" }}>#{wave.index}</strong> {wave.nodeIds.join(", ")}{" "}
              <span style={{ color: "var(--text-3, #9a927f)" }}>
                {wave.closed ? "(cerrada)" : wave.opened ? "(abierta)" : "(planificada)"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

function ConflictSection({ conflicts, emphasized }: { conflicts: ProtoConflictRow[]; emphasized: boolean }): React.ReactElement {
  const accent = emphasized && conflicts.length > 0 ? "var(--error, #cf5b5b)" : undefined;
  return (
    <SectionPanel title="Conflictos activos" {...(accent !== undefined ? { accent } : {})}>
      {conflicts.length === 0 ? (
        <Muted text="Ningún conflicto activo." success />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {conflicts.map((conflict) => (
            <li key={conflict.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--text-2, #cfc7b4)" }}>
              <Tag text={conflict.dimension} color="var(--error, #cf5b5b)" strong />
              <span>{conflict.status}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-3, #9a927f)" }}>{conflict.nodeIds.join(", ")}</span>
              <span style={{ color: "var(--text-3, #9a927f)" }}>{conflict.autoResolvable ? "auto-resolvable" : "requiere humano"}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

function EvidenceBlock({ evidence }: { evidence: WorkspaceEvidence }): React.ReactElement {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "rgba(107,191,115,0.06)",
        border: "1px solid rgba(107,191,115,0.32)",
        borderRadius: "var(--r-md, 8px)",
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--done, #6bbf73)" }}>
          Evidencia
        </span>
        <strong style={{ fontSize: 18, color: "var(--text-1, #f1ead8)" }}>
          tests {evidence.tests.pass}/{evidence.tests.total}
        </strong>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-3, #9a927f)" }}>
          commit {evidence.integrationCommit}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-2, #cfc7b4)", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>diff: {evidence.aggregateDiffRef}</span>
        <span>narrativa: {evidence.narrativeRef}</span>
      </div>
      {evidence.invalidationTrace !== undefined && evidence.invalidationTrace.length > 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-2, #cfc7b4)" }}>
          {evidence.invalidationTrace.map((t) => (
            <div key={t.seamId} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
              {t.seamId} {t.from}→{t.to} · re-ejecutados {t.reExecuted.join(", ") || "—"} · preservados{" "}
              <span style={{ color: "var(--done, #6bbf73)" }}>{t.preserved.join(", ") || "—"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Small shared bits ───────────────────────────────────────────────────────────

function Callout({ tone, text }: { tone: "action" | "warn"; text: string }): React.ReactElement {
  const color = tone === "warn" ? "var(--gated, #d0953a)" : "var(--copper, #d08a5a)";
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        border: `1px solid ${color}`,
        background: tone === "warn" ? "rgba(208,149,58,0.10)" : "rgba(208,138,90,0.10)",
        color,
        fontSize: 13,
        fontFamily: "var(--font-mono, monospace)"
      }}
    >
      {text}
    </div>
  );
}

function SectionPanel({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section
      style={{
        padding: "12px 14px",
        background: "var(--surface, #1a1915)",
        border: `1px solid ${accent ?? "var(--border, rgba(241,234,216,0.12))"}`,
        borderRadius: "var(--r-md, 8px)"
      }}
    >
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-3, #9a927f)", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function SeamStateDot({ state }: { state: WorkspaceSeam["state"] }): React.ReactElement {
  const color =
    state === "frozen" ? "var(--done, #6bbf73)" : state === "amended" ? "var(--gated, #d0953a)" : "var(--text-3, #9a927f)";
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: "0 0 auto" }} />;
}

function Muted({ text, success = false }: { text: string; success?: boolean }): React.ReactElement {
  return (
    <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: success ? "var(--done, #6bbf73)" : "var(--text-3, #9a927f)" }}>
      {success ? "✓ " : ""}
      {text}
    </div>
  );
}

function Tag({ text, color, strong = false }: { text: string; color?: string; strong?: boolean }): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 10.5,
        letterSpacing: "0.03em",
        padding: "2px 7px",
        borderRadius: 999,
        border: `1px solid ${color ?? "var(--border, rgba(241,234,216,0.18))"}`,
        color: color ?? "var(--text-3, #9a927f)",
        fontWeight: strong ? 600 : 400
      }}
    >
      {text}
    </span>
  );
}
