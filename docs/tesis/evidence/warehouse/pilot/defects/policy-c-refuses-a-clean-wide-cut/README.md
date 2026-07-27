# La política C no divide un fan-out ancho aunque el grafo esté limpio

Clasificación: **resultado adverso sobre el aporte de la tesis**. No es un
defecto corregido: es una medición que hay que decidir qué hacer con ella.

## Medición

Root `warehouse-projections`, run `bc859c1d`, 19 hijos, política
`adaptive-utility/3.1.0-pilot`. Lo que el journal registró:

    contextRelief 0.2511  parallelism 0.8889  faultIsolation 0.2008   -> benefit 0.4469
    coordination  1       pathOverlap 0.5759  validationDuplication 0.8947
    uncertainty   0.3508                                              -> cost    0.7054
    splitAdvantage -0.2584   minimumAdvantage 0.15

`selected: "split"`, pero la razón es `"Leaf is infeasible; C selected the
available semantic split."` **La utilidad no aprobó el corte.** Sólo dividió
porque `leafFeasible: false` lo forzó.

`coordination: 1` no era ruido: el corte tenía un ciclo real, un seam con la
dirección invertida (ver
[`seam-bindings-escape-cycle-detection`](../seam-bindings-escape-cycle-detection/README.md)).

## Contrafáctico

Se recalcularon `parallelism` y `coordination` sobre la topología persistida con
esa única relación corregida. **Control primero**: la reimplementación reproduce
exactamente los valores del journal sobre la topología original
(`parallelism 0.8889`, `coordination 1`, `advantage -0.2584`), así que su salida
sobre la topología corregida es confiable.

| Escenario | coordination | splitAdvantage | decisión |
|---|---:|---:|---|
| Como se planificó (con ciclo) | 1 | −0.2584 | leaf |
| Seam corregido | 0.1053 | −0.0347 | leaf |
| Seam corregido y `validationDuplication` = 0 | 0.1053 | +0.1889 | **split** |

Corregir el ciclo baja el costo de coordinación casi un orden de magnitud y aun
así **no alcanza**: la política sigue diciendo "no dividas" un fan-out de 19
módulos independientes cuyo paralelismo ella misma mide en 0.8889.

El término que liga es `validationDuplication = 0.8947`.

## De dónde sale ese 0.8947

Los 19 hijos declaran 2 acceptance intents cada uno; hay 4 intents únicos en
total. La fórmula da `(38 − 4)/38 = 0.8947`, verificado.

Los intents son criterios de objetivo completo, del tipo *"Create exactly 16
modules at src/analytics/projection-01.ts through projection-16.ts"* — criterios
que **ninguna hoja individual puede satisfacer** y que sólo tienen sentido sobre
el conjunto integrado.

Descartado por medición: se sospechó que la propagación de intents de ancestro
(`f6eeccd`) inflaba el término. **No lo hace**: esa propagación corre después del
cálculo de features. El 0.8947 lo produce la asignación del planner.

## La interacción que esto expone

El crítico de completitud exige que todo intent requerido tenga hoja propietaria
— es lo que hizo fallar el N=16 anterior con `unowned_acceptance`. Los criterios
amplios terminan entonces adheridos a muchas hojas. Eso infla
`validationDuplication`, que la política C lee como costo de dividir.

En una frase: **un crítico que exige propiedad-hoja de todo intent infla
estructuralmente un término de costo de la política, sesgándola en contra
justamente de las descomposiciones anchas donde esa exigencia es más cara.**

## Qué no se concluye, y qué hay que decidir

No se concluye que `validationDuplication` esté mal medido. Hay dos lecturas y
un solo caso no las separa:

1. El término es correcto y lo que está mal es que el planner asigne criterios de
   objetivo completo a las hojas.
2. El término es incorrecto y debería medir duplicación de verificación
   *propia* de cada hoja, no cobertura heredada compartida.

El esquema actual no distingue las dos cosas: `acceptanceIntentIds` es una lista
plana que mezcla lo que la unidad posee con lo que hereda. Mientras no se
distingan, cualquier ajuste al umbral o a la fórmula sería ajustar al resultado.

**No se tocó ni el umbral ni el término.** Se necesita una segunda medición con
intents efectivamente particionados por hoja antes de decidir.
