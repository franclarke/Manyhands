"use client";

import { useEffect, useState } from "react";
import {
  FolderOpen,
  GitMerge,
  GitBranch,
  Trash2,
  Download,
  Loader2,
  Check,
  CircleAlert,
  Eraser
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DeliveryStatus {
  available: boolean;
  repoPath?: string;
  branchName?: string;
  commitSha?: string;
  baseBranch?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  baseClean?: boolean;
  merged?: boolean;
  reason?: string;
}

type Busy = "merge" | "discard" | "cleanup" | "reveal" | null;
type Confirming = "merge" | "discard" | null;

/**
 * Delivery card for a finished run (W7): turns the `manyhands/run-*` result
 * branch into shippable actions — open the folder, download the diff, merge into
 * the base branch, discard, or clean up the run's intermediate worktrees.
 */
export function DeliveryPanel({ runId }: { runId: string }): React.ReactElement | null {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function refresh(): Promise<void> {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/deliver`);
      if (response.ok) setStatus((await response.json()) as DeliveryStatus);
    } catch {
      /* leave previous status */
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  async function act(action: NonNullable<Busy>): Promise<void> {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/deliver`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; mergedInto?: string; removedBranches?: number };
      if (!response.ok) throw new Error(payload.error ?? `Error ${response.status}`);
      setMessage({ tone: "ok", text: successText(action, payload) });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (status === null || !status.available) return null;

  const stat =
    status.filesChanged !== undefined
      ? `${status.filesChanged} archivo${status.filesChanged === 1 ? "" : "s"} · +${status.insertions ?? 0} / -${status.deletions ?? 0}`
      : null;

  return (
    <div className="mh-elev-1 flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-5 py-4 font-sans">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-meta font-medium text-[var(--status-review-fg)]">
          <GitBranch aria-hidden className="h-3.5 w-3.5" />
          Resultado listo para entregar
        </span>
        <span className="mh-mono truncate text-meta text-[var(--color-text-muted)]" title={status.branchName}>
          {status.branchName}
        </span>
        {stat !== null ? <span className="mh-mono text-eyebrow text-[var(--color-text-subtle)]">{stat}</span> : null}
        {status.merged ? (
          <span className="mh-mono flex items-center gap-1 text-eyebrow text-[var(--status-completed-fg)]">
            <Check aria-hidden className="h-3.5 w-3.5" />
            Mergeado en {status.baseBranch}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ActionButton icon={<FolderOpen className="h-3.5 w-3.5" />} label="Abrir carpeta" busy={busy === "reveal"} onClick={() => void act("reveal")} />
        <a
          href={`/api/runs/${encodeURIComponent(runId)}/export?format=patch`}
          download
          className="flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border-control)] bg-transparent px-3 text-meta font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)]"
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          Descargar diff
        </a>
        <ActionButton
          icon={<GitMerge className="h-3.5 w-3.5" />}
          label={status.merged ? "Ya mergeado" : `Mergear a ${status.baseBranch ?? "base"}`}
          primary
          busy={busy === "merge"}
          disabled={status.merged === true || status.baseClean === false}
          title={status.baseClean === false ? "El repo tiene cambios sin commitear; commiteá o stasheá antes de mergear." : undefined}
          onClick={() => setConfirming("merge")}
        />
        <ActionButton icon={<Eraser className="h-3.5 w-3.5" />} label="Limpiar worktrees" busy={busy === "cleanup"} onClick={() => void act("cleanup")} />
        <ActionButton icon={<Trash2 className="h-3.5 w-3.5" />} label="Descartar rama" danger busy={busy === "discard"} onClick={() => setConfirming("discard")} />
      </div>

      {message !== null ? (
        <div
          className="flex items-start gap-1.5 text-meta"
          style={{ color: message.tone === "ok" ? "var(--status-completed-fg)" : "var(--status-failed-fg)" }}
        >
          {message.tone === "ok" ? <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      ) : null}

      {confirming === "merge" ? (
        <ConfirmDialog
          title={`¿Mergear a "${status.baseBranch}"?`}
          description={`Se hace merge de "${status.branchName}" en la rama actual del repo. Tu working tree debe estar limpio.`}
          confirmLabel="Mergear"
          busy={busy === "merge"}
          onConfirm={() => void act("merge")}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "discard" ? (
        <ConfirmDialog
          title={`¿Descartar la rama "${status.branchName}"?`}
          description="Se borra la rama del resultado. El patch sigue disponible para descargar."
          confirmLabel="Descartar rama"
          destructive
          busy={busy === "discard"}
          onConfirm={() => void act("discard")}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  busy = false,
  disabled = false,
  primary = false,
  danger = false,
  title
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  title?: string | undefined;
}): React.ReactElement {
  const base =
    "flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border px-3 text-meta font-medium transition-[background,border-color,color,transform,box-shadow] duration-150 active:translate-y-px mh-press disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";
  const tone = primary
    ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] mh-lift hover:bg-[var(--color-accent-hover)]"
    : danger
      ? "border-[var(--color-border-control)] bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--status-failed-bg)] hover:text-[var(--status-failed-fg)]"
      : "border-[var(--color-border-control)] bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]";
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} title={title} className={`${base} ${tone}`}>
      {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function successText(action: NonNullable<Busy>, payload: { mergedInto?: string; removedBranches?: number }): string {
  switch (action) {
    case "merge":
      return `Mergeado en ${payload.mergedInto ?? "la rama base"}.`;
    case "discard":
      return "Rama del resultado descartada.";
    case "cleanup":
      return `Worktrees limpiados${payload.removedBranches !== undefined ? ` · ${payload.removedBranches} ramas intermedias borradas` : ""}.`;
    case "reveal":
      return "Carpeta abierta en el explorador.";
  }
}
