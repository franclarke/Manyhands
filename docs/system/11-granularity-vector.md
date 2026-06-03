# GranularityVector

**Archivos fuente:** `packages/execution-core/src/granularity/vector.ts`, `packages/execution-core/src/types.ts`

---

## Qué es

El `GranularityVector` es el vector de métricas que captura dos cosas simultáneamente: la estructura del DAG que el Decomposer produjo (cómo de granular fue la descomposición) y los resultados que la ejecución generó (cómo de bien funcionó esa granularidad). Es el artefacto de medición central de los experimentos de tesis.

---

## Responsabilidad

La pregunta de investigación de la tesis es: ¿a qué nivel de granularidad de descomposición conviene trabajar? Para responderla con evidencia, hay que medir tanto la estructura de la descomposición como el resultado de ejecutarla, y correlacionar ambas dimensiones. El `GranularityVector` es el instrumento que hace esa medición.

---

## Cómo funciona

### Las dos mitades del vector

El vector tiene 17 campos divididos en dos grupos:

**9 métricas pre-ejecución** — se pueden calcular en cuanto el Decomposer termina, antes de ejecutar un solo agente. Describen la estructura del DAG:

- `depth` — profundidad máxima del árbol (cuántos niveles de anidamiento tiene)
- `leafCount` — cuántas hojas ejecutables tiene el plan
- `compositeCount` — cuántos nodos integrator (composites) hay
- `avgLeafDepth` — profundidad media de las hojas (qué tan profundo en el árbol están en promedio)
- `maxLeafDepth` — la hoja más profunda del árbol
- `dependencyCount` — cuántas dependencias explícitas hay entre nodos
- `avgAcceptanceCriteriaPerLeaf` — cuántos acceptance criteria tiene cada hoja en promedio (más criterios = tarea más especificada)
- `estimatedTokensPerLeaf` — estimación heurística de cuántos tokens consume cada hoja (basada en la longitud del contrato y el contexto)

**8 métricas post-ejecución** — se calculan después de que el run completa. Describen los resultados:

- `integrationSuccessRate` — fracción de integraciones que terminaron en `success` o `executor_repair_success` (0-1)
- `leafSuccessRate` — fracción de hojas que terminaron en `success` (0-1)
- `conflictRate` — fracción de pares de hojas que producen conflicto en cherry-pick (0-1)
- `linesChanged` — total de líneas modificadas en todos los commits de hojas
- `totalDurationMs` — tiempo total de la run de punta a punta
- `unexpectedCommitCount` — cuántas hojas hicieron commits por su cuenta (debería ser 0)
- `scopeViolationCount` — cuántas hojas violaron su scope
- `testsPassedRate` — fracción de hojas cuyas `leafValidationCommands` pasaron (0-1, optional — solo si hay comandos de validación)

Tres campos adicionales son opcionales: `estimatedTokensPerLeaf` (heurístico), `totalCostUsd` (si el executor reporta costos), y `testsPassedRate` (si hay comandos de validación definidos).

### Cómo se computa

`computeGranularityVector(graph, results)` toma el `TaskGraph` completo y el array de `AgentExecutionResult` (uno por hoja) y deriva todas las métricas usando funciones auxiliares:

- `rate(numerator, denominator)` — calcula una fracción, retorna 0 si el denominador es 0
- `mean(values)` — promedio de un array
- `countDiffLines(diff)` — cuenta las líneas agregadas y eliminadas de un diff unificado
- `sumOptional(values)` — suma un array de valores opcionales, retornando `undefined` si ninguno está presente

Las métricas de rate (integrationSuccessRate, leafSuccessRate, conflictRate, testsPassedRate) están validadas con Zod para que sean siempre entre 0 y 1.

### Por qué 17 métricas y no un score único

La pregunta de la tesis no es "¿fue bueno el run?" sino "¿cómo se relaciona la granularidad de la descomposición con la calidad de la integración?". Un score único colapsaría información crítica: podría pasar que con granularidad `high` la `leafSuccessRate` suba (las hojas son más simples) pero la `integrationSuccessRate` baje (más costuras = más conflictos potenciales). Ese trade-off es exactamente lo que la tesis quiere medir.

Con el vector completo, se pueden ver curvas como: "a medida que `leafCount` aumenta, `conflictRate` aumenta pero `linesChanged` por hoja decrece". Eso es la curva de granularidad óptima.

### Cómo se usa en los experimentos

Para los experimentos de granularidad, el proceso es:
1. Tomar una fixture (ej. `benchmarks/expression-calculator/`)
2. Correr el Decomposer con `low`, `medium` y `high` aggressiveness → tres `TaskGraph` distintos
3. Congelar esos grafos como fixtures versionadas (para reproducibilidad)
4. Ejecutar cada grafo múltiples veces con `GeminiCliExecutor` real
5. Capturar el `GranularityVector` de cada run
6. Analizar la correlación entre las métricas pre-ejecución (estructura) y post-ejecución (resultados)

---

## Interfaces

**`computeGranularityVector(graph, results)`:**
- Recibe: `TaskGraph` + `AgentExecutionResult[]`
- Produce: `GranularityVector` (schema Zod validado)
- Lo invoca: `RunExecutor` al final de `run()`

**Dónde vive:** se persiste como campo del `RunRecord` y la web app lo muestra en el panel de evidencia del run workspace.

---

## Decisiones de diseño

La separación entre métricas pre-ejecución y post-ejecución no es solo estética — tiene implicaciones metodológicas para la tesis. Las métricas pre-ejecución son deterministas dada una descomposición; se pueden calcular antes de gastar tokens en ejecución. Esto permite, por ejemplo, detectar un DAG que es estructuralmente deficiente (demasiadas hojas, demasiada profundidad) antes de correr los agentes.

Las rates validadas en 0-1 con Zod previenen errores silenciosos donde una métrica calculada incorrectamente (ej. división por cero que retorna NaN) contamina el análisis estadístico sin que nadie lo note.
