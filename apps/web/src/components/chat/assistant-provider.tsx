import { useExternalStoreRuntime, AssistantRuntimeProvider, type AppendMessage, type ThreadMessage } from "@assistant-ui/react";
import { type ReactNode, useMemo, useState } from "react";
import type { RunEvent } from "@/lib/run-model/types";

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
  waves?: { waveId: number; nodeIds: string[] }[];
}

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

export function ChatRuntimeProvider({
  children,
  events
}: {
  children: ReactNode;
  events: RunEvent[];
}): React.ReactElement {
  const [customMessages, setCustomMessages] = useState<MyMessage[]>([]);

  // Convert ManyHands RunEvents to assistant-ui messages
  const mappedMessages = useMemo(() => {
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
        const choiceText = payload.choice?.action || payload.choice?.answer || "aprobado";
        list.push({
          id: `resolved-${payload.decisionId}-${event.seq}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Decisión resuelta: **${choiceText}**.`
            }
          ],
          createdAt: time
        });
      }
    });

    // Waves & subagent execution groups
    const wavePlanned = events.find((e) => e.type === "wave.planned");
    const wavePlans: { waveId: number; nodeIds: string[] }[] = (wavePlanned?.payload as unknown as UnifiedPayload)?.waves || [];

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

    // Chronological order so prompts, plan, waves and gates read as one stream.
    return list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }, [events]);

  const allMessages = useMemo(() => {
    return [...mappedMessages, ...customMessages];
  }, [mappedMessages, customMessages]);

  const adapter = useMemo(() => ({
    messages: allMessages,
    convertMessage: (message: MyMessage) => {
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      } as unknown as ThreadMessage;
    },
    // Appends the human's own message to the thread. The REAL side effect
    // (answering a planning question) is owned by the thread component, which
    // knows the pending decision; this provider never fakes a reply.
    onNew: async (message: AppendMessage) => {
      const userMsg: MyMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message.content.map((c) => {
          if (c.type === "text") return { type: "text", text: c.text };
          return { type: "text", text: "" };
        }),
        createdAt: new Date()
      };
      setCustomMessages((prev) => [...prev, userMsg]);
    }
  }), [allMessages]);

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
