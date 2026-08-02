# B-r2 — auditoría del fallo pre-candidate y fix del planner

Fecha: 2026-08-02
Celda oficial: `g6-06-T1-B-r2`
Run fallido: `3388e8d7-3464-4c5a-b9e6-2c61d0dbcecc`

## Resultado observado

La planning-only de la celda compiló y quedó preservada. La full terminó
pre-candidate después de su único intento de planning, con:

`WorkBreakdown planning failed after 1 attempts: acceptanceIntents.0.required: Required; acceptanceIntents.1.required: Required`

No se ejecutaron hojas, no hubo candidate, delivery, costo de ejecución ni
oráculo. La celda oficial no se reintenta.

## Causa raíz

La salida del modelo contenía `acceptanceIntents`, pero omitía el campo
estructural `required` en dos entradas. El prompt de salida lo muestra como
`required: true`, y el schema lo exige; por eso la validación cerrada rechazó
correctamente el documento. Es una omisión serializadora del modelo que
consume una celda antes de que pueda medirse la ejecución.

## Fix aplicado con TDD

Se agregó `restoreAcceptanceIntentRequiredDefaults` al planner. Antes de la
validación, completa con `required: true` únicamente cuando la propiedad fue
omitida. Valores presentes —incluidos `null` o tipos incorrectos— siguen
siendo rechazados por Zod. La regresión fue roja primero (1 falló, 28 pasaron)
con el error exacto de la celda; luego `pnpm build` pasó y el test focal pasó
29/29.

El fix no cambia el estímulo, el oráculo, los criterios, la fórmula ni
`minimumAdvantage`. La full B-r2 fallida permanece intacta; una nueva corrida,
si se ejecuta, tendrá otro directorio y será claramente una remediación.

## Qué no se concluye

- No se concluye que B-r2 oficial haya producido un plan o candidate válido.
- No se concluye nada sobre los criterios externos ni sobre H-G6 a partir de
  este fallo pre-candidate.
- No se concluye que completar un campo omitido garantice fidelidad semántica
  del código que el agente implemente.
