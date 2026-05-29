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
        border: "1px dashed var(--color-border)",
        borderRadius: "var(--r-lg)",
        background: "var(--color-bg-subtle)"
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
        style={{ fontSize: compact ? 14 : 16, color: "var(--color-text)" }}
      >
        {title}
      </span>
      {description !== undefined ? (
        <span style={{ fontSize: 12.5, color: "var(--color-text-subtle)", maxWidth: 360, lineHeight: 1.45 }}>
          {description}
        </span>
      ) : null}
    </div>
  );
}
