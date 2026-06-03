import type { ReactNode } from "react";

export type EmptyStateTone = "neutral" | "pending";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /**
   * `pending` marks data that is contractually expected but not produced yet
   * (e.g. execution-core evidence before Etapa 1 lands). It is rendered as an
   * explicit "pending" state, never as fake/placeholder content.
   */
  tone?: EmptyStateTone;
  compact?: boolean;
}

/**
 * Honest empty / pending state. Use instead of inventing placeholder data when
 * a real schema field has no value yet.
 */
export function EmptyState({
  title,
  description,
  tone = "neutral",
  compact = false
}: EmptyStateProps): React.ReactElement {
  const accent = tone === "pending" ? "var(--color-accent)" : "var(--color-text-subtle)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 6,
        padding: compact ? "16px 14px" : "40px 24px",
        border: "1px dashed var(--color-border-strong)",
        borderRadius: "var(--r-lg)",
        background: "rgba(241,234,216,0.035)"
      }}
    >
      {tone === "pending" ? (
        <span
          className="mh-coord"
          style={{ color: accent }}
        >
          pending · execution core
        </span>
      ) : null}
      <span
        className="mh-serif"
        style={{ fontSize: compact ? 15 : 17, color: "var(--color-text)" }}
      >
        {title}
      </span>
      {description !== undefined ? (
        <span style={{ fontSize: 13, color: "var(--color-text-muted)", maxWidth: 380, lineHeight: 1.5 }}>
          {description}
        </span>
      ) : null}
    </div>
  );
}
