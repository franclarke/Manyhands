# @manyhands/conflict-risk

> Predice el riesgo de conflicto entre pares de tareas **antes** de ejecutarlas, para informar al scheduler.

## Rol en el pipeline

Señal de scheduling (grounding). Es lo que permite al `scheduler` paralelizar con criterio en vez de a ciegas.

## Conceptos clave

- **`predictConflict` / `buildTaskPairRiskMatrix`.** Combina evidencia entre dos contratos — solapamiento de archivos, de paths, de símbolos; relación *producer-consumer*; paths críticos; fixtures de test compartidos — en un score que se mapea a `low` / `medium` / `high` / `blocking`.
- **Señales estáticas v0.** `buildStaticConflictSignals` deriva señales del `repository-index` (mismo archivo de símbolos declarados, producer-consumer real, schema compartido, solapamiento de API pública). Ver `ADR-0008`.
- **Recomendación accionable.** Cada predicción sugiere `run_parallel`, `serialize`, `add_dependency` o `requires_human_review`.

## API pública

`buildTaskPairRiskMatrix` · `predictConflict` · `buildStaticConflictSignals` · `findRiskPrediction` · `ConflictPrediction`

## Dependencias

`@manyhands/contracts`, `@manyhands/repository-index`, `@manyhands/shared`.
