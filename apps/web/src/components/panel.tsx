import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className = "" }: PanelProps): React.ReactElement {
  return (
    <section className={`mh-card ${className}`} style={{ padding: 22 }}>
      {children}
    </section>
  );
}

interface StatusPillProps {
  children: ReactNode;
  tone?: "default" | "accent" | "warning" | "danger" | "done" | "info";
}

export function StatusPill({
  children,
  tone = "default"
}: StatusPillProps): React.ReactElement {
  const palette: Record<NonNullable<StatusPillProps["tone"]>, { fg: string; bg: string; border: string }> = {
    default: { fg: "var(--text-2)", bg: "var(--surface-2)", border: "var(--border)" },
    accent:  { fg: "var(--status-planning-fg)", bg: "var(--status-planning-bg)", border: "var(--status-planning-border)" },
    warning: { fg: "var(--status-blocked-fg)",  bg: "var(--status-blocked-bg)",  border: "var(--status-blocked-border)" },
    danger:  { fg: "var(--status-failed-fg)",   bg: "var(--status-failed-bg)",   border: "var(--status-failed-border)" },
    done:    { fg: "var(--status-completed-fg)", bg: "var(--status-completed-bg)", border: "var(--status-completed-border)" },
    info:    { fg: "var(--status-pending-fg)",  bg: "var(--status-pending-bg)",  border: "var(--status-pending-border)" }
  };
  const color = palette[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0.02,
        border: `1px solid ${color.border}`,
        background: color.bg,
        color: color.fg,
        whiteSpace: "nowrap"
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }}
      />
      {children}
    </span>
  );
}
