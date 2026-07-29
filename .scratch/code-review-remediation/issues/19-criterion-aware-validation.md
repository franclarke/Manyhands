# 19 — Hacer la validación relevante por criterio

**What to build:** cada criterio sólo puede quedar satisfecho por evidencia pertinente y observable; una receta genérica no puede acreditar criterios heterogéneos por repetición.

**Blocked by:** 18.

**Status:** agent-working

- [ ] RED demuestra que el mismo `pnpm test` genérico no satisface criterios no trazados.
- [ ] Obligaciones compilan evidencia criterion-aware con referencias exactas.
- [ ] La matriz queda unverified ante criterio sin prueba relevante.
- [ ] La matriz claim–evidencia enlaza la nueva prueba antes de elevar CLAIM-040/041.
- [ ] Mutación autenticada, suites y reviews Standards/Spec pasan.

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
