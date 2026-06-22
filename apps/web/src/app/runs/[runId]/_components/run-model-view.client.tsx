"use client";

import { useEffect, useMemo, useState } from "react";
import { buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import type { Run, RunEvent, RunModel, Node } from "@/lib/run-model/types";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { StatusPill } from "@/components/ui/status-pill";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { RunTimeline } from "@/components/run-model/run-timeline";
import { selectRunTimeline } from "@/lib/run-model/run-phases";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { ChatRuntimeProvider } from "@/components/chat/assistant-provider";
import { ChatThread, ChatRail } from "@/components/chat/thread";
import { Button } from "@/components/ui/button";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ArtifactTabs } from "./artifact-tabs.client";
import { DeliveryPanel } from "./delivery-panel.client";
import { focusDockMode } from "@/lib/cockpit-layout";
import { useViewportWidth } from "@/lib/use-viewport-width";
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
  const timeline = useMemo(() => selectRunTimeline(model, view.stage), [model, view.stage]);
  // Pass the event log so the focus inspector can derive execution timing and the
  // live agent console (both read `options.events`, independent of the folded model).
  const focusView = useMemo(
    () => (focus !== null ? buildFocusView(model, focus, { events }) : null),
    [model, focus, events]
  );

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

  // Below a derived width the focus panel would clip both the chat and the DAG
  // canvas as a third column, so it floats as an overlay drawer instead. The
  // decision is the pure, tested `focusDockMode`; the width comes from a hook.
  const dockMode = focusDockMode(useViewportWidth());
  const focusDocked = focusView !== null && dockMode === "column";
  const focusOverlay = focusView !== null && dockMode === "overlay";

  // Close the overlay drawer on Escape — it has no resize handle to escape via.
  useEffect(() => {
    if (!focusOverlay) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusOverlay]);

  // Persisted, per-arrangement panel layout (with/without the docked focus panel).
  // `storage` must be passed explicitly: the library defaults to `localStorage`,
  // which crashes during SSR (this component server-renders its first frame).
  const panelIds = focusDocked ? ["chat", "artifacts", "focus"] : ["chat", "artifacts"];
  // The persisted layout (localStorage) differs from the SSR default, so reading
  // it on the first client render mismatches the server HTML. Gate it behind a
  // mount flag: first client render uses the noop storage (== SSR), and the
  // persisted layout applies on the post-hydration update instead.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "mh-run-workspace",
    panelIds,
    storage: hydrated && typeof window !== "undefined" ? window.localStorage : SSR_NOOP_STORAGE
  });

  return (
    <ChatRuntimeProvider events={events}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] font-sans">
        <RunHeader runId={seed.id} view={view} model={model} workspaceName={workspaceName} />
        <RunTimeline phases={timeline} />

        {/* Resizable multipanel workspace: chat | artifacts | focus.
            Layout persists per panel arrangement via useDefaultLayout. The
            relative wrapper hosts the overlay focus drawer on narrow viewports. */}
        <div className="relative flex min-h-0 flex-1">
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
          {focusDocked && (
            <>
              <ResizeHandle />
              <Panel
                id="focus"
                defaultSize="26%"
                minSize="280px"
                maxSize="44%"
                className="mh-panel-enter mh-elev-2 relative z-20 h-full overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-raised)]"
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

        {/* Narrow viewports: the focus panel floats over the canvas as a drawer
            so chat + artifacts keep their width instead of all three clipping. */}
        {focusOverlay && focusView !== null ? (
          <>
            <button
              type="button"
              aria-label="Cerrar foco"
              onClick={() => setFocus(null)}
              className="absolute inset-0 z-30 cursor-default bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)]"
            />
            <aside
              className="mh-panel-enter mh-elev-sheet absolute inset-y-0 right-0 z-40 w-[min(440px,92%)] overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-raised)]"
            >
              <FocusPanel view={focusView} onClose={() => setFocus(null)} onFocus={setFocus} />
            </aside>
          </>
        ) : null}
        </div>
      </div>
    </ChatRuntimeProvider>
  );
}

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
  // Single source of truth: the run badge derives from the durable run status —
  // the SAME function the sidebar uses — so header and sidebar never disagree.
  const runStatus = runUiStatus(model.run.control.status);

  return (
    <header className="mh-elev-1 flex h-14 select-none items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5">
      {/* Identity: id chip → title → ONE status pill (run status). */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="mh-mono shrink-0 rounded-[var(--r-sm)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-eyebrow text-[var(--color-text-subtle)]"
          title={`Run ${runId}`}
        >
          {runId.slice(0, 8)}
        </span>
        <h1 className="m-0 max-w-md truncate text-sm font-semibold text-[var(--color-text)]" title={view.title}>
          {view.title}
        </h1>
        <StatusPill status={runStatus} label={STATUS_META[runStatus].label} />
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
        <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
          <span className="text-[var(--color-text-subtle)]">Workspace</span>
          <strong className="max-w-[140px] truncate font-medium text-[var(--color-text)]">
            {workspaceName ?? "—"}
          </strong>
        </span>

        {/* Vitals readout: one bordered cluster, tabular numbers. */}
        <span className="mh-mono inline-flex items-center gap-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-meta tabular-nums">
          <span title="Tareas del grafo">
            <strong className="font-semibold text-[var(--color-text)]">{nodesCount}</strong>{" "}
            <span className="hidden text-[var(--color-text-subtle)] md:inline">tareas</span>
          </span>
          <span title="Conflictos detectados">
            <strong className={conflictsCount > 0 ? "font-semibold text-[var(--status-blocked-fg)]" : "font-semibold text-[var(--color-text)]"}>
              {conflictsCount}
            </strong>{" "}
            <span className="hidden text-[var(--color-text-subtle)] md:inline">conflictos</span>
          </span>
          {runningCount > 0 ? (
            <span className="flex items-center gap-1.5" title="Subagentes ejecutando ahora">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-running-fg)]" />
              <strong className="font-semibold text-[var(--status-running-fg)]">{runningCount}</strong>{" "}
              <span className="hidden text-[var(--color-text-subtle)] md:inline">activos</span>
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
            className="mh-lift flex h-9 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 text-label font-semibold text-[var(--color-accent-contrast)] transition-[background,border-color,box-shadow] duration-150 hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)]"
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
        <span className="absolute right-0 top-full mt-1 max-w-[260px] rounded-[var(--r-md)] border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-2 py-1 text-meta leading-snug text-[var(--status-failed-fg)] shadow-sm">
          {error}
        </span>
      ) : null}
    </span>
  );
}
