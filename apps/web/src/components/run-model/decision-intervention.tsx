"use client";

import { useEffect, useRef, useState } from "react";
import type { DecisionChannelItem } from "@/lib/run-model/decision-channel-view";
import { Button } from "@/components/ui/button";

export function DecisionIntervention({ runId, item }: { runId: string; item: DecisionChannelItem }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = (): void => {
    setOpen(false);
  };
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const choice = item.optionValues?.[choiceIndex] ?? item.options?.[choiceIndex] ?? "";
      const body = item.kind === "clarify"
        ? { answer: choice }
        : item.kind === "resolve_conflict"
          ? { choice: { resolutionId: choice } }
          : { choice: { action: "approve" } };
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/decisions/${encodeURIComponent(item.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `No se pudo responder (${response.status}).`);
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section aria-label="Intervención humana pendiente" className="absolute left-1/2 top-3 z-30 flex w-[min(720px,calc(100%-24px))] -translate-x-1/2 items-center gap-3 rounded-[var(--r-lg)] border border-[var(--status-blocked-border)] bg-[var(--color-surface-raised)] px-4 py-3 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-label font-semibold text-[var(--color-text)]">{item.label}</p>
          <p className="m-0 mt-0.5 truncate text-meta text-[var(--color-text-muted)]">{item.summary}</p>
        </div>
        <span className="hidden text-meta text-[var(--status-blocked-fg)] sm:inline">{item.affectedNodeIds.length || 1} nodo(s)</span>
        <Button size="sm" onClick={() => setOpen(true)}>Responder</Button>
      </section>
      <dialog ref={dialogRef} aria-labelledby={`decision-title-${item.id}`} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} className="m-auto w-[min(560px,calc(100%-32px))] rounded-[var(--r-xl)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/50">
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4 p-5">
          <div>
            <p className="m-0 text-eyebrow uppercase tracking-wide text-[var(--color-accent)]">Decisión humana</p>
            <h2 id={`decision-title-${item.id}`} className="m-0 mt-1 text-base font-semibold">{item.question ?? item.label}</h2>
            <p className="m-0 mt-2 text-sm text-[var(--color-text-muted)]">Sólo se detiene el trabajo que depende de {item.affectedNodeIds.join(", ") || "esta decisión"}; el resto puede continuar.</p>
          </div>
          {item.options !== undefined && item.options.length > 0 ? (
            <fieldset className="space-y-2"><legend className="mb-2 text-label font-semibold">Elegí una opción</legend>{item.options.map((option, index) => <label key={option} className="flex cursor-pointer gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] p-3 text-sm"><input type="radio" name="decision-option" value={item.optionValues?.[index] ?? option} checked={choiceIndex === index} onChange={() => setChoiceIndex(index)} />{option}</label>)}</fieldset>
          ) : null}
          {error !== null ? <p role="alert" className="m-0 text-sm text-[var(--status-failed-fg)]">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancelar</Button><Button type="submit" busy={busy} busyLabel="Guardando">Confirmar</Button></div>
        </form>
      </dialog>
    </>
  );
}
