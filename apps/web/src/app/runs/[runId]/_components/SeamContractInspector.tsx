"use client";

import type { TaskContractBundle } from "@manyhands/contracts";

import type { GraphRelationView } from "@/lib/run-model/presentation";
import { relationDisplayName } from "./cockpit-state";
import { AccessibleDialog } from "./accessible-dialog";

export function SeamContractInspector({
  relation,
  contracts,
  sourceTitle,
  targetTitle,
  open,
  onClose
}: {
  relation: GraphRelationView;
  contracts: readonly TaskContractBundle[];
  sourceTitle: string;
  targetTitle: string;
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const seamContracts = relation.details
    .filter((detail) => detail.kind === "contract")
    .flatMap((detail) => contracts.flatMap((bundle) => bundle.seams.filter((seam) => seam.id === detail.contractId)));

  return (
    <AccessibleDialog
      open={open}
      onClose={onClose}
      title={`${relationDisplayName(relation.kind)} · ${sourceTitle} → ${targetTitle}`}
      description="Contrato persistido y revisiones observadas en esta relación."
      widthClass="max-w-3xl"
    >
      <div className="grid gap-4">
        {relation.details.map((detail) => {
          if (detail.kind === "artifact") {
            return (
              <ContractCard key={detail.id} title={`${detail.contractId}@${detail.contractRevision}`}>
                <Detail label="Tipo" value="ArtifactRequirement" />
                <Detail label="Obligación" value={`Requerido para ${detail.requiredFor}.`} />
              </ContractCard>
            );
          }
          if (detail.kind === "conflict") {
            return (
              <ContractCard key={detail.id} title={detail.id}>
                <Detail label="Tipo" value="ConflictConstraint" />
                <Detail label="Motivo" value={detail.reason} />
                <Detail label="Riesgo" value={detail.risk} />
              </ContractCard>
            );
          }
          const seams = seamContracts.filter((seam) => seam.id === detail.contractId);
          return (
            <ContractCard key={detail.id} title={`${detail.contractId}@${detail.contractRevision}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Revisión exportada" value={detail.producerRevision} />
                <Detail label="Revisión importada" value={detail.consumerRevision} />
              </div>
              {seams.length > 0 ? seams.map((seam) => (
                <div key={`${seam.id}:${seam.revision}`} className="mt-3 rounded-lg bg-slate-950 p-3 text-slate-100">
                  <span className="text-micro font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Seam {seam.kind} · compatibilidad {seam.compatibility.mode}
                  </span>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <SignatureBlock label="Firma exportada" revision={detail.producerRevision} specification={seam.specification} />
                    <SignatureBlock label="Firma importada" revision={detail.consumerRevision} specification={seam.specification} />
                  </div>
                  {Object.keys(seam.semanticFacts).length > 0 ? (
                    <dl className="mt-3 grid gap-1 border-t border-slate-700 pt-3 text-micro">
                      {Object.entries(seam.semanticFacts).map(([name, value]) => (
                        <div key={name} className="grid grid-cols-[minmax(7rem,0.35fr)_1fr] gap-2">
                          <dt className="text-slate-400">{name}</dt><dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              )) : (
                <p className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
                  La revisión está declarada en el grafo; la firma no está incluida en los bundles cargados.
                </p>
              )}
            </ContractCard>
          );
        })}
      </div>
    </AccessibleDialog>
  );
}

function ContractCard({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4"><h3 className="font-mono text-xs font-semibold">{title}</h3><div className="mt-3">{children}</div></article>;
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  return <div><span className="text-micro font-semibold uppercase tracking-[0.1em] text-[var(--color-text-subtle)]">{label}</span><p className="mt-1 text-xs text-[var(--color-text)]">{value}</p></div>;
}

function SignatureBlock({ label, revision, specification }: { label: string; revision: string; specification: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
      <span className="text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">{label} · {revision}</span>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">{specification}</pre>
    </div>
  );
}
