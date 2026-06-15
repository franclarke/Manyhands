"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Workspace, RunPreview } from "@/lib/api-types";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { ThemeToggle } from "@/components/theme-toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Plus,
  Folder,
  History,
  Flame,
  GitMerge,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  Check,
  X
} from "lucide-react";

const COLLAPSE_STORAGE_KEY = "mh-sidebar-collapsed";

interface AppSidebarProps {
  workspaces: Workspace[];
  recentRuns: RunPreview[];
}

export function AppSidebar({ workspaces, recentRuns }: AppSidebarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [runs, setRuns] = useState<RunPreview[]>(recentRuns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RunPreview | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the local list in sync with fresh server data on navigation/refresh.
  useEffect(() => {
    setRuns(recentRuns);
  }, [recentRuns]);

  // Restore the collapsed preference after mount (avoids a hydration mismatch).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

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
    const id = deleteTarget.id;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) throw new Error(String(response.status));
      setRuns((prev) => prev.filter((run) => run.id !== id));
      setDeleteTarget(null);
      if (pathname === `/runs/${id}`) {
        router.push("/");
      } else {
        router.refresh();
      }
    } catch {
      /* keep dialog open on failure */
    } finally {
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <CollapsedRail onExpand={toggleCollapsed} />
    );
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] font-sans">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border-soft)] px-4 py-[14px]">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
          <Flame aria-hidden className="h-4 w-4" />
        </div>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text)]">
          ManyHands
        </span>
        <span className="mh-mono rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-subtle)]">
          v0.4
        </span>
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
          className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-accent)] bg-[var(--color-accent)] text-[13px] font-semibold text-[var(--color-accent-contrast)] transition-[background,border-color] duration-150 ease-out hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)] active:translate-y-px"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Nuevo run
        </Link>
      </div>

      {/* Workspaces */}
      <section className="px-3 pt-4" aria-label="Workspaces">
        <h3 className="mh-mono flex items-center gap-1.5 px-1.5 pb-1.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
          <Folder aria-hidden className="h-3 w-3" />
          Workspaces
        </h3>
        <ul className="m-0 flex list-none flex-col p-0">
          {workspaces.map((workspace) => (
            <li
              key={workspace.id}
              className="flex items-center gap-2 rounded-[var(--r-md)] px-1.5 py-1.5 text-[12.5px] text-[var(--color-text-muted)]"
              title={workspace.repoPath}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-subtle)]" />
              <span className="truncate font-medium">{workspace.name}</span>
              {workspace.defaultBranch !== undefined && workspace.defaultBranch.length > 0 ? (
                <span className="mh-mono ml-auto flex items-center gap-1 text-[10px] text-[var(--color-text-subtle)]">
                  <GitMerge aria-hidden className="h-3 w-3" />
                  {workspace.defaultBranch}
                </span>
              ) : null}
            </li>
          ))}
          {workspaces.length === 0 ? (
            <li className="px-1.5 py-1 text-[11.5px] text-[var(--color-text-subtle)]">
              Sin workspaces todavía
            </li>
          ) : null}
        </ul>
      </section>

      {/* Recent runs */}
      <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-4" aria-label="Runs recientes">
        <h3 className="mh-mono flex items-center gap-1.5 px-1.5 pb-1.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
          <History aria-hidden className="h-3 w-3" />
          Runs recientes
        </h3>
        <nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              active={pathname === `/runs/${run.id}`}
              editing={editingId === run.id}
              onStartRename={() => setEditingId(run.id)}
              onCommitRename={(title) => void commitRename(run.id, title)}
              onCancelRename={() => setEditingId(null)}
              onRequestDelete={() => setDeleteTarget(run)}
            />
          ))}
          {runs.length === 0 ? (
            <span className="px-1.5 py-1 text-[11.5px] text-[var(--color-text-subtle)]">
              Sin ejecuciones previas
            </span>
          ) : null}
        </nav>
      </section>

      {deleteTarget !== null ? (
        <ConfirmDialog
          title="¿Eliminar este run del historial?"
          description={`Se elimina "${deleteTarget.title || deleteTarget.userPrompt.slice(0, 48)}" de ManyHands. El repositorio y sus ramas no se tocan.`}
          confirmLabel="Eliminar run"
          destructive
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </aside>
  );
}

function CollapsedRail({ onExpand }: { onExpand: () => void }): React.ReactElement {
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] py-[14px] font-sans">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
        <Flame aria-hidden className="h-4 w-4" />
      </div>
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
      <div className="mt-auto">
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
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--r-md)] border border-transparent bg-transparent text-[var(--color-text-subtle)] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] hover:text-[var(--color-text)]"
    >
      {children}
    </button>
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
  const failed = uiStatus === "failed";
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
          "flex flex-col gap-1 rounded-[var(--r-lg)] border px-2.5 py-2 transition-colors duration-150",
          active
            ? "border-[var(--color-border)] bg-[var(--color-surface)]"
            : "border-transparent hover:bg-[color-mix(in_srgb,var(--color-text)_4.5%,transparent)]"
        ].join(" ")}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span
            className={[
              "line-clamp-2 min-w-0 flex-1 pr-10 text-[12.5px] leading-[1.3] text-[var(--color-text)]",
              active ? "font-semibold" : "font-medium"
            ].join(" ")}
          >
            {displayTitle}
          </span>
          {run.conflictCount !== undefined && run.conflictCount > 0 ? (
            <span
              className="mh-mono shrink-0 rounded border px-1 py-px text-[10px] font-semibold"
              title={`${run.conflictCount} ${run.conflictCount === 1 ? "conflicto" : "conflictos"}`}
              style={{
                color: failed ? "var(--status-failed-fg)" : "var(--status-blocked-fg)",
                background: failed ? "var(--status-failed-bg)" : "var(--status-blocked-bg)",
                borderColor: failed ? "var(--status-failed-border)" : "var(--status-blocked-border)"
              }}
            >
              {run.conflictCount}
            </span>
          ) : null}
        </span>
        <span className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-subtle)]">
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
          <span className="mh-mono shrink-0 text-[9.5px]">{formatRecency(run.updatedAt)}</span>
        </span>
      </Link>

      {/* Hover actions — rename / delete */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/run:opacity-100">
        <RowAction
          label="Renombrar run"
          onClick={(event) => {
            event.preventDefault();
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
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
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
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        "flex h-6 w-6 items-center justify-center rounded-[var(--r-sm)] border border-transparent bg-[color-mix(in_srgb,var(--color-bg-subtle)_85%,transparent)] backdrop-blur-sm transition-colors duration-150",
        danger
          ? "text-[var(--color-text-subtle)] hover:bg-[var(--status-failed-bg)] hover:text-[var(--status-failed-fg)]"
          : "text-[var(--color-text-subtle)] hover:bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)] hover:text-[var(--color-text)]"
      ].join(" ")}
    >
      {children}
    </button>
  );
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
