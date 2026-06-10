"use client";

import { useMemo, useState } from "react";
import { buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import type { Run, RunEvent, RunModel, Node } from "@/lib/run-model/types";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { ChatRuntimeProvider } from "@/components/chat/assistant-provider";
import { ChatThread } from "@/components/chat/thread";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ArtifactTabs } from "./artifact-tabs.client";

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

  // Persisted, per-arrangement panel layout (with/without the focus panel).
  const panelIds = focusView !== null ? ["chat", "artifacts", "focus"] : ["chat", "artifacts"];
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "mh-run-workspace", panelIds });

  return (
    <ChatRuntimeProvider events={events} onUserMessage={async () => {}}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] font-sans">
        {/* Compact Header */}
        <CompactRunHeader
          runId={seed.id}
          view={view}
          model={model}
          _connected={connected}
          workspaceName={workspaceName}
        />

        {/* Resizable multipanel workspace: chat | artifacts | focus.
            Layout persists per panel arrangement via autoSaveId. */}
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="flex-1 overflow-hidden"
        >
          <Panel id="chat" defaultSize="30%" minSize="240px" maxSize="48%" className="relative z-10 flex h-full min-w-0 flex-col">
            <ChatThread runId={seed.id} model={model} setActiveTab={setActiveTab} />
          </Panel>
          <ResizeHandle />
          <Panel id="artifacts" minSize="30%" className="flex h-full min-w-0 bg-[var(--color-bg)]">
            <ArtifactTabs
              model={model}
              view={view}
              focus={focus}
              onFocus={setFocus}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </Panel>
          {focusView !== null && (
            <>
              <ResizeHandle />
              <Panel
                id="focus"
                defaultSize="26%"
                minSize="280px"
                maxSize="44%"
                className="mh-panel-enter relative z-20 h-full overflow-y-auto bg-[var(--color-surface)] shadow-[-12px_0_24px_rgba(0,0,0,0.18)]"
              >
                <FocusPanel
                  view={focusView}
                  onClose={() => setFocus(null)}
                  onFocus={setFocus}
                />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </ChatRuntimeProvider>
  );
}

function CompactRunHeader({
  runId,
  view,
  model,
  _connected,
  workspaceName
}: {
  runId: string;
  view: ReturnType<typeof selectMinimalWorkspaceView>;
  model: RunModel;
  _connected: boolean;
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
                ? "bg-[var(--status-running-bg)] text-[var(--status-running-fg)] border-[var(--status-running-border)] mh-working"
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

        {/* The chat thread is the single decision channel; the header only
            SIGNALS a pending gate instead of duplicating its action. */}
        {view.primaryAttention !== null ? (
          <span className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-2 bg-[var(--status-review-bg)] text-[var(--status-review-fg)] border border-[var(--status-review-border)]">
            <span className="w-2 h-2 rounded-full bg-[var(--status-review-fg)] animate-pulse" />
            {view.primaryAttention.label}
          </span>
        ) : view.stage === "review" && view.reviewEvidence ? (
          <a
            href={`/api/runs/${runId}/export?format=patch`}
            download
            className="h-8 px-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-accent-contrast)] rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition text-none hover:text-[var(--color-accent-contrast)]"
          >
            Descargar Cambios
          </a>
        ) : null}
      </div>
    </header>
  );
}

