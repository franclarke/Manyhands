# @manyhands/scheduler

> Decide qué tareas pueden correr juntas sin pisarse: selección de waves consciente de scope y riesgo.

## Rol en el pipeline

Scheduling. Entre el plan aprobado y la ejecución: convierte el DAG en una secuencia de **waves** seguras.

## Conceptos clave

- **`selectScopeAwareWave`.** Dado el *frontier* (tareas con dependencias ya resueltas), elige el subconjunto que es seguro correr en paralelo: nunca coagenda pares de riesgo `high`/`blocking`, y serializa tareas cuyos scopes de archivos (globs de `executionScope`) se solapan. Sin scope declarado = paralelismo libre (D9), pero respetando la matriz de riesgo.
- **`scheduleTasks` + políticas.** `sequential_dag`, `parallel_naive` y `risk_aware`.
- **`applyHumanGateToSchedule`.** Aplica gates humanos deterministas sobre conflictos `high`/`blocking` (serializa o pide revisión).

## API pública

`selectScopeAwareWave` · `scheduleTasks` · `applyHumanGateToSchedule` · `SchedulingPolicy` · `ExecutionBatch` · `SchedulerPlan`

## Dependencias

`@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/task-graph`.
