# 11 — Completar el barrido

**What to build:** las dos celdas restantes, para tener tres puntos de escala comparables por construccion.

**Blocked by:** 10.

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
