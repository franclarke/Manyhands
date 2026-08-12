# @manyhands/task-graph

Modelo versionado del grafo ejecutable de ManyHands.

El target conserva jerarquía de integración, `ArtifactRequirement` y
`SeamBinding`, y reemplaza conflictos pairwise por `ResourceClaim`. Un
`GraphRevision` es la compilación directa de un `SemanticPlan`; no es el control
flow interno del orquestador.

Fuente normativa: [Graph Revision y Resource Claims](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#85-executable-graph-revision).
