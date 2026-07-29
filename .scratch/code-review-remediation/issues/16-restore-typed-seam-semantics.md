# 16 — Restaurar la semántica tipada de seams

**What to build:** `SeamBinding` expresa compatibilidad contractual sin convertirse en una dependencia de ejecución; artifacts y restricciones ordenantes conservan la detección de ciclos.

**Blocked by:** None.

**Status:** closed

- [x] Regresiones RED/GREEN cubren artifact + seam inverso y loops sólo de seams.
- [x] El prompt distingue producer, consumer y comandos sin consumidor interno.
- [x] Contrato técnico, evidencia histórica y HANDOFF no llaman ciclo material al falso positivo.
- [x] Suites y typechecks afectados pasan.
- [x] Reviews independientes Standards y Spec pasan sin P0/P1/P2.

## Registro de cierre

- Base de diagnóstico: `5f32d19`; fixed point revisado: `1745c0c`.
- Implementación: `cbb8cdb` (`packages/task-graph/src/validate-v2.ts`, prompt y regresiones); corrección documental inicial: `fdcbe84`.
- RED válido: `pnpm exec vitest run tests/task-graph-artifact-cycles.test.ts` produjo 2 fallos porque artifact + seam inverso y loop sólo de seams se clasificaban como `artifact_cycle`.
- GREEN: 5 archivos, 69/69 tests; typechecks `@manyhands/task-graph` y `@manyhands/decomposer` PASS con Node 22.23.1/pnpm 7.29.3.
- Remediación de reviews: tickets canónicos 16–26, DoD P0/P1/P2, contrato DAG y frases históricas coherentes; CLAIM-020/021/040/041/053 degradados conservadoramente a `partial`.
- Reviews finales, orden explícita “No implementes correcciones”: Standards PASS y Spec PASS sobre `1745c0c`, sin P0/P1/P2; Spec además sin P3.
- Evidencia adversa retry-9/retry-10 y sus JSON/JSONL/manifests/cells/freeze permanecen inmutables.
- Siguiente frente desbloqueado: 17.
