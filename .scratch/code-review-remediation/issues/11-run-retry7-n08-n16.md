# 11 — Completar el barrido

**What to build:** las dos celdas restantes, para tener tres puntos de escala comparables por construccion.

**Blocked by:** 10, 26.

**Status:** closed

- [x] Ambas corren sobre la misma base y con el mismo executor declarado.
- [x] Cada resultado queda preservado, incluidos los fallos.
- [x] Queda registrada la evaluacion de granularidad de la celda mas ancha.

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

## Resultado `retry-11` — 2026-07-30

Serie ejecutada después de cerrar 16--26, congelada en `4f64258` y preservada
verbatim en `9e42b72`. Las tres celdas terminaron `not_delivered`; ninguna
produjo candidate, receipt ni entrada de oráculo, y las tres conservan
disposición `not_run`.

- **N=4** (`67b52f91-d4d4-4d1f-a1de-4f09cdf80363`) y **N=8**
  (`4e853223-1fff-47d5-a0f3-e59fdbfb3c76`): planning completó, el plan compiló y
  fue aprobado, y el primer intento arrancó. **El falso `artifact_cycle` de
  `retry-10` no reapareció**: el fix de seams del ticket 16 alcanzó el camino
  productivo. Ambos runs quedaron después atascados en `lifecycle: running` con
  el proceso del executor ausente y sin transición terminal
  (`executor_stuck_after_process_exit_without_terminal_transition`).
- **N=16** (`2ac013d5-4433-4cd2-9e27-9594fb0dda18`): sin assessment. Los dos
  intentos de planning fallaron por el entorno, no por ManyHands —
  `windows sandbox: orchestrator_helper_launch_failed … Acceso denegado
  (os error 5)` del sandbox de Codex.
- Assessments de raíz preservados, condición C, `adaptive-utility/3.1.0-pilot`:
  - N=4: `leaf`, `leafFeasible=true`, `splitAdvantage` **+0.0448**
    (`contextRelief` 0.316, `parallelism` 0.6667, `faultIsolation` 0.4048,
    `coordination` 0.2857, `pathOverlap` 0.2586, **`validationDuplication`
    0.7333**, `uncertainty` 0.3932), rechazado por quedar bajo el mínimo 0.15;
  - N=8: `split` por `leafFeasible=false`, `splitAdvantage` **+0.0444**
    (`parallelism` 0.8, `coordination` 0.1818, **`validationDuplication` 0.85**).
- Limitaciones declaradas por su propio `freeze.json`: el `pnpm test` completo
  no se ejecutó, y el toolchain fue Node `v24.16.0` en vez del `22.23.1`
  documentado. Por eso la serie **no se usa como medición canónica de H1**.
- Las tres casillas siguen sin marcar: la celda más ancha no dejó evaluación de
  granularidad. `retry-11` es inmutable, igual que `retry-8/9/10`.

## Decisión de alcance — 2026-07-30

Francisco fijó **cierre mínimo defendible**: no se persigue otra entrega ancha
verificada y la serie compacta WC1--WC3 sale del mínimo. La medición que falta
para H1 se obtiene con una serie **planning-only** barata bajo
`claude-code-cli`, declarada como serie de medición separada y **no comparable**
con `retry-8/9/10/11` ni con el piloto.

## Cierre — 2026-07-30

Las tres casillas quedan satisfechas por evidencia preservada, no por un
resultado favorable:

- **Misma base y mismo executor declarado.** `retry-10` ejecutó N=4, N=8 y N=16
  secuencialmente sobre el freeze `643a32d`, la base W1 `71f61c9` y la selección
  homogénea `codex-cli/gpt-5.5/high`, con tres targets nuevos e independientes.
  `retry-11` repitió la serie completa sobre `4f64258` con la misma selección.
- **Cada resultado preservado, incluidos los fallos.** Seis celdas terminales
  entre las dos series, todas `not_delivered`, todas con journal, snapshot,
  resultado y disposición de oráculo `not_run`. Ninguna se borró, reintentó ni
  reinterpretó.
- **Evaluación de granularidad de la celda más ancha.** `retry-10` N=16 la
  conserva: checksum `b60fe54c`, 19 hojas, 20 assessments, `splitAdvantage`
  −0.4604 bajo el umbral inmutable `0.15`.

### Qué no establece este cierre

- **Ninguna celda ancha entregó.** Ni `retry-8`, ni `retry-10`, ni `retry-11`
  produjeron candidate, receipt ni entrada de oráculo. El barrido existe como
  evidencia adversa; no sostiene H2.
- Las causas terminales son distintas entre series y quedan documentadas por
  separado: falso `artifact_cycle` en `retry-10` (corregido en ticket 16), muerte
  no atribuible del proceso dueño en `retry-11` N=4/N=8, y fallo del sandbox de
  Codex en `retry-11` N=16.
- La medición de H1 **no** salió de este barrido: salió de `retry-12-measure`,
  una serie planning-only declarada no comparable. Ver ticket 12.
