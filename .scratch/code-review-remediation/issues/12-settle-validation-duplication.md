# 12 — Veredicto sobre la duplicacion de validacion

**What to build:** la pregunta abierta mas importante de la tesis queda cerrada con evidencia: si el termino mide mal, o si el planner asigna criterios de objetivo completo a las hojas.

**Blocked by:** 11 — necesita la medicion con intents efectivamente particionados por hoja.

**Status:** closed

- [x] Se compara la evaluacion nueva contra la registrada y se declara cual lectura sostiene la evidencia.
- [x] Si el termino cambia, va con regresion roja primero y version nueva de politica.
- [x] Si no se resuelve, queda declarado como limitacion en vez de ajustar el umbral.

## Veredicto — 2026-07-30

La segunda medición es `retry-12-measure`, una serie planning-only sobre el
**mismo estímulo, la misma fórmula y el mismo umbral** `minimumAdvantage = 0.15`,
con un Architect (`claude-code-cli/haiku`) que particionó los acceptance intents
por hoja.

| | piloto N=16 | retry-11 N=8 (Codex) | retry-12 N=4 | retry-12 N=8 |
|---|---:|---:|---:|---:|
| intents por hoja | compartidos | compartidos | propios | propios |
| `validationDuplication` | 0.8947 | 0.8500 | **0.3750** | **0.4828** |
| `splitAdvantage` | −0.2584 | +0.0444 | **+0.1710** | **+0.3275** |
| razón registrada | infactibilidad | bajo el mínimo | **utilidad** | infactibilidad |

`retry-12` N=4 es el primer caso del corpus —18 evaluaciones de raíz
preservadas— donde la razón registrada de un corte ancho es la utilidad:
`"Split advantage 0.1710 meets minimum 0.1500."`

**Lectura sostenida: (1).** El término mide lo que declara medir —obligaciones de
verificación duplicadas entre hermanas— y lo que producía el rechazo era la
asignación de criterios de objetivo completo a las hojas. La lectura (2) queda
descartada por evidencia.

**No se cambió el término, la fórmula ni el umbral**, así que la segunda casilla
se cumple por vacuidad: no hubo cambio de política que exigiera regresión roja ni
versión nueva. La tercera se cumple por las limitaciones declaradas abajo.

## Limitaciones declaradas

- El caso motivador (19 hijos, N=16) **no fue re-medido a su propia anchura**: la
  celda N=16 de `retry-12` falló en planning con un error no atribuible
  (`planning-failure-discards-cli-output`). El veredicto se apoya en 7 y 11
  hojas.
- `retry-12` **no es comparable** con las series Codex: el ejecutor es el
  Architect. No eleva ni corrige `retry-8/9/10/11` ni el piloto.
- Nada obliga a un Architect a particionar los intents. Dos ejecutores
  produjeron reparticiones distintas sobre el mismo estímulo, y esa variabilidad
  sigue sin control.
- `minimumAdvantage` y `maxLeafPlannedPaths` continúan **provisionales**.

## Evidencia

- `docs/tesis/evidence/warehouse/wide-graph/retry-12-measure/` (freeze, celdas,
  journals, `series-result.json`, README)
- `docs/tesis/evidence/warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md`
  (sección "Resolución")
- `docs/tesis/evidence/warehouse/pilot/defects/planning-failure-discards-cli-output/README.md`
