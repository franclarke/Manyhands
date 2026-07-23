# @manyhands/run-store

Adapter durable del event log canónico de RunCoordinator.

## Estado

Los eventos de dominio V2 son la fuente de verdad. Los snapshots son una cache
descartable que se valida contra el último evento y se reconstruye por fold.
No existe una segunda representación productiva del estado del run.

## Dirección objetivo

`run-store` ofrece:

- append de eventos de dominio ordenados e idempotentes;
- snapshots materializados con cursor y schema version;
- CAS por secuencia esperada e idempotencia por `eventId`;
- fencing durable para todo append y snapshot;
- recuperación de una línea JSONL final incompleta y rechazo explícito de
  corrupción intermedia;
- importación V1 explícita y auditada, sin inventar eventos silenciosamente.

Artifacts y attempts se persisten como registros inmutables e idempotentes. Los
leases de repositorio siguen siendo responsabilidad del adapter de Git, no de
este paquete.

Las trazas diagnósticas permanecen en `trace-store`. Los checkpoints del motor no
sustituyen el event log.

API V2: `JsonlRunEventStore`, `RunSnapshotStore`,
`LegacyRunRecordImporter` y errores de CAS/fencing/corrupción.

La API durable también expone `EventStoreCompactor`,
`verifyAndRecoverRunStore`, `JsonlAttemptStore`, `atomicWriteFile` y
`atomicWriteJson`. Los reemplazos fuerzan el temporal a disco, renombran con
backoff exponencial y jitter, limpian residuos y sincronizan el directorio
cuando la plataforma lo permite. El log activo usa append continuo y cada
generación compactada se publica con un manifest atómico y checksummed antes de
rotar el tail.

La recuperación elimina exclusivamente una línea final incompleta, rechaza
corrupción intermedia y reconstruye la proyección desde la última generación
válida más su tail activo.

Contrato objetivo: [`docs/system/04-run-executor.md`](../../docs/system/04-run-executor.md).
