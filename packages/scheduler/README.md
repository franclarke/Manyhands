# @manyhands/scheduler

Package actual de selección de batches/waves según DAG, scopes y riesgo.

## Dirección objetivo

Readiness se calcula desde graph revision aprobada, ArtifactRequirements,
SeamBindings, decisions, execution base, resource constraints y presupuesto.

`risk_aware` es la política default objetivo. El límite de paralelismo proviene
de configuración efectiva y capacidades; no existe un `maxParallel` universal.

El package produce una `WaveSelection` completa. El host/coordinator la persiste
antes de dispatch. No escribe eventos por sí mismo salvo que el boundary se
rediseñe explícitamente.

La implementación actual de `selectScopeAwareWave`, `scheduleTasks` y safety
context debe auditarse contra artifacts y decisiones locales.

Contrato objetivo: [`docs/system/12-scheduler.md`](../../docs/system/12-scheduler.md).
