# SP2 — validación compacta del planning semántico

> **Estado:** protocolo congelado para futura ejecución; no ejecutado.
> **Propósito:** validar que la ruta de planning rediseñada produce y ejecuta
> un corte seguro, no reconstituir ni comparar con Warehouse WC3.

## Pregunta y límite de inferencia

¿ManyHands puede producir un plan con granularidad segura y completar una tarea
acotada cuando las dependencias ejecutables se expresan como seams materializadas?

Un resultado `PASS` permite afirmar ese comportamiento en este escenario
controlado. No demuestra superioridad general entre políticas, ni reinterpreta
la evidencia histórica G6/G7.

## Target

La fuente única del target es
[`sp2-target-template/`](sp2-target-template/). Es un servicio Node ESM sin
dependencias externas, con tres superficies preexistentes:

1. `domain`: inventario y órdenes.
2. `application`: caso de uso que coordina el dominio y publica eventos.
3. `api`: fachada pública del estado actual.

La tarea agrega prioridad y backorders. Debe requerir los seams `Domain →
Application → API` y un composite de integración. El evaluador externo está en
el template y sólo se ejecuta contra el commit candidato exacto.

## Celdas y congelamiento

- Crear dos directorios de target desde el mismo template, fuera de `Manyhands`.
- En cada directorio: `git init`, configurar identidad local, `git add -A` y
  crear el commit base. Registrar el SHA y hashes de los archivos del template.
- Congelar: commit de ManyHands, SHA del template, SHA base de cada celda,
  prompt, modelo, esfuerzo, presupuesto, política y este protocolo.
- Usar Claude de menor costo disponible. No cambiar modelo ni configuración
  entre las dos celdas.

## Objetivo exacto

> Add express/standard order priority and backorder recording across the
> existing domain, application and API. `priority` accepts only `standard` or
> `express`, defaults to `standard` when omitted, and rejects other values with
> a `priority` error. An order that exceeds available stock
> must remain cancellable, record a positive backorder, emit exactly one
> application event of type `backorder-recorded`, and be observable through the API through `currentOrders()`,
> `currentBackorders()` and `events()`. `currentBackorders()` returns entries
> shaped exactly as `{ orderId, skuId, missing }`. Preserve existing behavior.
> Add focused tests beside the modified code.

## Criterios externos

1. `priority` acepta sólo `standard` o `express`, con `standard` por defecto.
2. Stock insuficiente no descarta la orden: registra un backorder positivo y la
   orden sigue cancellable.
3. Application publica exactamente un evento `backorder-recorded` por backorder.
4. API expone el listado actual de backorders.
5. `node evaluator.mjs` pasa sobre el commit candidato exacto, además de los
   tests propios del target.

## Procedimiento

1. Generar el plan antes de ejecutar. Inspeccionar su salida durable.
2. Si cualquier seam `api`, `type` o `command` tiene materialización `logical`,
   marcar la celda `FAIL` de planning y no despacharla.
3. Si el plan es seguro, ejecutar la celda sin retry automático. Sólo se permite
   una reparación dentro del scope ya declarado.
4. Ejecutar tests y `node evaluator.mjs` en el commit candidato exacto.
5. Repetir con la segunda celda, sin cambiar configuración ni oráculo.

## Veredicto

- `PASS`: 2/2 celdas completas y los cinco criterios externos satisfechos.
- `PARTIAL`: alguna celda incompleta, timeout o resultado no comparable.
- `FAIL`: falla observada de planning, ejecución o evaluación externa.

Nunca reemplazar una celda fallida por un retry, ampliar scopes para compensar
un plan incorrecto ni modificar el template, el protocolo o el oráculo durante
la serie.
