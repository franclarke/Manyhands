# `g6-02-T1-C-r1` — remediation-2 harness incident

Fecha: 2026-08-01

El planning válido de esta remediación está preservado por separado en
`../g6-02-T1-C-r1-remediation-2-planning/` y terminó en `needs_approval`.

El lanzamiento full no llegó a producir artefactos de salida porque se usó
accidentalmente el runtime vecino `C:\Users\franc\Documents\manyhands-g6-runtime`
en lugar del runtime autorizado bajo `Documents\Proyectos`. Se preservan en el
journal los dos POST resultantes: `76602e45-2548-4142-90b5-6dd270b97eaa` quedó
huérfano en planning y `48926ab9-85f2-40d3-a187-6ef7899fbf0d` fue rechazado por
`RepoLeaseLostError` al competir por el lease. No hubo candidate.

El fix del driver para este problema es `resolveRunsDir`, cubierto por
`run-experiment-paths.test.mjs`: `MANYHANDS_RUNS_DIR` tiene precedencia sobre un
`runsDir` congelado obsoleto.

## Qué no se concluye

- Estos POST no son resultados comparativos de C.
- No se cuentan como cobertura externa ni como un reintento exitoso.
- No se borran ni se reutilizan sus journals.
