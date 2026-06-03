import { STATUS_META, type UiStatus } from "@/lib/status";
import { StatusDot } from "./status-badge";

interface SignalProps {
  status: UiStatus;
  /** Override the default STATUS_META label. */
  label?: string;
  size?: number;
}

/**
 * Status signal — a small dot + label, no box. The Graphite Lab default for
 * communicating run/node status in dense, low-noise contexts (lists, rows,
 * headers) where a full {@link StatusBadge} pill would be too heavy. Color,
 * label and pulse all come from the single STATUS_META source (lib/status.ts).
 */
export function Signal({ status, label, size = 6 }: SignalProps): React.ReactElement {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        fontWeight: 600,
        color: meta.fg,
        whiteSpace: "nowrap"
      }}
    >
      <StatusDot status={status} size={size} />
      <span>{label ?? meta.label}</span>
    </span>
  );
}
