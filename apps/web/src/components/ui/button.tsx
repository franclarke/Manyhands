import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

const BASE_CLASS =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none font-sans " +
  "transition-[background,border-color,color,transform,box-shadow] duration-150 ease-out " +
  "active:translate-y-px mh-press disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "border border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] font-semibold mh-lift " +
    "hover:bg-[var(--color-accent-hover)] hover:border-[var(--color-accent-hover)] " +
    "disabled:hover:bg-[var(--color-accent)] disabled:hover:border-[var(--color-accent)]",
  ghost:
    "border border-[var(--color-border-control)] bg-[color-mix(in_srgb,var(--color-text)_3.5%,transparent)] " +
    "text-[var(--color-text)] font-medium " +
    "hover:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)] " +
    "disabled:hover:bg-[color-mix(in_srgb,var(--color-text)_3.5%,transparent)]",
  danger:
    "border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)] font-semibold " +
    "hover:bg-[color-mix(in_srgb,var(--status-failed-fg)_18%,transparent)] " +
    "disabled:hover:bg-[var(--status-failed-bg)]",
  quiet:
    "border border-transparent bg-transparent text-[var(--color-text-muted)] font-medium " +
    "hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] hover:text-[var(--color-text)] " +
    "disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-label rounded-[var(--r-md)]",
  md: "h-9 px-4 text-label rounded-[var(--r-lg)]",
  icon: "h-7 w-7 p-0 rounded-[var(--r-md)]"
};

/**
 * Tokenized button primitive — the single button vocabulary for the app chrome.
 * Consumes semantic/state tokens only; every variant ships default, hover,
 * focus (global ring), active, disabled and busy states.
 */
export function Button({
  variant = "ghost",
  size = "md",
  busy = false,
  busyLabel,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled === true || busy;
  return (
    <button
      type="button"
      disabled={isDisabled}
      {...rest}
      className={[BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className ?? ""].join(" ")}
    >
      {busy ? (
        <>
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
