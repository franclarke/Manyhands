# N=4 — ejecución completada y validada externamente

> **No comparable con la serie vigente.** Esta celda corrió bajo el estímulo
> original, que pedía N módulos derivando los mismos tres valores y diferenciados
> sólo por un id, con un único archivo de test compartido. Ese estímulo fue
> retirado por degenerado. Este PASS es evidencia de **mecánica**, no de que la
> arquitectura sirva para desarrollar software. Ver
> [`protocol/wide-graph-scaling.md`](../../../protocol/wide-graph-scaling.md).
>
> **Contrato de oráculo histórico.** El identificador
> `warehouse-wide-graph-v1` de `oracle-result.json` corresponde al contrato
> estructural anterior: comprobaba forma, límites y determinismo, pero no los
> valores contra el specimen. El contrato value-aware vigente se identifica
> como `warehouse-wide-graph-v2`; no se debe reinterpretar este recibo como si
> hubiera ejecutado esos checks.
>
> `oracle-v2-recheck.json` conserva la reevaluación del mismo commit entregado
> bajo v2. El checkout y todos los gates pasan, pero el contrato nuevo da FAIL
> porque el estímulo histórico no usa el catálogo value-aware vigente. La
> diferencia de veredicto queda atribuida por identificador, checks y SHA.

El cell `warehouse-wide-n04` se ejecutó sobre el piloto limpio 14, fijado en
W1 (`71f61c9efa222103ca2fb2f67692434ab493d75c`). El run
`c9b176d0-e46b-4883-92e8-3de4b7c2c96c` completó y publicó el commit
`b7a8838b1db9fa136103e5024df38697072ad3c9`.

## Evidencia conservada

- `run.events.v2.jsonl` registra siete candidatos de hoja, sus validaciones y
  adopciones, la reparación de integración, `final_candidate.verified` y
  `delivery.published`.
- `run.granularity-metrics.json` fija política C, hash del árbol candidato y
  métricas: profundidad máxima 1, siete hojas y factor de ramificación medio 7.
- `result.json` conserva el receipt de entrega y el SHA final.
- `oracle-result.json` es el resultado del oráculo ejecutado desde un clon
  externo en ese SHA: PASS para instalación con lockfile congelado, test,
  typecheck, build, límite entre módulos y doble sonda determinista.

La reparación de integración ocurrió dentro del run y antecede al candidato
final verificado. No se reescribió el journal ni se ajustaron umbrales de la
política C para obtener este árbol.

## Alcance de la conclusión

Esta celda demuestra que, para esta carga N=4 y este entorno, la planificación
produjo un árbol ancho observable y una entrega que supera los gates externos.
No estima todavía una curva de escalamiento ni atribuye causalidad a una sola
métrica: faltan las celdas N=8, N=12 y sus réplicas planificadas.
