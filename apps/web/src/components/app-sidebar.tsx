"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, RunPreview } from "@/lib/api-types";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Plus, Folder, History, Flame, GitMerge } from "lucide-react";

interface AppSidebarProps {
  workspaces: Workspace[];
  recentRuns: RunPreview[];
}

export function AppSidebar({ workspaces, recentRuns }: AppSidebarProps): React.ReactElement {
  const pathname = usePathname();

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
        <div className="ml-auto">
          <ThemeToggle />
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
          {recentRuns.map((run) => (
            <RunRow key={run.id} run={run} active={pathname === `/runs/${run.id}`} />
          ))}
          {recentRuns.length === 0 ? (
            <span className="px-1.5 py-1 text-[11.5px] text-[var(--color-text-subtle)]">
              Sin ejecuciones previas
            </span>
          ) : null}
        </nav>
      </section>
    </aside>
  );
}

function RunRow({ run, active }: { run: RunPreview; active: boolean }): React.ReactElement {
  const uiStatus = runUiStatus(run.status);
  const meta = STATUS_META[uiStatus];
  const failed = uiStatus === "failed";

  return (
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
            "line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-[1.3] text-[var(--color-text)]",
            active ? "font-semibold" : "font-medium"
          ].join(" ")}
        >
          {run.title || run.userPrompt.slice(0, 64)}
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
