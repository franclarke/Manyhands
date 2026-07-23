# Registro duradero de progreso — Cierre de tesis (Etapas 2–6)

> Registro continuo exigido por GOAL.md. Permite reanudar el trabajo si la
> sesión se interrumpe. Se actualiza al cerrar cada hito, no solo al final.
> Inicio de ejecución: 2026-07-23 (UTC). Commit de partida: `5355d4b`.

## Estado por etapa

| Etapa | Gate | Estado | Evidencia |
|---|---|---|---|
| 1 — Congelar alcance | G1 | **PASS** (aprobado por Francisco, D-1..D-4) | `docs/tesis/*.md`, `evidence/baselines/stage-1-baseline.md` |
| 2 — Toolchain y gates | G2 | **PASS** (commit `d552c5d`) | `evidence/gates/g2-gate-results.md`, `g2-fresh-install.md` |
| 3 — Aporte adaptativo | G3 | pending | — |
| 4 — Run canónico | G4 | pending | — |
| 5 — Experimento | G5 | pending | — |
| 6 — Tesis y presentación | G6 | pending | — |

## Decisiones adoptadas

- **D-1..D-4:** aprobadas por Francisco (ver `research-questions.md` §4).
- **D-5:** escenario del run canónico — se confirma al iniciar Etapa 4; default:
  feature vertical sobre app TS pequeña externa (GOAL.md sugiere escenarios tipo
  división de gastos / tareas / inventario).
- **D-6 (adoptada):** pnpm 7.29.3 + lockfile 5.4. **Limitación local:** Node 22
  no está instalado (nvm local solo tiene 18/19; Node activo = 24.16.0 de
  instalación directa; instalar 22 requeriría descarga/elevación). Gates locales
  corren sobre Node 24.16.0; CI queda como autoridad de Node 22; `engines` se
  fija `>=22`.
- **D-7 (adoptada):** señales de complejidad híbridas — LLM propone, validador
  determinista acota contra `RepositorySnapshot`.
- **D-8 (adoptada):** el `RecursiveDecomposer` emite señales y delega la frontera
  leaf/composite a la política adaptativa (un solo planificador).

## Bitácora

### 2026-07-23 — Sesión de ejecución (inicio)

1. G1 cerrado `PASS` (Francisco aprobó D-1..D-4). Commit `b9c4e68` con los
   entregables G1 + GOAL.md.
2. Etapa 2: toolchain alineada — `packageManager: pnpm@7.29.3`, `engines`
   (`node >=22`, `pnpm 7.29.3`), `.nvmrc` = 22.
3. **Bug de entorno (causa raíz):** `node_modules/simple-git` era una junction
   huérfana hacia `C:\Users\franc_rgy\...\manyhands-isolated-typecheck\...`
   (workspace temporal de otro perfil). Eliminada la junction (`rmdir`, solo el
   link). Además `.modules.yaml` marcaba como *skipped* binarios win32-x64
   necesarios (`@esbuild/win32-x64@0.27.7`, sharp, tailwind oxide) por un install
   previo roto → `pnpm install --frozen-lockfile --force` re-materializó el
   virtual store (75s, lockfile sin cambios de contenido).
4. Gates: `pnpm build` EXIT 0 (47s) · packages typecheck EXIT 0 (19s) · web tsc
   EXIT 0 (10s) · suite inicial 3 fallos / 1068 pass.
5. **Regresiones UI reparadas (TDD, sin debilitar invariantes):**
   - `run-canvas-no-auto-fit.test.ts`: assertaba el wiring viejo de
     `MinimalRunGraph`/`RunGraphCanvas` (0 consumidores — código muerto). Se
     eliminó `apps/web/src/components/run-model/minimal-run-graph.tsx` y el test
     ahora guarda el invariante A17 repo-wide (prohíbe `.fitView(`/`.setCenter(`/
     `.setViewport(`/`fitView=` en todo apps/web/src) + exige `defaultViewport`
     estático y `showFitView={false}` en el canvas productivo. Más estricto que
     antes.
   - `typography-scale.test.ts`: 21 usos `text-[10px]`/`text-[11px]` y un
     `px-2.5` en los 5 componentes cockpit nuevos → `text-micro` (piso 11px del
     sistema) y `px-2`.
6. Suite completa tras fixes: **181 files / 1072 passed / 2 skipped, EXIT 0, 88s**
   (2 skipped = kill-test POSIX en Windows, por diseño).
7. CI: agregados pasos `Typecheck (packages)` y `Build (web)` para equivalencia
   con los gates locales; comentario del lint actualizado (46 errores
   preexistentes, no-bloqueante, no es gate de tesis).

8. `web:build` EXIT 0 (116s). Commits `0757e55` (toolchain) y `d552c5d` (fixes
   UI). Fresh clone desde `d552c5d`: install 0 (35s, lockfile intacto), build 0
   (43s), test 0 (82s, 181/1072). **G2 = PASS.** Evidencia en
   `evidence/gates/g2-*.md`.

### Etapa 3 (en curso)

9. Diseño ajustado por evidencia: el planner productivo V2 es
   `WorkBreakdownPlanner` (no el `RecursiveDecomposer`, que es de la ruta legacy
   `/api/runs`). El punto de integración es entre `plan()` y `compile()` en
   `runPlanningV2`. D-8 se aplica sobre el planner productivo.
10. TDD: creado `tests/decomposer-adaptive-planning.test.ts` (rojo verificado por
    ZodError del schema estricto). Implementados: `ComplexitySignalsSchema`
    opcional en `WorkUnit` (planner/schema.ts) y
    `granularity/adaptive-planning.ts` (`applyAdaptiveGranularity`, formula
    version `c-task/1.0.0`, validación híbrida D-7: llm/clamped/derived, bridge a
    `compileAdaptiveWorkUnitTree`, preservación de campos semánticos, métricas
    estructurales).

## Siguiente acción exacta

- Correr `tests/decomposer-adaptive-planning.test.ts` hasta verde.
- Prompt del planner: instruir `complexitySignals` + shape.
- Evento `planning.granularity_assessed` en run-coordinator (schema + reducer +
  proyección) y emisión en `planning-host.ts` entre plan() y compile().
- Test vertical `runPlanningV2` + replay. Luego gates completos y commit G3.
