# Checkpoint 2 — integración productiva de C

> **Fecha:** 2026-07-24 · **Tasks:** 5–8 · **Estado:** PASS.

## Entregables

| Task | Commit | Resultado |
|---|---|---|
| 5 | `bf0ee82`, `18e6aab` | feedback semántico y un replan acotado en la ruta productiva |
| 6 | `d96cc24` | ownership único de acceptance intents por deepest owner/LCA |
| 7 | `a424ade`, `7f7d9b4` | evento C replayable y explicación visible en el inspector |
| 8 | `18e6aab` | A/B/C1/C por run, C default y replay bloqueado de candidato |

## Evidencia TDD

1. El test de contratos falló porque el asignador y el mapa de ownership no
   existían; luego demostró cinco criterios de usuario —no catorce— bajo A, B y
   C, manteniendo una obligación local en cada nodo.
2. El evento C falló inicialmente como discriminador desconocido; luego
   sobrevivió schema, journal, reducer, snapshot y presenter sin modificar el
   evento histórico de C1.
3. Las condiciones explícitas y el candidate replay fallaron por APIs ausentes;
   luego quedaron configurables y validados por hash, snapshot, goal y entrada
   de aceptación.
4. La prueba vertical forzó una hoja de 30 000 tokens medidos; C pidió una sola
   revisión semántica y aceptó el corte posterior de tres hijos cohesivos.

## Verificación de cierre

```powershell
pnpm vitest run tests/granularity-context-profile.test.ts tests/granularity-utility-policy.test.ts tests/contract-acceptance-allocation.test.ts tests/granularity-policy-conditions.test.ts tests/planning-candidate-replay.test.ts tests/run-record-schema.test.ts tests/planning-v2-adaptive.test.ts tests/planning-v2-pipeline.test.ts tests/run-granularity-assessed.test.ts tests/run-granularity-strategy-selected.test.ts tests/cockpit-granularity-explanation.test.ts tests/run-model-presentation.test.ts
pnpm --filter @manyhands/decomposer typecheck
pnpm --filter @manyhands/run-coordinator typecheck
pnpm --filter @manyhands/decomposer build
pnpm --filter @manyhands/run-coordinator build
pnpm --filter @manyhands/web exec tsc --noEmit
git diff --check
```

Resultado:

- 12 test files PASS;
- 50 tests PASS;
- tres typechecks PASS;
- ambos builds PASS;
- `dist/index.js` de decomposer contiene `adaptive-utility/2.0.0-pilot`;
- `git diff --check` PASS.

## Invariantes demostrados

- C es el default productivo; C1 y el alias histórico `C` siguen replayables;
- A y B consumen el mismo árbol semántico que C y no requieren editar código;
- una hoja inviable genera como máximo un replan semántico, nunca un split por
  carpetas o paths;
- un candidato experimental sólo se reutiliza si coincide su identidad
  completa; el Planner vivo sigue siendo obligatorio en la línea longitudinal;
- cada acceptance intent del usuario se compila una vez, aun cuando cruce
  siblings;
- la selección persiste configuración, hash, features, beneficio, costo,
  evidencia, razón y métricas estructurales;
- la UI explica C1 y C exclusivamente desde hechos replayados.

## Límite del checkpoint

La ruta está implementada, pero todavía no constituye evidencia experimental.
El checkpoint 3 debe cerrar derivación no censurada, suites amplias, build web y
dos runs reales de estabilidad sobre un mismo commit antes de declarar C-G2.
