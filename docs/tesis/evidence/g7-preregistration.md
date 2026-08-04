# G7 — Cierre compacto de la política de granularidad

## Propósito

Esta serie valida, en una escala acotada, dos afirmaciones separadas:

1. ManyHands puede llevar una tarea Warehouse desde un repositorio limpio hasta
   un commit entregado que satisface un oráculo externo.
2. La política `adaptive-utility/3.1.0-pilot` elige una granularidad coherente
   con la forma de la tarea: dividir una tarea multi-capa y conservar una tarea
   cohesiva como una unidad ejecutable cuando el árbol candidato lo permite.

La afirmación es deliberadamente acotada a estas dos tareas y a este baseline;
no se presenta como superioridad universal ni como una estimación estadística
general.

## Baseline y precedentes

- Proyecto: Warehouse Control Tower.
- Baseline exacto: `5da60192cc788032c59c7e7be27696ca0e0a30d7` (`feat: close WC3 durable warehouse operation`).
- Proveniencia: clon local del repositorio Warehouse usado en G6, no una copia
  de los resultados ni de los cambios de G6.
- El oráculo de T1 conserva los diez criterios externos congelados de G6.
- T2 agrega una tarea cohesiva y un oráculo específico, congelados antes de
  ejecutar cualquier celda.

## Diseño

| Celda | Tarea | Condición | Propósito |
|---|---|---|---|
| G7-01 | T1 multi-capa: prioridad y backorders | C | política nueva |
| G7-02 | T1 multi-capa: prioridad y backorders | A | control de hoja única |
| G7-03 | T2 cohesiva: resumen determinista de inventario | C | política nueva |
| G7-04 | T2 cohesiva: resumen determinista de inventario | B | control de split fino |

Hay una sola ejecución por celda. El resultado primario de funcionalidad es el
veredicto externo del SHA final; los controles sirven para interpretar la
decisión de granularidad y no se agregan a C como si fueran réplicas.

## Hipótesis y veredictos pre-registrados

### H1 — ManyHands funciona en este alcance

PASS si G7-01 y G7-03 llegan a `completed`, publican un SHA no vacío y el
oráculo externo satisface todos los criterios de su tarea. FAIL si alguna de
las dos celdas C no logra ese resultado. Un fallo de A o B no convierte H1 en
FAIL, pero se conserva como resultado del control.

### H2 — La política elige una granularidad adecuada

PASS si, en el journal de planificación, G7-01-C selecciona una raíz dividida
en al menos dos hojas ejecutables y G7-03-C selecciona una raíz hoja, y ambos
resultan compilables. FAIL si alguna decisión contradice esa predicción o si
la planificación termina en `replan_required`/fallo. Si la evidencia no permite
observar la decisión, el veredicto es INCONCLUSIVE.

### Comparación con controles

Los controles se interpretan descriptivamente: T1-A debe mostrar una raíz hoja
por diseño y T2-B debe conservar todos los cortes semánticos del candidato. No
se ajustan prompts, umbrales, criterios ni tareas luego de observar resultados.

## Estímulo congelado

Ambas tareas usan exactamente el baseline anterior, sin archivos pre-creados ni
fixtures añadidos. Los prompts completos viven en los JSON de las celdas y sus
hashes se registran en el manifiesto final.

### T1 — Multi-capa

Agregar prioridad de pedidos y backorders a través de las capas existentes:
dominio, aplicación, fulfillment, durabilidad, API, presentación y probe,
preservando comportamiento y tests existentes. El criterio funcional externo
es el mismo T1 de G6: instalación, tests, typecheck, build, integridad de tests
base, prioridad express, backorder, rechazo de prioridad inválida y probe G6
determinista.

### T2 — Cohesiva

Agregar un resumen determinista de inventario como una capacidad cohesiva del
dominio Warehouse. Debe exportar `summarizeInventory` desde
`src/analytics/stock-summary.ts`, agregar tests directos y un comando
`study:stock-summary` que emita exactamente un JSON con `schemaVersion: 1`,
`scenario: thesis-seed-2026`, `totalUnits`, `occupiedBins`, `skuCount` y
`topSku: { skuId, units }`. Los valores deben derivarse del escenario y no ser
hardcodeados; no debe romper las capacidades existentes.

## Modelo, límites y retries

- Planning, execution y repair: `codex-cli / gpt-5.4-mini`.
- Effort: `medium`, manteniendo el modelo económico `gpt-5.4-mini`. No se
  cambia de modelo ni se hacen reintentos ciegos.
- `maxPlanningAttempts: 1` y `automaticRetryBudget: 0`.
- Coste máximo: USD 8 por celda; USD 32 para las cuatro celdas.
- Tokens máximos de serie: 1,000,000.
- Paralelismo máximo: 2.
- Cada celda solicita exactamente 2 candidatos semánticos, el mínimo
  contractual, para mantener la serie compacta sin relajar los gates de
  ownership, seams, compilación ni validación.
- Si falla una celda, se conserva el journal y el diagnóstico; sólo se reintenta
  después de identificar una causa raíz de infraestructura o un defecto del
  protocolo. Un defecto del agente o del producto permanece como resultado.

## Medidas

Primarias: lifecycle terminal, SHA final, criterios externos satisfechos y
decisión de granularidad en el journal. Secundarias: hojas, profundidad,
criterios satisfechos, tiempo de pared, tokens/coste reportados, fallos,
replanificación y commits intermedios. Las métricas se derivan después de las
ejecuciones desde los artefactos crudos; el driver no las modifica.

## Integridad y cierre

Cada celda exige HEAD limpio en el baseline, conserva `cell.json`, journal,
snapshot, run record, métricas, diff y veredicto externo. El oráculo clona el
SHA entregado en un directorio temporal limpio y ejecuta sus propios gates. La
serie sólo se declara cerrada después de derivar resultados, comprobar hashes,
ejecutar los gates finales de ManyHands y escribir el informe final con
limitaciones y resultados adversos.
