# W2 excedió el hard timeout después de trabajar como una sola hoja

Clasificación: **resultado de ejecución de W2 y defecto de recuperación del
orquestador**. No es una entrega verificable ni una observación de oráculo.

## Observación

El reintento `series-16` se ejecutó sobre el clon limpio
`warehouse-control-tower-pilot-13`, creado desde la entrega W1 verificada
`71f61c9efa222103ca2fb2f67692434ab493d75c`. El journal del run
`86f88e35-b3c3-455e-8973-2f92e073e387` conservado en
`../../series-16/runs/W2/run.events.v2.jsonl` registra el árbol candidato y una
única hoja: profundidad 0 y `totalLeafCount: 1`. Sus métricas crudas están en
`../../series-16/runs/W2/run.granularity-metrics.json`.

El executor Codex produjo cambios en su worktree aislado, pero no creó candidato
ni entrega. A los 30 minutos exactos, el evento `failure.classified` registró:

```text
timeout: The agent hit the hard timeout.
```

El resultado del driver quedó en `waiting_for_input`, sin receipt, y el oráculo
externo no se ejecutó porque no existió un commit entregado.

## Defecto de recuperación observado

El timeout se clasificó como `failureClass: "code_test"` y levantó una decisión
`resolve_conflict` con las opciones `retry` y `stop`. Esa decisión no forma
parte de las dos decisiones pre-registradas de la célula (aprobar plan y
entrega), por lo que el driver no la respondió y preservó el estado sin
intervención ad hoc.

La evidencia no identifica todavía por qué el proceso del agente permaneció
inactivo tras generar el diff; sólo demuestra que el timeout de la hoja termina
en una clase de fallo y una decisión humana que el protocolo experimental no
autoriza contestar automáticamente.

## Relación con la política C

La política C `adaptive-utility/3.1.0-pilot` eligió nuevamente una hoja para W2.
Ése es el dato registrado. No se modificó `minimumAdvantage`,
`maxLeafPlannedPaths` ni ningún peso para forzar una descomposición.

## Qué no se concluye

No se concluye que una descomposición hubiera entregado W2, que la implementación
parcial satisfaga el contrato, ni que el timeout tenga una causa única en el
modelo, el executor o la infraestructura. Tampoco se concluye nada sobre el
oráculo externo: no recibió una entrega que pudiera evaluar.
