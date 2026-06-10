"use client";

import { useThread, useComposerRuntime } from "@assistant-ui/react";
import React, { useState, useRef, useEffect } from "react";
import type { RunModel } from "@/lib/run-model/types";
import {
  Send,
  Sparkles,
  AlertTriangle,
  Play,
  Loader2,
  AlertOctagon,
  Eye,
  ArrowRight
} from "lucide-react";

interface ChatThreadProps {
  runId: string;
  model: RunModel;
  setActiveTab: (tab: "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation") => void;
}

export function ChatThread({ runId, model, setActiveTab }: ChatThreadProps): React.ReactElement {
  const messages = useThread((t) => t.messages);
  const composer = useComposerRuntime();
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (inputText.trim().length === 0) return;
    composer.setText(inputText);
    composer.send();
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void handleSend();
    }
  };

  // Resolve plan approval
  const handleApprovePlan = async () => {
    setApproving(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/approve-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledgeCriticErrors: true })
      });
      if (!response.ok) {
        throw new Error(`Failed to approve plan: ${response.status}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setApproving(false);
    }
  };

  // Resolve decision raised in run
  const handleResolveDecision = async (decisionId: string, choiceAction: "approve" | "reject" | "accept") => {
    setBusy(decisionId);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(decisionId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice: { action: choiceAction } })
      });
      if (!response.ok) {
        throw new Error(`Failed to resolve decision: ${response.status}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  // Check if plan approval decision is pending
  const pendingPlanDecision = Array.from(model.decisions.values()).find(
    (d) => d.kind === "approve_plan" && d.status === "pending"
  );
  const isPlanPending = pendingPlanDecision !== undefined;

  return (
    <div className="h-full w-full bg-[var(--color-surface)] flex flex-col font-sans border-r border-[var(--color-border)]">
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] z-10">
        <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-text)] flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--color-text-subtle)]" />
          Comandos
        </h2>
        <span className="flex items-center gap-1 text-[9px] font-mono text-[var(--status-completed-fg)] bg-[var(--status-completed-bg)] border border-[var(--status-completed-border)] px-1.5 py-0.5 rounded uppercase tracking-wide">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-completed-fg)] animate-pulse" />
          Conectado
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4 bg-[var(--color-bg)]">
        {messages.map((message) => {
          const isAssistant = message.role === "assistant";
          const textContent = message.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
          
          const isDecision = textContent.includes("⚠ Se requiere decisión humana");
          const isConflict = textContent.includes("⚡ Conflicto de fusión detectado");
          const isSystemInfo = textContent.startsWith("✓") || textContent.startsWith("✗") || textContent.startsWith("🏁") || textContent.startsWith("Iniciando") || textContent.startsWith("Inspeccionando");

          if (!isAssistant) {
            // User message: right-aligned blue bubble
            return (
              <div key={message.id} className="flex justify-end w-full animate-fade-in">
                <div className="max-w-[82%] p-3 px-4 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
                  <Markdown text={textContent} isUser={true} />
                </div>
              </div>
            );
          }

          // Assistant message: left-aligned bubble with dot indicator
          return (
            <div key={message.id} className="flex gap-2.5 items-start max-w-[85%] animate-fade-in">
              <div className="w-5 h-5 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                {isDecision ? (
                  <DecisionCard
                    text={textContent}
                    model={model}
                    busy={busy}
                    onApprove={(id) => handleResolveDecision(id, "approve")}
                    onReject={(id) => handleResolveDecision(id, "reject")}
                  />
                ) : isConflict ? (
                  <ConflictCard text={textContent} onTabChange={setActiveTab} />
                ) : (
                  <div
                    className={`p-3 px-4 rounded-lg border text-sm leading-relaxed ${
                      isSystemInfo
                        ? "bg-[var(--color-bg-subtle)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-medium"
                        : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]"
                    }`}
                  >
                    <Markdown text={textContent} />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* If plan is waiting for approval, show the PlanApprovalCard inline */}
        {isPlanPending && (
          <div className="flex gap-2.5 items-start max-w-[85%] animate-fade-in">
            <div className="w-5 h-5 rounded-md bg-[var(--color-bg-subtle)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0 mt-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-planning-fg)] animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <PlanApprovalCard
                model={model}
                approving={approving}
                onApprove={handleApprovePlan}
                onTabChange={setActiveTab}
              />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="relative flex items-center bg-[var(--color-surface)] border border-[var(--color-border-control)] rounded-lg overflow-hidden focus-within:border-[var(--color-accent)] transition-all">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Preguntá o indicá un cambio..."
            className="w-full bg-transparent pl-4 pr-12 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={inputText.trim().length === 0}
            className={`absolute right-2 p-1.5 rounded-lg transition-colors ${
              inputText.trim().length > 0
                ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)]"
                : "bg-[var(--color-bg-subtle)] text-[var(--color-text-faint)] cursor-not-allowed"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-2 text-center">
          <span className="text-[10px] text-[var(--color-text-faint)]">
            ManyHands es un orquestador. Las solicitudes de aprobación y logs finos se integran en el chat.
          </span>
        </div>
      </div>
    </div>
  );
}

function PlanApprovalCard({
  model,
  approving,
  onApprove,
  onTabChange
}: {
  model: RunModel;
  approving: boolean;
  onApprove: () => void;
  onTabChange: (tab: "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation") => void;
}): React.ReactElement {
  const totalTasks = model.nodes.size;
  const leafTasks = Array.from(model.nodes.values()).filter((n) => n.role === "leaf").length;
  const seamsCount = model.seams.size;
  const conflictsCount = model.conflicts.size;
  const granularity = model.run.config.aggressiveness;

  return (
    <div className="p-4 bg-[var(--color-surface)] border border-[var(--status-planning-border)] rounded-xl shadow-sm space-y-4 font-sans">
      <div className="flex gap-2 items-center">
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-planning-fg)] animate-pulse" />
        <span className="text-[10px] font-bold text-[var(--status-planning-fg)] uppercase tracking-wider">
          Plan listo para aprobar
        </span>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-[var(--color-text)] leading-snug">
          Se ha generado la descomposición en subagentes. Revisá el plan y las costuras antes de ejecutar.
        </h4>
        
        {/* Plan stats list */}
        <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 bg-[var(--color-bg-subtle)] p-3 rounded-lg border border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
          <div>
            • Tareas: <strong className="text-[var(--color-text)]">{totalTasks}</strong>
          </div>
          <div>
            • Hojas ejecutables: <strong className="text-[var(--color-text)]">{leafTasks}</strong>
          </div>
          <div>
            • Costuras (seams): <strong className="text-[var(--color-text)]">{seamsCount}</strong>
          </div>
          <div>
            • Conflictos: <strong className="text-[var(--color-text)]">{conflictsCount}</strong>
          </div>
          <div className="col-span-2 pt-1.5 border-t border-[var(--color-border)] mt-1 flex justify-between">
            <span>• Granularidad:</span>
            <strong className="text-[var(--status-planning-fg)] uppercase font-mono">{granularity}</strong>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <button
          onClick={onApprove}
          disabled={approving}
          className="w-full h-9 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-subtle)] disabled:text-[var(--color-text-faint)] text-[var(--color-accent-contrast)] text-xs font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          {approving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          Aprobar plan e iniciar subagentes
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onTabChange("dag")}
            className="h-8 border border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] text-[11px] font-medium rounded-lg flex items-center justify-center gap-1 transition cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            Revisar DAG
          </button>
          <button
            onClick={() => onTabChange("plan")}
            className="h-8 border border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] text-[11px] font-medium rounded-lg flex items-center justify-center gap-1 transition cursor-pointer"
          >
            Ver Plan
          </button>
        </div>
      </div>
    </div>
  );
}

function DecisionCard({
  text,
  model,
  busy,
  onApprove,
  onReject
}: {
  text: string;
  model: RunModel;
  busy: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): React.ReactElement {
  // Find a pending decision in model to associate
  const pendingDecision = Array.from(model.decisions.values()).find(
    (d) => d.status === "pending"
  );

  return (
    <div className="p-4 bg-[var(--color-surface)] border border-[var(--status-blocked-border)] rounded-xl shadow-sm space-y-3 font-sans">
      <div className="flex gap-2 items-center">
        <AlertTriangle className="w-4 h-4 text-[var(--status-blocked-fg)]" />
        <span className="text-xs font-semibold text-[var(--status-blocked-fg)] uppercase tracking-wide">
          Se requiere tu aprobación
        </span>
      </div>
      <p className="text-xs text-[var(--color-text)] leading-relaxed font-medium">
        {text.replace("⚠ Se requiere decisión humana:", "").trim()}
      </p>

      {pendingDecision ? (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onApprove(pendingDecision.id)}
            disabled={busy !== null}
            className="flex-1 h-8 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-accent-contrast)] text-xs font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            {busy === pendingDecision.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Aprobar
          </button>
          <button
            onClick={() => onReject(pendingDecision.id)}
            disabled={busy !== null}
            className="px-3 h-8 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-border-soft)] border border-[var(--color-border)] text-[var(--color-text-muted)] text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Rechazar
          </button>
        </div>
      ) : (
        <span className="text-[11px] text-[var(--color-text-faint)] italic block">
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
  onTabChange: (tab: "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation") => void;
}): React.ReactElement {
  return (
    <div className="p-4 bg-[var(--color-surface)] border border-[var(--status-failed-border)] rounded-xl shadow-sm space-y-3 font-sans">
      <div className="flex gap-2 items-center">
        <AlertOctagon className="w-4 h-4 text-[var(--status-failed-fg)]" />
        <span className="text-xs font-semibold text-[var(--status-failed-fg)] uppercase tracking-wide">
          Conflicto Detectado
        </span>
      </div>
      <p className="text-xs text-[var(--color-text)] leading-relaxed font-medium">
        {text.replace("⚡ Conflicto de fusión detectado", "").trim()}
      </p>
      
      <button
        onClick={() => onTabChange("conflicts")}
        className="w-full h-8 border border-[var(--status-failed-border)] hover:bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)] text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition cursor-pointer"
      >
        Revisar Conflictos
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function Markdown({ text, isUser }: { text: string; isUser?: boolean }): React.ReactElement {
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
            <ul key={pIdx} className="list-disc pl-4 space-y-1 my-1">
              {lines.map((line, lIdx) => (
                <li key={lIdx} className={`text-xs leading-normal ${isUser ? "text-[var(--color-accent-contrast)] opacity-90" : "text-[var(--color-text-muted)]"}`}>
                  {renderInline(line.trim().replace(/^[-*]\s+/, ""), isUser)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={pIdx} className={`text-xs leading-relaxed ${isUser ? "text-[var(--color-accent-contrast)]" : "text-[var(--color-text)]"}`}>
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
        <code key={idx} className={`font-mono text-[10.5px] px-1.5 py-0.5 rounded font-medium border ${
          isUser
            ? "bg-[color-mix(in_srgb,var(--color-accent-contrast)_12%,transparent)] border-[color-mix(in_srgb,var(--color-accent-contrast)_22%,transparent)] text-[var(--color-accent-contrast)]"
            : "bg-[var(--color-bg-subtle)] border-[var(--color-border)] text-[var(--color-accent-hover)]"
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
