# 19 — Hacer la validación relevante por criterio

**What to build:** cada criterio sólo puede quedar satisfecho por evidencia pertinente y observable; una receta genérica no puede acreditar criterios heterogéneos por repetición.

**Blocked by:** 18.

**Status:** closed

- [x] RED demuestra que el mismo `pnpm test` genérico no satisface criterios no trazados.
- [x] Obligaciones compilan evidencia criterion-aware con referencias exactas.
- [x] La matriz queda unverified ante criterio sin prueba relevante.
- [x] La matriz claim–evidencia enlaza la nueva prueba antes de elevar CLAIM-040/041.
- [x] Mutación autenticada, suites y reviews Standards/Spec pasan.

## Evidencia de trabajo

- RED: `tests/validation-recipe.test.ts` demostró que dos obligaciones
  heterogéneas recibían el mismo `pnpm test` y quedaban materializadas sin
  trazabilidad.
- GREEN: los contratos enlazan `focused_command`, `static_proof` o
  `shared_command`; el compiler deja sin materializar una obligación sin enlace
  pertinente.
- RED/GREEN integrado: `tests/exact-candidate-validation.test.ts` demuestra una
  sola ejecución física compartida y observaciones criterion-aware durables con
  digest, duración, obligaciones y referencias.
- Fixture adversa: `tests/fixtures/validation/wide-graph-order/` conserva un
  candidato con orden de proyecciones incorrecto; una observación genérica
  exitosa no satisface su criterio.
- Frontera contractual: `tests/contracts-v2.test.ts` rechaza criterios
  compartidos ajenos y referencias focales que no coinciden con los selectors
  realmente ejecutados.
- Gates: 12 archivos/89 tests afectados PASS; suite raíz 212 archivos, 1466
  tests PASS y 2 skips preexistentes; typechecks de `contracts`, `decomposer`,
  `execution-core`, `run-coordinator` y web PASS; build de los 12 packages PASS.
- Mutación autenticada real: landing `200`, cookie emitida, `POST
  /api/workspaces` `201` y lectura persistida con el path físico exacto del clon
  aislado.
- CLAIM-040/041 permanecen `partial` hasta evidencia externa formal.

## Reviews sobre `8eaf3fb`

- Standards: FAIL — P1 porque la pertinencia compartida se autoatribuye; P2
  por tres representaciones paralelas de observación y por incluir duración
  no determinista en `matrixId`.
- Spec: FAIL — el mismo P1 de atribución no observada; P2 porque la fixture
  retry-2 sólo comparaba JSON y no ejercitaba el oráculo value-aware.
- No se implementaron correcciones durante las reviews. El ticket permanece
  `agent-working`; próximos pasos: RED por cada finding, fix sistémico, gates y
  re-reviews independientes.

## Remediación posterior a reviews

- P1: el compiler ya no infiere shared evidence desde co-localización; unidades
  con varios criterios quedan sin binding hasta una declaración explícita.
  `shared_command` ejecuta sus referencias exactas como selectors.
- P2 Spec: `tests/fixtures/validation/wide-graph-order/tests/projections.test.mjs`
  ejecuta un oracle Node real sobre el candidato retry-2 adverso; el validator
  lo reintenta una vez y conserva resultado `failed`.
- P2 Standards: `CriterionEvidenceObservationSchema` es una única definición en
  `@manyhands/shared`, consumida por contratos, execution-core y
  run-coordinator; incluye pass/fail, intento y digest de salida.
- P2 identidad: `matrixId` excluye la duración observada, pero conserva todos
  los campos deterministas de resultado y atribución.
- Primer gate raíz posterior: 211/212 archivos pasaron; el único fallo fue la
  frontera que prohíbe `run-coordinator -> contracts`. La definición canónica se
  movió a `shared`; el test de frontera y 24 pruebas relacionadas pasan.
- Gates finales de la remediación: 13 archivos/104 tests afectados PASS; suite
  raíz 212 archivos/1472 tests PASS con 2 skips preexistentes; typechecks de
  `shared`, `contracts`, `decomposer`, `execution-core`, `run-coordinator`,
  `orchestrator-graph` y web PASS; build de los 12 packages PASS.
- Pendiente obligatorio: fijar el commit y obtener re-reviews independientes
  Standards/Spec sin P0/P1/P2/P3.

## Re-reviews sobre `7b020e3`

- Standards PASS: 0 P0/P1/P2/P3; confirmó resueltos los tres findings previos.
- Spec FAIL: 0 P0/P1, 1 P2, 0 P3. La frontera permitía bindings incompatibles
  con su capa o `acceptableEvidence`, y el recipe etiquetaba la ejecución con
  el primer tipo aceptable en vez del tipo realmente producido.
- RED: contratos con `static_proof` en capa ejecutable, comandos en capa
  `static` o evidencia producida no aceptada eran válidos; un
  `focused_command` se registraba como `runtime_observation`.
- GREEN: el contrato valida capa, binding y tipo producido; el compiler deriva
  `static_analysis` o `test_result` del binding observable.
- Gates posteriores: 14 archivos/132 tests afectados PASS; suite raíz 212
  archivos/1474 tests PASS con 2 skips preexistentes; seis typechecks de
  paquetes, web typecheck y build de los 12 packages PASS.
- Commit de remediación: `2cf5814`.
- Re-reviews finales sobre `2cf5814`: Standards PASS y Spec PASS, ambas con
  0 P0/P1/P2/P3. Ningún reviewer implementó correcciones.
- Ticket cerrado el 2026-07-29. CLAIM-040/041 permanecen `partial`; ticket 20
  es la próxima frontera.
