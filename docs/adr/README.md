# Architecture Decision Records

Estos ADR documentan las decisiones que originaron la arquitectura V2 y sus
ajustes posteriores. La migración cerró en julio de 2026; los ADR siguen
explicando el porqué de los contratos vigentes.

Un ADR explica por qué se eligió una dirección. La síntesis vigente está en
[`../DECISIONS.md`](../DECISIONS.md); ante contradicción, se crea un ADR nuevo y
se actualiza la síntesis.

| ADR | Decisión |
|---|---|
| [0001](0001-target-architecture.md) | documentación como target explícito |
| [0002](0002-hybrid-task-graph.md) | grafo híbrido para trabajo agéntico |
| [0003](0003-typed-graph-relations.md) | relaciones tipadas y artifacts |
| [0004](0004-planner-graph-compiler.md) | separar planning y compilación |
| [0005](0005-contracts-and-evidence.md) | obligaciones versionadas y evidencia |
| [0006](0006-event-sourced-run-coordinator.md) | coordinator durable y estado derivado |
| [0007](0007-immutable-attempts-and-integration.md) | intentos exactos e integración bottom-up |
| [0008](0008-local-human-decisions.md) | decisiones humanas locales |
| [0009](0009-framework-and-executor-boundaries.md) | frameworks y executors como adapters |
| [0010](0010-graph-lenses-and-decision-inspector.md) | lentes del grafo e inspector de decisiones |
| [0011](0011-exact-repository-index-and-fenced-worktree-pool.md) | índice exacto y pool de worktrees con fencing |
| [0012](0012-utility-based-granularity-selection.md) | selección adaptativa de granularidad basada en utilidad |
| [0013](0013-policy-guided-candidate-planning.md) | planning guiado por política y candidatos válidos |
