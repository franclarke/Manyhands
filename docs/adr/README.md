# Architecture Decision Records

Estos ADR documentan decisiones de la arquitectura objetivo definida en julio de
2026. Reemplazan la serie histórica anterior, que describía prototipos, Lab Mode,
benchmarks, migraciones de executor y restricciones que ya no son normativas.

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
