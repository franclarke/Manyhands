# @manyhands/task-graph

Modelo actual de `TaskNode`, `TaskGraph`, dependencias, validación y orden
topológico.

## Estado de transición

La implementación actual mantiene `graph.dependencies` y shortcuts en nodos con
semántica principalmente de orden. Ese comportamiento es evidencia del estado
actual, no el contrato objetivo.

## Dirección objetivo

- `parentId` canónico para ownership;
- `ArtifactRequirement` para disponibilidad material;
- `SeamBinding` para compatibilidad;
- `ConflictConstraint` para scheduling;
- graph revisions inmutables;
- children, readiness y blast radius derivados;
- validación de contracts y evidence coverage.

La migración debe evitar mantener ambas representaciones indefinidamente. Toda
compatibilidad legacy necesita adapter y fecha/criterio de retiro.

API actual destacada: validación de grafo ejecutable, topological order,
readiness, helpers de dependencias y `graftSubtree`.

Contrato objetivo: [`docs/system/01-task-graph.md`](../../docs/system/01-task-graph.md).
