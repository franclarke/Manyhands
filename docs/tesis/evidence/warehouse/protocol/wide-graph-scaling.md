# Línea de evidencia: grafos anchos sobre W1

Estado: **instrumento definido; sin células ejecutadas**. Este documento no
constituye evidencia de paralelismo, entrega ni escalabilidad hasta que cada
célula conserve su journal, commit entregado y oráculo externo.

## Pregunta y base fija

La segunda hipótesis evalúa si el grafo puede desarrollar una arquitectura con
módulos independientes a tamaños representativos. Todas las células parten del
commit W1 verificado `71f61c9efa222103ca2fb2f67692434ab493d75c`, no de un
incremento posterior ni de un worktree reutilizado.

El barrido es `N ∈ {4, 8, 16}`. Cada valor es una célula distinta, ejecutada
de a una y restaurando el target a W1 sólo bajo las mismas guardas de
`run-g5.mjs`; una célula fallida también se preserva como resultado.

## Variables controladas y comparabilidad

La selección de executor es parte del freeze, no un parámetro libre del
operador. Incluye `executorId`, `model` y, cuando el modelo lo expone, `effort`.
El manifest de la serie conserva esa selección y cada célula debe repetirla sin
cambios en `planningSelection`, `executionSelection` y `repairSelection`. El
preflight aborta antes de escribir o ejecutar una serie si alguna selección
diverge.

Dos células con distinto executor, modelo o effort **no son comparables entre
sí**, aunque compartan base, estímulo y oráculo. Se preservan como series o
intentos distintos; nunca se elige sólo el resultado favorable ni se atribuye
su diferencia a la anchura. La serie vigente `retry-7` está congelada con
`claude-code-cli`/`sonnet`, sin campo `effort` porque ese modelo no expone esa
variable.

Los manifests históricos se reconciliaron el 2026-07-28 desde las selecciones
ya congeladas en sus propias células: pilot y retry-2 a retry-5 usaron
`codex-cli`/`gpt-5.5`/`high`; retry-6 y retry-7 declararon
`claude-code-cli`/`sonnet`. Esta reconciliación añade atribución; no modifica
celdas, journals ni resultados.

> **Revisión del estímulo.** La primera versión pedía `N` módulos que derivaban
> los mismos tres valores y sólo se diferenciaban por un id, y daba a las `N`
> hojas un único `projections.test.ts` compartido. Eso medía la maquinaria del
> grafo sobre un fan-out sintético e imposibilitaba la integración; un planner se
> detuvo a objetarlo en vez de construirlo
> ([evidencia](../wide-graph/retry-6/runs/warehouse-wide-n16/README.md)). El
> estímulo vigente es el descrito abajo. Las células y corridas anteriores se
> preservan pero **no son comparables** con esta serie.
>
> `N = 24` se retiró: el seed sostiene dieciséis preguntas analíticas
> genuinamente distintas, y llegar a veinticuatro exigía entradas cada vez más
> artificiales — la misma degeneración que esta revisión elimina. Enriquecer el
> seed invalidaría el oráculo de W1 y la cadena longitudinal entera.

## Estímulo congelado

El catálogo de métricas (`scripts/lib/wide-graph-metrics.mjs`) es la única fuente
de verdad: de él se renderiza el estímulo y contra él compara el oráculo. Ninguno
de los dos deriva por su cuenta, que es el defecto que hundió los primeros W1.

Cada célula agrega `N` módulos bajo `src/analytics/`, más un registro integrador.
Cada módulo responde **una pregunta analítica distinta** sobre el escenario
`thesis-seed-2026` y escribe **su propio** archivo de test:

```ts
export interface WarehouseProjection {
  readonly id: string;
  project(scenario: Scenario): unknown; // la respuesta a la pregunta de ese módulo
}
```

Un módulo puede importar solamente el contrato y los exports de W1; no puede
importar otro módulo. El registro es el único consumidor permitido y expone las
`N` proyecciones en el orden del catálogo — no alfabético.

Los tamaños son prefijos exactos del catálogo: `N=4` es un subconjunto de `N=8`,
que lo es de `N=16`. Entre dos puntos del barrido cambia la anchura del grafo y
nada más.

El estímulo **no** enuncia el resultado esperado de ninguna métrica; eso sólo
vive en el specimen, del lado del oráculo. Decirlo permitiría hardcodear.

El oráculo corre fuera del target, sobre un clon en el SHA entregado con
instalación congelada, y verifica: `test`, `typecheck`, `build`, inventario de
módulos, ausencia de importaciones entre pares, orden y cardinalidad del
registro, dos invocaciones byte-idénticas, y **el valor correcto de cada
métrica** contra el specimen. Ese último check es el que distingue un módulo
correcto de uno que devuelve un valor plausible inventado: el determinismo por sí
solo no los separa, porque dos corridas de un stub son igual de idénticas entre
sí que dos de una implementación real.

El contrato value-aware vigente se identifica como
`warehouse-wide-graph-v2`/`oracleContractVersion: 2`. Sus recibos registran el
SHA verificado y los checks ejecutados, incluido `specimen-values`. Los recibos
históricos `warehouse-wide-graph-v1` pertenecen al contrato estructural anterior
y no se reinterpretan bajo v2.

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
