# Snapshot de evidencia de granularidad

Este directorio preserva los inputs y el harness de regresión usados para
razonar sobre la política de granularidad adaptativa. Es un snapshot de datos y
de instrumentación; por sí solo no es un resultado experimental ni acredita un
`PASS` del sistema completo.

## Dos cortes temporales que no deben mezclarse

La tesis analiza un snapshot histórico de **83 cortes**. Esa cifra describe el
corpus disponible cuando se redactó el análisis y debe conservarse como dato
histórico en el [capítulo de granularidad](../../chapters/04-granularidad-adaptativa.tex).

El archivo que se preserva aquí es un snapshot posterior y contiene:

- `granularity-corpus.json`: **87 casos** de planner output registrados contra
  snapshots reales de repositorio;
- `granularity-bank-baseline.json`: **573 decisiones** congeladas a nivel de
  unidad para esos casos replayables.

Las 573 filas no son 573 experimentos ni 573 casos: un candidate tree puede
producir decisiones para varias unidades. Por eso tampoco corresponde reemplazar
automáticamente el “83” histórico de la tesis por “87”.

## Qué conserva cada archivo

`granularity-corpus.json` contiene los datos que consume
`selectGranularityStrategy`: condition, `WorkBreakdown` y
`RepositorySnapshot`. Deliberadamente no conserva outcomes, assessments ni
veredictos del sistema que generó esos inputs; esos runs todavía no estaban
gobernados por la política y no serían evidencia válida sobre ella.

`granularity-bank-baseline.json` congela la salida reducida de la política por
`caseId` y `unitKey`: selección, factibilidad y las razones categóricas
`doesNotFit`, `runsInParallel` y `verifiableApart`. Su función es volver
revisable cualquier cambio posterior mediante un diff explícito.

## Harness archivado

`harness/` copia los archivos que daban semántica y verificabilidad al banco:

| Archivo archivado | Ubicación original en el repositorio completo |
|---|---|
| `granularity-corpus.ts` | `tests/helpers/granularity-corpus.ts` |
| `granularity-regression-bank.test.ts` | `tests/granularity-regression-bank.test.ts` |
| `granularity-policy.test.ts` | `tests/granularity-policy.test.ts` |
| `granularity-mapping.test.ts` | `tests/granularity-mapping.test.ts` |
| `granularity-selection-governs.test.ts` | `tests/granularity-selection-governs.test.ts` |

Para ejecutar el harness se necesita el checkout fuente completo, sus workspace
packages y las fixtures restauradas bajo `tests/fixtures/`; esta copia se
conserva principalmente para lectura y trazabilidad desde un entorno local de
solo documentación.

El test del banco exige al menos 80 casos, alcanza un veredicto sobre la raíz de
cada caso sin inventar units y compara exactamente las decisiones reconstruidas
con las 573 filas congeladas. Regenerar el baseline requiere revisar el diff; no
debe usarse `UPDATE_GRANULARITY_BANK=1` solo para hacer pasar un cambio.

