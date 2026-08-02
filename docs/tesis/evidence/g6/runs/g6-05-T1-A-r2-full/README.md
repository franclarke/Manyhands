# G6-05-T1-A-r2 — full

Fecha: 2026-08-02
Run: `d2baaa3f-6775-4b1f-a884-33893602e86a`
Condición: A — hoja única forzada
Base: `5da60192cc788032c59c7e7be27696ca0e0a30d7`
SHA entregado y evaluado: `a8831b8c1160bd1ce6854be8c7eda3c91791338f`

## Resultado operacional

La única hoja completó la ejecución, validación, integración y delivery sin
retries. La hoja tardó 892 segundos desde `attempt.started` hasta el
candidate. El journal registra 156444 tokens y USD 0.703998 de uso reportado;
el límite de USD 8 de la celda no se alcanzó.

## Evaluación externa

El evaluador congelado produjo **9/10**. Pasaron instalación, tests, typecheck,
build, integridad de los 14 tests baseline, express-first, prioridad inválida y
los dos criterios del probe.

Falló únicamente `behaviour-backorder-recorded`: la superficie entregada no
exporta `orders.listBackorders`, por lo que el oráculo recibió
`TypeError: orders.listBackorders is not a function`. Se conserva como fallo
genuino del candidate de la hoja única.

## Qué no se concluye

- No se concluye que A haya satisfecho completamente la tarea: la cobertura es
  9/10, no 10/10.
- No se concluye que el ciclo operacional implique fidelidad semántica total.
- No se concluye confirmación ni falsación de H-G6 con esta repetición aislada.
- No se corrige el candidate después de la medición ni se altera el oráculo.
