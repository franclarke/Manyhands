import type { ReactNode } from "react";

interface MetricStatProps {
  value: ReactNode;
  label: string;
  /** Dim the stat when the value is absent/zero/pending. */
  muted?: boolean;
  align?: "left" | "center";
}

/**
 * Single metric (value + caption). Used in the run header and run summary.
 * Operational evidence, not decoration — keep these to numbers that inform a
 * decision (counts, depth, cost, latency).
 */
export function MetricStat({
  value,
  label,
  muted = false,
  align = "center"
}: MetricStatProps): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: align === "center" ? "center" : "flex-start" }}>
      <span
        className="mh-serif"
        style={{ fontSize: "var(--fs-lg)", color: muted ? "var(--color-text-subtle)" : "var(--color-text)", lineHeight: 1 }}
      >
        {value}
      </span>
      <span className="mh-coord" style={{ color: muted ? "var(--color-text-subtle)" : "var(--color-text-muted)" }}>
        {label}
      </span>
    </div>
  );
}
