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
    accent:  { fg: "var(--coral)",  bg: "rgba(204,120,92,0.10)", border: "rgba(204,120,92,0.45)" },
    warning: { fg: "var(--ready)",  bg: "rgba(201,164,92,0.10)", border: "rgba(201,164,92,0.45)" },
    danger:  { fg: "var(--error)",  bg: "rgba(194,91,84,0.10)",  border: "rgba(194,91,84,0.45)" },
    done:    { fg: "var(--done)",   bg: "rgba(107,142,107,0.10)", border: "rgba(107,142,107,0.45)" },
    info:    { fg: "var(--selected)", bg: "rgba(91,122,153,0.10)", border: "rgba(91,122,153,0.45)" }
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
        fontSize: 11,
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
