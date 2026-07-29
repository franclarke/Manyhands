"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Workspace, RunPreview } from "@/lib/api-types";
import { FIXTURE_CATALOG } from "@/lib/run-model/fixtures";
import { sidebarInitiallyCollapsedForRoute, type SidebarStoredPreference } from "@/lib/cockpit-layout";
import {
  RUNS_INITIAL_REVEAL,
  WORKSPACES_INITIAL_REVEAL,
  nextRevealCount,
  revealState
} from "@/lib/sidebar-reveal";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Logo } from "@/components/logo";
import {
  Plus,
  Folder,
  History,
  FlaskConical,
  GitMerge,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronDown,
  AlertTriangle
} from "lucide-react";

const COLLAPSE_STORAGE_KEY = "mh-sidebar-collapsed";

interface AppSidebarProps {
  workspaces: Workspace[];
  recentRuns: RunPreview[];
}

export function AppSidebar({ workspaces, recentRuns }: AppSidebarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const isProtoRoute = pathname === "/runs/proto" || pathname.startsWith("/runs/proto/");
  const realRunHref = recentRuns[0] === undefined ? "/" : `/runs/${recentRuns[0].id}`;

  const [collapsed, setCollapsed] = useState(false);
  const [runs, setRuns] = useState<RunPreview[]>(recentRuns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RunPreview | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealedWorkspaces, setRevealedWorkspaces] = useState(WORKSPACES_INITIAL_REVEAL);
  const [revealedRuns, setRevealedRuns] = useState(RUNS_INITIAL_REVEAL);

  const workspaceReveal = revealState(workspaces.length, revealedWorkspaces);
  const runReveal = revealState(runs.length, revealedRuns);

  // Keep the local list in sync with fresh server data on navigation/refresh.
  useEffect(() => {
    setRuns(recentRuns);
  }, [recentRuns]);

  // Restore the collapsed preference after mount (avoids a hydration mismatch).
  // On narrow viewports the sidebar always mounts collapsed — the desktop
  // preference must not eat the whole cockpit on a phone (see cockpit-layout).
  useEffect(() => {
    let stored: SidebarStoredPreference = null;
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw === "1") stored = "collapsed";
      else if (raw === "0") stored = "expanded";
    } catch {
      /* ignore */
    }
    setCollapsed(sidebarInitiallyCollapsedForRoute(window.innerWidth, stored, pathname));
  }, [pathname]);

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function commitRename(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    setEditingId(null);
    if (trimmed.length === 0) return;
    const previous = runs.find((run) => run.id === id);
    if (previous !== undefined && (previous.title ?? "") === trimmed) return;
    setRuns((prev) => prev.map((run) => (run.id === id ? { ...run, title: trimmed } : run)));
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed })
      });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      // Roll back the optimistic edit on failure.
      setRuns(recentRuns);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    setBusy(true);
    setDeleteError(null);
    const id = deleteTarget.id;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `No se pudo archivar el run (${response.status}).`);
      }
      setRuns((prev) => prev.filter((run) => run.id !== id));
      setDeleteTarget(null);
      if (pathname === `/runs/${id}`) {
        router.push("/");
      }
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (isProtoRoute) {
    return <ProtoSidebar pathname={pathname} collapsed={collapsed} realRunHref={realRunHref} onToggleCollapsed={toggleCollapsed} />;
  }

  if (collapsed) {
    return (
      <CollapsedRail onExpand={toggleCollapsed} />
    );
  }

  return (
    <>
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] font-sans">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border-soft)] px-4 py-[14px]">
        <Logo type="full" className="h-6 w-auto " />
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeToggle />
          <RailButton label="Colapsar barra lateral" onClick={toggleCollapsed}>
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </RailButton>
        </div>
      </div>

      {/* Primary action */}
      <div className="px-3 pb-1 pt-3">
        <Link
          href="/"
          className="mh-lift flex h-9 w-full items-center justify-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-label font-semibold text-[var(--color-accent-contrast)] transition-[background,border-color,box-shadow] duration-150 ease-out hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)] active:translate-y-px"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Nuevo run
        </Link>
      </div>

      {/* Scroll region — workspaces + run history share the leftover height so a
          long history stays reachable instead of being pushed off-screen. */}
      <div className="-mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pr-1">

      {/* Workspaces */}
      <section className="shrink-0 px-3 pt-4" aria-label="Workspaces">
        <h3 className="flex items-center gap-1.5 px-1.5 pb-2 text-meta font-medium text-[var(--color-text-subtle)]">
          <Folder aria-hidden className="h-3 w-3" />
          Workspaces
        </h3>
        <ul id="mh-workspace-list" className="m-0 flex list-none flex-col p-0">
          {workspaces.slice(0, workspaceReveal.visibleCount).map((workspace) => (
            <li
              key={workspace.id}
              className="flex items-center gap-2 rounded-[var(--r-md)] px-1.5 py-1.5 text-label text-[var(--color-text-muted)]"
              title={workspace.repoPath}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-subtle)]" />
              <span className="truncate font-medium">{workspace.name}</span>
              {workspace.defaultBranch !== undefined && workspace.defaultBranch.length > 0 ? (
                <span className="mh-mono ml-auto flex items-center gap-1 text-eyebrow text-[var(--color-text-subtle)]">
                  <GitMerge aria-hidden className="h-3 w-3" />
                  {workspace.defaultBranch}
                </span>
              ) : null}
            </li>
          ))}
          {workspaces.length === 0 ? (
            <li className="px-1.5 py-1 text-meta text-[var(--color-text-subtle)]">
              Sin workspaces todavía
            </li>
          ) : null}
          {workspaceReveal.canRevealMore ? (
            <li>
              <RevealMoreButton
                hiddenCount={workspaceReveal.hiddenCount}
                controls="mh-workspace-list"
                label={`Ver más workspaces (${workspaceReveal.hiddenCount} ocultos)`}
                onClick={() => setRevealedWorkspaces((prev) => nextRevealCount(workspaces.length, prev))}
              />
            </li>
          ) : null}
        </ul>
      </section>

      {/* Recent runs */}
      <section className="flex shrink-0 flex-col px-3 pt-4" aria-label="Runs recientes">
        <h3 className="flex items-center gap-1.5 px-1.5 pb-2 text-meta font-medium text-[var(--color-text-subtle)]">
          <History aria-hidden className="h-3 w-3" />
          Runs recientes
        </h3>
        <nav id="mh-run-list" className="flex flex-col gap-0.5">
          {runs.slice(0, runReveal.visibleCount).map((run) => (
            <RunRow
              key={run.id}
              run={run}
              active={pathname === `/runs/${run.id}`}
              editing={editingId === run.id}
              onStartRename={() => setEditingId(run.id)}
              onCommitRename={(title) => void commitRename(run.id, title)}
              onCancelRename={() => setEditingId(null)}
              onRequestDelete={() => {
                setDeleteError(null);
                setDeleteTarget(run);
              }}
            />
          ))}
          {runs.length === 0 ? (
            <span className="px-1.5 py-1 text-meta text-[var(--color-text-subtle)]">
              Sin ejecuciones previas
            </span>
          ) : null}
          {runReveal.canRevealMore ? (
            <RevealMoreButton
              hiddenCount={runReveal.hiddenCount}
              controls="mh-run-list"
              label={`Ver más runs (${runReveal.hiddenCount} ocultos)`}
              onClick={() => setRevealedRuns((prev) => nextRevealCount(runs.length, prev))}
            />
          ) : null}
        </nav>
      </section>

      </div>

      <div className="border-t border-[var(--color-border-soft)] p-3">
        <Link
          href="/runs/proto"
          aria-label="Abrir laboratorio de runs"
          className="flex h-9 items-center gap-2 rounded-[var(--r-lg)] border border-transparent px-3 text-label font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <FlaskConical aria-hidden className="h-4 w-4 text-[var(--color-accent)]" />
          Laboratorio de runs
        </Link>
      </div>

      </aside>

      {deleteTarget !== null ? (
        <ConfirmDialog
          title="¿Archivar este run del historial?"
          description={`Se oculta "${deleteTarget.title || deleteTarget.userPrompt.slice(0, 48)}" de ManyHands. El repositorio y sus ramas no se tocan.`}
          confirmLabel="Archivar run"
          destructive
          busy={busy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setDeleteError(null);
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * "Ver más" — reveals the next slice of a truncated sidebar list. It stays
 * rendered while items remain hidden, so repeated clicks walk the list to its
 * end; the remaining count keeps the depth of the list legible.
 */
function RevealMoreButton({
  hiddenCount,
  controls,
  label,
  onClick
}: {
  hiddenCount: number;
  controls: string;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-controls={controls}
      className="mt-0.5 flex w-full items-center gap-1.5 rounded-[var(--r-md)] border border-transparent px-1.5 py-1.5 text-left text-meta font-medium text-[var(--color-text-subtle)] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--color-text)_4.5%,transparent)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
    >
      <ChevronDown aria-hidden className="h-3 w-3" />
      Ver más
      <span className="mh-mono ml-auto text-eyebrow tabular-nums">{hiddenCount}</span>
    </button>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }): React.ReactElement {
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] py-[14px] font-sans">
      <Logo type="mark" className="h-6 w-6" />
      <div className="mt-2 flex flex-col items-center gap-1">
        <Link
          href="/"
          aria-label="Nuevo run"
          title="Nuevo run"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
        >
          <Plus aria-hidden className="h-4 w-4" />
        </Link>
        <RailButton label="Expandir barra lateral" onClick={onExpand}>
          <PanelLeftOpen aria-hidden className="h-4 w-4" />
        </RailButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link
          href="/runs/proto"
          aria-label="Abrir laboratorio de runs"
          title="Abrir laboratorio de runs"
          className="grid h-9 w-9 place-items-center rounded-[var(--r-lg)] border border-transparent text-[var(--color-accent)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <FlaskConical aria-hidden className="h-4 w-4" />
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function RailButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return <IconButton label={label} onClick={onClick}>{children}</IconButton>;
}

function ProtoSidebar({
  pathname,
  collapsed,
  realRunHref,
  onToggleCollapsed
}: {
  pathname: string;
  collapsed: boolean;
  realRunHref: string;
  onToggleCollapsed: () => void;
}): React.ReactElement {
  if (collapsed) {
    return (
      <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] py-[14px] font-sans">
        <Logo type="mark" className="h-6 w-6" />
        <div className="mt-2 flex flex-col items-center gap-1">
          <Link
            href="/runs/proto"
            aria-label="Explorar fixtures de demo"
            title="Explorar fixtures de demo"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
          >
            <FlaskConical aria-hidden className="h-4 w-4" />
          </Link>
          <RailButton label="Expandir barra lateral" onClick={onToggleCollapsed}>
            <PanelLeftOpen aria-hidden className="h-4 w-4" />
          </RailButton>
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Link
            href={realRunHref}
            aria-label="Volver a runs reales"
            title="Volver a runs reales"
            className="grid h-9 w-9 place-items-center rounded-[var(--r-lg)] border border-transparent text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <History aria-hidden className="h-4 w-4" />
          </Link>
          <ThemeToggle />
        </div>
      </aside>
    );
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] font-sans">
      <div className="flex items-center gap-3 border-b border-[var(--color-border-soft)] px-4 py-[14px]">
        <Logo type="full" className="h-6 w-auto" />
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeToggle />
          <RailButton label="Colapsar barra lateral" onClick={onToggleCollapsed}>
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </RailButton>
        </div>
      </div>

      <div className="px-3 pb-1 pt-3">
        <Link
          href="/runs/proto"
          className="mh-lift flex h-9 w-full items-center justify-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-label font-semibold text-[var(--color-accent-contrast)] transition-[background,border-color,box-shadow] duration-150 ease-out hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)] active:translate-y-px"
        >
          <FlaskConical aria-hidden className="h-4 w-4" />
          Explorar demos
        </Link>
      </div>

      <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-4" aria-label="Fixtures disponibles">
        <h3 className="flex items-center gap-1.5 px-1.5 pb-2 text-meta font-medium text-[var(--color-text-subtle)]">
          <FlaskConical aria-hidden className="h-3 w-3" />
          Fixtures disponibles
        </h3>
        <nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
          {FIXTURE_CATALOG.map((fixture) => {
            const active = pathname === `/runs/proto/${fixture.name}`;
            return (
              <Link
                key={fixture.name}
                href={`/runs/proto/${fixture.name}`}
                aria-current={active ? "page" : undefined}
                title={fixture.description}
                className={[
                  "flex flex-col gap-1 rounded-[var(--r-lg)] border px-3 py-2 transition-colors duration-150",
                  active
                    ? "mh-nav-active border-[var(--color-border)] bg-[var(--color-surface-raised)]"
                    : "border-transparent hover:bg-[color-mix(in_srgb,var(--color-text)_4.5%,transparent)]"
                ].join(" ")}
              >
                <span className={active ? "text-label font-semibold text-[var(--color-text)]" : "text-label font-medium text-[var(--color-text)]"}>
                  {fixture.title}
                </span>
                <span className="line-clamp-2 text-micro leading-[1.35] text-[var(--color-text-subtle)]">{fixture.description}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      <div className="mx-3 mb-3 space-y-2">
        <Link
          href={realRunHref}
          aria-label="Volver a runs reales"
          className="flex h-9 items-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-label font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <History aria-hidden className="h-4 w-4 text-[var(--color-text-muted)]" />
          Volver a runs reales
        </Link>
        <p className="px-1 text-micro leading-4 text-[var(--color-text-subtle)]">
          Los fixtures son locales y no alteran ejecuciones reales.
        </p>
      </div>
    </aside>
  );
}

interface RunRowProps {
  run: RunPreview;
  active: boolean;
  editing: boolean;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onRequestDelete: () => void;
}

function RunRow({
  run,
  active,
  editing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete
}: RunRowProps): React.ReactElement {
  const uiStatus = runUiStatus(run.status);
  const meta = STATUS_META[uiStatus];
  const displayTitle = run.title || run.userPrompt.slice(0, 64);

  if (editing) {
    return (
      <RenameField initial={displayTitle} onCommit={onCommitRename} onCancel={onCancelRename} />
    );
  }

  return (
    <div className="group/run relative">
      <Link
        href={`/runs/${run.id}`}
        aria-current={active ? "page" : undefined}
        className={[
          "flex flex-col gap-1 rounded-[var(--r-lg)] border px-3 py-2 transition-colors duration-150",
          active
            ? "mh-nav-active border-[var(--color-border)] bg-[var(--color-surface-raised)]"
            : "border-transparent hover:bg-[color-mix(in_srgb,var(--color-text)_4.5%,transparent)]"
        ].join(" ")}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span
            className={[
              "line-clamp-2 min-w-0 flex-1 pr-10 text-label leading-[1.3] text-[var(--color-text)]",
              active ? "font-semibold" : "font-medium"
            ].join(" ")}
          >
            {displayTitle}
          </span>
          {run.coordinationRiskCount !== undefined && run.coordinationRiskCount > 0 ? (
            <span
              className="mh-mono shrink-0 rounded border px-1 py-px text-eyebrow font-semibold"
              title={`${run.coordinationRiskCount} ${run.coordinationRiskCount === 1 ? "riesgo alto de coordinación" : "riesgos altos de coordinación"}`}
              style={{
                color: "var(--status-blocked-fg)",
                background: "var(--status-blocked-bg)",
                borderColor: "var(--status-blocked-border)"
              }}
            >
              <AlertTriangle aria-hidden className="mr-0.5 inline h-3 w-3" />{run.coordinationRiskCount}
            </span>
          ) : null}
        </span>
        <span className="flex items-center justify-between gap-2 text-micro text-[var(--color-text-subtle)]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className={meta.pulse ? "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" : "h-1.5 w-1.5 shrink-0 rounded-full"}
              style={{ backgroundColor: meta.fg }}
            />
            <span className="sr-only">{meta.label} ·</span>
            <span className="mh-mono max-w-[110px] truncate" title={run.workspaceName}>
              {run.workspaceName}
            </span>
          </span>
          <span className="mh-mono shrink-0 text-eyebrow tabular-nums">{formatRecency(run.updatedAt)}</span>
        </span>
      </Link>

      {/* Hover actions — rename / delete */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/run:opacity-100">
        <RowAction
          label="Renombrar run"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartRename();
          }}
        >
          <Pencil aria-hidden className="h-3 w-3" />
        </RowAction>
        <RowAction
          label="Eliminar run"
          danger
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete();
          }}
        >
          <Trash2 aria-hidden className="h-3 w-3" />
        </RowAction>
      </div>
    </div>
  );
}

function RenameField({
  initial,
  onCommit,
  onCancel
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1 rounded-[var(--r-lg)] border border-[var(--color-accent-deep)] bg-[var(--color-surface)] px-1.5 py-1.5">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit(value)}
        aria-label="Nuevo nombre del run"
        className="min-w-0 flex-1 bg-transparent text-label text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
      />
      <RowAction label="Guardar nombre" onClick={() => onCommit(value)}>
        <Check aria-hidden className="h-3 w-3" />
      </RowAction>
      <RowAction label="Cancelar" onClick={onCancel}>
        <X aria-hidden className="h-3 w-3" />
      </RowAction>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  danger = false,
  children
}: {
  label: string;
  onClick: (event: React.MouseEvent) => void;
  danger?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <IconButton label={label} onClick={onClick} tone={danger ? "danger" : "default"} size="sm" className="border-[var(--color-border)] bg-[var(--color-surface)]">{children}</IconButton>;
}

function formatRecency(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `hace ${diffMins}m`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
}
