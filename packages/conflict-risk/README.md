# @manyhands/conflict-risk

Implementación transicional de predicción pairwise de conflictos.

El rediseño reemplaza la matriz pairwise como producto por `ResourceClaim`
indexado por recurso. Hoy este package sigue siendo una dependencia productiva
legacy: sus constraints pueden diferir candidatos en `wave-selector-v2`, y lo
consumen scheduler, orchestrator, execution-core y web. Stage 6 retira esa
autoridad efectiva de selección; Stage 11 elimina el package cuando las pruebas
de reachability demuestren que no quedan callers productivos.

Fuente normativa: [rediseño correctness-first](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#95-taskgraph-and-resource-claims).
