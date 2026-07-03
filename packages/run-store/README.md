# @manyhands/run-store

> Persistencia JSON de snapshots de run.

## Rol en el pipeline

Persistencia.

## Conceptos clave

- **`JsonRunStore`.** Guarda y lee `RunSnapshot` como archivos JSON (por defecto bajo `.manyhands/runs`), con hashes canónicos de input/output para identidad y detección de cambios.
- **`RunSnapshot`.** Una captura completa de un run: feature, grafo, contratos, predicciones de riesgo, batches, resultados de agentes y eventos de traza.

> [!NOTE]
> `RunSnapshot` es la persistencia más **antigua** del sistema (arrastra campos de la era *Lab Mode*, como `deterministic` y `sourceFixture`). El estado **vivo** del producto se persiste vía los **checkpoints JSON de `orchestrator-graph`** y el **event log del `run-model`** en `apps/web`, no vía `RunSnapshot`.

## API pública

`JsonRunStore` · `RunSnapshot` · `withRunSnapshotHashes` · `computeRunSnapshotOutputHash`

## Dependencias

`@manyhands/contracts`, `@manyhands/task-graph`, `@manyhands/decomposer`, `@manyhands/scheduler`, `@manyhands/conflict-risk`, `@manyhands/repository-index`, `@manyhands/trace-store`.
