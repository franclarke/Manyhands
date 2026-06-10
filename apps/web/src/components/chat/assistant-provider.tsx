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
  changedFiles?: string[];
  cause?: string;
  iteration?: number;
  waves?: { waveId: number; nodeIds: string[] }[];
}

export interface MyMessage {
  id: string;
  role: "user" | "assistant";
  content: { type: "text"; text: string }[];
  createdAt: Date;
}

export function ChatRuntimeProvider({
  children,
  events,
  onUserMessage
}: {
  children: ReactNode;
  events: RunEvent[];
  onUserMessage: (message: string) => Promise<void>;
}): React.ReactElement {
  const [customMessages, setCustomMessages] = useState<MyMessage[]>([]);

  // Convert ManyHands RunEvents to assistant-ui messages
  const mappedMessages = useMemo(() => {
    const list: MyMessage[] = [];
    if (events.length === 0) return list;

    const baseTime = new Date(events[0]?.at || Date.now());

    // Base welcome message
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

    // Planning Phase
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
            text: `Planificación completada. He generado un DAG con **${readyPayload.nodeCount}** tareas, incluyendo **${readyPayload.seamCount}** costuras de inter-agente. El plan requiere aprobación antes de ser ejecutado.`
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
            text: `Inspeccionando el workspace git e identificando tareas... (${proposedNodes.length} tareas propuestas hasta el momento)`
          }
        ],
        createdAt: latestProposed ? new Date(latestProposed.at) : new Date(planStarted.at)
      });
    }

    // Human Decisions & Warnings (raised inline)
    events.forEach((event) => {
      const payload = event.payload as UnifiedPayload;
      const time = new Date(event.at);

      if (event.type === "decision.raised") {
        // Skip plan approval here as it is rendered by a special interactive section
        if (payload.decisionId === "approve_plan") return;

        list.push({
          id: `decision-${payload.decisionId}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: `⚠ **Se requiere decisión humana**: ${payload.context?.question || "Revisar y resolver solicitud."}`
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
              text: `⚡ Conflicto de fusión detectado en **${payload.files?.join(", ") || ""}** (${payload.dimension}). Causa: *${payload.diagnosisRef || ""}*. Se recomienda serializar.`
            }
          ],
          createdAt: time
        });
      }

      if (event.type === "decision.resolved") {
        const choiceText = payload.choice?.action || payload.choice?.answer || "Aprobado";
        list.push({
          id: `resolved-${payload.decisionId}-${event.seq}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: `✓ Decisión resuelta por el usuario: **"${choiceText}"**.`
            }
          ],
          createdAt: time
        });
      }
    });

    // Waves & Subagent execution groups
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
        if (nodeEvs.length === 0) return `- \`${nodeId}\`: Esperando ⚪`;

        const latestEv = nodeEvs[nodeEvs.length - 1]!;
        if (latestEv.type === "node.verify.passed") {
          const payload = latestEv.payload as UnifiedPayload;
          return `- \`${nodeId}\`: Completado ✓ (${payload.changedFiles?.length || 0} archivos modificados)`;
        }
        if (latestEv.type === "node.execution.failed") {
          const payload = latestEv.payload as UnifiedPayload;
          return `- \`${nodeId}\`: Falló ✗ (Causa: *${payload.cause}*)`;
        }
        if (latestEv.type === "node.verify.iteration") {
          const payload = latestEv.payload as UnifiedPayload;
          return `- \`${nodeId}\`: Verificando 🔍 (Intento ${payload.iteration})`;
        }
        if (latestEv.type === "node.execution.started") {
          return `- \`${nodeId}\`: Ejecutando ↻`;
        }
        return `- \`${nodeId}\`: Pendiente ⚪`;
      });

      const isWaveDone = w.nodeIds.every((nodeId) => {
        return waveEvents.some((e) => (e.type === "node.verify.passed" || e.type === "node.execution.failed") && (e.payload as UnifiedPayload).nodeId === nodeId);
      });

      const latestWaveEventTime = waveEvents.length > 0 ? new Date(waveEvents[waveEvents.length - 1]!.at) : new Date(waveOpened.at);

      const statusTitle = isWaveDone
        ? `**Oleada Wave ${w.waveId} completada**`
        : `**Oleada Wave ${w.waveId} en progreso paralelo...**`;

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
            text: `🏁 **Orquestación finalizada**. Estado final del run: **${payload.status === "success" ? "completado exitosamente" : payload.status}**.`
          }
        ],
        createdAt: new Date(runCompleted.at)
      });
    }

    // Sort list chronologically so user prompts, plan ready, waves, and approvals appear in exact sequence
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
      
      const userText = message.content.map(c => c.type === "text" ? c.text : "").join(" ");
      if (userText.trim().length > 0) {
        await onUserMessage(userText);
      }

      setTimeout(() => {
        const replyMsg: MyMessage = {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Recibido. Estoy procesando tu consulta en el contexto de la ejecución actual de ManyHands."
            }
          ],
          createdAt: new Date()
        };
        setCustomMessages((prev) => [...prev, replyMsg]);
      }, 1000);
    }
  }), [allMessages, onUserMessage]);

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
