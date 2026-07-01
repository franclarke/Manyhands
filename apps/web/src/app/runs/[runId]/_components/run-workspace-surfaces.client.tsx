"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFocusView, type FocusTarget, type FocusView } from "@/lib/run-model/focus-view";
import type { Node, RunEvent, RunModel } from "@/lib/run-model/types";
import { FocusPanel } from "@/components/run-model/focus-panel";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Button } from "@/components/ui/button";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Activity,
  AlertTriangle,
  Braces,
  ChevronDown,
  FileCode2,
  FileDiff,
  FolderTree,
  Maximize2,
  Minimize2,
  Network,
  Play,
  X
} from "lucide-react";

export type DockSurfaceId = "agents" | "node" | "files" | "diff" | "contract" | "risks" | "evidence" | "worktree";

export interface DockSlotState {
  id: string;
  surface: DockSurfaceId;
  focus: FocusTarget | null;
}

const SURFACE_LABEL: Record<DockSurfaceId, string> = {
  agents: "Agentes",
  node: "Nodo",
  files: "Archivos",
  diff: "Diff",
  contract: "Contrato",
  risks: "Riesgos",
  evidence: "Evidencia",
  worktree: "Worktree"
};

const SURFACE_OPTIONS: DockSurfaceId[] = ["agents", "node", "files", "diff", "contract", "risks", "evidence", "worktree"];

export function RunWorkspaceDock({
  runId,
  model,
  events,
  focus,
  focusView,
  slots,
  expandedSlotId,
  onFocus,
  onOpenSurface,
  onChangeSlotSurface,
  onCloseSlot,
  onToggleExpand
}: {
  runId: string;
  model: RunModel;
  events: RunEvent[];
  focus: FocusTarget | null;
  focusView: FocusView | null;
  slots: DockSlotState[];
  expandedSlotId: string | null;
  onFocus: (target: FocusTarget | null) => void;
  onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void;
  onChangeSlotSurface: (slotId: string, surface: DockSurfaceId) => void;
  onCloseSlot: (slotId: string) => void;
  onToggleExpand: (slotId: string) => void;
}): React.ReactElement {
  const visibleSlots = expandedSlotId === null ? slots : slots.filter((slot) => slot.id === expandedSlotId);
  return (
    <aside className="mh-panel-enter flex h-full min-w-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface-raised)]">
      {slots.length === 0 ? (
        <EmptyDock onOpenSurface={onOpenSurface} />
      ) : (
        <Group orientation="vertical" className="min-h-0 flex-1">
          {visibleSlots.map((slot, index) => (
            <Panel key={slot.id} id={slot.id} minSize="160px" className="min-h-0">
              <DockSlot
                runId={runId}
                model={model}
                events={events}
                focus={slot.focus ?? focus}
                focusView={slot.focus === null ? focusView : null}
                slot={slot}
                expanded={expandedSlotId === slot.id}
                onFocus={onFocus}
                onOpenSurface={onOpenSurface}
                onChangeSurface={(surface) => onChangeSlotSurface(slot.id, surface)}
                onClose={() => onCloseSlot(slot.id)}
                onToggleExpand={() => onToggleExpand(slot.id)}
              />
              {index < visibleSlots.length - 1 ? <HorizontalResizeHandle /> : null}
            </Panel>
          ))}
        </Group>
      )}
    </aside>
  );
}

function DockSlot({
  runId,
  model,
  events,
  focus,
  focusView,
  slot,
  expanded,
  onFocus,
  onOpenSurface,
  onChangeSurface,
  onClose,
  onToggleExpand
}: {
  runId: string;
  model: RunModel;
  events: RunEvent[];
  focus: FocusTarget | null;
  focusView: FocusView | null;
  slot: DockSlotState;
  expanded: boolean;
  onFocus: (target: FocusTarget | null) => void;
  onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void;
  onChangeSurface: (surface: DockSurfaceId) => void;
  onClose: () => void;
  onToggleExpand: () => void;
}): React.ReactElement {
  const resolvedFocusView = useMemo(
    () => (focus !== null ? buildFocusView(model, focus, { events }) : focusView),
    [events, focus, focusView, model]
  );
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <label className="relative flex min-w-0 flex-1 items-center">
          <select
            aria-label="Superficie del dock"
            value={slot.surface}
            onChange={(event) => onChangeSurface(event.target.value as DockSurfaceId)}
            className="mh-select h-7 w-full truncate pr-7 text-meta font-semibold"
          >
            {SURFACE_OPTIONS.map((surface) => (
              <option key={surface} value={surface}>
                {SURFACE_LABEL[surface]}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-[var(--color-text-subtle)]" />
        </label>
        <IconButton label={expanded ? "Restaurar vista" : "Expandir vista"} onClick={onToggleExpand}>
          {expanded ? <Minimize2 aria-hidden className="h-3.5 w-3.5" /> : <Maximize2 aria-hidden className="h-3.5 w-3.5" />}
        </IconButton>
        <IconButton label="Cerrar vista" onClick={onClose}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SurfaceBody
          runId={runId}
          model={model}
          focus={focus}
          focusView={resolvedFocusView}
          surface={slot.surface}
          onFocus={onFocus}
          onOpenSurface={onOpenSurface}
        />
      </div>
    </section>
  );
}

function SurfaceBody({
  runId,
  model,
  focus,
  focusView,
  surface,
  onFocus,
  onOpenSurface
}: {
  runId: string;
  model: RunModel;
  focus: FocusTarget | null;
  focusView: FocusView | null;
  surface: DockSurfaceId;
  onFocus: (target: FocusTarget | null) => void;
  onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void;
}): React.ReactElement {
  if (surface === "agents") return <AgentsSurface model={model} onFocus={onFocus} onOpenSurface={onOpenSurface} />;
  if (surface === "files" || surface === "worktree") return <FilesSurface runId={runId} model={model} initialNodeId={focus?.kind === "node" ? focus.id : undefined} />;
  if (surface === "diff") return <DiffSurface runId={runId} model={model} focus={focus} />;
  if (surface === "risks") return <RisksSurface model={model} onFocus={onFocus} />;
  if (surface === "evidence") return <EvidenceSurface runId={runId} model={model} onOpenSurface={onOpenSurface} />;
  if ((surface === "node" || surface === "contract") && focusView !== null) {
    return <FocusPanel view={focusView} onClose={() => onFocus(null)} onFocus={onFocus} />;
  }
  if (surface === "contract") return <ContractList model={model} onFocus={onFocus} />;
  return <EmptySurface title={SURFACE_LABEL[surface]} detail="Seleccioná un nodo, costura o evidencia para poblar esta vista." />;
}

function AgentsSurface({
  model,
  onFocus,
  onOpenSurface
}: {
  model: RunModel;
  onFocus: (target: FocusTarget | null) => void;
  onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void;
}): React.ReactElement {
  const nodes = Array.from(model.nodes.values());
  const groups = [
    { label: "Ejecutando", nodes: nodes.filter((node) => node.execution.kind === "running") },
    { label: "Verificando", nodes: nodes.filter((node) => node.execution.kind === "verifying") },
    { label: "Esperando", nodes: nodes.filter((node) => node.execution.kind === "blocked" || node.execution.kind === "idle") },
    { label: "Fallidos", nodes: nodes.filter((node) => node.execution.kind === "failed") },
    { label: "Finalizados", nodes: nodes.filter((node) => node.execution.kind === "integrated") }
  ];
  return (
    <Stack>
      <SurfaceHeader icon={<Activity aria-hidden className="h-4 w-4" />} title="Agentes" detail={`${nodes.length} tareas del run`} />
      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h3 className="m-0 text-meta font-semibold uppercase tracking-normal text-[var(--color-text-subtle)]">{group.label}</h3>
          {group.nodes.length === 0 ? <p className="m-0 text-xs text-[var(--color-text-faint)]">Sin agentes en este estado.</p> : null}
          {group.nodes.map((node) => (
            <AgentRow
              key={node.id}
              node={node}
              onFocus={() => onFocus({ kind: "node", id: node.id })}
              onDiff={() => onOpenSurface("diff", { kind: "node", id: node.id })}
              onFiles={() => onOpenSurface("files", { kind: "node", id: node.id })}
            />
          ))}
        </section>
      ))}
    </Stack>
  );
}

function AgentRow({ node, onFocus, onDiff, onFiles }: { node: Node; onFocus: () => void; onDiff: () => void; onFiles: () => void }): React.ReactElement {
  return (
    <div className="rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <button type="button" onClick={onFocus} className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-[var(--color-text)]">{node.title}</span>
          <span className="mh-mono shrink-0 text-eyebrow text-[var(--color-text-subtle)]">{node.execution.kind}</span>
        </div>
        <p className="m-0 mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{node.goal}</p>
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <MiniAction onClick={onFocus}>Nodo</MiniAction>
        <MiniAction onClick={onDiff}>Diff</MiniAction>
        <MiniAction onClick={onFiles}>Worktree</MiniAction>
      </div>
    </div>
  );
}

function FilesSurface({ runId, model, initialNodeId }: { runId: string; model: RunModel; initialNodeId?: string | undefined }): React.ReactElement {
  const nodes = Array.from(model.nodes.values());
  const [contextKind, setContextKind] = useState<"base" | "node" | "final">(initialNodeId !== undefined ? "node" : "base");
  const [nodeId, setNodeId] = useState(initialNodeId ?? nodes[0]?.id ?? "");
  const [path, setPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [tree, setTree] = useState<{ entries: Array<{ name: string; path: string; kind: "file" | "directory"; size?: number }>; workspace?: { label: string; rootPath: string; exists: boolean } } | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ context: contextKind, path });
    if (contextKind === "node" && nodeId.length > 0) params.set("nodeId", nodeId);
    setError(null);
    fetch(`/api/runs/${encodeURIComponent(runId)}/workspace-tree?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Workspace tree failed");
        setTree(payload);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [contextKind, nodeId, path, runId]);

  useEffect(() => {
    if (selectedFile === null) {
      setFile(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ context: contextKind, path: selectedFile });
    if (contextKind === "node" && nodeId.length > 0) params.set("nodeId", nodeId);
    fetch(`/api/runs/${encodeURIComponent(runId)}/workspace-file?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Workspace file failed");
        setFile(payload);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [contextKind, nodeId, runId, selectedFile]);

  return (
    <Stack>
      <SurfaceHeader icon={<FolderTree aria-hidden className="h-4 w-4" />} title="Archivos" detail={tree?.workspace?.label ?? "Contexto del workspace"} />
      <div className="grid gap-2">
        <select className="mh-select h-8 text-meta" value={contextKind} onChange={(event) => { setContextKind(event.target.value as "base" | "node" | "final"); setPath(""); setSelectedFile(null); }}>
          <option value="base">Repo base</option>
          <option value="node">Worktree de nodo</option>
          <option value="final">Resultado integrado</option>
        </select>
        {contextKind === "node" ? (
          <select className="mh-select h-8 text-meta" value={nodeId} onChange={(event) => { setNodeId(event.target.value); setPath(""); setSelectedFile(null); }}>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.title}</option>
            ))}
          </select>
        ) : null}
      </div>
      {error !== null ? <p className="m-0 text-xs text-[var(--status-failed-fg)]">{error}</p> : null}
      {tree?.workspace?.exists === false ? <EmptySurface title="Worktree no disponible" detail="Este contexto todavía no existe en disco o ya fue limpiado." /> : null}
      <div className="rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {path.length > 0 ? (
          <button type="button" onClick={() => { setPath(parentPath(path)); setSelectedFile(null); }} className="w-full cursor-pointer border-0 border-b border-[var(--color-border)] bg-transparent px-3 py-2 text-left text-xs text-[var(--color-text-muted)]">
            ../
          </button>
        ) : null}
        {(tree?.entries ?? []).map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => entry.kind === "directory" ? (setPath(entry.path), setSelectedFile(null)) : setSelectedFile(entry.path)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 border-b border-[var(--color-border-soft)] bg-transparent px-3 py-2 text-left text-xs last:border-b-0 hover:bg-[var(--color-bg-subtle)]"
          >
            <span className="truncate text-[var(--color-text)]">{entry.kind === "directory" ? "▸ " : ""}{entry.name}</span>
            {entry.size !== undefined ? <span className="mh-mono shrink-0 text-eyebrow text-[var(--color-text-subtle)]">{entry.size}b</span> : null}
          </button>
        ))}
      </div>
      {file !== null ? (
        <pre className="mh-mono max-h-80 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {file.content}
        </pre>
      ) : null}
    </Stack>
  );
}

function DiffSurface({ runId, model, focus }: { runId: string; model: RunModel; focus: FocusTarget | null }): React.ReactElement {
  const ref = focus?.kind === "node"
    ? `diff://runs/${runId}/node/${focus.id}`
    : model.evidence?.aggregateDiffRef ?? `diff://runs/${runId}/final`;
  return <ArtifactSurface title="Diff" icon={<FileDiff aria-hidden className="h-4 w-4" />} runId={runId} refId={ref} />;
}

function ArtifactSurface({ title, icon, runId, refId }: { title: string; icon: React.ReactNode; runId: string; refId: string }): React.ReactElement {
  const [content, setContent] = useState<string>("Cargando...");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts?ref=${encodeURIComponent(refId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Artifact failed");
        setContent(payload.content ?? "");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setContent(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [refId, runId]);
  return (
    <Stack>
      <SurfaceHeader icon={icon} title={title} detail={refId} />
      <pre className="mh-mono min-h-0 overflow-auto whitespace-pre-wrap rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
        {content}
      </pre>
    </Stack>
  );
}

function RisksSurface({ model, onFocus }: { model: RunModel; onFocus: (target: FocusTarget | null) => void }): React.ReactElement {
  const conflicts = Array.from(model.conflicts.values());
  return (
    <Stack>
      <SurfaceHeader icon={<AlertTriangle aria-hidden className="h-4 w-4" />} title="Riesgos" detail={`${conflicts.length} conflictos`} />
      {conflicts.length === 0 ? <EmptySurface title="Sin riesgos activos" detail="No hay conflictos detectados en el run actual." /> : null}
      {conflicts.map((conflict) => (
        <button key={conflict.id} type="button" onClick={() => onFocus({ kind: "conflict", id: conflict.id })} className="cursor-pointer rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs">
          <strong className="text-[var(--color-text)]">{conflict.dimension}</strong>
          <p className="m-0 mt-1 text-[var(--color-text-muted)]">{conflict.files.join(", ")}</p>
        </button>
      ))}
    </Stack>
  );
}

function EvidenceSurface({ runId, model, onOpenSurface }: { runId: string; model: RunModel; onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void }): React.ReactElement {
  return (
    <Stack>
      <SurfaceHeader icon={<Network aria-hidden className="h-4 w-4" />} title="Evidencia" detail={model.evidence ? "Lista" : "Pendiente"} />
      <div className="rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
        <p className="m-0 text-[var(--color-text-muted)]">Tests: {model.evidence ? `${model.evidence.tests.pass}/${model.evidence.tests.total}` : "—"}</p>
        <p className="m-0 mt-1 text-[var(--color-text-muted)]">Commit: {model.evidence?.integrationCommit ?? "—"}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => onOpenSurface("diff", { kind: "evidence", id: "final" })}>
        <FileDiff aria-hidden className="h-4 w-4" />
        Ver diff final
      </Button>
      <a className="text-xs text-[var(--color-accent)]" href={`/api/runs/${runId}/export?format=patch`}>Descargar patch</a>
    </Stack>
  );
}

function ContractList({ model, onFocus }: { model: RunModel; onFocus: (target: FocusTarget | null) => void }): React.ReactElement {
  const seams = Array.from(model.seams.values());
  return (
    <Stack>
      <SurfaceHeader icon={<Braces aria-hidden className="h-4 w-4" />} title="Contratos" detail={`${seams.length} costuras`} />
      {seams.map((seam) => (
        <button key={seam.id} type="button" onClick={() => onFocus({ kind: "seam", id: seam.id })} className="cursor-pointer rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs">
          <strong className="text-[var(--color-text)]">{seam.name}</strong>
          <p className="m-0 mt-1 text-[var(--color-text-muted)]">{seam.state} · r{seam.revision}</p>
        </button>
      ))}
    </Stack>
  );
}

export function BottomDrawer({
  runId,
  model,
  events,
  open,
  activeTab,
  onOpenChange,
  onTabChange
}: {
  runId: string;
  model: RunModel;
  events: RunEvent[];
  open: boolean;
  activeTab: "terminal" | "logs" | "events" | "validation";
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: "terminal" | "logs" | "events" | "validation") => void;
}): React.ReactElement | null {
  if (!open) return null;
  const tabs = [
    ["terminal", "Terminal"],
    ["logs", "Logs"],
    ["events", "Eventos"],
    ["validation", "Validación"]
  ] as const;
  return (
    <div className="mh-elev-sheet flex h-full min-h-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-surface-raised)]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-3">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onTabChange(id)} className={["h-7 rounded-[var(--r-md)] px-3 text-meta", activeTab === id ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]"].join(" ")}>
            {label}
          </button>
        ))}
        <IconButton label="Cerrar panel inferior" onClick={() => onOpenChange(false)}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeTab === "terminal" ? <TerminalSurface runId={runId} model={model} /> : null}
        {activeTab === "logs" ? <EventLogSurface events={events.filter((event) => event.type.includes("output") || event.type.includes("status"))} /> : null}
        {activeTab === "events" ? <EventLogSurface events={events} /> : null}
        {activeTab === "validation" ? <ValidationSurface model={model} /> : null}
      </div>
    </div>
  );
}

function TerminalSurface({ runId, model }: { runId: string; model: RunModel }): React.ReactElement {
  const nodes = Array.from(model.nodes.values());
  const [contextKind, setContextKind] = useState<"base" | "node" | "final">("base");
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [session, setSession] = useState<{ id: string; cwd: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<{ write(data: string): void; onData(cb: (data: string) => void): { dispose(): void }; dispose(): void; open(el: HTMLElement): void; focus(): void } | null>(null);

  useEffect(() => {
    if (session === null || terminalRef.current === null) return;
    let disposed = false;
    let eventSource: EventSource | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(([xterm, fit]) => {
      if (disposed || terminalRef.current === null) return;
      const term = new xterm.Terminal({ convertEol: true, cursorBlink: true, fontFamily: "JetBrains Mono, monospace", fontSize: 12 });
      const fitAddon = new fit.FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      term.focus();
      inputDisposable = term.onData((data) => {
        void fetch(`/api/runs/${encodeURIComponent(runId)}/terminals/${encodeURIComponent(session.id)}/input`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data })
        });
      });
      xtermRef.current = term;
      eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/terminals/${encodeURIComponent(session.id)}/stream`);
      eventSource.addEventListener("output", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { chunk: string };
        term.write(payload.chunk);
      });
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      disposed = true;
      eventSource?.close();
      inputDisposable?.dispose();
      xtermRef.current?.dispose();
      xtermRef.current = null;
    };
  }, [runId, session]);

  async function start(): Promise<void> {
    setError(null);
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/terminals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: contextKind, nodeId: contextKind === "node" ? nodeId : undefined })
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "No se pudo abrir terminal.");
      return;
    }
    setSession(payload.session);
  }

  async function close(): Promise<void> {
    if (session !== null) {
      await fetch(`/api/runs/${encodeURIComponent(runId)}/terminals/${encodeURIComponent(session.id)}`, { method: "DELETE" }).catch(() => undefined);
    }
    setSession(null);
  }

  return (
    <div className="flex h-full min-h-[220px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="mh-select h-8 text-meta" value={contextKind} onChange={(event) => setContextKind(event.target.value as "base" | "node" | "final")} disabled={session !== null}>
          <option value="base">Repo base</option>
          <option value="node">Worktree de nodo</option>
          <option value="final">Resultado integrado</option>
        </select>
        {contextKind === "node" ? (
          <select className="mh-select h-8 text-meta" value={nodeId} onChange={(event) => setNodeId(event.target.value)} disabled={session !== null}>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
          </select>
        ) : null}
        {session === null ? (
          <Button variant="primary" size="sm" onClick={() => void start()}>
            <Play aria-hidden className="h-4 w-4" />
            Abrir terminal
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void close()}>Cerrar terminal</Button>
        )}
        {session !== null ? <span className="mh-mono truncate text-eyebrow text-[var(--color-text-subtle)]">{session.cwd}</span> : null}
      </div>
      {error !== null ? <p className="m-0 text-xs text-[var(--status-failed-fg)]">{error}</p> : null}
      <div ref={terminalRef} className="min-h-0 flex-1 overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-black p-2" />
    </div>
  );
}

function EventLogSurface({ events }: { events: RunEvent[] }): React.ReactElement {
  return (
    <div className="mh-mono space-y-1 text-xs text-[var(--color-text-muted)]">
      {events.map((event) => (
        <div key={event.seq} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <span className="text-[var(--color-text-subtle)]">#{event.seq}</span> {event.type}
        </div>
      ))}
      {events.length === 0 ? <p className="m-0 text-xs text-[var(--color-text-subtle)]">Sin eventos para mostrar.</p> : null}
    </div>
  );
}

function ValidationSurface({ model }: { model: RunModel }): React.ReactElement {
  const nodes = Array.from(model.nodes.values()).filter((node) => node.execution.kind === "verifying" || node.execution.kind === "failed" || node.execution.kind === "integrated");
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <div key={node.id} className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs">
          <strong className="text-[var(--color-text)]">{node.title}</strong>
          <p className="m-0 mt-1 text-[var(--color-text-muted)]">{node.execution.kind}</p>
        </div>
      ))}
      {nodes.length === 0 ? <p className="m-0 text-xs text-[var(--color-text-subtle)]">La validación aparecerá cuando los agentes ejecuten tareas.</p> : null}
    </div>
  );
}

function EmptyDock({ onOpenSurface }: { onOpenSurface: (surface: DockSurfaceId, focus?: FocusTarget | null) => void }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
      <FileCode2 aria-hidden className="h-8 w-8 text-[var(--color-text-subtle)]" />
      <p className="m-0 text-sm font-semibold text-[var(--color-text)]">Dock vacío</p>
      <p className="m-0 text-xs leading-relaxed text-[var(--color-text-muted)]">Abrí agentes, archivos, diffs o evidencia cuando los necesites.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <MiniAction onClick={() => onOpenSurface("agents")}>Agentes</MiniAction>
        <MiniAction onClick={() => onOpenSurface("files")}>Archivos</MiniAction>
        <MiniAction onClick={() => onOpenSurface("diff")}>Diff</MiniAction>
      </div>
    </div>
  );
}

function SurfaceHeader({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string | undefined }): React.ReactElement {
  return (
    <header className="flex items-start gap-2">
      <span className="mt-0.5 text-[var(--color-accent)]">{icon}</span>
      <div className="min-w-0">
        <h3 className="m-0 text-sm font-semibold text-[var(--color-text)]">{title}</h3>
        {detail !== undefined ? <p className="mh-mono m-0 mt-0.5 truncate text-eyebrow text-[var(--color-text-subtle)]">{detail}</p> : null}
      </div>
    </header>
  );
}

function EmptySurface({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <div className="rounded-[var(--r-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="m-0 text-sm font-semibold text-[var(--color-text)]">{title}</p>
      <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="grid gap-3 p-4">{children}</div>;
}

function MiniAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer rounded-[var(--r-md)] border border-[var(--color-border-control)] bg-transparent px-2 py-1 text-eyebrow font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]">
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--r-md)] border border-transparent text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]">
      {children}
    </button>
  );
}

function HorizontalResizeHandle(): React.ReactElement {
  return (
    <Separator className="group relative h-px shrink-0 cursor-row-resize bg-[var(--color-border)] outline-none transition-colors duration-150 data-[separator=hover]:bg-[var(--color-border-strong)] data-[separator=active]:bg-[var(--color-accent)]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[3px] w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-border-strong)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[separator=active]:bg-[var(--color-accent)] group-data-[separator=active]:opacity-100"
      />
    </Separator>
  );
}

export function WorkspaceResizeHandle(): React.ReactElement {
  return <ResizeHandle />;
}

function parentPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
