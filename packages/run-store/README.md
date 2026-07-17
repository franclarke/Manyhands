# @manyhands/run-store

Package actual de snapshots JSON de run.

## Estado

`RunSnapshot` conserva una representación histórica con campos de etapas
anteriores. No debe asumirse como modelo objetivo ni como fuente única del run.

## Dirección objetivo

`run-store` debe ofrecer:

- append de eventos de dominio ordenados e idempotentes;
- snapshots materializados con cursor y schema version;
- graph revisions y approvals;
- operation/repository leases con fencing;
- referencias a artifacts, evidence y delivery receipts;
- replay y recovery deterministas.

Las trazas diagnósticas permanecen en `trace-store`. Los checkpoints del motor no
sustituyen el event log.

API actual: `JsonRunStore`, `RunSnapshot`, hashes de snapshots.

Contrato objetivo: [`docs/system/04-run-executor.md`](../../docs/system/04-run-executor.md).
