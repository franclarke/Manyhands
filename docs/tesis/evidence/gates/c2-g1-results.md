# C-G1 — selector, señales y contratos

> **Fecha:** 2026-07-24 · **Commit:** `cf6db65` · **Resultado:** PASS.

## Alcance

C-G1 verifica que el instrumento determinista existe antes de usarlo en runs:

- contexto medido desde snapshots versionados;
- selector bottom-up A/B/C sin cortes sintéticos;
- replan semántico acotado;
- ownership no duplicado de aceptación;
- métricas que conservan fallos y distinguen cero, unavailable y not applicable.

## Evidencia

- Suite enfocada del checkpoint 2: 50 tests PASS.
- `tests/thesis-study-metrics.test.ts`: 3 tests PASS.
- Rederivación histórica: 12 celdas G5 regeneradas sin cambiar el lector de
  journals ni perder compatibilidad.
- C compilado: `packages/decomposer/dist/index.js` contiene
  `adaptive-utility/2.0.0-pilot`.

## Conclusión

El componente y su medición satisfacen C-G1. Este gate no afirma estabilidad
de runs reales ni ventaja experimental.
