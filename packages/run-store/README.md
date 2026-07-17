# @manyhands/run-store

Adapter durable del event log canónico de RunCoordinator.

## Estado

Los eventos de dominio V2 son la fuente de verdad. Los snapshots son una cache
descartable que se valida contra el último evento y se reconstruye por fold. La
superficie histórica `RunSnapshot` vive temporalmente en `@manyhands/core`, el
contenedor legacy, hasta su retiro en WP-18.

## Dirección objetivo

`run-store` ofrece:

- append de eventos de dominio ordenados e idempotentes;
- snapshots materializados con cursor y schema version;
- CAS por secuencia esperada e idempotencia por `eventId`;
- fencing durable para todo append y snapshot;
- recuperación de una línea JSONL final incompleta y rechazo explícito de
  corrupción intermedia;
- importación V1 explícita y auditada, sin inventar eventos silenciosamente.

Artifacts y attempts se incorporan en WP-09. Los leases de repositorio siguen
siendo responsabilidad del adapter de Git, no de este paquete.

Las trazas diagnósticas permanecen en `trace-store`. Los checkpoints del motor no
sustituyen el event log.

API V2: `JsonlRunEventStore`, `RunSnapshotStore`,
`LegacyRunRecordImporter` y errores de CAS/fencing/corrupción.

Contrato objetivo: [`docs/system/04-run-executor.md`](../../docs/system/04-run-executor.md).
