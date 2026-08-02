# Informe final de evidencia G6 — etapa 12

Fecha: 2026-08-02.

## Estado de las etapas

El ledger [STAGE-LEDGER.md](STAGE-LEDGER.md) registra las etapas 0 a 12. El
dossier consolidado está en [THESIS-EVIDENCE-DOSSIER.md](../THESIS-EVIDENCE-DOSSIER.md).
Este informe y el dossier son evidencia, no manuscrito: no modifican
`main.tex` ni `presentacion.tex`.

| Etapa | Estado | Evidencia |
|---:|---|---|
| 0 | PASS: Codex headless, selección barata `codex-cli/gpt-5.4-mini/low`, mutación autenticada 201. | [stage-0-executor-preflight.md](stage-0-executor-preflight.md) |
| 1 | PASS: G6 re-congelado con seis celdas, clones y hashes verificados. | [stage-1-refreeze.md](stage-1-refreeze.md) |
| 2 | PASS: `low` fue preservado como pre-candidate; una sola escalada a `medium` produjo candidato 9/10 y superó el piso. | [stage-2-capability-floor.md](stage-2-capability-floor.md) |
| 3 | PASS operacional: C-r1 remediada, entregó 7/10; fallos adversos preservados. | [stage-3-remediation.md](stage-3-remediation.md) |
| 4 | PASS operacional: B-r1 entregó 9/10; fallo genuino preservado. | [stage-4-cell-g6-03-T1-B-r1.md](stage-4-cell-g6-03-T1-B-r1.md) |
| 5 | PASS operacional: C-r2 entregó 9/10; fallo genuino preservado. | [stage-5-cell-g6-04-T1-C-r2.md](stage-5-cell-g6-04-T1-C-r2.md) |
| 6 | PASS operacional: A-r2 entregó 9/10; fallo genuino preservado. | [stage-6-cell-g6-05-T1-A-r2.md](stage-6-cell-g6-05-T1-A-r2.md) |
| 7 | PASS operacional: B-r2 entregó 8/10; typecheck/build adversos preservados. | [stage-7-cell-g6-06-T1-B-r2.md](stage-7-cell-g6-06-T1-B-r2.md) |
| 8 | PASS: resultados derivados reproduciblemente para las seis filas canónicas. | [results.md](results.md) |
| 9 | PASS: veredicto inconcluso según el falsador pre-registrado. | [verdict.md](verdict.md) |
| 10 | PASS técnico: reviews independientes, fixes fail-closed y snapshot reproducible. | [stage-10-reviews.md](stage-10-reviews.md) |
| 11 | PASS: dossier con índice, límites y sección final obligatoria. | [THESIS-EVIDENCE-DOSSIER.md](../THESIS-EVIDENCE-DOSSIER.md) |
| 12 | PASS: gates finales y este informe. | Este archivo. |

## Runs canónicos: ejecutor, SHAs y receipts

Las seis filas fueron ejecutadas con `codex-cli/gpt-5.4-mini/medium` después del
piso de capacidad. Todas parten de
`5da60192cc788032c59c7e7be27696ca0e0a30d7`. Los SHAs, IDs y receipts salen de
los `cell.json`, `run.json` y `result.json` preservados en
[canonical-runs](canonical-runs/); los puntajes salen de [results.md](results.md).

| Celda | Run ID | SHA final | Receipt confirmado | Resultado |
|---|---|---|---|---:|
| g6-01-T1-A-r1 | `ce677946-dee3-494d-af62-20baecbd267f` | `3d6cdb15964891ee512817217d7cdabf254a6933` | `delivery:ce677946-dee3-494d-af62-20baecbd267f:delivery` | 9/10 |
| g6-02-T1-C-r1 | `e6442dc5-c1e7-429d-8f6b-b913c06c8ed2` | `0447b738edce84aea923dde723169259e4239538` | `delivery:e6442dc5-c1e7-429d-8f6b-b913c06c8ed2:delivery` | 7/10 |
| g6-03-T1-B-r1 | `c7e47c17-c57d-41c4-a4a2-0e65857c929e` | `4fd86c11b2541460411b8708f8eaa05eb6337d2b` | `delivery:c7e47c17-c57d-41c4-a4a2-0e65857c929e:delivery` | 9/10 |
| g6-04-T1-C-r2 | `a0f0edba-94e7-4fd7-9405-df62f9be7eda` | `a41b4babfaef5d45073ed577af1b27860eb6b615` | `delivery:a0f0edba-94e7-4fd7-9405-df62f9be7eda:delivery` | 9/10 |
| g6-05-T1-A-r2 | `d2baaa3f-6775-4b1f-a884-33893602e86a` | `a8831b8c1160bd1ce6854be8c7eda3c91791338f` | `delivery:d2baaa3f-6775-4b1f-a884-33893602e86a:delivery` | 9/10 |
| g6-06-T1-B-r2 | `d13ef9ff-0c56-4d5f-b4a8-4656e57bb951` | `f53cced0213ca57514dc4863189a7d47ba387168` | `delivery:d13ef9ff-0c56-4d5f-b4a8-4656e57bb951:delivery` | 8/10 |

La procedencia y los hashes de los archivos seleccionados están en
[canonical-runs/manifest.json](canonical-runs/manifest.json). Los runs raw de
remediación se preservan completos en [runs](runs/), incluidos los fallos
pre-candidate y los intentos descartados; no se reinterpretan ni se borran.

## Commits locales y causas raíz

Commits documentales y de corrección relevantes:

- `31f0589`: dossier de evidencia.
- `6b433cb`: ledger de etapa 11.
- `8674012`: corrección del estrechamiento de `allDead` en el comprobante de
  takeover, sin relajar la guardia runtime.
- `b8ef4b3`: preservación local de los raw runs G6, incluidos los fallos
  pre-candidate y los patches originales.
- `2c53c0f`: primer informe de gates finales.
- `380354e`: ledger de etapa 12.

Las reviews y los fixes fail-closed están descritos en
[stage-10-reviews.md](stage-10-reviews.md). Las causas de los fallos de hoja,
incluidos pool de worktrees, timeouts, errores de ejecutor, defecto de producto
y violación de alcance, están derivadas en
[leaf-outcomes/summary.json](../leaf-outcomes/summary.json).

## Gates finales

Los cinco comandos se ejecutaron en este orden, con build antes de test:

| Comando | Resultado |
|---|---|
| `pnpm build` | PASS |
| `pnpm test` | PASS: 224 archivos, 1580 tests, 2 skips |
| `pnpm -r --filter "./packages/*" typecheck` | PASS: 12 paquetes |
| `pnpm --filter @manyhands/web exec tsc --noEmit` | PASS después del fix de `allDead` |
| `pnpm web:build` | PASS: compilación Next.js y generación estática |
| `git diff --check` | PASS |

El primer intento de la suite agotó 120 s sin salida; se diagnosticó como ventana
insuficiente y se repitió con 600 s, terminando PASS. El typecheck web encontró
un error real de contrato de tipos, corregido y probado en
[run-operation-lease.ts](../../../../apps/web/src/lib/server/runs/run-operation-lease.ts).
No hubo push.

## Limitaciones

- G6 tiene dos repeticiones por condición y queda inconcluso; no hay inferencia
  estadística ni tercera repetición ([verdict.md](verdict.md)).
- No existe una serie ancha entregada; la cadena Warehouse queda en 1/8
  ([EVIDENCE-BASELINE.md](../../EVIDENCE-BASELINE.md)).
- El motivador de 19 hijos no fue re-medido a su propia anchura y `retry-12`
  fue planning-only ([retry-12-measure](../warehouse/wide-graph/retry-12-measure/README.md)).
- Los parámetros `minimumAdvantage = 0.15` y
  `maxLeafPlannedPaths = 12` siguen provisionales
  ([policy-c-refuses-a-clean-wide-cut](../warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md)).
- No se ejecutó una exploración con menos restricciones: sería otro protocolo y
  no evidencia G6.

## Qué no se concluye

- No se concluye que ManyHands entregue confiablemente una serie amplia.
- No se concluye que A, B o C sea superior de manera estadísticamente
  significativa.
- No se concluye que los fallos pre-candidate sean ceros ni que los resultados
  adversos sean éxitos.
- No se concluye que los parámetros provisionales sean óptimos o generalizables.
