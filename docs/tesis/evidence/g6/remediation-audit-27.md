# Auditoría de C-r2 — incumplimiento semántico repetido

Fecha: 2026-08-02
Celda: `g6-04-T1-C-r2`
Planning-only: `52d089df-99e4-494a-a8ce-c09abb987fd6`
Full: `a0f0edba-94e7-4fd7-9405-df62f9be7eda`

## Hallazgo

El plan compilado y la tarea congelada describen `Backorder` con
`orderId`, `skuId` y `missing` positivo. El candidate de C-r2 implementó un
registro por línea, pero llamó `quantity` al faltante. Sus tests locales
pasaron porque verificaron esa forma equivocada; el evaluador externo la
detectó sobre el SHA entregado.

El mismo criterio ya había fallado en el candidate B-r1, que usó `lines` y
`priority`. La repetición B/C descarta un problema de timeout o de delivery y
señala una debilidad real de fidelidad semántica en la implementación del
agente y en la validación local que éste produce.

## Clasificación y decisión

La etapa se clasifica como **fallo genuino de la condición**: hubo candidate,
ejecución completa y veredicto externo 9/10. Se preservan todos los artefactos
y se continúa con la siguiente celda del diseño sin modificar el estímulo,
criterios, oráculo, fórmula o `minimumAdvantage`.

## Qué no se concluye

- No se concluye que C sea peor que A o B por esta sola repetición.
- No se concluye que haya que relajar el contrato para obtener PASS.
- No se concluye confirmación ni falsación de H-G6.
- No se convierte el 9/10 en 10/10 mediante un parche posterior del candidate.
