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

`JsonlTraceStore` persiste envelopes checksummed en
`.manyhands/runs/<runId>/traces.jsonl`, fuerza cada append a disco y redacta
tokens, passwords, claves, cookies, headers Bearer y credenciales embebidas
antes de serializar. Una nueva instancia sobre el mismo run recupera las trazas
sin depender de memoria de proceso.

Contrato objetivo: [`docs/design/run-operative-model.md`](../../docs/design/run-operative-model.md).
