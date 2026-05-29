import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

const VARIANT_STYLE: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    border: "1px solid var(--color-accent)",
    background: "var(--color-accent)",
    color: "#14110e",
    fontWeight: 600
  },
  ghost: {
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontWeight: 500
  },
  danger: {
    border: "1px solid var(--status-failed-border)",
    background: "var(--status-failed-bg)",
    color: "var(--status-failed-fg)",
    fontWeight: 600
  }
};

const SIZE_STYLE: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "6px 11px", fontSize: 12, borderRadius: "var(--r-md)" },
  md: { padding: "7px 13px", fontSize: 12.5, borderRadius: "var(--r-lg)" }
};

/**
 * Tokenized button primitive. Replaces the ad-hoc Primary/Secondary buttons
 * scattered across the run chrome. Consumes semantic/state tokens only.
 */
export function Button({
  variant = "ghost",
  size = "md",
  busy = false,
  busyLabel = "Working…",
  disabled,
  children,
  style,
  ...rest
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled === true || busy;
  return (
    <button
      type="button"
      disabled={isDisabled}
      {...rest}
      style={{
        ...VARIANT_STYLE[variant],
        ...SIZE_STYLE[size],
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: disabled === true && !busy ? 0.55 : 1,
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
        ...style
      }}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
