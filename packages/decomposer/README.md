# @manyhands/decomposer

Package transicional de planning y compilación del grafo.

El target es un `PlanningEngine` progresivo que consulta un `RepositoryModel`,
produce un único `SemanticPlan`, lo verifica y lo compila directamente a un
`GraphRevision`. El planner productivo actual basado en cortes de paths y las
proyecciones legacy se reemplazan y retiran en Stages 4–6.

Fuente normativa: [Planning Engine y plan de migración](../../docs/plans/2026-08-12-correctness-first-system-redesign.md#92-planning-engine).
