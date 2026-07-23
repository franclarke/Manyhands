# Registro duradero de progreso — Cierre de tesis (Etapas 2–6)

> Registro continuo exigido por GOAL.md. Permite reanudar el trabajo si la
> sesión se interrumpe. Se actualiza al cerrar cada hito, no solo al final.
> Inicio de ejecución: 2026-07-23 (UTC). Commit de partida: `5355d4b`.

## Estado por etapa

| Etapa | Gate | Estado | Evidencia |
|---|---|---|---|
| 1 — Congelar alcance | G1 | **PASS** (aprobado por Francisco, D-1..D-4) | `docs/tesis/*.md`, `evidence/baselines/stage-1-baseline.md` |
| 2 — Toolchain y gates | G2 | **PASS** (commit `d552c5d`) | `evidence/gates/g2-gate-results.md`, `g2-fresh-install.md` |
| 3 — Aporte adaptativo | G3 | **PASS** (`3a52b8b`) | `evidence/gates/g3-adaptive-integration.md` |
| 4 — Run canónico | G4 | **PARTIAL** (1 run `completed` de 4) | `evidence/canonical-run/` |
| 5 — Experimento | G5 | **BLOCKED** (no ejecutado) | `evidence/experiment/protocol.md` |
| 6 — Tesis y presentación | G6 | **PARTIAL** (tesis reescrita; PDF no compilable) | `docs/tesis/main.tex`, `evidence/thesis-reference-analysis.md` |

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

11. **G3 = PASS** (commit `3a52b8b`). Suite 185 files / 1085 tests, exit 0.
    Evidencia: `evidence/gates/g3-adaptive-integration.md`.

### Etapa 4 (en curso) — run canónico

12. **Cambio de regla (Francisco, 2026-07-23):** Codex para planning **y**
    ejecución (reemplaza Claude Sonnet en planning).
13. Codex CLI 0.141.0 autenticado con cuenta ChatGPT. `gpt-5-codex`,
    `gpt-5.1-codex*` y `gpt-5` **no soportados** con esa cuenta; el default del
    config (`gpt-5.6-sol`) exige CLI más nuevo. **Modelo elegido: `gpt-5.5`**
    (probado OK).
14. Repo objetivo creado fuera de ManyHands:
    `~/manyhands-thesis-targets/expense-splitter` (TS, dominio + API + web +
    tests, 5 tests verdes, typecheck limpio). Base SHA `1da878d`.
15. **Run 1 (`890f19e1`)**: planning adaptativo con Codex real **funcionó** —
    `planning.granularity_assessed` persistido, señales `llm` aceptadas, grafo
    compilado. Pero el grafo salió patológico: **23 conflict constraints para 9
    nodos** y partes `:part-N` con **scopes idénticos**.
16. **Bug A (causa raíz):** las partes sintetizadas heredaban *todos* los
    `evidenceIds` del padre, así que el contract-compiler les daba el scope
    completo del padre. Además `synthesizeUnits` tenía un fallback degenerado
    que duplicaba todos los paths. Regresión agregada + corregido (evidencia por
    slice, sin fabricar partes sin trabajo disjunto).
17. **Run 2 (`8074fd46`)**: `planning.failed` — `candidate ... references
    unknown producer/consumer`. **Bug B (causa raíz):** al reshapear el árbol no
    se remapeaban `candidateArtifacts`/`candidateSeams`, así que las referencias
    a unidades fusionadas/colapsadas quedaban colgando. Regresión + corregido
    (`absorptionMap` + `remapRelations`, descarta auto-referencias).
18. **Run 3 (`88263695`)**: planning limpio al primer intento. Grafo sano: 5
    nodos, **3 conflictos** (antes 23), scopes distintos, coalescencia real
    (`domain-category-totals` + `web-category-breakdown` fusionados). Plan
    aprobado → ejecución real: 3 attempts en worktrees aislados (pool 2 slots),
    2 waves, agentes Codex exit 0 (125s/144s/184s). **Los 3 fallaron con
    `scope_violation`.**
19. **Bug C — hallazgo empírico decisivo.** Las partes sintetizadas reciben
    particiones mecánicas de paths que no corresponden a unidades de trabajo
    coherentes (`part-2` recibió solo `src/domain/expense.ts`; el agente
    necesitaba también el test y el tipo). **Causa raíz sistémica:** la política
    determinista puede *detectar* exceso de complejidad, pero **no puede
    inventar el corte semántico** — eso es responsabilidad del Architect
    (`DECISIONS.md` A4). Corrección: se retiró por completo `synthesizeUnits`;
    cuando el Architect no propone sub-unidades se conserva la hoja cohesiva y
    se registra `resplit_declined` con su rationale. El run canónico produjo la
    evidencia que justifica esta decisión de diseño.

## Siguiente acción exacta

- Verificar suite completa tras el retiro de la síntesis; commit del fix.
- Relanzar el run canónico (Run 4) y llevarlo hasta `completed` con delivery.
- Escribir `evidence/canonical-run/` con el paquete completo.


### Etapas 4–6 — cierre de sesión (2026-07-24)

20. **Run canónico completado.** Run `55f8ba9f` alcanzó `completed`:
    `finalSha c48835a ≠ base 1da878d`, 4 archivos (+104/−5), manifest + receipt
    confirmados, 12 tests verdes y typecheck limpio verificados **en clon
    limpio**. Ejecutor Codex `gpt-5.5` en planning y ejecución.
21. **Defectos adicionales corregidos con regresión previa:**
    - delivery bloqueada por el propio `.manyhands/` del target (`9338419`);
    - clasificación de fallo por causa real, no `execution_failed` genérico
      (`a73c6ba`) — verificado en run 6: `scope_unexpected_commit`, `discard: true`;
    - el motivo de una violación de alcance volcaba el diff en vez de nombrar
      las rutas (`225881d`).
22. **Reproducibilidad: 1 de 4 runs completó.** Causa raíz caracterizada: bajo
    política `strict`, un archivo fuera de `allowedPaths` se rechaza; el objetivo
    invita a crear tests nuevos que el planner no pre-declaró. **No se relajó la
    política** (invariante de seguridad). Tres líneas de solución documentadas en
    `evidence/canonical-run/README.md` §7.
23. **G5 no ejecutado**, con razón declarada y procedimiento de reanudación en
    `evidence/experiment/protocol.md`. La tesis no afirma superioridad de la
    política adaptativa.
24. **Tesis reescrita íntegramente** (`docs/tesis/main.tex`): nueva estructura de
    9 capítulos derivada del análisis de tesinas de referencia
    (`evidence/thesis-reference-analysis.md`), bibliografía reconstruida a 24
    referencias verificables (se eliminaron 3 fabricadas), SQLite WAL y los
    números `GEI` removidos, privacidad y WCAG matizados, rótulos «V3»
    eliminados, y un capítulo de evaluación basado en el run real incluido el
    resultado negativo.
25. **PDF no compilado:** no hay toolchain LaTeX en el entorno
    (`pdflatex`/`xelatex`/`latexmk`/`tectonic` ausentes). Limitación de entorno,
    no del documento.
26. Suite final: **187 archivos, 1099 tests, 2 skipped, exit 0**.

## Siguiente acción exacta (para reanudar)

1. Resolver la causa raíz de las violaciones de alcance
   (`evidence/canonical-run/README.md` §7, opciones a/b/c).
2. Repetir el caso canónico hasta obtener dos ejecuciones válidas consecutivas → cerrar G4.
3. Parametrizar umbral y críticos por run; ejecutar el protocolo de G5.
4. Instalar una toolchain LaTeX y compilar `docs/tesis/main.tex`; revisar el PDF.
5. Regenerar la presentación desde la tesis final.
