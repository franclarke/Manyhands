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
    border: "1px solid var(--color-border-control)",
    background: "rgba(241,234,216,0.035)",
    color: "var(--color-text)",
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
  sm: { minHeight: 36, padding: "0 13px", fontSize: 13, borderRadius: "var(--r-md)" },
  md: { minHeight: 40, padding: "0 16px", fontSize: 13.5, borderRadius: "var(--r-lg)" }
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
        transition: "background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out",
        ...style
      }}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
