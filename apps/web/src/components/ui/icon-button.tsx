import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  label,
  children,
  className = "",
  tone = "default",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tone?: "default" | "danger";
  size?: "sm" | "md";
}): React.ReactElement {
  const toneClass = tone === "danger"
    ? "hover:bg-[var(--status-failed-bg)] hover:text-[var(--status-failed-fg)]"
    : "hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]";
  const sizeClass = size === "sm" ? "h-6 w-6 rounded-[var(--r-sm)]" : "h-7 w-7 rounded-[var(--r-md)]";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex cursor-pointer items-center justify-center border border-transparent text-[var(--color-text-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${toneClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
