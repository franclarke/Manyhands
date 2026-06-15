# @manyhands/task-graph

> El modelo de datos del plan: nodos de tarea, dependencias y la validación estructural del DAG.

## Rol en el pipeline

Modelo (planning). Es la estructura que produce el `decomposer` y que consumen el `scheduler`, el `execution-core` y la UI.

## Conceptos clave

- **`TaskNode`.** Una tarea del plan, con `kind` (`root` / `composite` / `leaf` / `integrator`), su `goal` (campo canónico de intención — ver `DECISIONS.md` D2), `status`, `granularity` y, en las hojas, su `AgentTaskContract`.
- **`TaskGraph`.** El DAG completo. `graph.dependencies` es la lista **canónica** de aristas; `node.dependencies` es un shortcut sincronizado (D1). Mutá siempre vía los helpers.
- **Validación estructural.** `validateTaskGraph` detecta ciclos, nodos huérfanos, hojas sin contrato, scope vacío y desincronización de dependencias.
- **`graftSubtree`.** Re-decomposición selectiva: reemplaza el subárbol de un nodo (replan) sin descartar el resto del DAG, re-apuntando las aristas de frontera y validando el resultado.

## API pública

`validateTaskGraph` · `getLeafNodes` · `getTopologicalOrder` · `getReadyLeaves` / `getTaskReadiness` · `aggregateTaskStatus` · `addDependency` / `removeDependency` / `syncNodeDependencies` · `graftSubtree`

## Dependencias

`@manyhands/contracts`, `@manyhands/shared`. **Más:** [`docs/system/01-task-graph.md`](../../docs/system/01-task-graph.md).
