# G6-03-T1-B-r1 — rem26 full

Fecha: 2026-08-02
Run: `c7e47c17-c57d-41c4-a4a2-0e65857c929e`
Condición: B — división fina fija
Base: `5da60192cc788032c59c7e7be27696ca0e0a30d7`
SHA entregado y evaluado: `4fd86c11b2541460411b8708f8eaa05eb6337d2b`

## Resultado operacional

La corrida completó el ciclo completo: planning válido, aprobación del plan,
siete hojas ejecutadas, integración, candidate verificado y delivery confirmado.
No hubo retries automáticos. El journal registra 354005 tokens y USD
1.5930225 de uso reportado para los siete candidates de hoja; el límite de USD
8 de la celda no se alcanzó.

La matriz interna quedó `verified` y los ocho nodos produjeron/adoptaron
artefactos. El receipt confirma el delivery sobre `HEAD`, desde la base exacta
hasta el SHA entregado.

## Evaluación externa

El evaluador congelado produjo **9/10**:

- satisfechos: instalación, tests, typecheck, build, integridad de tests del
  baseline, express-first, prioridad inválida y los dos criterios del probe;
- no satisfecho: `behaviour-backorder-recorded`.

El detalle preservado por `external-verdict.json` fue que `listBackorders`
devolvió una entrada con `orderId`, `lines` y `priority`, pero no una entrada
con `orderId`, `skuId` y `missing` entero positivo. El plan había transcripto
correctamente ese contrato; por lo tanto es un incumplimiento semántico del
candidate, no un problema del criterio externo. El resultado se conserva como
adverso y no se convierte en PASS.

## Qué no se concluye

- No se concluye que B haya satisfecho completamente la tarea: su cobertura
  externa es 9/10, no 10/10.
- No se concluye que el fallo de `Backorder` sea un defecto del oráculo ni se
  lo corrige editando el candidate después de la medición.
- No se concluye confirmación ni falsación de H-G6 con una sola celda.
- No se generaliza este resultado a todas las tareas, modelos o repeticiones.
