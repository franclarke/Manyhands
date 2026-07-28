# N=8 — ejecución completada y validada externamente

> **No comparable con la serie vigente.** Esta celda corrió bajo el estímulo
> original, que pedía N módulos derivando los mismos tres valores y diferenciados
> sólo por un id, con un único archivo de test compartido. Ese estímulo fue
> retirado por degenerado. Este PASS es evidencia de **mecánica**, no de que la
> arquitectura sirva para desarrollar software. Ver
> [`protocol/wide-graph-scaling.md`](../../../protocol/wide-graph-scaling.md).
>
> **Contrato de oráculo histórico.** Los recibos
> `oracle-result.json` y `oracle-result-instrumentation-failure.json` usan
> `warehouse-wide-graph-v1`, el contrato estructural anterior: no comparaba los
> valores contra el specimen. El contrato value-aware vigente se identifica
> como `warehouse-wide-graph-v2`; estos recibos no se reinterpretan como si
> hubieran ejecutado sus checks.

El cell `warehouse-wide-n08` partió de W1
(`71f61c9efa222103ca2fb2f67692434ab493d75c`). El run
`5507c3b7-7a29-4936-8981-6af76bfb8e7d` completó y publicó
`73cc39db3a916effb73d2f1a34815d04cc1736ac`.

`run.granularity-metrics.json` fija condición C y un árbol de profundidad 1
con once hojas. `run.events.v2.jsonl` conserva sus validaciones, la reparación
de integración, `final_candidate.verified` y `delivery.published`.

El resultado final del oráculo externo es PASS en `oracle-result.json`: install
con lockfile congelado, test, typecheck, build, límites entre módulos y dos
sondas deterministas. Se ejecutó desde un clon externo fijado al SHA entregado.

`oracle-result-instrumentation-failure.json` conserva el FAIL previo causado
por un defecto del extractor del oráculo, documentado en
`../../../../pilot/defects/wide-graph-projection-id-field/README.md`; no modifica
el candidate ni el journal.

## Alcance de la conclusión

Esta celda demuestra una entrega externa verificable para N=8 y una
descomposición observada de once hojas. No estima aún una curva de escalamiento
ni permite atribuir causalidad a una métrica aislada.
