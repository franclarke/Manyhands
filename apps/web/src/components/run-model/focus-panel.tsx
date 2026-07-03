"use client";

/**
 * Focus panel — the on-demand deep inspector.
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
import { ChevronRight, X } from "lucide-react";
import { parseAnsiLog, type AnsiTone } from "@/lib/run-model/ansi";
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
      className="flex min-h-full flex-col gap-3 bg-[var(--color-surface-raised)] px-5 py-4 font-sans"
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="whitespace-nowrap text-meta text-[var(--color-text-subtle)]">
          Foco · {KIND_LABEL[view.kind]}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar foco"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--r-md)] border border-transparent text-[var(--color-text-subtle)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] hover:text-[var(--color-text)]"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <strong className="break-words text-base font-semibold leading-snug text-[var(--color-text)]">
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

// ── Node ──────────────────────────────────────────────────────────────────────

function NodeBody({ view, onFocus }: { view: NodeFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  const live =
    view.vital.status === "running" || view.vital.status === "verifying" || view.vital.status === "repairing";
  const showConsole = view.console.lines.length > 0 || live;

  const noFlags =
    !view.isInWavefront &&
    !view.isBlocked &&
    !view.isInvalidated &&
    !view.isPendingReexecution &&
    !view.isAffectedByPendingAmendment &&
    !view.hasActiveConflict;

  return (
    <Stack>
      {showConsole ? <NodeConsole view={view} /> : null}

      <Section title="Estado">
        <Field label="Situación" value={`${view.display} · ${view.freshness}`} strong />
        <Field label="Signo vital" value={`${view.vital.label}${view.vital.detail !== undefined ? ` — ${view.vital.detail}` : ""}`} />
        <Field label="Duración" value={formatTiming(view.timing)} mono />
        {view.vital.verificationSummary !== undefined ? <Field label="Verificación" value={view.vital.verificationSummary} mono /> : null}
      </Section>

      <Section title="Contrato">
        <Field label="Rol" value={`${humanizeRole(view.role)} · d${view.depth}`} />
        {view.goal.length > 0 ? <Field label="Objetivo" value={view.goal} /> : null}
        <Field
          label="Alcance"
          value={view.scope.paths.length > 0 ? view.scope.paths.join(", ") : "—"}
          tag={humanizeOrigin(view.scope.origin)}
          mono
        />
        {view.planning !== undefined ? <Field label="Planning" value={formatPlanning(view.planning)} mono /> : null}
      </Section>

      <Section title="Dependencias">
        <ChipRow label="Depende de">
          {view.dependencies.length === 0 ? <span className="text-xs text-[var(--color-text-subtle)]">—</span> : null}
          {view.dependencies.map((d) => (
            <LinkChip key={d.id} text={`${d.title} (${d.id})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "node", id: d.id }) : undefined} />
          ))}
        </ChipRow>
        {view.consumes.length > 0 ? (
          <ChipRow label="Consume">
            {view.consumes.map((s) => (
              <LinkChip key={s.id} text={`${s.id} (${s.state} r${s.revision})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: s.id }) : undefined} />
            ))}
          </ChipRow>
        ) : null}
        {view.produces.length > 0 ? (
          <ChipRow label="Produce">
            {view.produces.map((s) => (
              <LinkChip key={s.id} text={`${s.id} (${s.state} r${s.revision})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "seam", id: s.id }) : undefined} />
            ))}
          </ChipRow>
        ) : null}
        {view.parent !== undefined ? (
          <ChipRow label="Padre">
            <LinkChip text={`${view.parent.title} (${view.parent.id})`} onClick={onFocus !== undefined ? () => onFocus({ kind: "node", id: view.parent!.id }) : undefined} />
          </ChipRow>
        ) : null}
      </Section>

      <Section title="Evidencia">
        {view.commit !== undefined ? <Field label="Commit" value={view.commit.slice(0, 10)} mono /> : null}
        {view.changedFiles.length > 0 ? <Field label="Archivos" value={view.changedFiles.join(", ")} mono /> : null}
        {view.builtAgainst.length > 0 ? (
          <Field label="Construido contra" value={view.builtAgainst.map((b) => `${b.seamId}@${b.revision}`).join(", ")} mono />
        ) : null}
        {view.producedRevision !== undefined ? (
          <Field label="Produce rev." value={`${view.producedRevision.seamId}@${view.producedRevision.revision}`} mono />
        ) : null}
        <ChipRow label="Banderas">
          {view.isInWavefront ? <Chip text="wavefront" tone="running" /> : null}
          {view.isBlocked ? <Chip text="bloqueado" tone="blocked" /> : null}
          {view.isInvalidated ? <Chip text="obsoleto" tone="blocked" /> : null}
          {view.isPendingReexecution ? <Chip text="re-ejecución pendiente" tone="blocked" /> : null}
          {view.isAffectedByPendingAmendment ? <Chip text="enmienda pendiente" tone="running" /> : null}
          {view.hasActiveConflict ? <Chip text="conflicto" tone="failed" /> : null}
          {noFlags ? <span className="text-xs text-[var(--color-text-subtle)]">— sin banderas activas</span> : null}
        </ChipRow>
        <RefList refs={view.refs} live={live} />
      </Section>
    </Stack>
  );
}

function NodeConsole({ view }: { view: NodeFocusView }): React.ReactElement {
  const live =
    view.vital.status === "running" || view.vital.status === "verifying" || view.vital.status === "repairing";
  const content = view.console.lines.map((line) => line.chunk).join("");
  return (
    <section
      aria-label="Consola del agente"
      className="grid gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 mh-elev-inset"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-subtle)]">
          {live ? <span aria-hidden className="mh-node-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /> : null}
          Consola del agente{live ? " · en vivo" : ""}
        </span>
        <span className="mh-mono text-eyebrow text-[var(--color-text-subtle)]">
          {view.console.lines.length} chunks{view.console.truncated ? " · últimos 200" : ""}
        </span>
      </div>
      {view.console.lines.length === 0 ? (
        <span className="mh-mono text-xs text-[var(--color-text-muted)]">
          {live ? "Esperando la primera salida del agente…" : "Sin salida en vivo capturada."}
        </span>
      ) : (
        <TerminalView content={content} ariaLabel="Salida del agente en vivo" />
      )}
    </section>
  );
}

// ── Seam ──────────────────────────────────────────────────────────────────────

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
        {view.consumers.length === 0 ? <span className="text-xs text-[var(--color-text-subtle)]">—</span> : null}
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

// ── Conflict ──────────────────────────────────────────────────────────────────

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

// ── Decision ──────────────────────────────────────────────────────────────────

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

// ── Evidence ──────────────────────────────────────────────────────────────────

function EvidenceBody({ view, onFocus }: { view: EvidenceFocusView; onFocus?: ((t: FocusTarget) => void) | undefined }): React.ReactElement {
  return (
    <Stack>
      <Field label="Tests" value={`${view.tests.pass}/${view.tests.total}`} strong />
      <Field label="Commit" value={view.integrationCommit} mono />
      <RefLine refItem={view.aggregateDiffRef} />
      <RefLine refItem={view.narrativeRef} />
      {view.metrics !== undefined ? <Field label="Métricas" value={formatMetrics(view.metrics)} mono /> : null}
      {view.invalidationTrace !== undefined && view.invalidationTrace.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-subtle)]">Traza de invalidación</span>
          {view.invalidationTrace.map((t) => (
            <span key={t.seamId} className="mh-mono text-eyebrow text-[var(--color-text-muted)]">
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

// ── Missing ───────────────────────────────────────────────────────────────────

function MissingBody({ view }: { view: MissingFocusView }): React.ReactElement {
  return (
    <Stack>
      <Field label="Objetivo" value={`${view.target.kind}:${view.target.id}`} mono />
      <Note text={view.message} tone="warn" />
    </Stack>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function Stack({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex flex-col gap-2">{children}</div>;
}

const FIELD_GRID = "grid grid-cols-[minmax(110px,auto)_1fr] items-baseline gap-x-3 gap-y-1.5";

function Field({ label, value, mono = false, strong = false, tag }: { label: string; value: string; mono?: boolean; strong?: boolean; tag?: string }): React.ReactElement {
  return (
    <div className={FIELD_GRID}>
      <span className="text-xs text-[var(--color-text-subtle)]">{label}</span>
      <span
        className={[
          "break-words text-label",
          mono ? "mh-mono" : "",
          strong ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
        ].join(" ")}
      >
        {value}
        {tag !== undefined ? (
          <span className="mh-mono ml-1.5 inline-block rounded-full border border-[var(--color-border)] px-1.5 align-middle text-eyebrow text-[var(--color-text-subtle)]">
            {tag}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** A labeled group in the node inspector — an eyebrow header over its fields, with a hairline above. */
function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--color-border)_80%,transparent)] pt-3 first:border-0 first:pt-0">
      <span className="mh-mono uppercase tracking-[0.1em] text-eyebrow text-[var(--color-text-subtle)]">{title}</span>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function humanizeRole(role: NodeFocusView["role"]): string {
  return role === "root" ? "Raíz" : role === "composite" ? "Grupo" : "Hoja";
}

function humanizeOrigin(origin: NodeFocusView["scope"]["origin"]): string {
  return origin === "derived" ? "derivado" : "inferido";
}

/** Execution duration, humanized — never fabricated (the selector returns undefined / running honestly). */
function formatTiming(timing: NodeFocusView["timing"]): string {
  if (timing === undefined) return "—";
  if (timing.running) return "en curso";
  if (timing.durationMs === undefined) return "—";
  return formatDuration(timing.durationMs);
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec} s`;
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s === 0 ? `${m} min` : `${m} min ${s} s`;
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={FIELD_GRID}>
      <span className="text-xs text-[var(--color-text-subtle)]">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

type ChipTone = "running" | "blocked" | "failed" | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  running: "border-[var(--status-running-border)] bg-[var(--status-running-bg)] text-[var(--status-running-fg)]",
  blocked: "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)]",
  failed: "border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)]",
  neutral: "border-[var(--color-border)] bg-transparent text-[var(--color-text-subtle)]"
};

function Chip({ text, tone = "neutral" }: { text: string; tone?: ChipTone }): React.ReactElement {
  return (
    <span className={`mh-mono rounded-full border px-2 py-0.5 text-eyebrow ${CHIP_TONE[tone]}`}>
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
      className="mh-mono cursor-pointer rounded-full border border-[var(--color-accent-deep)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-2 py-0.5 text-eyebrow text-[var(--color-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
    >
      {text} ↗
    </button>
  );
}

function RefLine({ refItem }: { refItem: FocusRef }): React.ReactElement {
  return <ArtifactViewer refItem={refItem} />;
}

function RefList({ refs, live = false }: { refs: FocusRef[]; live?: boolean }): React.ReactElement | null {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {refs.map((r) => (
        <ArtifactViewer key={r.ref} refItem={r} live={live} />
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
  metadata?: { changedFiles?: string[]; commitSha?: string };
}

/** Agent-status artifacts refresh while the node works (MH_STATUS is live). */
const LIVE_STATUS_POLL_MS = 4_000;

/** ANSI tones → design tokens. info (blue/cyan) maps to NEUTRAL — the design system bans celeste. */
const ANSI_TONE_CLASS: Record<AnsiTone, string> = {
  default: "text-[var(--color-text-muted)]",
  pass: "text-[var(--status-completed-fg)]",
  fail: "text-[var(--status-failed-fg)]",
  warn: "text-[var(--status-blocked-fg)]",
  info: "text-[var(--color-text-subtle)]",
  muted: "text-[var(--color-text-subtle)]"
};

/** A sober terminal: agent/test output with ANSI colors mapped to the palette. */
function TerminalView({ content, ariaLabel }: { content: string; ariaLabel?: string | undefined }): React.ReactElement {
  const lines = parseAnsiLog(content);
  return (
    <div
      role="log"
      aria-label={ariaLabel}
      className="mh-mono max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-meta leading-[1.6] mh-elev-inset"
    >
      {lines.length === 0 ? (
        <span className="text-[var(--color-text-subtle)]">— sin salida —</span>
      ) : (
        lines.map((segments, li) => (
          <div key={li}>
            {segments.length === 0
              ? " "
              : segments.map((seg, si) => (
                  <span key={si} className={`${ANSI_TONE_CLASS[seg.tone]}${seg.bold ? " font-semibold" : ""}`}>
                    {seg.text}
                  </span>
                ))}
          </div>
        ))
      )}
    </div>
  );
}

function artifactMeta(payload: ArtifactPayload): string | null {
  const files = payload.metadata?.changedFiles?.length;
  if (files !== undefined && files > 0) return `${files} ${files === 1 ? "archivo" : "archivos"}`;
  return null;
}

function ArtifactViewer({ refItem, live = false }: { refItem: FocusRef; live?: boolean }): React.ReactElement {
  const [payload, setPayload] = useState<ArtifactPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = runIdFromRef(refItem.ref);
  // Poll the live MH_STATUS only while the node is actually working — never on a
  // terminal run (that was the read-amplification we saw: status:// every 4s forever).
  const isLiveStatus = live && refItem.ref.startsWith("status://");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setPayload(null);
    setError(null);
    if (!refItem.available || runId === null) return;

    const load = (): void => {
      void fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts?ref=${encodeURIComponent(refItem.ref)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? response.statusText);
          return response.json() as Promise<ArtifactPayload>;
        })
        .then((artifact) => {
          if (cancelled) return;
          setPayload(artifact);
          setError(null);
          if (isLiveStatus) timer = setTimeout(load, LIVE_STATUS_POLL_MS);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          if (isLiveStatus) timer = setTimeout(load, LIVE_STATUS_POLL_MS);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [refItem.available, refItem.ref, runId, isLiveStatus]);

  if (!refItem.available || runId === null) {
    return <span className="text-label text-[var(--color-text-subtle)]">{refItem.label}: artefacto referenciado.</span>;
  }

  if (error !== null) {
    const notFound = /not found|404/i.test(error);
    return (
      <span className={notFound ? "text-label text-[var(--color-text-subtle)]" : "mh-mono text-label text-[var(--status-blocked-fg)]"}>
        {notFound ? `${refItem.label}: sin artefacto todavía.` : `${refItem.label}: ${error}`}
      </span>
    );
  }

  if (payload === null) {
    return (
      <span className="flex items-center gap-1.5 text-label text-[var(--color-text-subtle)]">
        <span aria-hidden className="mh-working inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-text-subtle)]" />
        {refItem.label} · cargando…
      </span>
    );
  }

  const meta = artifactMeta(payload);
  // Open the evidence (test log + diff) by default for terminal nodes — burying
  // it behind a collapsed summary was the audit's named legibility miss.
  const defaultOpen = isLiveStatus || payload.kind === "log" || payload.language === "diff";
  return (
    <details
      className="group rounded-[var(--r-md)] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 text-meta text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <span className="flex items-center gap-1.5">
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
          {refItem.label}
        </span>
        {meta !== null ? <span className="mh-mono text-eyebrow text-[var(--color-text-subtle)]">{meta}</span> : null}
      </summary>
      <div className="px-3 pb-3">
        {payload.language === "diff" ? (
          <pre className="mh-mono m-0 max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-eyebrow leading-[1.5]">
            <DiffContent content={payload.content} />
          </pre>
        ) : (
          <TerminalView content={payload.content} ariaLabel={refItem.label} />
        )}
      </div>
    </details>
  );
}

/** Minimal unified-diff coloring: additions, deletions, hunk headers. */
function DiffContent({ content }: { content: string }): React.ReactElement {
  return (
    <>
      {content.split("\n").map((line, index) => {
        const tone = line.startsWith("+")
          ? "text-[var(--status-completed-fg)]"
          : line.startsWith("-")
            ? "text-[var(--status-failed-fg,#cf5b5b)]"
            : line.startsWith("@@") || line.startsWith("diff ")
              ? "text-[var(--color-accent,#d08a5a)]"
              : "";
        return (
          <span key={index} className={tone ? `block ${tone}` : "block"}>
            {line}
          </span>
        );
      })}
    </>
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

const NOTE_TONE = {
  neutral: "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]",
  warn: "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)]",
  success: "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)]"
} as const;

function Note({ text, tone = "neutral" }: { text: string; tone?: keyof typeof NOTE_TONE }): React.ReactElement {
  return (
    <div className={`rounded-[var(--r-md)] border px-3 py-2 text-xs leading-relaxed ${NOTE_TONE[tone]}`}>
      {text}
    </div>
  );
}
