"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitCompareArrows, LoaderCircle } from "lucide-react";

import type { RunModel, RunEvent } from "@/lib/run-model/types";
import { AccessibleDialog } from "./accessible-dialog";
import { affectedSubgraphNodeIds } from "./cockpit-state";
import { loadCandidateDiffComparison, type CandidateDiffComparison } from "./decision-diff.actions";
import { SideBySideDiffViewer } from "./SideBySideDiffViewer";

type Decision = NonNullable<RunModel["projection"]>["decisions"][string];

/**
 * What the operator can actually do about a blocker.
 *
 * A blocked node never ran, so the failure is not in a candidate to inspect but
 * in the contract or the repository. Naming the remedy is the difference
 * between a dialog that informs and one that only restates the error.
 */
const BLOCKER_REMEDY: Record<string, string> = {
  capability_missing:
    "El repositorio no declara ese comando, así que no hay nada que ejecutar. Necesita un manifiesto con ese script antes de que este nodo pueda validarse.",
  evidence_missing:
    "El plan no dijo con qué comando se prueba esta obligación. Hay que enmendar el plan para que la declare.",
  shared_evidence_invalid:
    "La evidencia compartida no coincide con todas las obligaciones que cubre. Hay que enmendar el plan para que sea idéntica en cada una."
};

export function DecisionQueueDrawer({
  decisions,
  model,
  activeDecisionId,
  busy,
  onOpen,
  onClose,
  onResolve
}: {
  decisions: readonly Decision[];
  model: RunModel;
  activeDecisionId: string | null;
  busy: boolean;
  onOpen: (decisionId: string) => void;
  onClose: () => void;
  onResolve: (optionId: string) => void;
}): React.ReactElement | null {
  const active = decisions.find((decision) => decision.id === activeDecisionId) ?? null;
  if (decisions.length === 0) return null;

  return (
    <>
      <aside aria-label="Cola de decisiones" className="pointer-events-none fixed right-4 top-20 z-40 w-[min(360px,calc(100vw-2rem))]">
        <div className="pointer-events-auto max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-[var(--status-review-border)] bg-[var(--color-surface)]/95 p-3 shadow-xl backdrop-blur motion-reduce:backdrop-blur-none">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <span className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--status-review-fg)]">Decision queue</span>
            <span className="rounded-full bg-[var(--status-review-bg)] px-2 py-0.5 text-micro font-bold tabular-nums text-[var(--status-review-fg)]">{decisions.length}</span>
          </div>
          <div className="grid gap-2">
            {decisions.map((decision) => {
              const blocked = affectedSubgraphNodeIds(model.nodes, decision.affectedNodeIds);
              const independent = model.nodes.filter((node) => !blocked.has(node.id)).length;
              return (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => onOpen(decision.id)}
                  className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-left hover:border-[var(--status-review-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--status-review-fg)]"
                >
                  <span className="flex items-start gap-2">
                    <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-review-fg)]" />
                    <span className="min-w-0">
                      <strong className="line-clamp-2 text-xs leading-5 text-[var(--color-text)]">{decision.question}</strong>
                      <span className="mt-1 block text-micro text-[var(--color-text-muted)]">
                        {blocked.size} nodo{blocked.size === 1 ? "" : "s"} en pausa · {independent} independiente{independent === 1 ? "" : "s"} continúan
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {active !== null ? (
        <DecisionDialog
          decision={active}
          model={model}
          busy={busy}
          onClose={onClose}
          onResolve={onResolve}
        />
      ) : null}
    </>
  );
}

function DecisionDialog({
  decision,
  model,
  busy,
  onClose,
  onResolve
}: {
  decision: Decision;
  model: RunModel;
  busy: boolean;
  onClose: () => void;
  onResolve: (optionId: string) => void;
}): React.ReactElement {
  const blocked = affectedSubgraphNodeIds(model.nodes, decision.affectedNodeIds);
  const blockers = decision.blockers ?? [];
  const affectedNames = [...blocked].map((nodeId) => model.nodes.find((node) => node.id === nodeId)?.title ?? nodeId);
  const fallbackComparison = useMemo(
    () => candidateComparison(model.events, decision.affectedNodeIds),
    [decision.affectedNodeIds, model.events]
  );
  const [comparison, setComparison] = useState<CandidateDiffComparison>(fallbackComparison);
  const [loadingDiff, setLoadingDiff] = useState(fallbackComparison.candidateCommit !== null);

  useEffect(() => {
    let current = true;
    setComparison(fallbackComparison);
    if (fallbackComparison.candidateCommit === null) {
      setLoadingDiff(false);
      return () => { current = false; };
    }
    setLoadingDiff(true);
    void loadCandidateDiffComparison(model.run.id, decision.affectedNodeIds)
      .then((loaded) => {
        if (current && loaded !== null) setComparison(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (current) setLoadingDiff(false);
      });
    return () => { current = false; };
  }, [decision.affectedNodeIds, fallbackComparison, model.run.id]);

  return (
    <AccessibleDialog
      open
      onClose={onClose}
      title="Revisar decisión del agente"
      description="El grafo permanece visible detrás del diálogo y las ramas independientes continúan ejecutándose."
    >
      <div className="grid gap-5">
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
          <div>
            <span className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--status-review-fg)]">Pregunta</span>
            <p className="mt-1 text-sm font-semibold leading-6 text-[var(--color-text)]">{decision.question}</p>
            {decision.evidenceRefs.length > 0 ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">Evidencia: {decision.evidenceRefs.join(" · ")}</p>
            ) : null}
          </div>
          <div className="rounded-xl border border-[var(--status-review-border)] bg-[var(--status-review-bg)] p-3 text-xs">
            <strong className="block text-[var(--status-review-fg)]">{affectedNames.length} nodo{affectedNames.length === 1 ? "" : "s"} en pausa local</strong>
            <p className="mt-1 leading-5 text-[var(--color-text-muted)]">{affectedNames.join(", ")}</p>
          </div>
        </section>

        {blockers.length > 0 ? (
          <section className="rounded-xl border border-[var(--status-blocked-border,var(--color-border))] bg-[var(--color-bg-subtle)] p-3">
            <h3 className="text-xs font-semibold text-[var(--color-text)]">Por qué no puede empezar</h3>
            <p className="mt-1 text-micro leading-5 text-[var(--color-text-muted)]">
              El nodo no llegó a ejecutarse, así que no hay intento que repetir: esta comprobación lee el contrato y el
              repositorio, y volver a correrla da el mismo resultado.
            </p>
            <ul className="mt-2 grid gap-2">
              {blockers.map((blocker) => (
                <li key={blocker.obligationId} className="rounded-lg border border-[var(--color-border)] p-3">
                  <code className="text-micro text-[var(--color-text-subtle)]">{blocker.obligationId}</code>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text)]">{blocker.detail}</p>
                  <p className="mt-1 text-micro leading-5 text-[var(--color-text-muted)]">
                    {BLOCKER_REMEDY[blocker.cause] ?? "Hay que enmendar el plan."}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div hidden={blockers.length > 0}>
          <div className="mb-2 flex items-center gap-2">
            <GitCompareArrows aria-hidden className="h-4 w-4 text-[var(--color-accent)]" />
            <h3 className="text-xs font-semibold">Diff del candidato propuesto</h3>
            {loadingDiff ? <LoaderCircle aria-label="Cargando diff exacto" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          </div>
          <SideBySideDiffViewer before={comparison.before} after={comparison.after} />
          {comparison.exact ? null : (
            <p className="mt-2 text-micro text-[var(--color-text-subtle)]">
              El journal conserva el commit y los archivos cambiados, pero no contiene hunks de texto; se muestra la comparación verificable disponible.
            </p>
          )}
        </div>

        <fieldset disabled={busy || loadingDiff}>
          <legend className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--color-text-subtle)]">Elegí una acción</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {decision.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onResolve(option.id)}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-raised)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <strong className="block text-xs">{option.label}</strong>
                {option.description === undefined ? null : <span className="mt-1 block text-micro leading-5 text-[var(--color-text-muted)]">{option.description}</span>}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </AccessibleDialog>
  );
}

function candidateComparison(events: readonly RunEvent[], affectedNodeIds: readonly string[]): {
  before: { label: string; content: string };
  after: { label: string; content: string };
  exact: boolean;
  candidateCommit: string | null;
} {
  const event = [...events].reverse().find((candidate) => (
    candidate.type === "attempt.candidate_created" &&
    typeof candidate.payload.nodeId === "string" &&
    affectedNodeIds.includes(candidate.payload.nodeId)
  ));
  const payload = event?.payload;
  const beforeText = typeof payload?.before === "string" ? payload.before : undefined;
  const afterText = typeof payload?.after === "string" ? payload.after : undefined;
  const commit = typeof payload?.candidateCommit === "string" ? payload.candidateCommit : "sin candidato asociado";
  const files = Array.isArray(payload?.changedFiles)
    ? payload.changedFiles.filter((file): file is string => typeof file === "string")
    : [];
  return {
    before: {
      label: "Base",
      content: beforeText ?? ["// Base declarada por el intento", ...files.map((file) => `- ${file}`)].join("\n")
    },
    after: {
      label: `Candidate ${commit.slice(0, 12)}`,
      content: afterText ?? [`// Candidate ${commit}`, ...files.map((file) => `+ ${file}`), ...(files.length === 0 ? ["// Sin archivos de diff registrados"] : [])].join("\n")
    },
    exact: beforeText !== undefined && afterText !== undefined,
    candidateCommit: typeof payload?.candidateCommit === "string" ? payload.candidateCommit : null
  };
}
