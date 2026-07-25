# Codex usage limit — 2026-07-25

Clasificación: **interrupción externa; run no evaluable**.

## Evidencia

- Run: `efa0a8cc-b293-4082-bf59-b502b213f150`.
- Base: seed `0f87e457ae154385cbb81bb6e3541a3533b78761` en clon limpio.
- ManyHands: `7e99fc41c79a56205add4e09b23448b284574984`.
- Attempts de planning: 3.
- Resultado de cada attempt: exit code 1, `envelopes=none`, `stdoutBytes=0` y
  mensaje `You've hit your usage limit`.
- Próximo acceso informado por el proveedor: 2026-07-30 00:37.

## Interpretación

El run no ejercitó la nueva validación de fidelidad: el modelo no devolvió un
candidate. Tampoco ejercitó C2 ni execution. Por eso no cuenta como fracaso W1,
no modifica el denominador experimental y no justifica cambios de código.

## Reanudación

Después de recuperar cuota, crear otro clon desde el seed y otra serie de salida.
Mantener la misma versión conductual, modelo, esfuerzo, prompts y oráculos salvo
que una verificación previa revele drift; registrar el nuevo HEAD exacto aunque
sólo agregue esta evidencia. Ejecutar primero el dry-run y luego W1; no reanudar
sobre `series-3` ni sobre un target con entrega previa.
