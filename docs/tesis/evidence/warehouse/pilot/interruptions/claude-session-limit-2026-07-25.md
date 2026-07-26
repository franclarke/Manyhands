# Claude Code session limit — 2026-07-25

Clasificación: **interrupción externa; ejecución no evaluable**.

## Evidencia

- Serie: `series-7`. Run: `50db1be4-0c16-4ed4-88d4-31d71e25ed58`.
- Base: seed `0f87e457ae154385cbb81bb6e3541a3533b78761` en clon limpio `pilot-7`.
- ManyHands: `cdb3466` (fenced-specimen fidelity).
- Executor: Claude Code CLI `sonnet` en planning, ejecución y repair.

Cronología del run:

    05:42:37Z  -> planning
    05:46:28Z  -> needs_approval        (plan aprobado por el driver)
    05:46:36Z  -> running
    05:48:27Z  -> waiting_for_input

El attempt de la hoja terminó en `failure.classified` + `attempt.failed` con

    executor_error: The agent exited non-zero without a recognizable cause
    ... You've hit your session limit · resets 6:50am (America/Buenos_Aires)

y el supervisor levantó un `resolve_conflict`. El driver se detuvo ahí, como
exige el protocolo: sólo aprueba plan y entrega, nunca una decisión no
pre-registrada.

## Qué sí quedó demostrado

Es el primer run del piloto que **supera planning**. Las tres correcciones de
esta sesión se ejercitaron y ninguna volvió a disparar:

- el feedback de reparación llegó limpio, sin envelopes `planning.node`;
- `plannedPaths` no reincidió en `package.json`;
- la regla de fidelidad aceptó el contrato renderizado.

C emitió una decisión real y persistida sobre el instrumento endurecido:
`totalLeafCount = 1`, `maxGraphDepth = 0`, `minimumAdvantage = 0.15`,
`candidateTreeHash = sha256:94852cdc…`. Colapsó a hoja única, que es la
decisión esperada para el primer incremento sobre un seed vacío.

## Interpretación

La interrupción ocurrió en el agente de código, no en ManyHands ni en C. No
cuenta como fracaso de W1, no modifica el denominador experimental y no
justifica cambios de código. La entrega no existe: **no hay commit y no se
adoptó nada**.

## Reanudación

Después del reset, clon nuevo desde el seed y serie nueva, con la misma versión
conductual salvo que una verificación previa revele drift. Ejecutar primero el
dry-run. No reanudar sobre `series-7` ni sobre `pilot-7`, que ya tiene un run
con decisión pendiente.

Nota operativa: el executor comparte la cuota de la sesión interactiva que
conduce el piloto. Conviene lanzar la serie cuando esa cuota esté fresca, porque
cada incremento consume agente además de orquestador.
