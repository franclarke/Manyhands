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

`coordination: 1` reflejaba un loop en la topologia combinada de artifacts y
seams. No era un ciclo del DAG de ejecucion: A5 define seams como compatibilidad
no ordenante. La direccion del seam seguia siendo semanticamente dudosa (ver
[`seam-bindings-escape-cycle-detection`](../seam-bindings-escape-cycle-detection/README.md)).

## Contrafáctico

Se recalcularon `parallelism` y `coordination` sobre la topología persistida con
esa única relación corregida. **Control primero**: la reimplementación reproduce
exactamente los valores del journal sobre la topología original
(`parallelism 0.8889`, `coordination 1`, `advantage -0.2584`), así que su salida
sobre la topología corregida es confiable.

| Escenario | coordination | splitAdvantage | decisión |
|---|---:|---:|---|
| Como se planifico (loop de compatibilidad) | 1 | −0.2584 | leaf |
| Seam alineado contrafactualmente | 0.1053 | −0.0347 | leaf |
| Seam alineado y `validationDuplication` = 0 | 0.1053 | +0.1889 | **split** |

Alinear el seam baja el costo de coordinacion casi un orden de magnitud y aun
asi **no alcanza**: la politica sigue diciendo "no dividas" un fan-out de 19
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

---

## Resolución — 2026-07-30

La segunda medición existe:
[`retry-12-measure`](../../../wide-graph/retry-12-measure/README.md), una serie
planning-only sobre el **mismo estímulo, la misma fórmula y el mismo umbral**,
con un Architect que sí particionó los intents por hoja.

| | piloto N=16 (19 hijos) | retry-11 N=8 (Codex) | retry-12 N=4 | retry-12 N=8 |
|---|---:|---:|---:|---:|
| intents por hoja | compartidos | compartidos | **propios** | **propios** |
| `validationDuplication` | 0.8947 | 0.8500 | **0.3750** | **0.4828** |
| `splitAdvantage` | −0.2584 | +0.0444 | **+0.1710** | **+0.3275** |
| razón registrada | infactibilidad | bajo el mínimo | **utilidad** | infactibilidad |

Con intents particionados, `validationDuplication` cae a la mitad y el advantage
cruza el mínimo. En `retry-12` N=4 la razón registrada es
`"Split advantage 0.1710 meets minimum 0.1500."` — **la primera vez en todo el
corpus que la utilidad, y no la infactibilidad de la hoja, aprueba un corte
ancho.**

**Veredicto: sostiene la lectura (1).** El término mide lo que dice medir —
obligaciones de verificación duplicadas entre hermanas— y lo que producía el
rechazo era la asignación de criterios de objetivo completo a las hojas, no un
error de la fórmula. No se cambió el término, la fórmula ni el umbral, y la
lectura (2) queda descartada por evidencia, no por conveniencia.

### Qué no se concluye de la resolución

- **El caso motivador no fue re-medido a su propia anchura.** El rechazo original
  ocurrió sobre 19 hijos; la resolución se apoya en árboles de 7 y 11 hojas. La
  celda N=16 de `retry-12` falló en planning y no dejó evaluación.
- No se concluye que el planner esté arreglado. Nada obliga a un Architect a
  particionar los intents: dos ejecutores distintos produjeron reparticiones
  distintas sobre el mismo estímulo, y esa variabilidad sigue sin control.
- No se concluye que la política sea correcta en general, ni que
  `minimumAdvantage = 0.15` esté anclado. Sigue siendo provisional.
- `retry-12` no es comparable con ninguna serie Codex y no modifica sus
  resultados, que siguen siendo evidencia adversa inmutable.
