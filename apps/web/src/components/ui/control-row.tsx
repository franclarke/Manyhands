import type { ReactNode } from "react";

interface ControlRowProps {
  /** Short coordinate-style label shown in the left gutter. */
  label: string;
  /** Optional one-line explanation under the label. */
  hint?: string;
  children: ReactNode;
  /** Width of the label gutter. */
  labelWidth?: number;
  /** Drop the bottom divider (e.g. for the last row in a group). */
  last?: boolean;
}

/**
 * Inline control row — a coordinate label + hint in a fixed left gutter and the
 * control(s) on the right, separated from siblings by a hairline rule. This is
 * the Graphite Lab pattern for forms: separation by spacing and rules, not by
 * nested boxes. Collapses to a stacked layout on narrow viewports.
 */
export function ControlRow({
  label,
  hint,
  children,
  labelWidth = 132,
  last = false
}: ControlRowProps): React.ReactElement {
  return (
    <div
      className="mh-control-row"
      style={{
        display: "flex",
        alignItems: hint !== undefined ? "flex-start" : "center",
        gap: 18,
        padding: "13px 0",
        borderBottom: last ? "none" : "1px solid var(--rule-soft)"
      }}
    >
      <div
        className="mh-control-row__label"
        style={{
          width: labelWidth,
          flex: `0 0 ${labelWidth}px`,
          paddingTop: hint !== undefined ? 2 : 0
        }}
      >
        <div className="mh-coord">{label}</div>
        {hint !== undefined ? (
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, lineHeight: 1.4 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap"
        }}
      >
        {children}
      </div>
    </div>
  );
}
