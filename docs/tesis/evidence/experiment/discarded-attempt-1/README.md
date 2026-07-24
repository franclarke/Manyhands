# Intento 1 del experimento — descartado

> **Fecha:** 2026-07-24 · **Resultado:** 6/12 entregas · **Motivo del descarte:**
> defecto de ManyHands que anuló por completo un brazo experimental.

## Qué pasó

Las **cuatro** celdas de la condición B fallaron, todas en planificación y en
menos de 100 segundos:

```
planning.failed: [{ "code": "too_small", "minimum": 0, "inclusive": false,
                    "message": "Number must be greater than 0",
                    "path": ["payload", "leafThreshold"] }]
```

## Causa raíz

El esquema del evento `planning.granularity_assessed` exigía
`leafThreshold: z.number().positive()`. La condición B ---«ninguna unidad es
hoja»--- necesita un umbral **por debajo** del menor puntaje alcanzable, y usa
`-1`. El evento se rechazaba al escribirse, así que la planificación fallaba
antes de producir un grafo.

El umbral es un **parámetro de política**, y dos políticas legítimas caen fuera
del rango productivo: «toda unidad es hoja» necesita un valor en o por encima
del mayor puntaje alcanzable, y «ninguna lo es», uno por debajo del menor. La
restricción a números positivos codificaba el rango productivo como si fuera el
rango válido.

**Los tests de política no podían detectarlo:** ninguno hacía round-trip por el
evento que el planificador realmente escribe. La regresión agregada
(`tests/granularity-policy-conditions.test.ts`, «every condition survives the
durable journal») persiste la evaluación de las tres políticas a través del
esquema y falla exactamente por esta causa sin el fix.

## Consecuencia

Conforme al §6 del protocolo ---«si durante la ejecución se descubre un defecto
que obliga a modificar ManyHands, el experimento se reinicia por completo; no se
mezclan runs de versiones distintas»--- **las 12 celdas se re-ejecutaron** sobre
el commit corregido. Los resultados de este intento **no** se usan para
responder ninguna RQ.

## Por qué se conserva

Porque el brazo perdido no fue un resultado sobre granularidad y sería
deshonesto que el registro sugiriera que la condición B «falla». Falló el
sistema al escribir su propio evento, no la condición.

Se conservan los journals de las cuatro celdas B y el CSV derivado del intento.
