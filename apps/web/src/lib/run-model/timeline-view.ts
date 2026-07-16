/**
 * Timeline / audit-trail view-model (U-B) — the chronological projection of the
 * event log. Unlike the other view-models it takes the RAW `RunEvent[]` (the log
 * IS the audit trail), not the reduced `RunModel`: fixtures and the SSE adapter
 * both produce `RunEvent[]`, so the same timeline serves both.
 *
 * PURE and node-testable: never mutates input, never touches React. Each event maps
 * to one readable `TimelineEntry` (category + headline + detail + tone + nodeId for
 * per-node audit). Unknown event types still appear (forward-compat audit), so the
 * trail never silently hides activity. Order is the log order (monotonic `seq`).
 *
 * Discipline: this surfaces the log, it does NOT re-derive run state — health/phase
 * stay with their selectors. Autonomous activity (repair, planning retry) shows as
 * neutral/auxiliary, never as human attention.
 */
import type { Actor, NodeId, RunEvent } from "./types";
import { displayWaveOrdinal } from "./scheduling-wave-ordinal";

export type TimelineCategory =
  | "framing"
  | "proposal"
  | "foundation"
  | "supervision"
  | "reconciliation"
  | "disposition"
  | "decision"
  | "other";

export type TimelineTone = "info" | "good" | "warn" | "bad" | "human";

export interface TimelineEntry {
  seq: number;
  at: string;
  actor: Actor;
  type: string;
  category: TimelineCategory;
  title: string;
  detail?: string;
  /** The node this entry concerns, for per-node audit filtering / highlight. */
  nodeId?: NodeId;
  tone: TimelineTone;
}

export interface TimelineView {
  entries: TimelineEntry[];
  count: number;
}

/** Stable, payload-free grouping of an event type into a run category. */
export function timelineCategoryOf(type: string): TimelineCategory {
  if (type === "run.created" || type === "run.context.resolved") return "framing";
  if (type.startsWith("plan.")) return "proposal";
  if (type.startsWith("grounding.") || type === "seam.frozen" || type === "scope.derived" || type === "wave.planned") {
    return "foundation";
  }
  if (
    type.startsWith("node.") ||
    type === "wave.opened" ||
    type === "wave.closed" ||
    type === "run.scheduling.wave_selected" ||
    type.startsWith("amendment.") ||
    type === "seam.amended"
  ) {
    return "supervision";
  }
  if (type.startsWith("integration.") || type.startsWith("conflict.")) return "reconciliation";
  if (type === "run.evidence.ready" || type === "run.metrics.ready" || type === "run.completed") return "disposition";
  if (type.startsWith("decision.")) return "decision";
  return "other";
}

interface Mapped {
  title: string;
  detail?: string | undefined;
  nodeId?: NodeId | undefined;
  tone: TimelineTone;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];
}

/** Map one event to its readable headline/detail/tone/nodeId (payload-aware). */
function describe(event: RunEvent, schedulingWavePosition = 0): Mapped {
  const p = event.payload;
  switch (event.type) {
    case "run.created":
      return { title: "Run creado", detail: str(p.intent), tone: "info" };
    case "run.context.resolved":
      return { title: "Contexto resuelto", detail: `${str(p.repo) ?? "?"} @ ${str(p.baseCommit) ?? "?"} · ${str(p.readiness) ?? "?"}`, tone: "info" };

    case "plan.started":
      return { title: "Planning iniciado", tone: "info" };
    case "plan.node.proposed":
      return { title: `Nodo propuesto: ${str(p.title) ?? str(p.nodeId) ?? "?"}`, detail: `${str(p.role) ?? "?"} · d${Number(p.depth ?? 0)}`, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "info" };
    case "plan.node.status": {
      const state = str(p.state) ?? "?";
      const concern = state === "retrying" || state === "failed" || state === "fallback";
      const attempt = p.attempt !== undefined ? ` · intento ${Number(p.attempt)}${p.maxAttempts !== undefined ? `/${Number(p.maxAttempts)}` : ""}` : "";
      const err = str(p.errorKind) !== undefined ? ` · ${str(p.errorKind)}` : "";
      return { title: `Planning: ${state}`, detail: `${attempt}${err}`.replace(/^ · /, "") || undefined, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: state === "failed" ? "bad" : concern ? "warn" : "info" };
    }
    case "plan.seam.proposed":
      return { title: `Costura propuesta: ${str(p.name) ?? str(p.seamId) ?? "?"}`, ...(str(p.producerNodeId) !== undefined ? { nodeId: str(p.producerNodeId) } : {}), tone: "info" };
    case "plan.ready":
      return { title: "Plan listo", detail: `${Number(p.nodeCount ?? 0)} nodos · ${Number(p.seamCount ?? 0)} costuras`, tone: "info" };

    case "grounding.started":
      return { title: "Grounding iniciado", tone: "info" };
    case "skeleton.file.committed":
      return { title: "Esqueleto commiteado", detail: str(p.path), tone: "info" };
    case "seam.frozen":
      return { title: `Costura congelada: ${str(p.seamId) ?? "?"} r${Number(p.revision ?? 0)}`, detail: str(p.extractedFrom), tone: "good" };
    case "scope.derived":
      return { title: "Scope derivado", detail: Array.isArray(p.paths) ? (p.paths as string[]).join(", ") : undefined, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "info" };
    case "wave.planned":
      return { title: `Olas planificadas (${Array.isArray(p.waves) ? (p.waves as unknown[]).length : 0})`, tone: "info" };
    case "run.scheduling.wave_selected": {
      const ready = stringList(p.readyTaskIds);
      const selected = stringList(p.selectedTaskIds);
      const blocked = stringList(p.blockedTaskIds);
      const warnings = Array.isArray(p.warnings) ? (p.warnings as Array<{ message?: unknown }>) : [];
      const fallbacks = Array.isArray(p.fallbacks) ? (p.fallbacks as Array<{ message?: unknown }>) : [];
      const warningMessages = [...warnings, ...fallbacks].map((item) => str(item.message)).filter((item): item is string => item !== undefined);
      const riskSummary = (p.riskSummary as { blocking?: unknown } | undefined) ?? {};
      const blockingRisk = typeof riskSummary.blocking === "number" ? riskSummary.blocking : 0;
      const detail = [
        `${selected.length}/${ready.length} seleccionadas`,
        `${blocked.length} bloqueadas`,
        `politica ${str(p.policy) ?? "?"}`,
        ...warningMessages
      ].join(" | ");
      return {
        title: `Ola seleccionada #${displayWaveOrdinal(p, schedulingWavePosition)}`,
        detail,
        tone: warningMessages.length > 0 || blockingRisk > 0 ? "warn" : "info"
      };
    }
    case "grounding.completed":
      return { title: "Grounding completo", detail: str(p.skeletonCommit), tone: "good" };

    case "wave.opened":
      return { title: "Ola abierta", detail: Array.isArray(p.nodeIds) ? (p.nodeIds as string[]).join(", ") : undefined, tone: "info" };
    case "wave.closed":
      return { title: "Ola cerrada", tone: "info" };
    case "node.execution.started":
      return { title: "Ejecución iniciada", detail: `${str(p.agent) ?? "?"}${str(p.model) !== undefined ? ` · ${str(p.model)}` : ""}${str(p.reason) !== undefined ? ` · ${str(p.reason)}` : ""}`, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "info" };
    case "node.verify.iteration":
      return { title: "Verificando", detail: `build ${str(p.build) ?? "?"} · tests ${Number(p.testsPass ?? 0)}/${Number(p.testsTotal ?? 0)} · iter ${Number(p.iteration ?? 0)}/${Number(p.maxIterations ?? 0)}`, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "info" };
    case "node.verify.passed":
      return { title: "Verificado ✓", detail: str(p.commit) !== undefined ? `commit ${str(p.commit)}` : undefined, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "good" };
    case "node.verify.failed":
      return { title: "Verificación falló (iteración)", detail: str(p.cause), ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "warn" };
    case "node.repair.started":
      return { title: "Reparación automática", detail: str(p.reason), ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "info" };
    case "node.execution.failed":
      return { title: "Ejecución falló", detail: str(p.cause), ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "bad" };

    case "node.cli.output": {
      const stream = str(p.stream) ?? "stdout";
      const chunk = str(p.chunk);
      return {
        title: `Consola ${stream}`,
        detail: chunk !== undefined ? compactChunk(chunk) : undefined,
        ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}),
        tone: stream === "stderr" ? "warn" : "info"
      };
    }

    case "amendment.proposed":
      return { title: "Enmienda propuesta", detail: `${str(p.changeKind) ?? "?"} · afecta ${Array.isArray(p.affects) ? (p.affects as string[]).length : 0}`, ...(str(p.nodeId) !== undefined ? { nodeId: str(p.nodeId) } : {}), tone: "warn" };
    case "seam.amended":
      return { title: `Costura enmendada: ${str(p.seamId) ?? "?"} r${Number(p.revision ?? 0)}`, detail: str(p.changeKind), tone: "warn" };
    case "amendment.applied":
      return { title: "Enmienda aplicada", tone: "info" };
    case "amendment.rejected":
      return { title: "Enmienda rechazada", tone: "info" };

    case "integration.started":
      return { title: "Integración iniciada", detail: Array.isArray(p.childNodeIds) ? (p.childNodeIds as string[]).join(", ") : undefined, ...(str(p.compositeNodeId) !== undefined ? { nodeId: str(p.compositeNodeId) } : {}), tone: "info" };
    case "conflict.detected":
      return { title: `Conflicto detectado (${str(p.dimension) ?? "?"})`, detail: Array.isArray(p.files) ? (p.files as string[]).join(", ") : undefined, tone: p.autoResolvable === true ? "warn" : "bad" };
    case "conflict.resolved":
      return { title: "Conflicto resuelto", detail: `${str(p.by) ?? "?"} · ${str(p.resolutionId) ?? "?"}`, tone: "good" };
    case "integration.validated":
      return { title: "Integración validada", detail: `tests ${Number(p.testsPass ?? 0)}/${Number(p.testsTotal ?? 0)} · ${p.passed === true ? "ok" : "falló"}`, ...(str(p.compositeNodeId) !== undefined ? { nodeId: str(p.compositeNodeId) } : {}), tone: p.passed === true ? "good" : "warn" };
    case "integration.completed":
      return { title: "Integración completa", detail: `${str(p.status) ?? "?"}${str(p.commit) !== undefined ? ` · commit ${str(p.commit)}` : ""}`, ...(str(p.compositeNodeId) !== undefined ? { nodeId: str(p.compositeNodeId) } : {}), tone: str(p.status) === "success" ? "good" : "bad" };

    case "run.evidence.ready":
      return { title: "Evidencia lista", detail: `tests ${Number((p.tests as { pass?: number })?.pass ?? 0)}/${Number((p.tests as { total?: number })?.total ?? 0)}`, tone: "good" };
    case "run.metrics.ready": {
      const m = (p.metrics as Record<string, number>) ?? {};
      return { title: "Métricas listas", detail: `${m.leafCount ?? 0} hojas · éxito-hoja ${Math.round((m.leafSuccessRate ?? 0) * 100)}% · conflicto ${Math.round((m.conflictRate ?? 0) * 100)}%`, tone: "info" };
    }
    case "run.completed":
      return { title: `Run ${str(p.status) ?? "?"}`, tone: str(p.status) === "success" ? "good" : str(p.status) === "failed" ? "bad" : "warn" };

    case "decision.raised":
      return { title: `Decisión planteada: ${str(p.kind) ?? "?"}`, detail: str((p.context as { question?: string })?.question), tone: "human" };
    case "decision.resolved":
      return { title: "Decisión resuelta", detail: str(p.decisionId), tone: "human" };

    default:
      return { title: event.type, tone: "info" };
  }
}

function compactChunk(chunk: string): string {
  const oneLine = chunk.replace(/\s+/g, " ").trim();
  return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 117)}...`;
}

/**
 * Build the chronological audit trail from the event log (already in `seq` order).
 * `options.nodeId` keeps only entries that concern that node (per-node audit).
 */
export function buildTimelineView(events: readonly RunEvent[], options: { nodeId?: NodeId } = {}): TimelineView {
  const entries: TimelineEntry[] = [];
  let schedulingWavePosition = 0;
  for (const event of events) {
    const position = schedulingWavePosition;
    if (event.type === "run.scheduling.wave_selected") schedulingWavePosition += 1;
    const mapped = describe(event, position);
    if (options.nodeId !== undefined && mapped.nodeId !== options.nodeId) continue;
    entries.push({
      seq: event.seq,
      at: event.at,
      actor: event.actor,
      type: event.type,
      category: timelineCategoryOf(event.type),
      title: mapped.title,
      ...(mapped.detail !== undefined ? { detail: mapped.detail } : {}),
      ...(mapped.nodeId !== undefined ? { nodeId: mapped.nodeId } : {}),
      tone: mapped.tone
    });
  }
  return { entries, count: entries.length };
}
