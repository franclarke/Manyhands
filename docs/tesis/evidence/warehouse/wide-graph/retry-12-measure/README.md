# `retry-12-measure` — serie de medición planning-only

## Qué es y qué no es

Esta serie existe para observar **una sola cosa**: la evaluación de granularidad
que la política C (`adaptive-utility/3.1.0-pilot`) produce sobre el estímulo de
grafo ancho, con un Architect capaz de particionar los acceptance intents por
hoja.

- **No es comparable** con `retry-8`, `retry-9`, `retry-10`, `retry-11` ni con el
  piloto. El ejecutor *es* el Architect, así que cambiarlo cambia el árbol
  candidato. Esta serie no eleva, corrige ni reinterpreta ningún resultado de
  aquéllas.
- **No aporta nada a H2.** Ninguna celda ejecuta, produce candidate, entrega ni
  recibe oráculo. Las tres disposiciones de oráculo son `not_run` por
  construcción, no por fallo.
- El estímulo, la fórmula, el umbral `minimumAdvantage = 0.15` y el oráculo son
  los mismos bytes que en `retry-11`; los `goalSha256` de las tres celdas
  coinciden con los suyos.

Congelada en `freeze.json`: código `5c48aba`, política
`adaptive-utility/3.1.0-pilot`, ejecutor `claude-code-cli/haiku`, base W1
`71f61c9`, Node `22.23.1` / pnpm `7.29.3`.

## Cómo se detiene una celda de medición

`planning.granularity_strategy_selected` se emite **antes** de que se levante la
decisión `approve_plan`. La celda se detiene ahí, **sin responder** esa decisión:
responder `approve` es exactamente lo que iniciaría una ejecución que la medición
no necesita. El run queda parkeado en `needs_approval` y el target no se toca.

## Resultados

| Celda | run | resultado | hojas | selected | splitAdvantage | validationDuplication |
|---|---|---|---:|---|---:|---:|
| N=4 | `1664d097` | medida | 7 | split | **+0.1710** | **0.3750** |
| N=8 | `4ba80bca` | medida | 11 | split | **+0.3275** | **0.4828** |
| N=16 | `6e1e5ed3` | **sin medición** | — | — | — | — |

Features completos de la raíz:

| | N=4 | N=8 |
|---|---:|---:|
| contextRelief | 0 | 0.6726 |
| parallelism | 0.8333 | 0.7000 |
| faultIsolation | 0.8571 | 0.7455 |
| coordination | 0.4286 | 0.3091 |
| pathOverlap | 0.1423 | 0.2525 |
| validationDuplication | 0.3750 | 0.4828 |
| uncertainty | 0.6238 | 0.4697 |
| leafFeasible | true | false |
| razón registrada | `Split advantage 0.1710 meets minimum 0.1500.` | `Leaf is infeasible; C selected the available semantic split.` |

**N=4 es el primer caso de todo el corpus en el que la razón registrada de un
corte ancho es la utilidad.** En N=8 la hoja además era infactible, así que la
razón cita la infactibilidad; su advantage `+0.3275` habría alcanzado igual.

## Partición de intents observada

N=4 — cada módulo posee su intent, más dos transversales:

```
analytics-w1-four-projections   ai-contract, ai-proj-01..04, ai-isolation, ai-runtime, ai-registry, ai-preserve, ai-script
  analytics-contract            ai-contract
  projection-zone-unit-totals   ai-proj-01, ai-isolation, ai-runtime
  projection-sku-unit-totals    ai-proj-02, ai-isolation, ai-runtime
  projection-bin-occupancy      ai-proj-03, ai-isolation, ai-runtime
  projection-sku-bin-spread     ai-proj-04, ai-isolation, ai-runtime
  analytics-registry            ai-registry
  study-wide-graph-cli          ai-script, ai-preserve
```

N=8 repite la forma con `ai-projection-01` … `ai-projection-08`.

Contraste con `retry-11` N=8, mismo estímulo: las ocho hojas hermanas comparten
**los mismos dos** intents (`analytics-modules-contract-and-independence`,
`projection-questions-and-tests`), y `validationDuplication` es `0.85`.

## N=16 quedó sin medición

El planner falló sus tres intentos internos:

```
claude-code-cli planning failed with exit code 1
(envelopes=assistant,rate_limit_event,result,system; stdoutBytes=14685)
```

No se reintenta: el protocolo congelado admite un intento por celda. La causa no
es atribuible con lo que quedó registrado —ver
[`planning-failure-discards-cli-output`](../../pilot/defects/planning-failure-discards-cli-output/README.md)—
y la presencia de `rate_limit_event` **no** indica throttling: el host ya
documenta que ese envelope aparece también en llamadas exitosas, y una llamada
directa al mismo modelo, minutos después, respondió normalmente.

## Qué no se concluye

- **No se concluye que el caso motivador esté resuelto.** El rechazo original
  ocurrió sobre un fan-out de 19 hijos (N=16); esta serie lo mide a 7 y 11 hojas.
  El mecanismo queda demostrado a esas dos anchuras, no a la del caso original.
- No se concluye que Codex produciría el mismo árbol si se lo volviera a correr:
  no se lo volvió a correr, y no puede correrse en esta máquina.
- No se concluye nada sobre la calidad del plan ni del código: nada se ejecutó.
- `minimumAdvantage` y `maxLeafPlannedPaths` siguen **sin anclar**. Nada de esta
  serie los deriva.
