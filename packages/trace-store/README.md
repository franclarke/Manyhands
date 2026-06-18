# @manyhands/trace-store

> Un log append-only de eventos de traza de planning y ejecución.

## Rol en el pipeline

Trazas / diagnóstico.

## Conceptos clave

- **`TraceEvent`.** Un evento inmutable con `id`, `type`, `timestamp`, `actor` (`system` / `human` / `agent`) y `payload`. Los tipos cubren todo el ciclo: `decomposition_*`, `graph_created`, `risk_predicted`, `agent_run_*`, `cherry_pick_*`, `integration_*`, `run_completed`, …
- **`batch_scheduled`.** En `RunExecutor.run`, registra policy, batches seleccionados, tareas bloqueadas, resumen de riesgo, fallbacks y warnings. En el camino web productivo, la decisión por wave además se persiste como `RunEvent` required (`run.scheduling.wave_selected`) antes del dispatch.
- **`InMemoryTraceStore`.** La implementación base (en memoria); `run-store` la persiste dentro del `RunSnapshot`.

> [!NOTE]
> La taxonomía de eventos incluye algunos **legacy** (p. ej. `mock_worktree_created`) junto a los vigentes de `execution-core` (`worktree_created`, `executor_repair_started`, …).

## API pública

`TraceEvent` · `TraceEventType` · `TraceStore` · `InMemoryTraceStore`

## Dependencias

`@manyhands/shared`.
