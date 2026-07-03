import { STATUS_META, type UiStatus } from "@/lib/status";

interface StatusPillProps {
  status: UiStatus;
  label: string;
  /** Optional tooltip with extended detail. */
  title?: string | undefined;
  /** Override the palette's pulse (e.g. force-static in dense lists). */
  pulse?: boolean | undefined;
  /** `mini` is the dense variant for DAG cards and list rows. */
  size?: "md" | "mini";
}

/**
 * Status chip — dot + text on the status palette. The only sanctioned way to
 * show a UiStatus inline (state is never color-only; the label is mandatory).
 * The label reads as product copy (sentence-case Geist), not console mono; the
 * `tabular-nums` keeps the rare numeric label aligned.
 */
export function StatusPill({ status, label, title, pulse, size = "md" }: StatusPillProps): React.ReactElement {
  const meta = STATUS_META[status];
  const animate = pulse ?? meta.pulse;
  const mini = size === "mini";
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-medium tabular-nums",
        mini ? "h-5 gap-1 px-1.5 text-micro" : "h-6 gap-1.5 px-2 text-meta"
      ].join(" ")}
      title={title}
      style={{ color: meta.fg, background: meta.bg, borderColor: meta.border }}
    >
      <span
        aria-hidden
        className={[
          mini ? "h-1 w-1" : "h-1.5 w-1.5",
          // Live states share the DAG node's pulse, not Tailwind's generic blink.
          animate ? "coral-pulse" : "",
          "shrink-0 rounded-full"
        ].join(" ")}
        // Not-started states read as a hollow ring ("empty = no arrancado"), matching
        // the node glyph; every other state is a filled dot.
        style={
          meta.hollow
            ? { boxShadow: `inset 0 0 0 ${mini ? "1.25px" : "1.5px"} ${meta.fg}` }
            : { background: meta.fg }
        }
      />
      {label}
    </span>
  );
}
