# Experimento final de tesis — pre-registración

**Estado:** congelado antes de abrir celdas; no contiene resultados ni SHAs de candidatos.

## Propósito

El estudio histórico acumuló una línea Warehouse incompleta (`1/8`), una
comparación G6 inconclusa y un estudio G7 que no llegó a candidatos. Esos
resultados se conservan como resultados adversos, pero no se usan para sostener
una afirmación positiva. Esta serie final mide sólo dos proposiciones acotadas,
con un target pequeño y un oráculo externo independiente.

## Hipótesis operables

### H-F1 — viabilidad end-to-end acotada

Para las dos tareas congeladas y en dos repeticiones adaptativas por tarea,
ManyHands llega a `completed` y `delivered`, publica un SHA final no vacío y ese
SHA pasa todos los criterios del oráculo externo correspondiente.

**PASS:** las cuatro celdas cumplen lifecycle, receipt y oráculo.
**FAIL:** cualquier celda no produce candidato entregado o cualquier oráculo no
pasa. Un resultado `not_run` no es PASS.

### H-F2 — selección de granularidad según forma de tarea

La política adaptativa selecciona una topología coherente con la forma
pre-registrada de la tarea:

- **M (multi-capa):** raíz composite, al menos tres hojas ejecutables y
  ownership explícito para `domain`, `application` y `api`.
- **S (cohesiva):** raíz leaf, profundidad cero y una única unidad ejecutable.

**PASS:** las dos repeticiones M cumplen el primer patrón y las dos S el
segundo, con eventos de planning y graph compiler persistidos.
**FAIL:** cualquier patrón esperado no aparece, el plan queda en
`replan_required` o la topología no puede derivarse del journal.

Estas hipótesis no son una confirmación retroactiva de las hipótesis históricas
de escala. La tesis las presenta como proposiciones de ingeniería evaluadas en
un alcance controlado.

## Tareas congeladas

### M — cambio multi-capa

Sobre `target-template/`, agregar prioridad de pedidos (`standard` por defecto,
`express` válido y rechazo de otros valores) y registro de backorders a través de
`domain`, `application` y `api`. Una orden con stock insuficiente debe conservarse
cancelable, registrar `{ orderId, skuId, missing }`, emitir un único evento
`backorder-recorded` y exponer el listado por la API. Se preserva el
comportamiento existente y se agregan tests focalizados.

### S — cambio cohesivo

Sobre el mismo baseline, agregar y exportar desde `src/domain/orders.mjs` la
función pura `summarizeInventory(state)`, que derive de `stockBySku` el objeto
`{ totalUnits, occupiedSkus }`. Debe aceptar dos estados distintos, no
hardcodear valores, conservar todas las operaciones existentes y agregar un
test focalizado. No se solicita tocar application ni api.

## Celdas y orden

| Celda | Tarea | Condición | Repetición | Cuenta |
|---|---|---|---:|---|
| `M-C-r1` | M | C adaptativa | 1 | sí |
| `M-C-r2` | M | C adaptativa | 2 | sí |
| `S-C-r1` | S | C adaptativa | 1 | sí |
| `S-C-r2` | S | C adaptativa | 2 | sí |

Se ejecuta primero un rehearsal descartable, que nunca cuenta como celda. No
hay controles A/B en esta serie: por eso no se hacen afirmaciones de
superioridad ni de causalidad frente a otras políticas.

## Configuración congelada

- Planning, execution y repair: `codex-cli / gpt-5.4-mini`.
- Esfuerzo: `medium`.
- Política: `adaptive-utility/3.1.0-pilot`.
- `maxPlanningAttempts: 1` y `automaticRetryBudget: 0`.
- Una sola reparación dentro del scope declarado por celda; ninguna repetición
  automática de una celda fallida.
- `pnpm build` inmediatamente antes de cada run.
- Targets bajo `C:/mh-final-thesis/<cell>` para evitar `MAX_PATH`.
- El oráculo corre sólo sobre el SHA candidato exacto, en checkout limpio.

## Medidas y custodia

Cada celda conserva `cell.json`, prompt, base SHA, journal, snapshot, métricas
de grafo, diff, candidate SHA, receipt y resultado del oráculo. Las métricas se
derivan desde artefactos crudos después de terminar la serie; el driver no puede
convertir un fallo en una observación positiva.

## Límites declarados

El resultado no demuestra escalabilidad, superioridad sobre A/B, optimalidad de
la política, generalización a otros repositorios, modelos o lenguajes, ni
calibración de `minimumAdvantage` o `maxLeafPlannedPaths`. La evidencia adversa
histórica sigue disponible y se reporta aparte.
