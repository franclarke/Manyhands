"use client";

import { useMemo, useState } from "react";
import { buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView, type ProductStage } from "@/lib/run-model/minimal-workspace-view";
import type { Run, RunEvent, RunModel, Node } from "@/lib/run-model/types";
import type { UiStatus } from "@/lib/status";
import { StatusPill } from "@/components/ui/status-pill";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { ChatRuntimeProvider } from "@/components/chat/assistant-provider";
import { ChatThread, ChatRail } from "@/components/chat/thread";
import { Button } from "@/components/ui/button";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ArtifactTabs } from "./artifact-tabs.client";
import { DeliveryPanel } from "./delivery-panel.client";
import { Download, Pause, Play } from "lucide-react";

const SSR_NOOP_STORAGE: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => null,
  setItem: () => undefined
};

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

  // Collapsible orchestrator panel: collapse to a thin rail to free the canvas,
  // driven imperatively so the resize handle and the header toggle stay in sync.
  const chatPanelRef = usePanelRef();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const toggleChat = (): void => {
    const ref = chatPanelRef.current;
    if (ref === null) return;
    if (ref.isCollapsed()) ref.expand();
    else ref.collapse();
  };

  // Persisted, per-arrangement panel layout (with/without the focus panel).
  // `storage` must be passed explicitly: the library defaults to `localStorage`,
  // which crashes during SSR (this component server-renders its first frame).
  const panelIds = focusView !== null ? ["chat", "artifacts", "focus"] : ["chat", "artifacts"];
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "mh-run-workspace",
    panelIds,
    storage: typeof window === "undefined" ? SSR_NOOP_STORAGE : window.localStorage
  });

  return (
    <ChatRuntimeProvider events={events}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] font-sans">
        <RunHeader runId={seed.id} view={view} model={model} workspaceName={workspaceName} />

        {/* Resizable multipanel workspace: chat | artifacts | focus.
            Layout persists per panel arrangement via useDefaultLayout. */}
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="flex-1 overflow-hidden"
        >
          <Panel
            id="chat"
            defaultSize="30%"
            minSize="240px"
            maxSize="48%"
            collapsible
            collapsedSize="52px"
            panelRef={chatPanelRef}
            onResize={() => setChatCollapsed(chatPanelRef.current?.isCollapsed() ?? false)}
            className="relative z-10 flex h-full min-w-0 flex-col"
          >
            {chatCollapsed ? (
              <ChatRail
                connected={connected}
                hasAttention={view.primaryAttention !== null}
                onExpand={toggleChat}
              />
            ) : (
              <ChatThread
                runId={seed.id}
                model={model}
                connected={connected}
                setActiveTab={setActiveTab}
                onCollapse={toggleChat}
              />
            )}
          </Panel>
          <ResizeHandle />
          <Panel id="artifacts" minSize="30%" className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
            {view.stage === "review" ? <DeliveryPanel runId={seed.id} /> : null}
            <div className="flex min-h-0 flex-1">
              <ArtifactTabs
                model={model}
                view={view}
                focus={focus}
                onFocus={setFocus}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </div>
          </Panel>
          {focusView !== null && (
            <>
              <ResizeHandle />
              <Panel
                id="focus"
                defaultSize="26%"
                minSize="280px"
                maxSize="44%"
                className="mh-panel-enter relative z-20 h-full overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)]"
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

const STAGE_META: Record<ProductStage, { label: string; status: UiStatus }> = {
  intent: { label: "Intención", status: "pending" },
  proposal: { label: "Planificando", status: "planning" },
  running: { label: "Ejecutando", status: "running" },
  review: { label: "Revisión", status: "needs_review" }
};

function RunHeader({
  runId,
  view,
  model,
  workspaceName
}: {
  runId: string;
  view: ReturnType<typeof selectMinimalWorkspaceView>;
  model: RunModel;
  workspaceName?: string | undefined;
}): React.ReactElement {
  const nodesCount = model.nodes.size;
  const conflictsCount = model.conflicts.size;
  const runningCount = Array.from(model.nodes.values()).filter((n: Node) => n.execution.kind === "running").length;
  const stage = STAGE_META[view.stage];

  return (
    <header className="flex h-12 select-none items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      {/* Identity: title → stage. The id lives in a quiet mono chip. */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="mh-mono shrink-0 rounded bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-text-subtle)]"
          title={`Run ${runId}`}
        >
          {runId.slice(0, 8)}
        </span>
        <h1 className="m-0 max-w-md truncate text-sm font-semibold text-[var(--color-text)]" title={view.title}>
          {view.title}
        </h1>
        <StatusPill status={stage.status} label={stage.label} />
      </div>

      <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="hidden min-w-0 items-center gap-1.5 md:flex">
          <span className="text-[var(--color-text-subtle)]">Workspace</span>
          <strong className="max-w-[140px] truncate font-medium text-[var(--color-text)]">
            {workspaceName ?? "—"}
          </strong>
        </span>
        <span className="hidden items-center gap-1.5 lg:flex">
          <span className="text-[var(--color-text-subtle)]">Granularidad</span>
          <strong className="mh-mono font-medium text-[var(--color-text)]">{model.run.config.aggressiveness}</strong>
        </span>
        <span className="mh-mono flex items-center gap-3 text-[11.5px]">
          <span title="Tareas del grafo">
            <strong className="font-semibold text-[var(--color-text)]">{nodesCount}</strong>{" "}
            <span className="text-[var(--color-text-subtle)]">tareas</span>
          </span>
          <span title="Conflictos detectados">
            <strong className={conflictsCount > 0 ? "font-semibold text-[var(--status-blocked-fg)]" : "font-semibold text-[var(--color-text)]"}>
              {conflictsCount}
            </strong>{" "}
            <span className="text-[var(--color-text-subtle)]">conflictos</span>
          </span>
          {runningCount > 0 ? (
            <span className="flex items-center gap-1.5" title="Subagentes ejecutando ahora">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-running-fg)]" />
              <strong className="font-semibold text-[var(--status-running-fg)]">{runningCount}</strong>{" "}
              <span className="text-[var(--color-text-subtle)]">activos</span>
            </span>
          ) : null}
        </span>

        {/* The chat thread is the single decision channel; the header only
            SIGNALS a pending gate instead of duplicating its action. */}
        <RunControlButton runId={runId} model={model} />
        {view.primaryAttention !== null ? (
          <StatusPill status="needs_review" label={view.primaryAttention.label} pulse />
        ) : view.stage === "review" && view.reviewEvidence ? (
          <a
            href={`/api/runs/${runId}/export?format=patch`}
            download
            className="flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-accent-contrast)] transition-colors hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)]"
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            Descargar cambios
          </a>
        ) : null}
      </div>
    </header>
  );
}

function RunControlButton({ runId, model }: { runId: string; model: RunModel }): React.ReactElement | null {
  const control = model.run.control;
  const [busy, setBusy] = useState<"pause" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPause = control.status === "generating" || control.status === "running";
  const canResume = control.status === "paused" && control.pendingHumanAction === "none";
  if (!canPause && !canResume) return null;

  const action = canPause ? "pause" : "resume";
  const label = action === "pause" ? "Pausar" : "Reanudar";

  const submit = async (): Promise<void> => {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: control.version })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `La acción falló (${response.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <Button
        variant="ghost"
        size="sm"
        busy={busy === action}
        busyLabel={action === "pause" ? "Pausando" : "Reanudando"}
        onClick={() => void submit()}
        title={error ?? label}
        aria-label={label}
      >
        {action === "pause" ? <Pause aria-hidden className="h-3.5 w-3.5" /> : <Play aria-hidden className="h-3.5 w-3.5 fill-current" />}
        {label}
      </Button>
      {error !== null ? (
        <span className="absolute right-0 top-full mt-1 max-w-[260px] rounded-[var(--r-md)] border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-2 py-1 text-[11px] leading-snug text-[var(--status-failed-fg)] shadow-sm">
          {error}
        </span>
      ) : null}
    </span>
  );
}
