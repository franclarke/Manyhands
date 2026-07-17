# @manyhands/trace-store

Package actual de trazas de planning y ejecución.

## Boundary objetivo

`trace-store` conserva telemetría diagnóstica: prompts, logs, timings, eventos de
provider y detalles de proceso. No es el event log de dominio y no decide
lifecycle, readiness, success ni estado de UI.

La taxonomía actual incluye eventos legacy y algunos hechos que también aparecen
en el producto. El plan de transición debe clasificar cada tipo como:

- domain event: migrar al Run Event Store;
- diagnostic trace: conservar aquí;
- duplicated/obsolete: retirar.

API actual destacada: `TraceEvent`, `TraceEventType`, `TraceStore` e
`InMemoryTraceStore`.

Contrato objetivo: [`docs/design/run-operative-model.md`](../../docs/design/run-operative-model.md).
