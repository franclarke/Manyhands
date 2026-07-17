import type { ResultReadiness } from "@/lib/run-model/selectors";

export function EvidenceMatrixPanel({ result }: { result: ResultReadiness }): React.ReactElement | null {
  if (result.matrix === null) return null;
  return (
    <section aria-label="Evidencia del resultado" className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
      <div className="flex items-start justify-between gap-4"><div><p className="m-0 text-eyebrow uppercase tracking-wide text-[var(--color-text-subtle)]">Resultado verificable</p><h2 className="m-0 mt-1 text-sm font-semibold">Qué está demostrado y qué falta</h2></div><span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-meta">{result.matrix.outcome === "verified" ? "Listo para entregar" : "Entrega bloqueada"}</span></div>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">{result.matrix.criteria.map((criterion) => <li key={criterion.criterionId} className="rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"><div className="flex items-center justify-between gap-2"><strong className="text-label">{criterion.criterionId}</strong><span className="text-meta uppercase text-[var(--color-text-subtle)]">{criterion.status}</span></div><p className="m-0 mt-1 text-meta text-[var(--color-text-muted)]">{criterion.justification}</p></li>)}</ul>
      {!result.deliveryAllowed ? <p role="status" className="m-0 mt-3 text-sm text-[var(--status-blocked-fg)]">No se puede aprobar la entrega hasta cubrir los criterios faltantes o resolver la evidencia fallida.</p> : null}
    </section>
  );
}
