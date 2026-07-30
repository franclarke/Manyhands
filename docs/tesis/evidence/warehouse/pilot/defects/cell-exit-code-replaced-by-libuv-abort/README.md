# El código de salida de una celda lo reemplazaba un abort de libuv

## Hecho observado

En el HEAD `6738005`, antes de cualquier cambio de esta sesión, el caso
`runs one attributable oracle before delivery and reuses its receipt after
restart` de `tests/wide-graph-oracle-contract.test.ts` fallaba de forma
reproducible: esperaba `code: 1` y recibía `3221226505`.

La captura del stderr del hijo muestra que el driver hizo todo su trabajo y
alcanzó su conclusión correcta —

```
[…] lifecycle=failed finalSha=none
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

— y recién entonces abortó. `3221226505` es `0xC0000409`
(`STATUS_STACK_BUFFER_OVERRUN`), el código con el que Windows reporta ese
`abort()`. La causa es llamar `process.exit()` mientras los sockets HTTP del
driver todavía se están cerrando.

## Por qué importa para la evidencia

`run-g5.mjs` clasifica cada celda por el código de salida de
`run-experiment.mjs`: `outcome: code === 0 ? "completed" : "not_delivered"`. Un
código de salida que puede ser reemplazado por un abort del runtime hace que la
clasificación de una celda dependa del timing de cierre de sockets. En este caso
el abort no cambió la conclusión —ambos códigos son distintos de cero— pero la
misma carrera puede ocurrir en una celda entregada, y ahí sí convertiría un
`completed` en `not_delivered`.

## Corrección

`run-experiment.mjs` fija `process.exitCode` y deja que Node drene sus handles
en vez de forzar la salida. El caso que fallaba pasa sin ningún otro cambio, y
el gate afectado queda en 26/26.

## Evidencia primaria

- `docs/tesis/evidence/scripts/run-experiment.mjs`
- `tests/wide-graph-oracle-contract.test.ts`
- `tests/wide-graph-study.test.ts`

## Qué no se concluye

- No se concluye que alguna celda ya preservada haya sido mal clasificada por
  esta causa. En `retry-8`, `retry-10` y `retry-11` ninguna celda produjo
  candidate, así que ninguna podía haber salido con `0`; sus resultados no
  cambian y no se reinterpretan.
- No se concluye nada sobre el producto: el defecto está en el driver del
  experimento, no en ManyHands.
- No se concluye que `fail()` esté libre del mismo riesgo. Su salida sigue
  usando `process.exit(2)`; se dejó intacta porque cualquier código distinto de
  cero significa "celda abortada" y cambiarla no estaba respaldado por una
  regresión observada.
