# @manyhands/repository-index

Indexación exacta de repositorios TypeScript/JavaScript, cacheada por identidad
Git y perfil de schema.

El target agrega un `RepositoryModel` con imports, exports, tests, interfaces,
resources, coverage y una consulta budgeted. El planner no debe recibir un dump
del índice completo ni convertir ausencia de datos en bajo riesgo.

Fuente normativa: [Repository Model y Stage 4](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#91-repository-model).
