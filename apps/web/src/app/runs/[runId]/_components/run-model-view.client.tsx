"use client";

import { useCallback, useMemo, useState } from "react";
import { buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import type { Run, RunEvent, RunModel, Node } from "@/lib/run-model/types";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { ChatRuntimeProvider } from "@/components/chat/assistant-provider";
import { ChatThread } from "@/components/chat/thread";
import { ArtifactTabs } from "./artifact-tabs.client";
import { Play } from "lucide-react";

export function RunModelView({
  seed,
  initialEvents,
  workspaceName
}: {
  seed: Run;
  initialEvents: RunEvent[];
  workspaceName?: string | undefined;
}): React.ReactElement {
  const { model, events, connected } = useLiveRunModel(seed, initialEvents);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [activeTab, setActiveTab] = useState<"dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation">("dag");

  const view = useMemo(() => selectMinimalWorkspaceView(model), [model]);
  const focusView = useMemo(() => (focus !== null ? buildFocusView(model, focus) : null), [model, focus]);

  const onResolve = useCallback(
    (id: string) => {
      const decision = model.decisions.get(id);
      if (decision === undefined) return;
      const choice = defaultChoiceFor(decision.kind, decision.context.options);
      void fetch(`/api/runs/${encodeURIComponent(seed.id)}/decisions/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice })
      });
    },
    [model, seed.id]
  );

  return (
    <ChatRuntimeProvider events={events} onUserMessage={async () => {}}>
      <div className="flex flex-col w-full h-screen bg-[var(--color-bg)] overflow-hidden font-sans">
        {/* Compact Header */}
        <CompactRunHeader
          runId={seed.id}
          view={view}
          model={model}
          _connected={connected}
          onResolve={onResolve}
          workspaceName={workspaceName}
        />

        {/* 2-Pane Content View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Conversational Chat (Middle) */}
          <div className="w-[420px] flex-shrink-0 flex flex-col relative z-10 border-r border-[var(--color-border)]">
            <ChatThread runId={seed.id} model={model} setActiveTab={setActiveTab} />
          </div>

          {/* Tabbed Artifact Panel (Right) */}
          <div className="flex-1 flex relative bg-white min-w-0">
            <ArtifactTabs
              model={model}
              view={view}
              focus={focus}
              onFocus={setFocus}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            {/* Slide-out Inspector Focus Panel */}
            {focusView !== null && (
              <div className="w-[380px] h-full flex-shrink-0 border-l border-[var(--color-border)] bg-white shadow-[-12px_0_24px_rgba(0,0,0,0.03)] overflow-y-auto relative z-20">
                <FocusPanel
                  view={focusView}
                  onClose={() => setFocus(null)}
                  onFocus={setFocus}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </ChatRuntimeProvider>
  );
}

function CompactRunHeader({
  runId,
  view,
  model,
  _connected,
  onResolve,
  workspaceName
}: {
  runId: string;
  view: ReturnType<typeof selectMinimalWorkspaceView>;
  model: RunModel;
  _connected: boolean;
  onResolve: (id: string) => void;
  workspaceName?: string | undefined;
}): React.ReactElement {
  const nodesCount = model.nodes.size;
  const conflictsCount = model.conflicts.size;
  const runningCount = Array.from(model.nodes.values()).filter((n: Node) => n.execution.kind === "running").length;

  return (
    <header className="flex items-center justify-between px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] h-12 select-none">
      <div className="flex items-center gap-3 min-w-0">
        <span className="mh-mono text-xs font-semibold px-2 py-0.5 bg-[var(--color-bg-subtle)] rounded text-[var(--color-text-muted)]">
          Run {runId.slice(0, 8)}
        </span>
        <span className="text-sm font-semibold text-[var(--color-text)] truncate max-w-sm" title={view.title}>
          {view.title}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold font-mono border ${
          view.stage === "review"
            ? "bg-[var(--status-review-bg)] text-[var(--status-review-fg)] border-[var(--status-review-border)]"
            : view.stage === "proposal"
              ? "bg-[var(--status-planning-bg)] text-[var(--status-planning-fg)] border-[var(--status-planning-border)]"
              : view.stage === "running"
                ? "bg-[var(--status-running-bg)] text-[var(--status-running-fg)] border-[var(--status-running-border)] animate-pulse"
                : "bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] border-[var(--status-pending-border)]"
        }`}>
          {view.stage}
        </span>
      </div>

      <div className="flex items-center gap-5 text-xs text-[var(--color-text-muted)]">
        <span className="hidden md:inline">
          Workspace: <strong className="text-[var(--color-text)]">{workspaceName ?? model.run.workspaceId.slice(0, 8)}</strong>
        </span>
        <span className="hidden lg:inline">
          Granularidad: <strong className="text-[var(--color-text)]">{model.run.config.aggressiveness}</strong>
        </span>
        <div className="flex items-center gap-3">
          <span>Tareas: <strong className="text-[var(--color-text)]">{nodesCount}</strong></span>
          <span>Conflictos: <strong className="text-[var(--color-text)]">{conflictsCount}</strong></span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--status-running-fg)] animate-pulse" />
              Ejecutando: <strong className="text-[var(--color-text)]">{runningCount}</strong>
            </span>
          )}
        </div>

        {/* Primary Contextual Action in Header */}
        {view.primaryAttention !== null ? (
          <button
            onClick={() => onResolve(view.primaryAttention!.id)}
            className="h-8 px-3 bg-[var(--color-accent)] hover:opacity-90 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {view.primaryAttention.primaryActionLabel}
          </button>
        ) : view.stage === "review" && view.reviewEvidence ? (
          <a
            href={`/api/runs/${runId}/export?format=patch`}
            download
            className="h-8 px-3 bg-[var(--color-accent)] hover:opacity-90 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition text-none hover:text-white"
          >
            Descargar Cambios
          </a>
        ) : null}
      </div>
    </header>
  );
}

function defaultChoiceFor(kind: string, options: readonly string[] | undefined) {
  if (kind === "clarify") return { answer: options?.[0] ?? "" };
  if (kind === "resolve_conflict") return { resolutionId: "human-selected" };
  if (kind === "approve_merge") return { action: "accept" };
  return { action: "approve" };
}
