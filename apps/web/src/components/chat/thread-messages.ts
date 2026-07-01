import type { RunEvent } from "@/lib/run-model/types";

interface SchedulingReason {
  taskId?: string;
  reason?: string;
  relatedTaskIds?: string[];
  riskLevel?: string;
}

interface SchedulingNotice {
  code?: string;
  taskIds?: string[];
  message?: string;
}

interface UnifiedPayload {
  intent?: string;
  nodeCount?: number;
  seamCount?: number;
  decisionId?: string;
  conflictId?: string;
  files?: string[];
  dimension?: string;
  diagnosisRef?: string;
  context?: { question?: string };
  choice?: { action?: string; answer?: string };
  status?: string;
  waveId?: number;
  nodeIds?: string[];
  nodeId?: string;
  title?: string;
  changedFiles?: string[];
  cause?: string;
  iteration?: number;
  waveIndex?: number;
  policy?: string;
  readyTaskIds?: string[];
  selectedTaskIds?: string[];
  blockedTaskIds?: string[];
  blockedReasons?: SchedulingReason[];
  fallbacks?: SchedulingNotice[];
  warnings?: SchedulingNotice[];
  waves?: { waveId: string | number; nodeIds: string[] }[];
}

/**
 * Resolution actions travel as internal slugs (`approve`, `retry_integration`, …).
 * The thread must never leak them raw — this maps the known vocabulary to the
 * Spanish copy users already see on the gate buttons. Kept client-side on purpose:
 * importing the server gate-option arrays would cross the apps→server boundary.
 */
const RESOLUTION_LABELS: Record<string, string> = {
  approve: "aprobado",
  reject: "rechazado",
  retry: "reintento de planificación",
  retry_repair: "reintento de reparación",
  retry_integration: "reintento de integración",
  replan_subtree: "re-planificación del subárbol",
  accept_failing: "fallo aceptado",
  accept_conflict: "conflicto aceptado",
  extend_budget: "presupuesto extendido",
  finish_partial: "cierre parcial",
  abort: "run abortado",
  abort_run: "run abortado"
};

/**
 * Message ids are semantic and STABLE — the thread renderer switches on them
 * (`decision-<id>`, `conflict-<id>`, `resolved-*`, `wave-progress-*`,
 * `plan-summary`, `plan-ongoing`, `run-complete-message`). Never sniff message
 * text to infer intent.
 */
export interface MyMessage {
  id: string;
  role: "user" | "assistant";
  content: { type: "text"; text: string }[];
  createdAt: Date;
}

/**
 * Reduce the native run-model event log into the ordered chat messages the
 * orchestrator thread renders. PURE: no React, no assistant-ui — so it can be
 * exercised directly over event logs (see tests/thread-messages.test.ts).
 */
export function buildThreadMessages(events: RunEvent[]): MyMessage[] {
  const list: MyMessage[] = [];
  if (events.length === 0) return list;

  const baseTime = new Date(events[0]?.at || Date.now());

  // nodeId → human title (streamed in via plan.node.proposed), so execution
  // narration never shows raw ids.
  const nodeTitle = new Map<string, string>();
  for (const event of events) {
    if (event.type === "plan.node.proposed") {
      const payload = event.payload as UnifiedPayload;
      if (payload.nodeId !== undefined && payload.title !== undefined) {
        nodeTitle.set(payload.nodeId, payload.title);
      }
    }
  }
  const titleOf = (nodeId: string): string => nodeTitle.get(nodeId) ?? nodeId.slice(0, 8);
  const labelList = (nodeIds: string[]): string => (nodeIds.length > 0 ? nodeIds.map(titleOf).join(", ") : "ninguna");

  list.push({
    id: "welcome",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Hola, soy ManyHands. Estoy orquestando la descomposición y ejecución paralela de tu tarea técnica."
      }
    ],
    createdAt: baseTime
  });

  // User prompt message (derived from run.created)
  const runCreated = events.find((e) => e.type === "run.created");
  if (runCreated) {
    const payload = runCreated.payload as UnifiedPayload;
    list.push({
      id: "user-prompt",
      role: "user",
      content: [
        {
          type: "text",
          text: payload.intent || "Iniciar tarea de ManyHands"
        }
      ],
      createdAt: new Date(runCreated.at)
    });
  }

  // Planning phase
  const planStarted = events.find((e) => e.type === "plan.started");
  const planReady = events.find((e) => e.type === "plan.ready");

  if (planReady) {
    const readyPayload = planReady.payload as UnifiedPayload;
    list.push({
      id: "plan-summary",
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Planificación completada. Generé un DAG con **${readyPayload.nodeCount}** tareas y **${readyPayload.seamCount}** costuras entre agentes. El plan requiere tu aprobación antes de ejecutar.`
        }
      ],
      createdAt: new Date(planReady.at)
    });
  } else if (planStarted) {
    const proposedNodes = events.filter((e) => e.type === "plan.node.proposed");
    const latestProposed = proposedNodes[proposedNodes.length - 1];
    list.push({
      id: "plan-ongoing",
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Inspeccionando el workspace e identificando tareas… (${proposedNodes.length} propuestas hasta ahora)`
        }
      ],
      createdAt: latestProposed ? new Date(latestProposed.at) : new Date(planStarted.at)
    });
  }

  // Human gates & warnings (raised inline)
  events.forEach((event) => {
    const payload = event.payload as UnifiedPayload;
    const time = new Date(event.at);

    if (event.type === "decision.raised") {
      // Plan approval renders as a dedicated interactive card in the thread.
      if (payload.decisionId === "approve_plan") return;

      list.push({
        id: `decision-${payload.decisionId}`,
        role: "assistant",
        content: [
          {
            type: "text",
            text: payload.context?.question || "Revisar y resolver la solicitud pendiente."
          }
        ],
        createdAt: time
      });
    }

    if (event.type === "conflict.detected") {
      list.push({
        id: `conflict-${payload.conflictId}`,
        role: "assistant",
        content: [
          {
            type: "text",
            text: `Conflicto ${payload.dimension ?? ""} en **${payload.files?.join(", ") || "archivos compartidos"}**. Dos subagentes tocaron la misma superficie; revisalo en Riesgos.`
          }
        ],
        createdAt: time
      });
    }

    if (event.type === "decision.resolved") {
      // Prefer the human's own words (gate answers carry the Spanish label);
      // fall back to mapping the internal action slug, never showing it raw.
      const action = payload.choice?.action;
      const choiceText =
        payload.choice?.answer ?? (action !== undefined ? RESOLUTION_LABELS[action] ?? action : undefined);
      list.push({
        id: `resolved-${payload.decisionId}-${event.seq}`,
        role: "assistant",
        content: [
          {
            type: "text",
            text: choiceText !== undefined ? `Decisión resuelta: **${choiceText}**.` : "Decisión resuelta."
          }
        ],
        createdAt: time
      });
    }
  });

  // Waves & subagent execution groups
  events
    .filter((e) => e.type === "run.scheduling.wave_selected")
    .forEach((event) => {
      const payload = event.payload as UnifiedPayload;
      const selected = payload.selectedTaskIds ?? [];
      const blocked = payload.blockedTaskIds ?? [];
      const reasons = payload.blockedReasons ?? [];
      const notices = [...(payload.warnings ?? []), ...(payload.fallbacks ?? [])]
        .map((notice) => notice.message)
        .filter((message): message is string => message !== undefined && message.length > 0);

      const reasonText = reasons
        .map((reason) => {
          const task = reason.taskId !== undefined ? titleOf(reason.taskId) : "tarea";
          const related = reason.relatedTaskIds !== undefined && reason.relatedTaskIds.length > 0
            ? ` (${labelList(reason.relatedTaskIds)})`
            : "";
          return `${task}: ${reason.reason ?? "bloqueada"}${related}`;
        })
        .join("; ");

      const detailLines = [
        `Seleccionadas: ${labelList(selected)}.`,
        blocked.length > 0 ? `Bloqueadas para otra ola: ${labelList(blocked)}.` : "Sin tareas bloqueadas por scheduling.",
        reasonText.length > 0 ? `Motivos: ${reasonText}.` : undefined,
        notices.length > 0 ? `Avisos: ${notices.join("; ")}.` : undefined
      ].filter((line): line is string => line !== undefined);

      list.push({
        id: `wave-progress-scheduling-${event.seq}`,
        role: "assistant",
        content: [
          {
            type: "text",
            text: `**Ola ${(payload.waveIndex ?? 0) + 1} seleccionada por scheduling**\n\n${detailLines.join("\n")}`
          }
        ],
        createdAt: new Date(event.at)
      });
    });

  const wavePlanned = events.find((e) => e.type === "wave.planned");
  const wavePlans: { waveId: string | number; nodeIds: string[] }[] = (wavePlanned?.payload as unknown as UnifiedPayload)?.waves || [];

  wavePlans.forEach((w) => {
    const waveOpened = events.find((e) => e.type === "wave.opened" && (e.payload as UnifiedPayload).waveId === w.waveId);
    if (!waveOpened) return; // Wave not yet started

    const nodeIdsSet = new Set(w.nodeIds);
    const waveEvents = events.filter((e) => {
      const payload = e.payload as UnifiedPayload;
      return payload && payload.nodeId && nodeIdsSet.has(payload.nodeId);
    });

    const nodeStatusList = w.nodeIds.map((nodeId) => {
      const nodeEvs = waveEvents.filter((e) => (e.payload as UnifiedPayload).nodeId === nodeId);
      const label = titleOf(nodeId);
      if (nodeEvs.length === 0) return `· ${label} — esperando`;

      const latestEv = nodeEvs[nodeEvs.length - 1]!;
      if (latestEv.type === "node.verify.passed") {
        const payload = latestEv.payload as UnifiedPayload;
        return `✓ ${label} — completado (${payload.changedFiles?.length || 0} archivos)`;
      }
      if (latestEv.type === "node.execution.failed") {
        const payload = latestEv.payload as UnifiedPayload;
        return `✗ ${label} — falló (${payload.cause ?? "causa desconocida"})`;
      }
      if (latestEv.type === "node.verify.iteration") {
        const payload = latestEv.payload as UnifiedPayload;
        return `↻ ${label} — verificando (intento ${payload.iteration})`;
      }
      if (latestEv.type === "node.execution.started") {
        return `↻ ${label} — ejecutando`;
      }
      return `· ${label} — pendiente`;
    });

    const isWaveDone = w.nodeIds.every((nodeId) => {
      return waveEvents.some((e) => (e.type === "node.verify.passed" || e.type === "node.execution.failed") && (e.payload as UnifiedPayload).nodeId === nodeId);
    });

    const latestWaveEventTime = waveEvents.length > 0 ? new Date(waveEvents[waveEvents.length - 1]!.at) : new Date(waveOpened.at);

    const statusTitle = isWaveDone
      ? `**Oleada ${w.waveId} completada**`
      : `**Oleada ${w.waveId} en ejecución paralela…**`;

    list.push({
      id: `wave-progress-${w.waveId}`,
      role: "assistant",
      content: [
        {
          type: "text",
          text: `${statusTitle}\n\n${nodeStatusList.join("\n")}`
        }
      ],
      createdAt: latestWaveEventTime
    });
  });

  // Run completion message
  const runCompleted = events.find((e) => e.type === "run.completed");
  if (runCompleted) {
    const payload = runCompleted.payload as UnifiedPayload;
    list.push({
      id: "run-complete-message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Orquestación finalizada. Estado final: **${payload.status === "success" ? "completado exitosamente" : payload.status}**.`
        }
      ],
      createdAt: new Date(runCompleted.at)
    });
  }

  // Stable message ids (`decision-<id>`, `conflict-<id>`) legitimately RECUR in
  // the append-only log: a gate or conflict is raised, resolved/retried, then
  // raised AGAIN for the same target across a retry loop (e.g. retry_integration),
  // so the log holds more than one `decision.raised`/`conflict.detected` per key.
  // The reducer already collapses these into a single model entry, so the thread
  // must render exactly one card per id — and assistant-ui hard-crashes on a
  // duplicate message id. Keep the LAST occurrence so the actionable card sits at
  // the most recent point in the stream (resolutions stay distinct via their seq).
  const deduped = [...new Map(list.map((message) => [message.id, message])).values()];

  // Chronological order so prompts, plan, waves and gates read as one stream.
  return deduped.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
