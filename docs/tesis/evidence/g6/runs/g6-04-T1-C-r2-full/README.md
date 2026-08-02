# G6-04-T1-C-r2 — full

Fecha: 2026-08-02
Run: `a0f0edba-94e7-4fd7-9405-df62f9be7eda`
Condición: C — política adaptativa
Base: `5da60192cc788032c59c7e7be27696ca0e0a30d7`
SHA entregado y evaluado: `a41b4babfaef5d45073ed577af1b27860eb6b615`

## Resultado operacional

La corrida completó planning, aprobación, siete hojas, integración y delivery
confirmado. No hubo retries automáticos. El journal registra 305868 tokens y
USD 1.376406 de uso reportado para las hojas; el límite de USD 8 de la celda no
se alcanzó.

## Evaluación externa

El evaluador externo congelado produjo **9/10**. Pasaron instalación, tests,
typecheck, build, integridad de los 14 tests baseline, express-first, rechazo de
prioridad inválida y los dos criterios del probe.

Falló únicamente `behaviour-backorder-recorded`: `listBackorders` devolvió
`{ orderId, skuId, quantity }`, sin el campo `missing` entero positivo exigido
por el contrato. Es un fallo genuino del candidate; no es un fallo de
infraestructura ni una discrepancia del oráculo.

## Qué no se concluye

- No se concluye que C haya satisfecho completamente la tarea: la cobertura es
  9/10, no 10/10.
- No se concluye que una corrección manual del candidate sea evidencia del
  agente ni se reintenta esta invocación.
- No se concluye confirmación ni falsación de H-G6 con esta segunda repetición
  aislada.
- No se generaliza el resultado a otras tareas o modelos.
