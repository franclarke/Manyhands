# N=16 bajo Claude Sonnet — parkeado en planning

Run `305a99c5`, celda `warehouse-wide-n16` de `retry-6`, executor declarado
`claude-code-cli / sonnet`, base W1 `71f61c9e`. Primera corrida del barrido ancho
con un executor distinto sobre el **mismo estímulo congelado**.

## Resultado

    lifecycle: planning
    decision.kind: clarify_goal
    finalSha: none
    granularity metrics: ninguna

El planner produjo un breakdown (`root` composite, **3 hijos**) más una pregunta
consecuente sin resolver, así que `compileGraphRevision` lo rechazó — es su
comportamiento correcto, cubierto por test. **La política C nunca se ejecutó**:
no hay evento `planning.granularity_strategy_selected` ni
`run.granularity-metrics.json`.

La pregunta:

> Beyond a unique id, should the 16 projection modules differ in what they
> compute (e.g. filtered by zone, SKU threshold, or time window), or is
> structural parallelism with identical derivation logic (only id differs)
> sufficient?

con dos opciones ofrecidas: aceptar 16 módulos estructuralmente paralelos que
sólo difieren por id, o especificar un eje de diferenciación por módulo.

El driver `run-experiment.mjs` **no la respondió**, por diseño: sólo contesta
`approve_plan` y la entrega. Contestar una `clarify_goal` sería improvisar
estímulo que la celda pre-registrada no autoriza.

## Qué muestra

Dos executors sobre el estímulo idéntico se comportan de forma materialmente
distinta: Codex `gpt-5.5` construyó el fan-out de 19 unidades sin objetar; Claude
`sonnet` se detuvo a preguntar si el fan-out tiene contenido semántico o es
paralelismo estructural.

La pregunta es pertinente. El objetivo pide 16 módulos que derivan los **mismos**
tres valores (`projectionId`, `totalUnits`, `skuCount`) a través de las **mismas**
funciones de W1, diferenciándose sólo por id. Eso es, literalmente, un fan-out
sintético.

## Qué no se concluye

No se concluye que un executor planifique mejor que el otro. Un caso no separa
"Claude es más cuidadoso" de "Codex es más decidido", y ninguno de los dos
comportamientos es incorrecto frente a un estímulo ambiguo.

Sí queda registrado un límite de la línea de grafos anchos que hasta ahora estaba
implícito: **la anchura del grafo puede ser un artefacto de un estímulo
degenerado**. N=4 y N=8 pasaron su oráculo, pero midieron la maquinaria del grafo
sobre módulos que no se diferencian entre sí. Eso sirve para la hipótesis de
mecánica; es débil para sostener que la arquitectura sirve para desarrollar
software real.

## Decisión pendiente

Para obtener la medición de política que este run no produjo hay que
**desambiguar el estímulo**, y eso cambia la celda. Es trabajo de instrumento
legítimo — el objetivo ya implica la respuesta — pero debe congelarse como celda
nueva (`retry-7`), preservando ésta, y declararse. No se hizo aquí: elegir el eje
de diferenciación es una decisión de diseño del experimento, no una corrección.
