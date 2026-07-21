"use client";

import { useEffect } from "react";
import { Button } from "./button";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Minimal tokenized confirmation dialog (replaces `window.confirm`).
 * Focus lands on the cancel action; Escape cancels.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="mh-elev-sheet flex w-full max-w-sm flex-col gap-3 rounded-[var(--r-xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className="m-0 text-base font-semibold text-[var(--color-text)]">{title}</h2>
        <p className="m-0 text-label leading-relaxed text-[var(--color-text-muted)]">{description}</p>
        {error !== null ? (
          <p role="alert" className="m-0 text-label text-[var(--status-failed-fg)]">{error}</p>
        ) : null}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} size="sm" onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
