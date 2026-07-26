# Línea de evidencia: grafos anchos sobre W1

Estado: **instrumento definido; sin células ejecutadas**. Este documento no
constituye evidencia de paralelismo, entrega ni escalabilidad hasta que cada
célula conserve su journal, commit entregado y oráculo externo.

## Pregunta y base fija

La segunda hipótesis evalúa si el grafo puede desarrollar una arquitectura con
módulos independientes a tamaños representativos. Todas las células parten del
commit W1 verificado `71f61c9efa222103ca2fb2f67692434ab493d75c`, no de un
incremento posterior ni de un worktree reutilizado.

El barrido es `N ∈ {4, 8, 16, 24}`. Cada valor es una célula distinta, ejecutada
de a una y restaurando el target a W1 sólo bajo las mismas guardas de
`run-g5.mjs`; una célula fallida también se preserva como resultado.

## Estímulo congelado

Cada célula agrega `N` módulos de proyección bajo `src/analytics/`, más un único
registro integrador. Los módulos implementan el mismo contrato público:

```ts
export interface WarehouseProjection {
  readonly id: string;
  project(scenario: Scenario): { projectionId: string; totalUnits: number; skuCount: number };
}
```

Un módulo puede importar solamente `Scenario`, `totalUnits` y `countSkus` de la
base W1 y el archivo de contrato; no puede importar otro módulo de proyección.
El registro es el único consumidor permitido de todos los módulos y expone las
`N` proyecciones ordenadas por `id`. Cada módulo debe devolver su propio `id`,
el total de unidades y el conteo de SKU del escenario `thesis-seed-2026`; los
valores esperados se derivan de las funciones productivas W1, no de constantes
duplicadas.

El prompt de cada célula debe nombrar exactamente los `N` archivos
`projection-01.ts`…`projection-NN.ts`, el contrato, el registro y tests. Antes
de la primera ejecución se versionan los cuatro prompts, sus SHA-256 y un
oráculo fuera del target que verifica: inventario completo de módulos, ausencia
de importaciones entre pares, orden y cardinalidad del registro, dos invocaciones
deterministas, y los checks `test`, `typecheck` y `build`.

## Mediciones requeridas

Por célula se guardan el `cell.json` congelado, journal V2, snapshot, resultado,
diff final, commit entregado y resultado del oráculo. Del evento
`planning.granularity_strategy_selected` se extraen el árbol candidato
persistido, decisión de cada unidad, profundidad, hojas, `parallelism`,
`coordination`, `splitAdvantage` y la política `adaptive-utility/3.1.0-pilot`.

El resultado confirma la hipótesis sólo si la entrega y el oráculo externo
pasan. Un grafo ancho planificado sin entrega, un fixture, o una métrica de
topología calculada fuera de un journal productivo no cuentan como observación.

## Qué no se concluye

El diseño no presupone que el planner elija un fan-out de N ni que los `N`
módulos sean paralelos: ambas son observaciones. Tampoco compara modelos,
costos ni condiciones de granularidad; sólo prepara una línea de evidencia
complementaria para la política C sobre la base W1 verificada.
