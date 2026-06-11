import { STATUS_META, type UiStatus } from "@/lib/status";

interface StatusPillProps {
  status: UiStatus;
  label: string;
  /** Optional tooltip with extended detail. */
  title?: string | undefined;
  /** Override the palette's pulse (e.g. force-static in dense lists). */
  pulse?: boolean | undefined;
}

/**
 * Status chip — dot + text on the status palette. The only sanctioned way to
 * show a UiStatus inline (state is never color-only; the label is mandatory).
 */
export function StatusPill({ status, label, title, pulse }: StatusPillProps): React.ReactElement {
  const meta = STATUS_META[status];
  const animate = pulse ?? meta.pulse;
  return (
    <span
      className="mh-mono inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium"
      title={title}
      style={{ color: meta.fg, background: meta.bg, borderColor: meta.border }}
    >
      <span
        aria-hidden
        className={animate ? "h-1.5 w-1.5 animate-pulse rounded-full" : "h-1.5 w-1.5 rounded-full"}
        style={{ background: meta.fg }}
      />
      {label}
    </span>
  );
}
