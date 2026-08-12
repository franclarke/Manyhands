# @manyhands/conflict-risk

Implementación transicional de predicción pairwise de conflictos.

El rediseño reemplaza la matriz pairwise como producto por `ResourceClaim`
indexado por recurso. Este package puede aportar evidencia durante la migración,
pero no crea dependencias funcionales ni es una fuente de verdad de scheduling.
Se retira o absorbe cuando Stage 13 demuestre que no tiene callers productivos.

Fuente normativa: [rediseño correctness-first](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#95-taskgraph-and-resource-claims).
