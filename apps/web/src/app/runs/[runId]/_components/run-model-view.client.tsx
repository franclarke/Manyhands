"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFocusView, type FocusTarget } from "@/lib/run-model/focus-view";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { selectRunCanvasProjection, type RunCanvasMode } from "@/lib/run-model/run-canvas-projection";
import { selectResultReadiness } from "@/lib/run-model/selectors";
import type { Run, RunEvent, RunModel, Node } from "@/lib/run-model/types";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { StatusPill } from "@/components/ui/status-pill";
import { MinimalRunGraphCanvas } from "@/components/run-model/minimal-run-graph";
import { RunTimeline } from "@/components/run-model/run-timeline";
import { selectRunTimeline } from "@/lib/run-model/run-phases";
import { graphEmptyStateKind } from "@/lib/run-model/run-phases";
import { useLiveRunModel } from "@/components/run-model/use-live-run-model";
import { ChatRuntimeProvider } from "@/components/chat/assistant-provider";
import { ChatThread, ChatRail } from "@/components/chat/thread";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { DeliveryPanel } from "./delivery-panel.client";
import { OperationalRecoveryCenter } from "./operational-recovery-center.client";
import { runDockMode } from "@/lib/cockpit-layout";
import { useViewportWidth } from "@/lib/use-viewport-width";
import { Bot, Download, FileDiff, FolderTree, List, Pause, Play, RotateCcw, ScrollText, ShieldCheck, Terminal } from "lucide-react";
import {
  BottomDrawer,
  RunWorkspaceDock,
  type BottomDrawerTab,
  type DockSlotState,
  type DockSurfaceId
} from "./run-workspace-surfaces.client";
import { RunCanvasToolbar, RunOutline } from "./run-cockpit-navigation.client";
import { DecisionIntervention } from "@/components/run-model/decision-intervention";
import { EvidenceMatrixPanel } from "@/components/run-model/evidence-matrix-panel";

const SSR_NOOP_STORAGE: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => null,
  setItem: () => undefined
};

export function RunModelView({
  seed,
  initialEvents,
  workspaceName,
  fixture
}: {
  seed: Run;
  initialEvents: RunEvent[];
  workspaceName?: string | undefined;
  fixture?: { model: RunModel; events: RunEvent[] } | undefined;
}): React.ReactElement {
  const live = useLiveRunModel(seed, initialEvents, { disabled: fixture !== undefined });
  const model = fixture?.model ?? live.model;
  const events = fixture?.events ?? live.events;
  const connected = fixture !== undefined ? true : live.connected;
  const connection = fixture !== undefined ? "connected" : live.connection;
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [dockSlots, setDockSlots] = useState<DockSlotState[]>([]);
  const slotSeqRef = useRef(0);
  const [expandedDockSlotId, setExpandedDockSlotId] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomDrawerTab>("activity");
  const [canvasMode, setCanvasMode] = useState<RunCanvasMode>("graph");
  const [leftSurface, setLeftSurface] = useState<"outline" | "orchestrator">("outline");
  const [commandOpen, setCommandOpen] = useState(false);

  const view = useMemo(() => selectMinimalWorkspaceView(model), [model]);
  const timeline = useMemo(() => selectRunTimeline(model, view.stage), [model, view.stage]);
  const canvasProjection = useMemo(
    () => selectRunCanvasProjection(model, view, canvasMode),
    [canvasMode, model, view]
  );
  const resultReadiness = useMemo(() => selectResultReadiness(model), [model]);
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

  const dockMode = runDockMode(useViewportWidth());
  const dockOpen = dockSlots.length > 0;
  const docked = dockOpen && dockMode === "column";
  const dockOverlay = dockOpen && dockMode === "overlay";

  // Close the overlay drawer on Escape — it has no resize handle to escape via.
  useEffect(() => {
    if (!dockOverlay) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDockSlots([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dockOverlay]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Persisted, per-arrangement panel layout (with/without the docked focus panel).
  // `storage` must be passed explicitly: the library defaults to `localStorage`,
  // which crashes during SSR (this component server-renders its first frame).
  const panelIds = docked ? ["chat", "artifacts", "dock"] : ["chat", "artifacts"];
  // The persisted layout (localStorage) differs from the SSR default, so reading
  // it on the first client render mismatches the server HTML. Gate it behind a
  // mount flag: first client render uses the noop storage (== SSR), and the
  // persisted layout applies on the post-hydration update instead.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(`mh-run-cockpit:${seed.id}:v1`);
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as {
        dockSlots?: DockSlotState[];
        bottomOpen?: boolean;
        bottomTab?: BottomDrawerTab;
      };
      if (Array.isArray(parsed.dockSlots)) setDockSlots(parsed.dockSlots.slice(0, 2));
      if (typeof parsed.bottomOpen === "boolean") setBottomOpen(parsed.bottomOpen);
      if (parsed.bottomTab === "activity" || parsed.bottomTab === "events" || parsed.bottomTab === "terminal" || parsed.bottomTab === "validation" || parsed.bottomTab === "files") {
        setBottomTab(parsed.bottomTab);
      }
    } catch {
      // Ignore stale layout payloads.
    }
  }, [hydrated, seed.id]);
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(
      `mh-run-cockpit:${seed.id}:v1`,
      JSON.stringify({ dockSlots, bottomOpen, bottomTab })
    );
  }, [bottomOpen, bottomTab, dockSlots, hydrated, seed.id]);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "mh-run-workspace",
    panelIds,
    storage: hydrated && typeof window !== "undefined" ? window.localStorage : SSR_NOOP_STORAGE
  });

  function openSurface(surface: DockSurfaceId, target: FocusTarget | null = focus): void {
    if (target !== null) setFocus(target);
    // Monotonic id: two surfaces opened in the same millisecond collided under
    // `Date.now()` (duplicate React keys crashed the dock panel group).
    const nextId = `slot-${++slotSeqRef.current}-${surface}`;
    setDockSlots((current) => {
      // A surface lives in at most one slot: re-opening it retargets that slot
      // instead of stacking a duplicate view of the same thing.
      const existing = current.find((slot) => slot.surface === surface);
      if (existing !== undefined) {
        return current.map((slot) => (slot.id === existing.id ? { ...slot, focus: target } : slot));
      }
      const nextSlot: DockSlotState = {
        id: nextId,
        surface,
        focus: target
      };
      if (current.length < 2) return [...current, nextSlot];
      return [current[0]!, { ...current[1]!, surface, focus: target }];
    });
    setExpandedDockSlotId(null);
  }

  /** Toolbar behavior: open when absent, close when already open (toggle). */
  function toggleSurface(surface: DockSurfaceId): void {
    const existing = dockSlots.find((slot) => slot.surface === surface);
    if (existing !== undefined) {
      setDockSlots((current) => current.filter((slot) => slot.id !== existing.id));
      setExpandedDockSlotId(null);
      return;
    }
    openSurface(surface);
  }

  function handleLegacyTab(tab: "dag" | "plan" | "conflicts" | "execution" | "files" | "evaluation"): void {
    if (tab === "conflicts") openSurface("risks", focus);
    else if (tab === "files") openSurface("diff", focus);
    else if (tab === "evaluation") openSurface("evidence", { kind: "evidence", id: "final" });
    else if (tab === "execution") {
      setBottomTab("events");
      setBottomOpen(true);
    } else if (tab === "plan") openSurface("plan", focus);
  }

  return (
    <ChatRuntimeProvider events={events}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] font-sans">
        <RunHeader
          runId={seed.id}
          view={view}
          model={model}
          events={events}
          workspaceName={workspaceName}
          connection={connection}
          onOpenDecision={() => {
            setLeftSurface("orchestrator");
            chatPanelRef.current?.expand();
          }}
        />
        <RunCommandPalette
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
          actions={[
            {
              label: "Revisar decisiones",
              detail: "Abre el canal resolutivo del orquestador",
              onSelect: () => {
                setLeftSurface("orchestrator");
                chatPanelRef.current?.expand();
              }
            },
            {
              label: "Abrir eventos",
              detail: "Muestra el historial durable del run",
              onSelect: () => {
                setBottomTab("events");
                setBottomOpen(true);
              }
            },
            { label: "Abrir plan", detail: "Inspecciona o corrige el plan", onSelect: () => openSurface("plan") },
            { label: "Abrir diff agregado", detail: "Inspecciona los cambios integrados", onSelect: () => openSurface("diff", { kind: "evidence", id: "final" }) },
            { label: "Abrir evidencia", detail: "Tests, trazabilidad y resultado", onSelect: () => openSurface("evidence", { kind: "evidence", id: "final" }) },
            ...(model.run.control.status === "generating" || model.run.control.status === "running"
              ? [{
                  label: "Pausar run",
                  detail: "Detiene el avance de forma reversible",
                  onSelect: async () => {
                    await fetch(`/api/runs/${encodeURIComponent(seed.id)}/pause`, { method: "POST" });
                  }
                }]
              : [])
          ]}
        />
        <OperationalRecoveryCenter
          runId={seed.id}
          model={model}
          events={events}
          onOpenFailure={(nodeId) => {
            setBottomTab("events");
            setBottomOpen(true);
            if (nodeId !== undefined) openSurface("node", { kind: "node", id: nodeId });
          }}
          onOpenDelivery={() => document.getElementById("delivery-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
        />
        <RunTimeline
          phases={timeline}
          trailing={
            <>
              <DockToggle label="Agentes" active={dockSlots.some((s) => s.surface === "agents")} onClick={() => toggleSurface("agents")}>
                <Bot aria-hidden className="h-4 w-4" />
              </DockToggle>
              <DockToggle label="Plan" active={dockSlots.some((s) => s.surface === "plan")} onClick={() => toggleSurface("plan")}>
                <ShieldCheck aria-hidden className="h-4 w-4" />
              </DockToggle>
              <DockToggle label="Archivos" active={dockSlots.some((s) => s.surface === "files")} onClick={() => toggleSurface("files")}>
                <FolderTree aria-hidden className="h-4 w-4" />
              </DockToggle>
              <DockToggle label="Diff" active={dockSlots.some((s) => s.surface === "diff")} onClick={() => toggleSurface("diff")}>
                <FileDiff aria-hidden className="h-4 w-4" />
              </DockToggle>
            </>
          }
        />

        {/* Resizable cockpit: chat | graph workspace | free dock.
            Layout persists per panel arrangement via useDefaultLayout. The
            relative wrapper hosts the overlay dock on narrow viewports. */}
        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel id="workspace-main" minSize="320px" className="min-h-0">
        <div className="relative flex h-full min-h-0">
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="flex-1 overflow-hidden"
        >
          <Panel
            id="chat"
            defaultSize="24%"
            minSize="300px"
            maxSize="36%"
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
            ) : leftSurface === "outline" ? (
              <RunOutline
                view={view}
                selectedTarget={focus}
                projection={canvasProjection}
                onFocus={(target) => openSurface("node", target)}
                onOpenDecision={() => setLeftSurface("orchestrator")}
              />
            ) : (
              <div className="relative h-full min-h-0">
                <button
                  type="button"
                  onClick={() => setLeftSurface("outline")}
                  className="absolute right-10 top-2 z-20 h-7 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 text-meta font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  Ver outline
                </button>
              <ChatThread
                runId={seed.id}
                model={model}
                connected={connected}
                setActiveTab={handleLegacyTab}
                onCollapse={toggleChat}
              />
              </div>
            )}
          </Panel>
          <ResizeHandle />
          <Panel id="artifacts" minSize="30%" className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
            {fixture === undefined && (view.stage === "review" || model.run.control.status === "failed_delivery") ? (
              <div id="delivery-panel"><DeliveryPanel runId={seed.id} /></div>
            ) : null}
            {view.stage === "review" && view.reviewEvidence !== null ? (
              <ReviewEvidencePanel
                evidence={view.reviewEvidence}
                onOpenDiff={() => openSurface("diff", { kind: "evidence", id: "final" })}
                onOpenEvidence={() => openSurface("evidence", { kind: "evidence", id: "final" })}
              />
            ) : null}
            {view.stage === "review" ? <EvidenceMatrixPanel result={resultReadiness} /> : null}
            <RunCanvasToolbar mode={canvasMode} projection={canvasProjection} onModeChange={setCanvasMode} />
            <div className="relative min-h-0 flex-1 bg-[var(--color-bg)]">
              {fixture === undefined && view.primaryAttention !== null ? <DecisionIntervention runId={seed.id} item={view.primaryAttention} /> : null}
              <MinimalRunGraphCanvas
                graph={canvasProjection.graph}
                stage={view.stage}
                selectedTarget={focus}
                onFocus={(target) => (target === null ? setFocus(null) : openSurface("node", target))}
                fill
                emptyKind={graphEmptyStateKind(model.run.control.status)}
                mode={canvasMode}
                overlayNodeIds={canvasProjection.overlayNodeIds}
                dimOutsideOverlay={canvasProjection.dimOutsideOverlay}
                waveLabel={canvasProjection.wave?.label}
                showHierarchyEdges={canvasProjection.showHierarchyEdges}
                showDependencyEdges={canvasProjection.showDependencyEdges}
                showSeamEdges={canvasProjection.showSeamEdges}
                showConflictEdges={canvasProjection.showConflictEdges}
              />
            </div>
          </Panel>
          {docked && (
            <>
              <ResizeHandle />
              <Panel
                id="dock"
                defaultSize="26%"
                minSize="280px"
                maxSize="44%"
                className="relative z-20 h-full min-w-0"
              >
                <RunWorkspaceDock
                  runId={seed.id}
                  model={model}
                  events={events}
                  focus={focus}
                  focusView={focusView}
                  slots={dockSlots}
                  expandedSlotId={expandedDockSlotId}
                  onFocus={setFocus}
                  onOpenSurface={openSurface}
                  onChangeSlotSurface={(slotId, surface) =>
                    setDockSlots((current) => current.map((slot) => slot.id === slotId ? { ...slot, surface } : slot))
                  }
                  onCloseSlot={(slotId) => setDockSlots((current) => current.filter((slot) => slot.id !== slotId))}
                  onToggleExpand={(slotId) => setExpandedDockSlotId((current) => current === slotId ? null : slotId)}
                />
              </Panel>
            </>
          )}
        </Group>

        {/* Narrow viewports: the dock floats over the canvas as a drawer
            so chat + artifacts keep their width instead of all three clipping. */}
        {dockOverlay ? (
          <>
            <button
              type="button"
              aria-label="Cerrar dock"
              onClick={() => setDockSlots([])}
              className="absolute inset-0 z-30 cursor-default bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)]"
            />
            <aside
              className="mh-panel-enter mh-elev-sheet absolute inset-y-0 right-0 z-40 w-[min(520px,92%)] border-l border-[var(--color-border)] bg-[var(--color-surface-raised)]"
            >
              <RunWorkspaceDock
                runId={seed.id}
                model={model}
                events={events}
                focus={focus}
                focusView={focusView}
                slots={dockSlots}
                expandedSlotId={expandedDockSlotId}
                onFocus={setFocus}
                onOpenSurface={openSurface}
                onChangeSlotSurface={(slotId, surface) =>
                  setDockSlots((current) => current.map((slot) => slot.id === slotId ? { ...slot, surface } : slot))
                }
                onCloseSlot={(slotId) => setDockSlots((current) => current.filter((slot) => slot.id !== slotId))}
                onToggleExpand={(slotId) => setExpandedDockSlotId((current) => current === slotId ? null : slotId)}
              />
            </aside>
          </>
        ) : null}
        </div>
          </Panel>
        {bottomOpen ? (
          <>
          <ResizeHandle direction="horizontal" />
          <Panel id="workspace-bottom" defaultSize="30%" minSize="180px" maxSize="48%" className="min-h-0">
            <BottomDrawer
              runId={seed.id}
              model={model}
              events={events}
              open={bottomOpen}
              activeTab={bottomTab}
              onOpenChange={setBottomOpen}
              onTabChange={setBottomTab}
            />
          </Panel>
          </>
        ) : null}
        </Group>
        {!bottomOpen ? (
          <BottomBar onOpen={(tab) => { setBottomTab(tab); setBottomOpen(true); }} />
        ) : null}
      </div>
    </ChatRuntimeProvider>
  );
}

interface RunCommand {
  label: string;
  detail: string;
  onSelect: () => void | Promise<void>;
}

function RunCommandPalette({
  open,
  onClose,
  actions
}: {
  open: boolean;
  onClose: () => void;
  actions: readonly RunCommand[];
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_srgb,var(--color-bg)_68%,transparent)] px-4 pt-[12vh]" role="presentation" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Comandos del run" className="w-full max-w-xl overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <strong className="text-label text-[var(--color-text)]">Comandos del run</strong>
          <button type="button" onClick={onClose} className="mh-mono rounded-[var(--r-sm)] border border-[var(--color-border)] px-2 py-1 text-eyebrow text-[var(--color-text-muted)]">Esc</button>
        </div>
        <div className="p-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                onClose();
                void action.onSelect();
              }}
              className="flex w-full flex-col rounded-[var(--r-md)] px-3 py-2.5 text-left hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              <span className="text-label font-medium text-[var(--color-text)]">{action.label}</span>
              <span className="mt-0.5 text-meta text-[var(--color-text-muted)]">{action.detail}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewEvidencePanel({
  evidence,
  onOpenDiff,
  onOpenEvidence
}: {
  evidence: NonNullable<ReturnType<typeof selectMinimalWorkspaceView>["reviewEvidence"]>;
  onOpenDiff: () => void;
  onOpenEvidence: () => void;
}): React.ReactElement {
  return (
    <section aria-label="Evidencia final del run" className="border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-eyebrow font-semibold uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Revisión final</p>
          <h2 className="m-0 mt-1 font-[family:var(--font-display)] text-xl leading-tight text-[var(--color-text)]">Resultado integrado</h2>
        </div>
        <span className="mh-mono rounded-[var(--r-sm)] bg-[var(--status-completed-bg)] px-2 py-1 text-meta font-semibold text-[var(--status-completed-fg)]">
          Tests {evidence.tests.pass}/{evidence.tests.total}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <p className="m-0 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-meta text-[var(--color-text-muted)]">
          Commit <span className="mh-mono text-[var(--color-text)]">{evidence.integrationCommit}</span>
        </p>
        <p className="m-0 truncate rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-meta text-[var(--color-text-muted)]" title={evidence.narrativeRef}>
          Narrativa disponible para inspección
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onOpenDiff}><FileDiff aria-hidden className="h-3.5 w-3.5" />Ver diff agregado</Button>
        <Button size="sm" variant="ghost" onClick={onOpenEvidence}>Ver evidencia y trazabilidad</Button>
      </div>
    </section>
  );
}

function DockToggle({ label, active, onClick, children }: {
  label: string; active: boolean; onClick: () => void; children: React.ReactNode;
}): React.ReactElement {
  return <IconButton label={label} aria-pressed={active} onClick={onClick} className={active ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}>{children}</IconButton>;
}

function BottomBar({ onOpen }: { onOpen: (tab: BottomDrawerTab) => void }): React.ReactElement {
  const tabs = [
    ["activity", "Actividad", <ScrollText key="a" aria-hidden className="h-3.5 w-3.5" />],
    ["events", "Eventos", <List key="e" aria-hidden className="h-3.5 w-3.5" />],
    ["terminal", "Terminal", <Terminal key="t" aria-hidden className="h-3.5 w-3.5" />],
    ["validation", "Validación", <ShieldCheck key="v" aria-hidden className="h-3.5 w-3.5" />],
    ["files", "Archivos", <FolderTree key="f" aria-hidden className="h-3.5 w-3.5" />]
  ] as const;
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3">
      {tabs.map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] px-2 text-meta font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

function RunHeader({
  runId,
  view,
  model,
  events,
  workspaceName,
  connection,
  onOpenDecision
}: {
  runId: string;
  view: ReturnType<typeof selectMinimalWorkspaceView>;
  model: RunModel;
  events: RunEvent[];
  workspaceName?: string | undefined;
  connection: "connecting" | "connected" | "reconnecting" | "degraded" | "disconnected";
  onOpenDecision: () => void;
}): React.ReactElement {
  const nodesCount = model.nodes.size;
  const conflictsCount = Array.from(model.conflicts.values()).filter((conflict) => conflict.status !== "resolved").length;
  const runningCount = Array.from(model.nodes.values()).filter((n: Node) => n.execution.kind === "running").length;
  // Single source of truth: the run badge derives from the durable run status —
  // the SAME function the sidebar uses — so header and sidebar never disagree.
  const runStatus = runUiStatus(model.run.control.status);
  const elapsed = formatRunElapsed(events);

  return (
    <header className="mh-elev-1 flex h-14 select-none items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5">
      {/* Identity: id chip → title → ONE status pill (run status). */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="mh-mono shrink-0 rounded-[var(--r-sm)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-eyebrow text-[var(--color-text-subtle)]"
          title={`Run ${runId}`}
        >
          {runId.slice(0, 8)}
        </span>
        <h1 className="m-0 min-w-0 max-w-md truncate text-sm font-semibold text-[var(--color-text)]" title={view.title}>
          {view.title}
        </h1>
        <StatusPill status={runStatus} label={STATUS_META[runStatus].label} />
        <ConnectionIndicator connection={connection} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-[var(--color-text-muted)]">
        {elapsed !== null ? <span className="mh-mono hidden text-meta tabular-nums text-[var(--color-text-subtle)] xl:inline" title="Tiempo observado en el event log">{elapsed}</span> : null}
        <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
          <span className="text-[var(--color-text-subtle)]">Workspace</span>
          <strong className="max-w-[140px] truncate font-medium text-[var(--color-text)]">
            {workspaceName ?? "—"}
          </strong>
        </span>

        {/* Vitals readout: one bordered cluster, tabular numbers. */}
        <span className="mh-mono hidden items-center gap-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-meta tabular-nums sm:inline-flex">
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
          <button type="button" onClick={onOpenDecision} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" aria-label="Revisar y decidir la acción pendiente">
            <StatusPill status="needs_review" label="Revisar y decidir" pulse />
          </button>
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

function formatRunElapsed(events: readonly RunEvent[]): string | null {
  if (events.length === 0) return null;
  const first = new Date(events[0]!.at).getTime();
  const last = new Date(events[events.length - 1]!.at).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  const seconds = Math.round((last - first) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ConnectionIndicator({ connection }: { connection: "connecting" | "connected" | "reconnecting" | "degraded" | "disconnected" }): React.ReactElement {
  const label = connection === "connected"
    ? "Conectado al event log"
    : connection === "connecting"
      ? "Conectando al event log"
      : connection === "reconnecting"
        ? "Reconectando al event log"
        : connection === "degraded"
          ? "Conexión degradada; el historial puede estar desactualizado"
          : "Sin conexión al event log";
  const tone = connection === "connected" ? "bg-[var(--status-running-fg)]" : "bg-[var(--status-blocked-fg)]";
  return (
    <span className="flex items-center gap-1.5 text-eyebrow text-[var(--color-text-subtle)]" title={label}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      {connection === "connected" ? null : label.replace(" al event log", "")}
    </span>
  );
}

function RunControlButton({ runId, model }: { runId: string; model: RunModel }): React.ReactElement | null {
  const control = model.run.control;
  const [busy, setBusy] = useState<"pause" | "resume" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPause = control.status === "generating" || control.status === "running";
  const canResume = control.status === "paused" && control.pendingHumanAction === "none";
  const canRestart = control.status === "interrupted" || control.status === "failed" || control.status === "failed_artifact";
  if (!canPause && !canResume && !canRestart) return null;

  const action = canPause ? "pause" : canResume ? "resume" : "restart";
  const label = action === "pause" ? "Pausar" : action === "resume" ? "Reanudar" : "Reintentar";

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
        busyLabel={action === "pause" ? "Pausando" : action === "resume" ? "Reanudando" : "Reintentando"}
        onClick={() => void submit()}
        title={error ?? label}
        aria-label={label}
      >
        {action === "pause" ? (
          <Pause aria-hidden className="h-3.5 w-3.5" />
        ) : action === "resume" ? (
          <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
        ) : (
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
        )}
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
