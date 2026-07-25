# El límite de sesión no se reconocía como capacidad en ejecución

Clasificación: **defecto productivo de clasificación + interrupción externa**.

## Observación

W1 de `series-10` (run `9cf4852f-d707-46ee-84e4-7487c9040c5a`, ManyHands
`62d5c1f`) superó planning —el fix de throttling funcionó— y llegó a ejecución.
El attempt de la hoja duró nueve segundos:

    13:10:16Z  attempt.started
    13:10:26Z  attempt.failed

    executor_error: The agent exited non-zero without a recognizable cause;
    inspect the stderr tail in the trace.:
    You've hit your session limit · resets 2pm (America/Buenos_Aires)

El supervisor levantó un `resolve_conflict` pidiendo guía humana.

## Causa

`classifyExecutorFailure` ya tenía una clase `quota` con
`retryableOnOtherExecutor: true`, pero su patrón no cubría el fraseo real de
ninguno de los dos CLIs del estudio:

- Claude Code: `You've hit your session limit · resets 2pm`
- Codex: `You've hit your usage limit · resets 2026-07-30 00:37`

Ambos caían en `unknown`, cuya glosa es "the agent exited non-zero without a
recognizable cause". Un rechazo puro de capacidad quedaba presentado como agente
roto, gastaba el intento del nodo y escalaba a una decisión humana que ninguna
persona puede resolver: no hay guía que destrabe una cuota agotada.

Vale la pena notar que la interrupción de Codex documentada el 2026-07-25 cayó
en la misma trampa; el defecto llevaba ahí desde entonces, sin verse, porque
aquel run murió en planning y no en ejecución.

## Corrección TDD

- Rojo: los tres fraseos —Claude, Codex y un aviso genérico de reset— se
  clasificaban `unknown`.
- Verde: `QUOTA_PATTERN` reconoce `(session|usage|message|token) limit`. Los tres
  quedan como `quota`, con `retryableOnOtherExecutor: true`.
- Verificación: 53 tests de execution-core PASS; typecheck PASS.

## Estado

La interrupción en sí sigue siendo externa: la cuota reseteaba a las 14:00 ART.
El run no produjo commit y no se adoptó nada. Resultado acumulado: **0/8**.
