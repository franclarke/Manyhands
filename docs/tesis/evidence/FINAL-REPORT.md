# Informe final de evidencia — etapa 12

Fecha: 2026-08-02.

## Estado

Las etapas 0 a 12 del plan quedan documentadas en
[STAGE-LEDGER.md](g6/STAGE-LEDGER.md). No se ejecutó ningún run adicional
después de G6; por lo tanto, este cierre no agrega una observación experimental
ni altera el presupuesto de la serie.

La evidencia consolidada está en
[THESIS-EVIDENCE-DOSSIER.md](THESIS-EVIDENCE-DOSSIER.md). El dossier no es la
tesis y no modifica `main.tex` ni `presentacion.tex`.

## Commits locales relevantes

- `31f0589`: dossier trazable de evidencia para PI-1, PI-2 y PI-3.
- `6b433cb`: fila de etapa 11 en el ledger.
- `8674012`: corrección de tipado fail-safe para el comprobante de takeover,
  manteniendo la guardia de `allDead`.
- El resultado G6 derivado, el veredicto, las reviews independientes y el
  snapshot reproducible están enlazados desde
  [g6/results.md](g6/results.md),
  [g6/verdict.md](g6/verdict.md),
  [g6/stage-10-reviews.md](g6/stage-10-reviews.md) y
  [g6/canonical-runs/manifest.json](g6/canonical-runs/manifest.json).

Todos los commits fueron locales. No se hizo push.

## Gates ejecutados

| Comando | Resultado |
|---|---|
| `pnpm build` | PASS; ejecutado antes de la suite. |
| `pnpm test` | PASS en la repetición ampliada: 224 archivos, 1580 tests, 2 skips. Duración reportada: 154,5 s. |
| `pnpm -r --filter "./packages/*" typecheck` | PASS; 12 paquetes. |
| `pnpm --filter @manyhands/web exec tsc --noEmit` | PASS después de corregir la inferencia de `allDead`. |
| `pnpm web:build` | PASS; compilación Next.js, tipos y generación de 3 páginas estáticas. |
| `pnpm exec vitest run tests/run-operation-authority-atomic.test.ts` | PASS; 1 archivo, 8 tests. |
| `git diff --check` | PASS antes de los commits de esta etapa. |

El primer intento de `pnpm test` agotó 120 s sin salida y fue terminado por el
wrapper; no fue tratado como fallo de aserciones. La repetición con 600 s
terminó correctamente. El typecheck web sí encontró un error real: el
comprobante exigía `allDead: true` pero la propiedad se infería como
`boolean`. La corrección quedó aislada en
[run-operation-lease.ts](../../../apps/web/src/lib/server/runs/run-operation-lease.ts)
y fue verificada por el test de autoridad, el typecheck y el build web.

## Estado de preservación

Los runs, journals, worktrees, pools y artefactos originales permanecen
preservados. El snapshot mínimo comprometido para las seis filas canónicas está
descripto en [canonical-runs/README.md](g6/canonical-runs/README.md) y sus
hashes en [canonical-runs/manifest.json](g6/canonical-runs/manifest.json).
Las carpetas raw no seleccionadas siguen fuera del índice Git por diseño y no
se borraron.

## Pendientes y límites

- G6 termina con veredicto inconcluso: dos repeticiones por condición no
  confirman ni falsan H-G6 ([verdict.md](g6/verdict.md)).
- No hay una serie amplia entregada; la cadena longitudinal Warehouse queda en
  1/8 ([EVIDENCE-BASELINE.md](../EVIDENCE-BASELINE.md)).
- El motivador de 19 hijos no fue re-medido a su propia anchura y
  `retry-12` fue planning-only
  ([retry-12-measure](warehouse/wide-graph/retry-12-measure/README.md)).
- Los parámetros `minimumAdvantage = 0.15` y
  `maxLeafPlannedPaths = 12` siguen provisionales
  ([policy-c-refuses-a-clean-wide-cut](warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md)).
- No se ejecutó una exploración “con menos restricciones”: hacerlo sería un
  experimento distinto y requeriría una decisión y un protocolo separados; no
  se lo presenta como evidencia G6.

## Qué no se concluye

- No se concluye que el sistema entregue confiablemente una serie amplia.
- No se concluye que una condición de G6 sea superior de manera estadísticamente
  significativa.
- No se concluye que los fallos preservados sean éxitos, ceros o evidencia
  atribuible cuando no tienen candidato.
- No se concluye que los parámetros provisionales sean óptimos o generalizables.
