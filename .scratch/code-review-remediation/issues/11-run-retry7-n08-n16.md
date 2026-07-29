# 11 — Completar el barrido

**What to build:** las dos celdas restantes, para tener tres puntos de escala comparables por construccion.

**Blocked by:** 10, 26.

**Status:** ready-for-agent

- [ ] Ambas corren sobre la misma base y con el mismo executor declarado.
- [ ] Cada resultado queda preservado, incluidos los fallos.
- [ ] Queda registrada la evaluacion de granularidad de la celda mas ancha.

## Progreso 2026-07-28

- `retry-8` preservó resultados terminales atribuibles para N=4, N=8 y N=16,
  todos `failed` antes de candidate; no hubo receipt/SHA y el oráculo quedó
  `not_run`.
- N=8 y N=16 expusieron el mismo defecto productivo: composites y descendientes
  declaraban los mismos `plannedPaths`, y el crítico los trataba como owners
  independientes.
- TDD del fix en `28efda8`: RED `1 failed / 6 passed`; GREEN `38/38`; typecheck
  y build de `@manyhands/decomposer` PASS. El cambio permite sólo el resumen
  ancestro-descendiente y mantiene el rechazo entre ramas incomparables.
- Reviews Standards/Spec: PASS, sin P0/P1/P2/P3. Spec verificó en los journals
  reales que N4 tenía `13/13`, N8 `20/20` y N16 `37/37` duplicados
  ancestro-descendiente, sin ownership entre ramas independientes.
- Pendiente antes de marcar aceptación: nuevo freeze limpio y serie sucesora
  completa `{4, 8, 16}` con targets nuevos. `retry-8` permanece inmutable como
  evidencia adversa.
- `retry-9` quedó congelado en
  `faead8546a9d447200a66b0167836536d558bba4`: Gate P0 exacto PASS, tres
  targets nuevos limpios sobre W1, selección homogénea
  `codex-cli/gpt-5.5/high` y células `{4, 8, 16}` con condición C.
- Pendiente: ejecutar las tres células, preservar cada resultado, correr el
  oráculo sólo ante una entrega y registrar la evaluación N=16.
- `retry-9` N=4 avanzó por planning y comenzó ejecución productiva, pero queda
  descartado como serie comparable. Run
  `3340ab0b-b255-43b5-af33-870e8872b00e`: el primer commit falló por identidad
  Git ausente; la decisión `retry` quedó resuelta, pero una carrera entre el
  runner activo y la route dejó el lifecycle en `waiting_for_input`. No hubo
  candidate/receipt/oráculo; N=8 y N=16 no se iniciaron.
- Corrección TDD en `60eb12f`: fallback Git command-scoped y continuación
  decision-aware que espera el lease anterior y deja que el driver recalcule
  readiness. REDs preservados, GREEN final `17/17`; suite afectada `29/29`;
  typechecks afectados/web PASS; packages build y web build PASS en clon
  aislado. Review inicial Standards encontró P1/P2, ambos corregidos; re-review
  Standards/Spec PASS sin P0/P1/P2/P3.
- Pendiente de aceptación: freeze sucesor nuevo desde N=4, recomendado
  `retry-10`, con targets nuevos. Las tres casillas continúan abiertas.

## Progreso retry-10 y remediacion requerida

- `retry-10` ejecuto N=4, N=8 y N=16 secuencialmente sobre el mismo freeze
  `643a32d`, W1 exacto y `codex-cli/gpt-5.5/high`, con tres targets nuevos.
- Los tres runs fallaron durante compiled plan review antes de candidate por el
  mismo falso positivo: artefacto `analytics-registry -> study-wide-graph-script`
  y seam no ordenante inverso `study-wide-graph-script -> analytics-registry`
  fueron tratados incorrectamente como un ciclo. Cada resultado y
  journal queda preservado con oraculo `not_run`; N=16 conserva su assessment.
- Reviews independientes del fixed point `67a16a1`: Standards FAIL P1 y Spec
  P1. La integridad del freeze pasa, pero falta reduccion, regresion, fix y
  rerun del camino productivo.
- Diagnostico corregido por auditoria: `SeamBinding` no impone readiness segun
  A5. La implementacion lo habia agregado erroneamente al DAG y retry-10
  reprodujo un falso `artifact_cycle`.
- TDD en `cbb8cdb`: seams fuera de la adyacencia; ciclos materiales siguen
  rechazados; prompt producer -> consumer explicito. Suite afectada 69/69 y
  typechecks task-graph/decomposer PASS.
- Ticket 11 permanece abierto y sus casillas no se marcan. Los blockers
  canónicos del cierre de correctness viven en tickets 16--26; el plan es sólo
  un runbook. `retry-10` permanece inmutable.
