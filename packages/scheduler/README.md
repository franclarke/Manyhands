# @manyhands/scheduler

> Decide qué tareas pueden correr juntas sin pisarse: selección de waves consciente de scope y riesgo.

## Rol en el pipeline

Scheduling. Entre el plan aprobado y la ejecución: convierte el DAG en una secuencia de **waves** seguras.

## Conceptos clave

- **`selectScopeAwareWave`.** Dado el *frontier* (tareas con dependencias ya resueltas), elige el subconjunto que es seguro correr en paralelo: nunca coagenda pares de riesgo `high`/`blocking`, y serializa tareas cuyos scopes de archivos (globs de `implementationPaths`/`testPaths`) se solapan. Los `configPaths` (manifests compartidos) se excluyen del solape: serializarlos no evita el conflicto de integración (lo resuelve el composer). Sin scope declarado = paralelismo libre (D9), pero respetando la matriz de riesgo.
- **`buildSchedulingSafetyContext`.** Completa contratos/riesgos desde el `TaskGraph`, genera warnings/fallbacks para datos incompletos y degrada de forma conservadora.
- **Seams explícitos.** Un par producer/consumer con el mismo `InterfaceContract` es evidencia de compatibilidad y puede compartir wave si sus superficies físicas son seguras. Firmas incompatibles, símbolos concretos, archivos, imports o scopes solapados conservan riesgo alto.
- **`scheduleTasks` + políticas.** `sequential_dag`, `parallel_naive` y `risk_aware`. El camino productivo usa `risk_aware`; `parallel_naive` solo debe ser explícito.
- **`applyHumanGateToSchedule`.** Aplica gates humanos deterministas sobre conflictos `high`/`blocking` (serializa o pide revisión).
- **`summarizeRiskMatrix`.** Resume niveles de riesgo para eventos de auditoría.

## API pública

`buildSchedulingSafetyContext` · `selectScopeAwareWave` · `summarizeRiskMatrix` · `scheduleTasks` · `applyHumanGateToSchedule` · `SchedulingPolicy` · `ExecutionBatch` · `SchedulerPlan`

## Auditoría

El package no escribe eventos. En la web, `execution-host` persiste
`run.scheduling.wave_selected` como evento required antes de despachar una wave.
En `execution-core`, `RunExecutor.run` emite `batch_scheduled` con policy,
selected/blocked task ids, resumen de riesgo, fallbacks y warnings.

## Dependencias

`@manyhands/conflict-risk`, `@manyhands/contracts`, `@manyhands/task-graph`.
