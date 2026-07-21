# LangGraph — uso histórico y boundary actual

## Estado

LangGraph ya no conduce la ruta productiva V2. `@langchain/core` y
`@langchain/langgraph` continúan declarados en `apps/web/package.json`, pero el
árbol actual no contiene imports productivos de esas librerías.

La explicación detallada y la evidencia están en
[`../development/library-usage.md`](../development/library-usage.md#langchain-y-langgraph).

## Qué hacía en la arquitectura anterior

La arquitectura V1 usaba `StateGraph` para encadenar planning y ejecución,
checkpoints para resume y `interrupt()` para gates humanos. Eso distinguía un
control graph interno del `TaskGraph`, pero en la práctica introducía otra
representación mutable del run que debía reconciliarse con `RunRecord` y eventos.

El commit de retiro `c5a4f99` eliminó:

- `graphs/planning-graph.ts`;
- `graphs/execution-graph.ts`;
- `checkpointer.ts`;
- `state.ts`;
- los nodos y tests asociados al control graph legacy.

## Qué lo reemplazó

- [`RunCoordinator`](../../packages/run-coordinator/src/coordinator.ts) valida
  commands, persiste eventos y pliega el lifecycle.
- [`V2ExecutionDriver`](../../packages/orchestrator-graph/src/v2/execution-driver.ts)
  calcula readiness, registra waves y despacha attempts.
- [`JsonlRunEventStore`](../../packages/run-store/src/jsonl-event-store.ts) aporta
  replay, CAS, checksums, idempotencia y fencing.
- Los hosts de [`apps/web/src/lib/server/runs/v2/`](../../apps/web/src/lib/server/runs/v2/)
  conectan CLIs, filesystem, leases y rutas HTTP.

El resultado es un control plane explícito en TypeScript: el event journal es la
historia durable y ningún checkpoint de framework puede recuperar autoridad.

## Boundary que se conserva

La decisión arquitectónica sigue siendo útil aunque LangGraph ya no esté activo:
un framework de workflow futuro solo puede ser un adapter. No puede:

- definir el lifecycle persistido;
- representar relaciones del `TaskGraph` mediante sus edges internos;
- usar un checkpoint como event log;
- convertir `interrupt()` en la única entidad de decisión;
- importar sus tipos en `run-coordinator`, contratos o UI.

[`run-coordinator-boundaries.test.ts`](../../tests/run-coordinator-boundaries.test.ts)
prohíbe de forma explícita `@langchain/langgraph` dentro del paquete de dominio.

## Deuda residual

Que LangChain/LangGraph sigan en el manifest web no es evidencia de uso. Mientras
no exista un adapter productivo y sus tests, deben considerarse dependencias
residuales candidatas a eliminación, no una capacidad actual de ManyHands.
