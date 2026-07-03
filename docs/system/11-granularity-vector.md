# Run Metrics (`GranularityVector`)

**Archivos fuente:** `packages/execution-core/src/granularity/vector.ts`,
`packages/execution-core/src/types.ts`

---

## Qué Es

`GranularityVector` es el nombre heredado del schema de métricas de un run. El
nombre viene de una etapa anterior orientada a experimentos de granularidad, pero
en el producto actual debe entenderse como **métricas operativas del run**.

No define una estrategia de benchmark ni una metodología de tesis vigente.

## Qué Mide

El vector combina estructura del DAG y resultados de ejecución.

**Estructura**

- `depth`
- `leafCount`
- `compositeCount`
- `avgLeafDepth`
- `maxLeafDepth`
- `dependencyCount`
- `avgAcceptanceCriteriaPerLeaf`
- `estimatedTokensPerLeaf` (opcional)

**Resultados**

- `integrationSuccessRate`
- `leafSuccessRate`
- `conflictRate`
- `totalDurationMs`
- `totalCostUsd` (opcional)
- `testsPassedRate` (opcional)
- `linesChanged`
- `unexpectedCommitCount`
- `scopeViolationCount`

## Cómo Se Computa

`computeGranularityVector()` recibe:

- `TaskGraph`
- `AgentExecutionResult[]`
- `IntegrationResult[]`
- duración total
- métricas opcionales de validación/costo

Deriva tasas con helpers puros y valida el resultado con Zod para evitar valores
fuera de rango o datos malformados.

## Uso Actual

El vector se persiste dentro del resultado de ejecución y la web app lo puede
mostrar como evidencia operativa: duración, éxito de hojas, conflictos,
violaciones de scope, líneas cambiadas y validación.

## Nota Histórica

Antes se lo describía como instrumento central de experimentos de tesis. Esa
interpretación está retirada. Si en el futuro se diseña una evaluación formal,
podrá reutilizar o reemplazar estas métricas, pero no debe asumir que este schema
es suficiente para medir calidad del producto.

