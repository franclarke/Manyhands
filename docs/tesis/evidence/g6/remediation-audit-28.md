# Auditoría de A-r2 — candidate completo con contrato incompleto

Fecha: 2026-08-02
Celda: `g6-05-T1-A-r2`
Planning-only: `3fc492fc-55b2-4756-82f3-4cb5735e6742`
Full: `d2baaa3f-6775-4b1f-a884-33893602e86a`

## Hallazgo

La condición A concentró la tarea en una única hoja. La ejecución llegó a
delivery y pasó los gates técnicos, pero el módulo de órdenes entregado no
exportó `listBackorders`, una operación explícita del objetivo. El evaluador
externo lo detectó de forma directa como `TypeError`.

Esto difiere de B-r1 y C-r2, donde la función existía pero la forma del
registro era incorrecta. El patrón común es que los tests locales del agent
no garantizan por sí solos la fidelidad completa del contrato congelado; el
oráculo externo evita contar esos candidates como PASS.

## Clasificación y decisión

Se clasifica como **fallo genuino de la condición**: no hubo fallo de runtime,
timeout ni límite de proveedor. Se preservan candidate, diff, journal,
resultado y veredicto 9/10. No se modifica el candidate y se continúa con la
siguiente celda del diseño.

## Qué no se concluye

- No se concluye que A sea superior o inferior a B/C por este dato aislado.
- No se concluye que haya que relajar la tarea o el oráculo.
- No se concluye confirmación ni falsación de H-G6.
- No se convierte la cobertura 9/10 en 10/10 mediante un parche posterior.
