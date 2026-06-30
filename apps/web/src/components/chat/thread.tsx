"use client";

import { useThread, useComposerRuntime } from "@assistant-ui/react";
import React, { useState, useRef, useEffect, useMemo } from "react";
import type { Decision, RunModel } from "@/lib/run-model/types";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Send,
  Sparkles,
  Play,
  Loader2,
  OctagonAlert,
  Eye,
  ArrowRight,
  Check,
  Flag,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";

type TabKey = "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation";

interface ChatThreadProps {
  runId: string;
  model: RunModel;
  connected: boolean;
  setActiveTab: (tab: TabKey) => void;
  onCollapse: () => void;
}

export function ChatThread({ runId, model, connected, setActiveTab, onCollapse }: ChatThreadProps): React.ReactElement {
  const messages = useThread((t) => t.messages);
  const composer = useComposerRuntime();
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Only follow the tail when the operator is already there. In long control-room
  // sessions, wave progress rewrites the same message constantly; yanking the
  // scroll to the bottom every tick would steal the reading position.
  const atBottomRef = useRef(true);

  const handleScroll = (): void => {
    const el = scrollContainerRef.current;
    if (el === null) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const pendingPlanDecision = useMemo(
    () =>
      Array.from(model.decisions.values()).find(
        (d) => d.kind === "approve_plan" && d.status === "pending"
      ),
    [model]
  );

  // A pending clarify gate makes the composer a REAL channel: the text travels
  // as the answer to the planner's question (POST /answer → Command resume).
  const pendingQuestion = useMemo(
    () =>
      Array.from(model.decisions.values()).find(
        (d) => d.kind === "clarify" && d.status === "pending" && d.context.question !== undefined
      ),
    [model]
  );
  const canSend = pendingQuestion !== undefined;
  // Execution gates reuse the clarify channel but are NOT planner questions —
  // the composer copy must say so (context.gate is set by persistExecutionPause).
  const isExecutionGate = pendingQuestion?.context.gate !== undefined;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async (): Promise<void> => {
    const text = inputText.trim();
    if (text.length === 0 || pendingQuestion === undefined) return;
    const nodeId = pendingQuestion.context.nodeIds?.[0];
    if (nodeId === undefined) return;
    setActionError(null);
    composer.setText(text);
    composer.send();
    setInputText("");
    if (textareaRef.current !== null) textareaRef.current.style.height = "auto";
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId, answer: text })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter is a newline so multi-sentence answers fit.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleApprovePlan = async (): Promise<void> => {
    if (!pendingPlanDecision) return;
    setApproving(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(pendingPlanDecision.id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve", acknowledgeCriticErrors: true })
        }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  };

  const postDecision = async (decisionId: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(decisionId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(decisionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleResolveDecision = (decisionId: string, choiceAction: "approve" | "reject"): Promise<void> =>
    postDecision(decisionId, { choice: { action: choiceAction } });

  // Gate/clarify options travel as the answer the backend validates against
  // the gate's option labels — the exact label is what makes replan_subtree
  // and friends match server-side.
  const handleAnswerDecision = (decisionId: string, answer: string): Promise<void> =>
    postDecision(decisionId, { answer });

  return (
    <div className="flex h-full w-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] font-sans">
      {/* Header */}
      <div className="z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
        <h2 className="flex items-center gap-2 text-label font-semibold tracking-tight text-[var(--color-text)]">
          <Sparkles aria-hidden className="h-4 w-4 text-[var(--color-text-subtle)]" />
          Orquestador
        </h2>
        <div className="flex items-center gap-2">
          <StatusPill
            status={connected ? "completed" : "blocked"}
            label={connected ? "Conectado" : "Reconectando…"}
            pulse={!connected}
          />
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Colapsar el orquestador"
            title="Colapsar el orquestador"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-md)] text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
          >
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[var(--color-bg)] px-5 py-5"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => {
          const textContent = message.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");

          if (message.role !== "assistant") {
            return (
              <div key={message.id} className="animate-fade-in flex w-full justify-end">
                <div className="max-w-[82%] rounded-[var(--r-lg)] bg-[var(--color-accent)] px-4 py-3 text-[var(--color-accent-contrast)]">
                  <Markdown text={textContent} isUser />
                </div>
              </div>
            );
          }

          const kind = messageKind(message.id);

          if (kind === "resolved") {
            return (
              <div key={message.id} className="animate-fade-in flex items-center gap-2 pl-7 text-meta text-[var(--color-text-subtle)]">
                <Check aria-hidden className="h-4 w-4 text-[var(--status-completed-fg)]" />
                <Markdown text={textContent} inline />
              </div>
            );
          }

          return (
            <div key={message.id} className="animate-fade-in flex max-w-[88%] items-start gap-3">
              <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                {kind === "decision" ? (
                  <GateCard
                    icon={<CircleHelp aria-hidden className="h-4 w-4" />}
                    eyebrow="Gate · decisión humana"
                    decision={model.decisions.get(decisionIdFrom(message.id))}
                    text={textContent}
                    busy={busy}
                    onApprove={(id) => void handleResolveDecision(id, "approve")}
                    onReject={(id) => void handleResolveDecision(id, "reject")}
                    onAnswer={(id, answer) => void handleAnswerDecision(id, answer)}
                    onTabChange={setActiveTab}
                  />
                ) : kind === "conflict" ? (
                  <ConflictCard text={textContent} onTabChange={setActiveTab} />
                ) : kind === "final" ? (
                  <div className="rounded-[var(--r-lg)] border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-4 py-3 text-sm leading-relaxed text-[var(--color-text)]">
                    <span className="mh-mono mb-1.5 flex items-center gap-1.5 text-eyebrow uppercase tracking-[0.08em] text-[var(--status-completed-fg)]">
                      <Flag aria-hidden className="h-3 w-3" />
                      Run finalizado
                    </span>
                    <Markdown text={textContent} />
                  </div>
                ) : kind === "wave" ? (
                  <WaveCard text={textContent} />
                ) : (
                  <div
                    className={[
                      "rounded-[var(--r-lg)] border px-4 py-3 text-label leading-relaxed",
                      kind === "planning"
                        ? "mh-working border-[var(--status-planning-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                    ].join(" ")}
                  >
                    <Markdown text={textContent} />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Plan approval gate (interactive, pinned to the stream tail) */}
        {pendingPlanDecision !== undefined && (
          <div className="animate-fade-in flex max-w-[88%] items-start gap-3">
            <div className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-review-fg)]" />
            </div>
            <div className="min-w-0 flex-1">
              <PlanApprovalCard
                model={model}
                approving={approving}
                onApprove={() => void handleApprovePlan()}
                onTabChange={setActiveTab}
              />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Action error feedback */}
      {actionError !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-t border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-5 py-3 text-meta leading-relaxed text-[var(--status-failed-fg)]"
        >
          <OctagonAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{actionError}</span>
        </div>
      ) : null}

      {/* Intervention channel — a real input only while a gate awaits an answer.
          Otherwise it collapses to a quiet status line instead of a dead input. */}
      {canSend ? (
        <div className="border-t border-[var(--status-review-border)] bg-[var(--color-surface)] p-4">
          <div className="relative flex items-end overflow-hidden rounded-[var(--r-lg)] border border-[var(--status-review-border)] bg-[var(--color-surface)] transition-colors focus-within:border-[var(--color-accent)]">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              aria-label={
                isExecutionGate ? "Respuesta para el gate de ejecución" : "Respuesta para el planner"
              }
              placeholder={
                isExecutionGate
                  ? "Escribí una opción del gate (o usá los botones de arriba)…"
                  : "Respondé la pregunta del planner…"
              }
              className="max-h-40 w-full resize-none bg-transparent py-3 pl-4 pr-12 text-sm leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={inputText.trim().length === 0}
              aria-label="Enviar respuesta"
              className={[
                "absolute bottom-2 right-2 rounded-[var(--r-md)] p-1.5 transition-colors",
                inputText.trim().length > 0
                  ? "cursor-pointer bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)]"
                  : "cursor-not-allowed bg-[var(--color-bg-subtle)] text-[var(--color-text-faint)]"
              ].join(" ")}
            >
              <Send aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-micro text-[var(--status-review-fg)]">
            {isExecutionGate
              ? "La ejecución está pausada esperando tu decisión."
              : "El planner está esperando tu respuesta para continuar la descomposición."}
            <span className="text-[var(--color-text-subtle)]"> · Enter envía, Shift+Enter salta de línea</span>
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-meta text-[var(--color-text-subtle)]">
          <CircleHelp aria-hidden className="h-4 w-4 shrink-0" />
          <span>ManyHands pedirá tu intervención acá cuando haga falta.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsed projection of the orchestrator panel: a thin rail that still
 * surfaces the two things the operator can't afford to lose when the chat is
 * out of the way — liveness (connection) and a pending decision (attention).
 */
export function ChatRail({
  connected,
  hasAttention,
  onExpand
}: {
  connected: boolean;
  hasAttention: boolean;
  onExpand: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center gap-3 border-r border-[var(--color-border)] bg-[var(--color-surface)] py-3">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expandir el orquestador"
        title="Expandir el orquestador"
        className="flex h-7 w-7 items-center justify-center rounded-[var(--r-md)] border border-[var(--color-border-control)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
      >
        <PanelLeftOpen aria-hidden className="h-4 w-4" />
      </button>
      <Sparkles aria-hidden className="h-4 w-4 text-[var(--color-text-subtle)]" />
      <span className="mt-1 text-eyebrow font-semibold uppercase tracking-[0.14em] text-[var(--color-text-subtle)] [writing-mode:vertical-rl]">
        Orquestador
      </span>
      <div className="mt-auto flex flex-col items-center gap-2">
        {hasAttention ? (
          <span
            aria-label="Hay una decisión pendiente"
            title="Hay una decisión pendiente"
            className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-review-fg)]"
          />
        ) : null}
        <span
          aria-label={connected ? "Conectado" : "Reconectando"}
          title={connected ? "Conectado" : "Reconectando"}
          className={[
            "h-2 w-2 rounded-full",
            connected ? "bg-[var(--status-completed-fg)]" : "animate-pulse bg-[var(--status-blocked-fg)]"
          ].join(" ")}
        />
      </div>
    </div>
  );
}

// ── Message taxonomy (id-based, never content sniffing) ──────────────────────

type MessageKind = "decision" | "conflict" | "resolved" | "wave" | "final" | "planning" | "narration";

function messageKind(id: string): MessageKind {
  if (id.startsWith("decision-")) return "decision";
  if (id.startsWith("conflict-")) return "conflict";
  if (id.startsWith("resolved-")) return "resolved";
  if (id.startsWith("wave-progress-")) return "wave";
  if (id === "run-complete-message") return "final";
  if (id === "plan-ongoing") return "planning";
  return "narration";
}

function decisionIdFrom(messageId: string): string {
  return messageId.replace(/^decision-/, "");
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function PlanApprovalCard({
  model,
  approving,
  onApprove,
  onTabChange
}: {
  model: RunModel;
  approving: boolean;
  onApprove: () => void;
  onTabChange: (tab: TabKey) => void;
}): React.ReactElement {
  const totalTasks = model.nodes.size;
  const leafTasks = Array.from(model.nodes.values()).filter((n) => n.role === "leaf").length;
  const seamsCount = model.seams.size;
  const conflictsCount = model.conflicts.size;
  const granularity = model.run.config.aggressiveness;

  return (
    <div className="space-y-4 rounded-[var(--r-xl)] border border-[var(--status-review-border)] bg-[var(--color-surface)] p-4 font-sans">
      <span className="mh-mono flex items-center gap-2 text-eyebrow font-semibold uppercase tracking-[0.08em] text-[var(--status-review-fg)]">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-review-fg)]" />
        Gate · aprobación del plan
      </span>

      <p className="m-0 text-label font-medium leading-snug text-[var(--color-text)]">
        La descomposición está lista. Revisá el plan y las costuras antes de lanzar los subagentes.
      </p>

      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-meta text-[var(--color-text-muted)]">
        <PlanStat label="Tareas" value={totalTasks} />
        <PlanStat label="Hojas ejecutables" value={leafTasks} />
        <PlanStat label="Costuras" value={seamsCount} />
        <PlanStat label="Conflictos previstos" value={conflictsCount} />
        <div className="col-span-2 mt-1 flex justify-between border-t border-[var(--color-border)] pt-1.5">
          <dt>Granularidad</dt>
          <dd className="mh-mono m-0 uppercase text-[var(--status-review-fg)]">{granularity}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 pt-0.5">
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent-contrast)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {approving ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Play aria-hidden className="h-4 w-4 fill-current" />
          )}
          Aprobar plan e iniciar subagentes
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTabChange("dag")}
            className="flex h-8 cursor-pointer items-center justify-center gap-1 rounded-[var(--r-md)] border border-[var(--color-border-control)] text-meta font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
          >
            <Eye aria-hidden className="h-4 w-4" />
            Revisar grafo
          </button>
          <button
            type="button"
            onClick={() => onTabChange("plan")}
            className="flex h-8 cursor-pointer items-center justify-center gap-1 rounded-[var(--r-md)] border border-[var(--color-border-control)] text-meta font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
          >
            Ver plan
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanStat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="mh-mono m-0 font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function GateCard({
  icon,
  eyebrow,
  decision,
  text,
  busy,
  onApprove,
  onReject,
  onAnswer,
  onTabChange
}: {
  icon: React.ReactNode;
  eyebrow: string;
  decision: Decision | undefined;
  text: string;
  busy: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAnswer: (id: string, answer: string) => void;
  onTabChange: (tab: TabKey) => void;
}): React.ReactElement {
  const pending = decision !== undefined && decision.status === "pending";
  // clarify decisions (planner questions AND execution gates) carry their
  // valid answers as option labels — generic Aprobar/Rechazar would 400
  // server-side, which is exactly how the postmortem run got stuck.
  const options = decision?.kind === "clarify" ? decision.context.options ?? [] : [];

  return (
    <div className="space-y-3 rounded-[var(--r-xl)] border border-[var(--status-review-border)] bg-[var(--color-surface)] p-4 font-sans">
      <span className="mh-mono flex items-center gap-2 text-eyebrow font-semibold uppercase tracking-[0.08em] text-[var(--status-review-fg)]">
        {icon}
        {eyebrow}
      </span>
      <p className="m-0 text-label font-medium leading-relaxed text-[var(--color-text)]">
        <Markdown text={text} inline />
      </p>

      {pending && decision !== undefined ? (
        options.length > 0 ? (
          <div className="flex flex-col gap-2 pt-0.5">
            {options.map((option, index) => (
              <button
                key={option}
                type="button"
                onClick={() => onAnswer(decision.id, option)}
                disabled={busy !== null}
                className={
                  index === 0
                    ? "flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-accent-contrast)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                    : "flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border-control)] bg-transparent px-3 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                }
              >
                {busy === decision.id ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
                {option}
                {index === 0 && decision.kind === "clarify" && decision.context.gate === undefined ? (
                  <span className="mh-mono rounded bg-[color-mix(in_srgb,var(--color-accent-contrast)_18%,transparent)] px-1 py-px text-eyebrow font-medium uppercase tracking-[0.06em]">
                    Recomendada
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : decision.kind === "clarify" ? (
          <span className="block text-meta text-[var(--color-text-subtle)]">
            Respondé desde el campo de abajo.
          </span>
        ) : decision.kind === "resolve_conflict" ? (
          <button
            type="button"
            onClick={() => onTabChange("conflicts")}
            className="flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-[var(--r-md)] border border-[var(--status-failed-border)] text-xs font-medium text-[var(--status-failed-fg)] transition-colors hover:bg-[var(--status-failed-bg)]"
          >
            Elegir resoluciÃ³n en Riesgos
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => onApprove(decision.id)}
              disabled={busy !== null}
              className="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent-contrast)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === decision.id ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Play aria-hidden className="h-4 w-4" />
              )}
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => onReject(decision.id)}
              disabled={busy !== null}
              className="h-8 cursor-pointer rounded-[var(--r-md)] border border-[var(--color-border-control)] bg-transparent px-3 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Rechazar
            </button>
          </div>
        )
      ) : (
        <span className="block text-meta text-[var(--color-text-subtle)]">
          Decisión ya resuelta o integrada.
        </span>
      )}
    </div>
  );
}

function ConflictCard({
  text,
  onTabChange
}: {
  text: string;
  onTabChange: (tab: TabKey) => void;
}): React.ReactElement {
  return (
    <div className="space-y-3 rounded-[var(--r-xl)] border border-[var(--status-failed-border)] bg-[var(--color-surface)] p-4 font-sans">
      <span className="mh-mono flex items-center gap-2 text-eyebrow font-semibold uppercase tracking-[0.08em] text-[var(--status-failed-fg)]">
        <OctagonAlert aria-hidden className="h-4 w-4" />
        Conflicto detectado
      </span>
      <p className="m-0 text-label font-medium leading-relaxed text-[var(--color-text)]">
        <Markdown text={text} inline />
      </p>
      <button
        type="button"
        onClick={() => onTabChange("conflicts")}
        className="flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-[var(--r-md)] border border-[var(--status-failed-border)] text-xs font-medium text-[var(--status-failed-fg)] transition-colors hover:bg-[var(--status-failed-bg)]"
      >
        Revisar en Riesgos
        <ArrowRight aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Wave progress — monospaced status lines so columns of states align. */
function WaveCard({ text }: { text: string }): React.ReactElement {
  const [title, ...rest] = text.split("\n\n");
  const lines = rest.join("\n\n").split("\n").filter((line) => line.trim().length > 0);
  const inProgress = title?.includes("…") === true;
  return (
    <div className="space-y-3 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 font-sans">
      <p className={["m-0 text-label font-semibold text-[var(--color-text)]", inProgress ? "mh-working rounded" : ""].join(" ")}>
        <Markdown text={title ?? ""} inline />
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {lines.map((line, idx) => (
          <li key={idx} className="mh-mono text-eyebrow leading-relaxed text-[var(--color-text-muted)]">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Lightweight markdown (bold + inline code) ────────────────────────────────

function Markdown({ text, isUser, inline }: { text: string; isUser?: boolean; inline?: boolean }): React.ReactElement {
  if (inline === true) {
    return <>{renderInline(text, isUser)}</>;
  }
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-2">
      {paragraphs.map((p, pIdx) => {
        const lines = p.split("\n");
        const isList = lines.every(
          (line) => line.trim().startsWith("- ") || line.trim().startsWith("* ")
        );

        if (isList) {
          return (
            <ul key={pIdx} className="my-1 list-disc space-y-1 pl-4">
              {lines.map((line, lIdx) => (
                <li key={lIdx} className={`text-xs leading-normal ${isUser ? "text-[var(--color-accent-contrast)] opacity-90" : "text-[var(--color-text-muted)]"}`}>
                  {renderInline(line.trim().replace(/^[-*]\s+/, ""), isUser)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={pIdx} className={`m-0 text-label leading-relaxed ${isUser ? "text-[var(--color-accent-contrast)]" : "text-[var(--color-text)]"}`}>
            {lines.map((line, lIdx) => (
              <span key={lIdx} className="block">
                {renderInline(line, isUser)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string, isUser?: boolean): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  const split = text.split(regex);

  split.forEach((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      parts.push(
        <strong key={idx} className={`font-semibold ${isUser ? "text-[var(--color-accent-contrast)]" : "text-[var(--color-text)]"}`}>
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      parts.push(
        <code key={idx} className={`rounded border px-1.5 py-0.5 font-mono text-micro font-medium ${
          isUser
            ? "border-[color-mix(in_srgb,var(--color-accent-contrast)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-accent-contrast)_12%,transparent)] text-[var(--color-accent-contrast)]"
            : "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
        }`}>
          {part.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(part);
    }
  });

  return parts;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; conflict?: { currentStatus?: string } };
    // Structured mutation conflict (409): another request already resolved this
    // decision. The model self-heals via SSE, so phrase it as info, not failure.
    if (response.status === 409 && payload.conflict !== undefined) {
      return "Esta decisión ya fue resuelta (por otra pestaña o una acción previa). El estado se actualizó.";
    }
    return payload.error ?? `La acción falló (${response.status}).`;
  } catch {
    return `La acción falló (${response.status}).`;
  }
}
