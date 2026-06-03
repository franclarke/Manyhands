import { STATUS_META, type UiStatus } from "@/lib/status";

interface StatusDotProps {
  status: UiStatus;
  size?: number;
}

/** Status dot driven by the single STATUS_META source. */
export function StatusDot({ status, size = 6 }: StatusDotProps): React.ReactElement {
  const meta = STATUS_META[status];
  return (
    <span
      aria-hidden
      className={meta.pulse ? "coral-pulse" : undefined}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: meta.fg,
        flex: "0 0 auto"
      }}
    />
  );
}

interface StatusBadgeProps {
  status: UiStatus;
  /** Override the default STATUS_META label. */
  label?: string;
}

/**
 * Tokenized status pill. Single source for run/node status presentation —
 * color, label and pulse all come from STATUS_META (lib/status.ts).
 */
export function StatusBadge({ status, label }: StatusBadgeProps): React.ReactElement {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 26,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.02,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.fg,
        whiteSpace: "nowrap"
      }}
    >
      <StatusDot status={status} />
      {label ?? meta.label}
    </span>
  );
}
