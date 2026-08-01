# G6 · T1 — enunciado congelado

> Congelado antes de ejecutar la primera celda. **Idéntico para las condiciones
> A, B y C.** Su SHA-256 queda en `freeze.json`.
>
> El enunciado declara la superficie pública requerida porque el evaluador
> externo la importa para ejercitarla. **No enuncia ningún valor esperado**: el
> evaluador computa lo que corresponde y compara. Decir la respuesta acá
> permitiría satisfacer el criterio sin implementar.

## Objetivo (texto exacto enviado al sistema)

```text
Add order priority and backorders to this warehouse codebase, across every layer that already exists.

Domain  - src/domain/orders.ts:
- Export type OrderPriority = "standard" | "express".
- Order gains a readonly priority field of that type. It is optional at the call site: an order placed without a priority is treated as "standard", so existing callers keep working unchanged.
- placeOrder throws OrderError when a priority is supplied and is neither "standard" nor "express".
- Export interface Backorder with readonly orderId, skuId and missing fields, where missing is a positive integer.
- WarehouseState gains a readonly backorders field keyed by order id.
- reserveOrder records a Backorder for every line whose quantity exceeds the available units, instead of throwing, and leaves the order in a status from which it can still be cancelled.
- Export listBackorders(state) returning every recorded Backorder.

Application  - src/application/warehouse-service.ts:
- The service exposes the new operations and emits a warehouse event for a recorded backorder.

Fulfillment  - src/fulfillment/planner.ts:
- Within one wave, planFulfillment lists express orders before standard ones. Its existing signature does not change.

Durability  - src/durability/journal.ts:
- HistoryAnalytics gains a backorders count derived from the events.

API  - src/api/server.ts:
- The server exposes the backorders of the current state.

Presentation  - src/presentation/tower.ts:
- The rendered SVG distinguishes express orders from standard ones.

Probe  - src/probe/g6.ts and a package script named study:g6-probe:
- Follow the shape of the existing probes: export main() returning a JSON string, and write exactly one JSON object to stdout when invoked directly, with no other output.
- Two invocations from the same commit must emit byte-identical output.

Preserve all existing behaviour and keep every existing test passing. Put new tests next to the code they cover, inside the directories the test script already scans.
```

## Por qué esta tarea

Toca **seis capas** del objetivo (`domain`, `application`, `fulfillment`,
`durability`, `api`, `presentation`) más el probe. Ésa es la condición que G5
nunca alcanzó: un objetivo cuya superficie de lectura obliga al agente a cargar
mucho más contexto del que un repositorio de cinco pruebas podía ofrecer.

## Qué no declara

- No dice cuántos faltantes produce ningún escenario.
- No dice en qué orden quedan los pedidos, sólo la relación que debe cumplirse.
- No dice qué campos lleva el JSON del probe más allá de que sea uno solo y
  determinista.

## Enmienda del 2026-08-01, antes de cualquier dato comparativo

Un chequeo planning-only sobre la condición A se detuvo porque el planner
preguntó, con razón, algo que el enunciado no resolvía:

> ¿`placeOrder` exige prioridad explícita a todo llamador, o una prioridad
> ausente cae en `"standard"` para que los llamadores existentes sigan
> compilando?

La ambigüedad chocaba de frente con el requisito de preservar el comportamiento
existente. El enunciado la resuelve ahora explícitamente —prioridad opcional con
`"standard"` por defecto— en vez de dejar que el planner improvise o que un
operador conteste a mitad de celda, que sería inyectar estímulo que la celda
pre-registrada no autoriza.

Es la misma clase de enmienda que G5 registró en su momento: *"los objetivos se
hicieron auto-contenidos, porque una redacción ambigua hacía que el planificador
se detuviera a preguntar"*. No cambia qué se mide ni cómo, y se hace cuando aún
**no existe ningún dato comparativo**.
