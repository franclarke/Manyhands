"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Workspace, RunPreview } from "@/lib/api-types";
import { runUiStatus, STATUS_META } from "@/lib/status";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Plus,
  Folder,
  History,
  Settings,
  GitCompare,
  BarChart3,
  Flame,
  AlertOctagon
} from "lucide-react";

interface AppSidebarProps {
  workspaces: Workspace[];
  recentRuns: RunPreview[];
}

export function AppSidebar({ workspaces, recentRuns }: AppSidebarProps): React.ReactElement {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        background: "var(--color-bg-subtle)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto"
      }}
      className="font-sans"
    >
      {/* Brand Header */}
      <div
        style={{
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--color-border-soft)"
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-accent-contrast)"
          }}
        >
          <Flame className="w-4 h-4" />
        </div>
        <span
          className="font-semibold text-lg"
          style={{ letterSpacing: "-0.01em", color: "var(--text)" }}
        >
          ManyHands
        </span>
        <span
          className="mh-mono text-[9px] px-1.5 py-0.5 rounded"
          style={{
            background: "var(--color-surface)",
            color: "var(--text-3)",
            marginLeft: "auto"
          }}
        >
          v0.4
        </span>
        <ThemeToggle />
      </div>

      {/* Primary Action */}
      <div style={{ padding: "16px 20px 12px" }}>
        <Link href="/" passHref style={{ textDecoration: "none" }}>
          <button
            type="button"
            style={{
              width: "100%",
              height: 38,
              background: "var(--color-accent)",
              border: "1px solid var(--color-accent)",
              color: "var(--color-accent-contrast)",
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              cursor: "pointer",
              boxShadow: "none"
            }}
          >
            <Plus className="w-4 h-4" />
            Nuevo Run
          </button>
        </Link>
      </div>

      {/* Navigation Links */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "0 12px"
        }}
      >
        <SidebarLink
          href="/compare"
          icon={<GitCompare className="w-4 h-4" />}
          label="Comparar Granularidad"
          active={pathname === "/compare"}
        />
        <SidebarLink
          href="/benchmarks"
          icon={<BarChart3 className="w-4 h-4" />}
          label="Benchmarks / Evals"
          active={pathname === "/benchmarks"}
        />
        <SidebarLink
          href="/settings"
          icon={<Settings className="w-4 h-4" />}
          label="Configuración"
          active={pathname === "/settings"}
        />
      </div>

      {/* Workspaces Section */}
      <div style={{ marginTop: 22, padding: "0 20px" }}>
        <h3
          className="mh-mono"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-3)",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <Folder className="w-3.5 h-3.5" />
          Workspaces
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                color: "var(--text-2)",
                padding: "4px 0"
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "var(--color-text-subtle)"
                }}
              />
              <span style={{ fontWeight: 500 }} title={workspace.repoPath}>
                {workspace.name}
              </span>
            </div>
          ))}
          {workspaces.length === 0 && (
            <span style={{ fontSize: 11, fontStyle: "italic", color: "var(--text-4)" }}>
              Sin workspaces creados
            </span>
          )}
        </div>
      </div>

      {/* Recent Runs Section */}
      <div
        style={{
          marginTop: 22,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "0 20px 24px",
          minHeight: 0
        }}
      >
        <h3
          className="mh-mono"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-3)",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <History className="w-3.5 h-3.5" />
          Runs Recientes
        </h3>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            overflowY: "auto",
            flex: 1,
            marginRight: -10,
            paddingRight: 10
          }}
        >
          {recentRuns.map((run) => {
            const isActive = pathname === `/runs/${run.id}`;
            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    padding: "10px 10px",
                    borderRadius: 8,
                    background: isActive ? "var(--color-surface)" : "transparent",
                    border: "1px solid",
                    borderColor: isActive ? "var(--color-border)" : "transparent",
                    borderLeft: isActive ? "2px solid var(--color-accent)" : "1px solid transparent",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    cursor: "pointer",
                    transition: "all 150ms ease",
                    boxShadow: "none"
                  }}
                  className={`group ${!isActive ? "hover:bg-[var(--cu-surface-3)]" : ""}`}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: isActive ? 600 : 500,
                        fontSize: 12.5,
                        color: "var(--color-text)",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        lineHeight: 1.25,
                        flex: 1
                      }}
                    >
                      {run.title || run.userPrompt.slice(0, 32)}
                    </span>
                    {run.conflictCount !== undefined && run.conflictCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-[10px] font-semibold font-mono rounded border"
                        style={{
                          color: "var(--status-failed-fg)",
                          background: "var(--status-failed-bg)",
                          borderColor: "var(--status-failed-border)",
                          padding: "1px 5px"
                        }}
                      >
                        <AlertOctagon className="w-2.5 h-2.5" />
                        {run.conflictCount}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 10,
                      color: "var(--color-text-subtle)",
                      paddingLeft: 0
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <StatusDot status={run.status} />
                      <span className="mh-mono truncate max-w-[110px]" title={run.workspaceName}>
                        {run.workspaceName}
                      </span>
                    </span>
                    <span className="mh-mono text-[9.5px]">
                      {formatRecency(run.updatedAt)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
          {recentRuns.length === 0 && (
            <span style={{ fontSize: 11, fontStyle: "italic", color: "var(--text-4)" }}>
              Sin ejecuciones previas
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  active
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}): React.ReactElement {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderRadius: "var(--r-lg)",
          background: active ? "var(--color-surface)" : "transparent",
          color: active ? "var(--color-text)" : "var(--color-text-muted)",
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          cursor: "pointer"
        }}
        className="hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] transition-colors"
      >
        <span style={{ color: active ? "var(--color-accent)" : "var(--color-text-subtle)" }}>{icon}</span>
        {label}
      </div>
    </Link>
  );
}

function StatusDot({ status }: { status: RunPreview["status"] }): React.ReactElement {
  const uiStatus = runUiStatus(status);
  const meta = STATUS_META[uiStatus];
  return (
    <span
      className={meta.pulse ? "w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse" : "w-1.5 h-1.5 rounded-full flex-shrink-0"}
      style={{ backgroundColor: meta.fg }}
    />
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
