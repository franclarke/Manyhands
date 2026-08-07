# G3 — Integración productiva de la granularidad adaptativa

> **Fecha:** 2026-07-23 (UTC) · **Etapa 3** · **Decisiones aplicadas:** D-2, D-7, D-8
> **Toolchain:** pnpm 7.29.3 · Node v24.16.0 (local) · Node 22 (CI)

> **Nota posterior (2026-08-06).** Los resultados de abajo son un hecho
> histórico y no se tocan. La ruta que describen fue retirada en la etapa 3F
> de [`docs/plans/2026-08-05-robust-graph-execution-redesign.md`](../../../plans/2026-08-05-robust-graph-execution-redesign.md):
> hoy planning corta una unidad por vez y la fórmula adaptativa se mide pero
> no decide.

## Qué cambió (ruta objetivo del roadmap §9)

```text
RepositorySnapshot
  → Planner semántico (WorkBreakdown + complexitySignals por unidad)   [ampliado]
  → validación híbrida de señales (clamp contra el alcance declarado)  [NUEVO]
  → evaluación determinista de C_task + critics                        [ya existía, ahora productivo]
  → árbol WorkUnit canónico reshaped                                   [NUEVO cableado]
  → compileGraphRevision (Graph Compiler canónico)                     [sin cambios]
  → critics de plan y contratos → GraphRevision aprobada               [sin cambios]
```

Antes de esta etapa, `architect-pass`, `graph-compiler-v3` y
`complexity-evaluator` existían con test unitario pero **ningún consumidor
productivo** (CLAIM-001/002 en `partial`). Ahora `runPlanningV2` los invoca
entre `plan()` y `compile()`.

## Decisiones de diseño aplicadas

**D-7 (híbrido) — origen de las señales de complejidad.** Cada unidad puede
traer `complexitySignals` del planner (0–10 por dimensión). El validador
determinista las acepta (`llm`), las acota contra el alcance real declarado
(`clamped`) o las deriva íntegramente de la superficie de la unidad cuando el
planner las omite (`derived`). El `scopeRadius` se acota a
`[⌈paths/2⌉, paths+2]`: una unidad que toca 8 módulos no puede declarar radio 1.
El origen aceptado se persiste por nodo.

**D-8 (un solo planificador).** El planner productivo del pipeline V2 es
`WorkBreakdownPlanner` (`packages/decomposer/src/planner/work-breakdown.ts`),
no el `RecursiveDecomposer` — este último pertenece a la ruta legacy
`/api/runs`. La corrección al diseño: **D-8 se aplicó sobre
`WorkBreakdownPlanner`**, que ahora emite señales y delega la frontera
leaf/composite a la política determinista. No se crearon dos planificadores
competidores ni un segundo modelo de grafo: `applyAdaptiveGranularity` reutiliza
`compileAdaptiveWorkUnitTree`, que emite el **mismo `WorkUnit` canónico** que
consume el Graph Compiler.

**Sin doble representación.** El árbol reshaped se re-valida con
`WorkBreakdownSchema` antes de compilar. Los campos semánticos del planner
(title, objective, concerns, expectedOutcomes, acceptanceIntentIds, evidenceIds,
plannedPaths) se preservan en toda unidad cuya clave sobrevive; las unidades
sintetizadas (merges, re-splits) derivan los suyos de sus fuentes.

## Implementación

| Archivo | Cambio |
|---|---|
| `packages/decomposer/src/planner/schema.ts` | `ComplexitySignalsSchema` opcional en `WorkUnit` (leaf y composite). |
| `packages/decomposer/src/granularity/adaptive-planning.ts` | **NUEVO.** `applyAdaptiveGranularity`, `ADAPTIVE_GRANULARITY_FORMULA_VERSION = "c-task/1.0.0"`, validación híbrida, bridge al compilador adaptativo, restauración semántica, métricas estructurales. |
| `packages/decomposer/src/compiler/graph-compiler-v3.ts` | Expone `mergedFrom` (procedencia de coalescencia) y `criticDecisions`. |
| `packages/decomposer/src/granularity/coalescing-critic.ts` | Separador de ids fusionados `+` → `:` (los ids fusionados deben seguir siendo `EntityId` válidos). |
| `packages/decomposer/src/planner/prompt.ts` | El prompt pide `complexitySignals` por unidad y declara que la frontera la decide una política determinista. |
| `packages/run-coordinator/src/domain/events.ts` | Evento de dominio `planning.granularity_assessed`. |
| `packages/run-coordinator/src/reducer.ts` | `GranularityProjection` en `RunProjection`, keyed por `nodeId`. |
| `apps/web/src/lib/server/runs/v2/planning-host.ts` | Invoca la política entre `plan()` y `compile()`; emite el evento; escribe métricas diagnósticas. |
| `apps/web/src/lib/run-model/presentation.ts` | `granularityExplanation` deriva la explicación desde la proyección. |
| `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx` | El inspector explica la decisión de granularidad por nodo. |

## Evidencia persistida por nodo

`planning.granularity_assessed` (evento de dominio, entre `planning.completed` y
`graph.compiled`) contiene: `formulaVersion`, `weights`, `leafThreshold` y, por
unidad, `unitKey`, `nodeId` compilado, las 4 `dimensions`, `signalSource`,
`complexityScore`, `decision` (leaf|composite), `recommendedBranchingFactor` y
`rationale`; más `criticDecisions` (coalescencias y re-splits) y `metrics`.

Las **métricas estructurales de tesis** se persisten aparte, como artefacto
diagnóstico versionado por run
(`<runId>.granularity-metrics.json`): no son evento de dominio y **no gobiernan
el lifecycle** (roadmap §9.4).

## Cobertura de tests (comportamiento, no estructura)

`tests/decomposer-adaptive-planning.test.ts` (7 casos) cubre los escenarios
mínimos del roadmap §9.6:

| Escenario | Caso |
|---|---|
| tarea simple permanece leaf | typo de un archivo → `root.kind === "leaf"` |
| composite trivial colapsa | composite con C_task bajo → leaf |
| tarea compleja se divide | módulo completo → composite, campos semánticos preservados |
| siblings triviales se fusionan | dos ediciones al mismo archivo → 1 unidad, decisión `coalesced` |
| hoja demasiado amplia se redivide | leaf de 5 módulos → composite, decisión `resplit_required` |
| señales ausentes / incoherentes | `derived` y `clamped` con `scopeRadius` acotado |
| métricas estructurales | depth/leaves/branching/coalesced |

`tests/run-granularity-assessed.test.ts` (2): el evento se acepta en lifecycles
de planning, se proyecta por `nodeId` y se rechaza fuera de planning.

`tests/planning-v2-adaptive.test.ts` (1, **prueba vertical**): atraviesa
inspector → planner → política adaptativa → Graph Compiler y verifica que
(1) el evento se persiste entre `planning.completed` y `graph.compiled`,
(2) el Graph Compiler recibió el breakdown adaptativo,
(3) **replay** desde el journal reconstruye la explicación de **todos** los nodos
del grafo compilado, (4) el snapshot la conserva, (5) las métricas quedan como
artefacto diagnóstico.

`tests/cockpit-granularity-explanation.test.ts` (3): el presentador de UI.

## Bug encontrado y causa raíz

**`planned_path_already_exists` al compilar el breakdown reshaped.** Al
reconstruir las unidades, `plannedPaths` se rellenaba con el alcance *observado*
(que incluye rutas existentes citadas como evidencia), y el critic de scope
rechaza declarar como salida nueva un archivo que ya existe. Causa raíz: se
confundió *alcance de trabajo* (paths + evidencia) con *salidas nuevas
declaradas*. Corrección: `plannedPaths` se restaura solo desde lo que el planner
declaró como salida nueva — unión para unidades fusionadas, intersección con lo
autorizado por la unidad fuente para re-splits.

## Resultados de gates sobre el commit de la etapa

| Comando | Exit | Duración |
|---|---|---|
| `pnpm build` | 0 | ~45s |
| `pnpm -r --filter "./packages/*" typecheck` | 0 | ~19s |
| `pnpm --filter @manyhands/web exec tsc --noEmit` | 0 | ~10s |
| `pnpm test` | 0 | ver `progress-log.md` |

## Checklist del gate G3

- [x] El pipeline productivo invoca la política adaptativa.
- [x] Prueba vertical inspector → planner → adaptive compiler → Graph Compiler.
- [x] Los datos de `C_task` sobreviven persistencia y replay.
- [x] Sin doble representación de nodos o relaciones (mismo `WorkUnit` canónico).
- [x] La suite completa de G2 sigue verde.
- [x] La UI explica la decisión de granularidad con evidencia.
- [x] No se aceptaron tests unitarios aislados como cierre del gate.

**G3: PASS.**

## Limitación declarada

La política se ejercitó con planners de prueba y fixtures deterministas. La
calidad de las señales emitidas por un LLM real (Claude Sonnet) se observa
recién en el run canónico de la Etapa 4 y en el experimento de la Etapa 5.
