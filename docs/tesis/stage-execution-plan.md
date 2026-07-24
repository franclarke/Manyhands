# Diseño de ejecución — Etapas 2 a 6

> **Estado:** diseño (no implementación) · **Commit base:** `5355d4b` · **Fecha:** 2026-07-23
> **Precondición:** G1 `PASS` con D-1..D-4 aprobadas (ver [`research-questions.md`](research-questions.md) §4).
> **Propósito:** convertir el plan rector [`../THESIS_COMPLETION_ROADMAP.md`](../THESIS_COMPLETION_ROADMAP.md)
> en un diseño de ingeniería accionable por etapa, anclado a los símbolos reales
> auditados en G1. Este documento **no** ejecuta código; fija *qué* construir,
> *dónde*, *con qué prueba primero* y *cómo se cierra cada gate*.

Convención: **[hecho]** observado en G1 · **[diseño]** propuesta de este documento · **[decisión-abierta]** requiere confirmación de Francisco antes o durante la etapa.

---

## 0. Principios transversales (aplican a todas las etapas)

1. **TDD obligatorio para cambio conductual** (memoria `always-tdd`; roadmap §5.4):
   regresión roja → fix mínimo → refactor. Cada ítem de diseño lista su prueba
   inicial.
2. **Invariantes no negociables** (roadmap §4.3): protección del working tree
   sucio, aislamiento por worktree, inspección de diff real, scope + anti path
   traversal, commits candidatos del orquestador, cancelación con verificación de
   muerte, leases/fencing, validación sobre commit exacto, prohibición de integrar
   `stale`/fallido, manifest+receipt antes de `completed`, sin recentrado del
   canvas. Ninguna etapa los relaja.
3. **Una sola representación canónica** (roadmap §5.6, `DECISIONS.md` A5/A12): no
   introducir modelos paralelos de grafo, relaciones, lifecycle ni evidencia.
4. **Evidencia versionada** bajo `docs/tesis/evidence/` con fecha UTC, commit,
   comando, toolchain, exit code, resultado y limitaciones (roadmap §14).
5. **Nomenclatura sin sufijos (D-1):** el trabajo de código que renombra símbolos
   `*V2` y retira el legacy no requerido se hace como refactor mecánico separado,
   **después** de que los gates estén verdes, para no mezclar rename masivo con
   cambio conductual.
6. **Gate = evidencia, no afirmación:** ningún gate pasa por tests enfocados,
   tipos que compilan o docs. Requiere el paquete de evidencia del roadmap §13.

---

## Mapa de dependencias entre etapas

```text
G1 (scope) ──► G2 (toolchain/gates verdes) ──► G3 (aporte adaptativo productivo)
                                                     │
                                                     ▼
                                          G4 (run canónico completed)
                                                     │
                                                     ▼
                                          G5 (experimento reconstruible)
                                                     │
                                                     ▼
                                          G6 (tesis + presentación coherentes)
```

Regla de regresión (roadmap §13): si un gate anterior vuelve a rojo durante uno
posterior, se repara el anterior antes de continuar. La nomenclatura (D-1) es
transversal: se aplica en G2/G3 sobre código y se refleja en G6 sobre la tesis.

---

## Etapa 2 — Estabilizar toolchain y gates (Gate G2)

### Objetivo
Un checkout reproducible desde limpio con install, tests, typechecks y builds
verdes sobre un único commit, antes de tocar comportamiento.

### Precondiciones
- G1 `PASS`. Working tree limpio o con cambios propios preservados.

### Estado de partida **[hecho, G1]**
- Incoherencia cuádruple: `packageManager: pnpm@11.7.0` vs lockfile `5.4` (pnpm 7)
  vs CI pnpm `7.29.3` + Node `22` vs Node local `24.16.0`.
- CI (`.github/workflows/ci.yml`) corre `lint`, `build`, `web:typecheck`, un test
  dedicado (`repository-fast-indexer.test.ts`) y `test`.
- Suite completa y typechecks: estado real **no medido** en G1 (política documental).

### Decisión de toolchain **[decisión-abierta D-6]**
El roadmap §8 recomienda la ruta de menor riesgo: **Node 22 + pnpm 7.29.3 +
lockfile 5.4 + `--frozen-lockfile`** (alinear `packageManager` a `pnpm@7.29.3`).
Migrar a pnpm 11 es válido solo como cambio deliberado (regenerar lockfile a
`9.0`, actualizar CI, probar fresh install), no mezclado con pnpm 7.
- **Recomendación:** alinear a pnpm 7.29.3 primero (menor riesgo para la tesis);
  diferir pnpm 11 a Trabajo Futuro. **Consecuencia:** cambio de una línea en
  `packageManager`, sin regenerar lockfile.

### Diseño de trabajo **[diseño]**
1. **Fijar toolchain única:**
   - Alinear `package.json` → `packageManager` a `pnpm@7.29.3` (coincide con CI y
     lockfile 5.4).
   - Fijar Node con el mecanismo del repo: agregar `.nvmrc` (`22`) y `engines`
     (`node >=22 <23`, `pnpm 7.29.3`). Alinear el entorno local (Node 24 → 22)
     para no auditar sobre una versión distinta a CI.
2. **Fresh install aislado** (roadmap §8): clonar/copiar a un workspace temporal
   fuera del `node_modules` histórico y correr `pnpm install --frozen-lockfile`.
   Registrar si el lockfile se modifica (no debe).
3. **Separar fallos de entorno de fallos reales:** correr los gates y clasificar
   cada rojo como (a) colección/imports, (b) contrato migrado, (c) test frágil de
   strings, (d) comportamiento real.
4. **Reparar por causa, con TDD donde haya comportamiento:** suites que no
   colectan, imports faltantes, contratos migrados. Tests frágiles que inspeccionan
   strings se elevan a prueba de comportamiento **sin** debilitar invariantes.
5. **Gates amplios al final,** tras los enfocados verdes. Registrar duración,
   toolchain y resultado de cada uno.
6. **CI equivalente a local:** el workflow debe ejecutar el mismo conjunto de
   comandos mínimos.

### Comandos mínimos (roadmap §8)
```bash
pnpm install --frozen-lockfile
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

### Enfoque TDD
- Antes de reparar una suite que no colecta: reproducir el fallo, capturar el
  mensaje exacto, corregir el import/contrato, re-correr. La "regresión" aquí es
  el propio gate rojo → verde documentado.
- Para tests frágiles: escribir la aserción de comportamiento equivalente antes de
  borrar la de strings.

### Riesgos y mitigación
- **R2.1 — pnpm 11 vs lockfile 5.4:** un `install` con pnpm 11 regenera el
  lockfile. *Mitigación:* alinear a pnpm 7.29.3 antes de cualquier install (D-6).
- **R2.2 — Node 24 local:** builds verdes en local con Node 24 no garantizan CI
  (Node 22). *Mitigación:* auditar sobre Node 22.
- **R2.3 — `continue-on-error` oculto en CI:** el gate no debe aceptar fallos
  silenciosos. *Mitigación:* revisar el workflow.

### Entregables (roadmap §8)
- Definición única de toolchain (`.nvmrc`, `engines`, `packageManager`, CI).
- `docs/tesis/evidence/gates/g2-fresh-install.md` (log de fresh install).
- `docs/tesis/evidence/gates/g2-gate-results.md` (resultados completos con
  duración, toolchain, exit codes).
- Lista cerrada de regresiones encontradas y corregidas.

### Checklist de gate G2
- [ ] Fresh install termina sin modificar el lockfile.
- [ ] Los seis comandos mínimos pasan sobre el mismo commit.
- [ ] Ninguna suite falla en colección.
- [ ] Sin `continue-on-error` en gates de tesis.
- [ ] Checkout candidato reconstruible sin caches privados.

---

## Etapa 3 — Integrar el aporte adaptativo (Gate G3)

> Etapa central de la contribución (D-2 aprobada). El diseño se apoya en el
> hallazgo de G1: el compilador adaptativo **ya emite el `WorkUnit` canónico**;
> falta el extractor de señales aguas arriba y el cableado productivo.

### Objetivo
Que la política de granularidad adaptativa (`C_task`) **gobierne el planning
productivo**, dejando evidencia persistida y replayable, sin crear un segundo
modelo de grafo.

### Precondiciones
- G2 `PASS`.

### Estado de partida **[hecho, G1]**
- **Aguas abajo (existe y testeado):**
  - `evaluateIntrinsicComplexity` (`packages/decomposer/src/granularity/complexity-evaluator.ts`):
    `C_task = Σ wᵢ·dᵢ`, pesos congelados `DEFAULT_COMPLEXITY_WEIGHTS = {scopeRadius 0.3, interfaceImpact 0.25, validationSurface 0.25, contextTokenMass 0.2}`,
    umbral `LEAF_COMPLEXITY_THRESHOLD = 3.5`, `recommendedBranchingFactor = clamp(⌈C/2⌉, 2, 5)`.
  - `runArchitectPass` (`llm/architect-pass.ts`): frontera **determinista**; recibe
    `ComplexityDimensions` ya calculadas + `proposedUnits` opcionales; un LLM puede
    producir señales pero **no** puede saltear el umbral.
  - `compileAdaptiveWorkUnitTree` (`compiler/graph-compiler-v3.ts`): emite el
    `WorkUnit` canónico (`planner/schema.ts`) + `assessments` por nodo +
    `coalescedUnitsCount`; incluye Coalescing critic (`granularity/coalescing-critic.ts`)
    y Re-splitting via `forceComposite`.
  - `ThesisMetricsCollector` (`granularity/thesis-metrics.ts`).
- **Aguas arriba (falta):** nadie deriva `ComplexityDimensions` (scopeRadius,
  interfaceImpact, validationSurface, contextTokenMass) desde el `RepositorySnapshot`
  + goal. El test las provee sintéticas.
- **Ruta productiva actual:** `planning-host.ts::runPlanningV2` usa `plan()` →
  `WorkBreakdown` (LLM `RecursiveDecomposer`/`ClaudeCodeRecursiveDecomposer`/
  `CodexRecursiveDecomposer`, `decomposer-policy.ts`) y `compile()` →
  `CompiledGraphRevision`. **No** invoca `architect-pass`/`graph-compiler-v3`/
  `complexity-evaluator`.

### Ruta objetivo (roadmap §9)
```text
RepositorySnapshot
  → semantic planning signals        [GAP a construir: extractor de dimensiones]
  → deterministic C_task assessment  [existe: evaluateIntrinsicComplexity]
  → adaptive WorkUnit tree           [existe: compileAdaptiveWorkUnitTree]
  → canonical compileGraphRevision   [existe: compiler/graph-compiler.ts]
  → critics and contracts            [existe: critics/review.ts]
  → approved GraphRevision           [existe]
```

### Decisión de diseño central **[decisión-abierta D-7]**
¿Cómo se obtienen las cuatro señales de complejidad por unidad?

- **Opción A — LLM emite señales (recomendada).** Extender el planner LLM
  (Architect Pass semántico) para que, por unidad propuesta, emita las 4
  dimensiones + `rationale` + `proposedUnits`; el pipeline determinista
  (`evaluateIntrinsicComplexity` + `compileAdaptiveWorkUnitTree`) decide corte y
  emite el `WorkUnit` tree canónico.
  - *Pro:* aprovecha el juicio semántico del modelo sobre impacto de interfaz y
    superficie de validación; frontera determinista intacta.
  - *Con:* requiere cambiar el prompt/schema del planner y validar las señales.
- **Opción B — Extractor determinista sobre el snapshot.** Derivar dimensiones de
  `repositoryEvidence` (conteo de paths, símbolos exported, scripts de test,
  masa estimada de tokens).
  - *Pro:* 100 % determinista y reproducible; ideal para el experimento (Etapa 5).
  - *Con:* señales más pobres; `interfaceImpact` sin lectura semántica es una
    heurística.
- **Recomendación:** **híbrido** — el LLM propone unidades y señales; un validador
  determinista las acota/normaliza contra el snapshot (rechaza `scopeRadius`
  incoherente con los paths declarados). Registrar la fuente y confianza de cada
  dimensión (roadmap §9.1).

### Diseño de trabajo **[diseño]**
1. **Extractor/validador de señales** (`packages/decomposer/src/granularity/…`):
   componente que produce `ComplexityDimensions` por unidad a partir de
   (goal, snapshot evidence, propuesta del planner), con evidencia y confianza por
   dimensión. **Prueba primero:** dado un snapshot fijo y un goal, produce las 4
   dimensiones esperadas; rechaza señales incoherentes con los paths.
2. **Adaptador planner→adaptativo:** conectar la salida del planner LLM con
   `compileAdaptiveWorkUnitTree`, de modo que el `WorkBreakdown.root` productivo
   sea el `WorkUnit` tree adaptativo. Punto de inyección: entre `plan()` y
   `compile()` en `runPlanningV2`, o dentro del `WorkBreakdownModel`. **No** crear
   un `GraphRevisionV3` paralelo (el output ya es `WorkUnit`).
   **Prueba primero:** una tarea simple queda leaf; una compleja se divide; el
   `WorkBreakdown` resultante valida contra `WorkBreakdownSchema`.
3. **Persistencia por nodo** (roadmap §9.3): extender el payload de
   `planning.node_discovered` (o un evento nuevo `planning.granularity_assessed`)
   con: dimensiones, pesos, **versión de fórmula**, `C_task`, decisión leaf/composite,
   branching factor, coalescencia/re-split y evidencia de entrada. Debe sobrevivir
   `foldRun` y replay. **Prueba primero:** cargar los eventos y reconstruir el
   assessment por nodo; snapshot round-trip.
4. **Métricas de tesis como artefacto diagnóstico** (roadmap §9.4): persistir
   `ThesisMetrics` keyed por `runId` + commit + config, **sin** gobernar lifecycle
   ni crear segunda fuente de verdad. **Prueba primero:** las métricas se emiten y
   recuperan sin afectar `foldRun`.
5. **Explicabilidad (replay/UI)** (roadmap §9.5): exponer por nodo "por qué esta
   granularidad" (C_task + dimensiones) en un reporte o en el inspector del
   cockpit. **Prueba primero:** el presentador deriva la explicación desde los
   eventos.
6. **Versión de fórmula y pesos como contrato:** fijar `formulaVersion` y
   `DEFAULT_COMPLEXITY_WEIGHTS` como contrato versionado explícito (hoy están
   congelados en código; elevarlos a contrato con id de versión).

### Cobertura mínima obligatoria (roadmap §9.6)
- tarea simple que permanece leaf;
- tarea compleja que se divide;
- siblings triviales que se fusionan (coalescencia);
- hoja demasiado amplia que se re-divide (`forceComposite`);
- enmienda que invalida solo fingerprints afectados (ligado a `DECISIONS.md` A6/A8);
- **prueba vertical** que atraviesa inspector → planner → adaptive compiler →
  Graph Compiler y persiste/recupera evidencia adaptativa.

### Riesgos y mitigación
- **R3.1 — Doble modelo de grafo.** *Mitigación:* el output es `WorkUnit`
  canónico; prohibido introducir `GraphRevisionV3`. Test de arquitectura que falle
  si aparece un segundo modelo.
- **R3.2 — Señales LLM no confiables.** *Mitigación:* validador determinista que
  acota dimensiones contra el snapshot; registrar confianza.
- **R3.3 — Coexistencia con el `RecursiveDecomposer`.** *Mitigación:* decidir si
  el recursivo se refactoriza para emitir señales y delegar el corte al pipeline
  adaptativo, en vez de decidir con su heurística de `aggressiveness`. **[decisión-abierta D-8]**
- **R3.4 — Regresión de G2.** *Mitigación:* la suite completa de G2 debe seguir
  verde tras la integración.

### Entregables
- Extractor/validador de señales + pipeline adaptativo cableado en la ruta
  productiva.
- Eventos/artefactos de evidencia adaptativa persistidos y replayables.
- Suite de los 6 escenarios mínimos + prueba vertical.
- `docs/tesis/evidence/gates/g3-adaptive-integration.md`.

### Checklist de gate G3 (roadmap §9)
- [ ] El pipeline productivo invoca la política adaptativa.
- [ ] Una prueba vertical atraviesa inspector → planner → adaptive compiler → Graph Compiler.
- [ ] Los datos de `C_task` sobreviven persistencia y replay.
- [ ] Sin doble representación de nodos/relaciones.
- [ ] La suite completa de G2 sigue verde.
- [ ] La UI o un reporte explican la decisión de granularidad con evidencia.
- [ ] Tests unitarios aislados del compilador **no** se aceptan como cierre.

---

## Etapa 4 — Producir el run canónico (Gate G4)

### Objetivo
Demostrar el recorrido end-to-end: objetivo real → planificación adaptativa →
ejecución aislada → validación exacta → integración bottom-up → entrega
verificada, con evidencia versionada. Es el claim `missing` central (CLAIM-044).

### Precondiciones
- G3 `PASS`. Ejecutor Codex configurado.
- Runs previos (`.manyhands/`) **eliminados o ignorados** (decisión de Francisco):
  el run canónico parte de estado limpio.

### Estado de partida **[hecho, G1]**
- Ruta productiva de ejecución cableada (`execution-pipeline.ts`): `WorktreePool`,
  `ExecutionBaseBuilder`, `ExactCandidateValidatorV2`, `V2NodeExecutor`,
  `V2ExecutionDriver`, `FinalCandidatePreparer`, supervisión de procesos, leases y
  fencing. **[hecho]**
- **Delivery es fase separada:** el `RunCoordinator` del pipeline de ejecución
  lanza `"Delivery is not available from the execution pipeline."` — hay que
  ejercer la fase de delivery (publicación) como paso propio. **[hecho — CLAIM-043]**
- Integración bottom-up y delivery existen en código+tests pero **sin recorrido
  end-to-end** (CLAIM-042/043).

### Escenario canónico **[decisión-abierta D-5, recomendación registrada]**
Feature vertical sobre un pequeño monorepo/app TS existente (dominio + API + UI +
tests), con al menos un seam y validación de integración; base Git limpia y verde;
reproducible desde un commit conocido; presupuesto acotado. Evitar greenfield
vacío (roadmap §10).

### Diseño de trabajo **[diseño]**
1. **Elegir y congelar el repositorio y el goal** con criterios de aceptación
   explícitos; registrar base SHA, executor Codex, modelo/esfuerzo, versiones
   (Codex/Node/pnpm/Git), `maxParallel`, timeouts, env redactado y commit exacto
   de ManyHands (roadmap §10 "Configuración congelada").
2. **Cerrar la fase de delivery productiva:** wiring del paso `prepare → validate
   exact candidate → publish` fuera del execution pipeline, que emita
   `final_candidate.verified` y publique la rama candidata. **Prueba primero:**
   máquina de delivery produce manifest+receipt sobre un candidato verificado y
   rechaza uno `stale`/no verificado.
3. **Ejercer el recorrido completo** sobre el escenario; capturar el paquete de
   evidencia (roadmap §10 "Evidencia obligatoria"): config, journal, snapshot
   final, grafo+contratos aprobados, attempts+fingerprints, commits candidatos,
   diffs no vacíos, matrices de evidencia, resultados de integración,
   `FinalArtifactManifest`, delivery receipt, SHAs (base/final/rama), logs
   redactados, capturas UI, instrucciones de repetición.
4. **Reparar en ManyHands, no evadir:** ante anomalía, seguir evidencia → regresión
   roja → causa raíz → fix sistémico → repetir el run original. No sustituir por
   una fixture más fácil.
5. **Fixture visual offline** solo como *fallback de presentación*, claramente
   rotulada, nunca presentada como run real.

### Criterios de éxito (roadmap §10)
`completed`; `finalSha ≠ baseSha`; el diff final contiene el cambio; ancestry y
provenance explicables; sin criterio requerido `uncovered`/`failed`/flaky oculto;
manifest coincide con el candidato validado; receipt confirma el mismo SHA; el
target final pasa sus tests; recorrido repetible desde baseline limpio.

### Enfoque TDD
- El paso de delivery se construye test-first (estados: prepared → validated →
  published; rechazo de `stale`).
- Cualquier bug del recorrido se captura como regresión antes de corregir.

### Riesgos y mitigación
- **R4.1 — Falla del proveedor LLM.** *Mitigación:* presupuesto/timeouts;
  reintento acotado por causa (`DECISIONS.md` A11); fixture de respaldo para la
  demo (no para la evidencia).
- **R4.2 — Delivery nunca ejercida.** *Mitigación:* cerrarla en el punto 2 con
  prueba propia antes del run completo.
- **R4.3 — Run no repetible.** *Mitigación:* dos ejecuciones consecutivas del
  escenario (gate).

### Entregables
- `docs/tesis/evidence/canonical-run/` con el paquete completo de evidencia.
- Instrucciones de repetición.

### Checklist de gate G4 (roadmap §10)
- [ ] Termina en `completed` con `finalSha ≠ baseSha`.
- [ ] Manifest + receipt válidos y coincidentes.
- [ ] Sin criterios `uncovered`/`failed`/flaky ocultos.
- [ ] El target final pasa sus tests.
- [ ] Dos ejecuciones consecutivas satisfacen los criterios; al menos una con Codex real.

---

## Etapa 5 — Ejecutar el experimento (Gate G5)

### Objetivo
Evaluación **exploratoria** del trade-off de la política adaptativa frente a
granularidad fija. No es un benchmark universal (CLAIM-005/006 → regenerar, D-4).

### Precondiciones
- G3 `PASS` (política productiva persiste `C_task`) y G4 `PASS` (recorrido demostrado).

### Preguntas de investigación
RQ1 (entrega verificada), RQ2 (trade-off éxito/tiempo/costo/coordinación), RQ3
(modos de falla) — ver [`research-questions.md`](research-questions.md) §2.

### Diseño de trabajo **[diseño]**
1. **Modos de granularidad forzada** reproducibles:
   - A — Single leaf (prohibir descomponer).
   - B — Fixed fine-grained (regla fija documentada).
   - C — Adaptive (política productiva de G3).
   Base existente: `DecompositionMode` (`coarse`/`fine`/`auto`) en el decomposer;
   conectar A/B/C de forma reproducible y con `MANYHANDS_FORCE_FALLBACK`/config
   determinista donde aplique. **Prueba primero:** cada modo produce la topología
   esperada sobre una tarea fija.
2. **Protocolo y constantes** (roadmap §11): mismas tareas, repo, base commit,
   modelo/esfuerzo/executor, presupuesto/timeouts, versión de ManyHands, comandos
   de validación, hardware. Orden de condiciones alternado/randomizado.
3. **Tamaño: 2 tareas × 3 condiciones × 2 repeticiones = 12 runs**, con
   escalamiento pre-declarado a un máximo de 18 (tercera repetición solo en
   celdas cuyas dos repeticiones discrepen en la métrica primaria). Reemplaza el
   27–45 del roadmap §11 por desproporcionado. Las dos tareas deben caer en
   **lados opuestos del umbral** para no sesgar el diseño. No se elimina una
   corrida por perjudicar la hipótesis. Ver `evidence/experiment/protocol.md`.
4. **Métricas:** primarias (entrega verificada, cobertura de criterios, wall-clock,
   tokens/costo, attempts/retries, fallos validación/integración, decisiones
   humanas) y estructurales (profundidad, hojas, branching, coalesced, tamaño de
   contexto, `stale`, conflictos). `GEI` **secundaria**, siempre con sus
   componentes; versionar fórmula, unidades y denominador cero.
5. **Scripts de análisis** que regeneran tablas y métricas desde datos crudos.
6. **Análisis honesto:** datos crudos completos y valores de **cada run
   individual**; fallos y modos de falla por condición; amenazas a la validez.
   **Sin pruebas de significancia** —el tamaño no las admite—; se declara
   explícitamente qué conclusiones permite y cuáles no.

### Estructura de evidencia (roadmap §11)
```text
docs/tesis/evidence/experiment/
  protocol.md · environment.json · tasks/ · raw/runs.csv · raw/run-artifacts/
  derived/summary.csv · scripts/ · analysis.md · limitations.md
```
Cada fila de `runs.csv` apunta a `runId`, commit de ManyHands, base commit,
config y artefactos verificables.

### Riesgos y mitigación
- **R5.1 — Varianza del proveedor.** *Mitigación:* 2 repeticiones + orden
  pre-registrado en bloques invertidos; reportar cada run, no solo promedios. Si
  las dos repeticiones de una celda discrepan, se reporta que la varianza domina
  sobre el efecto de la condición.
- **R5.2 — Costo/tiempo.** *Mitigación:* diseño de 12 runs (máx. 18), ejecutable
  dentro del presupuesto real de la tesis.
- **R5.4 — Limitación del contrato de alcance como factor de confusión.** La
  condición B, al generar unidades con alcances más estrechos, está a priori más
  expuesta al modo de falla conocido. *Mitigación:* resolver la causa raíz antes
  de ejecutar; regla de inconclusión pre-declarada si más del 50 % de los runs
  falla por esa causa en todas las condiciones.
- **R5.3 — `GEI` engañoso.** *Mitigación:* nunca única base; análisis de
  sensibilidad a la fórmula.

### Checklist de gate G5 (roadmap §11)
- [ ] Todas las celdas planificadas tienen resultado o razón de ausencia.
- [ ] Los scripts regeneran tablas/métricas desde datos crudos.
- [ ] Una muestra de runs se audita hasta commits y journals.
- [ ] Las conclusiones distinguen observación, inferencia y limitación.
- [ ] Sin números manuales sin procedencia.

---

## Etapa 6 — Corregir tesis y presentación (Gate G6)

### Objetivo
Alinear el relato académico con la versión demostrada; aplicar D-1..D-4 al texto;
compilar el PDF; preparar la defensa.

### Precondiciones
- G5 `PASS` (dataset y análisis disponibles).

### Diseño de trabajo sobre la tesis **[diseño]** — aplicando decisiones G1
1. **Reescribir Resumen, objetivos y conclusiones** desde la matriz de claims.
2. **D-1 (nomenclatura):** eliminar "Decomposer V3", "GraphRevision V3",
   "ManyHands V3"; describir la generación definitiva sin sufijo; alinear con los
   símbolos ya renombrados en G2/G3. Resolver título y objetivos.
3. **D-3 (SQLite):** remover SQLite WAL y compactación del presente; describir la
   persistencia real (JSONL append-only + escritura atómica `fsync` opcional +
   snapshots). Corregir Resumen, Obj. Específico 5, §3 y la figura
   `fig:arquitectura-general`.
4. **D-4 (resultados):** sustituir la tabla `GEI` y los 4 casos por los resultados
   regenerados en G5, o rotularlos como ilustrativos con procedencia.
5. **Privacidad (CLAIM-081):** describir ManyHands como **control plane local**;
   no afirmar inferencia local ni privacidad absoluta con proveedores remotos.
6. **Frontera Planner → política adaptativa → Graph Compiler** descrita con
   precisión (la decisión de granularidad vive en el Architect Pass + política;
   el Graph Compiler materializa).
7. **WCAG (CLAIM-073):** "diseñado según pautas WCAG 2.2 AA; sin auditoría de
   conformidad externa".
8. **Figura del monorepo (CLAIM-082):** completar paquetes omitidos
   (`run-coordinator`, `repository-index`, `conflict-risk`, `trace-store`,
   `orchestrator-graph`).
9. **Metodología reproducible** (protocolo, repos, tareas, config, métricas,
   resultados, amenazas, limitaciones).
10. **Bibliografía:** aumentar y verificar citas, URLs/DOIs.
11. **Sintaxis LaTeX:** sustituir Markdown embebido (p. ej. `**...**` dentro de
    `enumerate`, subíndices `$C_{task}$` correctos) por comandos válidos.
12. **Compilar el PDF desde cero** y revisar referencias, figuras/tablas, cortes
    de página, warnings, metadatos, ortografía y consistencia terminológica.

### Diseño de la presentación (roadmap §12)
Narrativa: problema → hipótesis de diseño → arquitectura mínima → demo del run
canónico → evidencia experimental → limitaciones → trabajo futuro. Entregables:
guion de demo, checklist de preparación, fixture visual offline rotulada, video/
capturas de respaldo, paquete del run canónico, respuestas preparadas (validez,
privacidad, costos, reproducibilidad, nomenclatura).

### Riesgos y mitigación
- **R6.1 — Deriva claim↔texto.** *Mitigación:* revisión de trazabilidad contra la
  matriz antes de cerrar.
- **R6.2 — Falla del proveedor en la defensa.** *Mitigación:* fixture offline +
  video del run canónico.
- **R6.3 — LaTeX con Markdown roto.** *Mitigación:* pase de sintaxis + compilación
  limpia sin warnings.

### Checklist de gate G6 (roadmap §12)
- [ ] La tesis compila desde un entorno documentado.
- [ ] La matriz claim-evidencia no tiene claims sin respaldo.
- [ ] Tablas/gráficos generados desde el dataset.
- [ ] PDF y presentación usan la misma terminología y números.
- [ ] La demo fue ensayada desde baseline limpio.
- [ ] Una falla del proveedor no impide explicar y demostrar el resultado.

---

## Decisiones abiertas acumuladas (para Francisco)

Las de G1 (D-1..D-4) están aprobadas; D-5 se confirma al iniciar G4. Este diseño
agrega, para confirmar en su etapa:

- **D-6 (Etapa 2):** alinear a **pnpm 7.29.3** (recomendado) vs. migrar a pnpm 11.
- **D-7 (Etapa 3):** fuente de las señales de complejidad — LLM emite / extractor
  determinista / **híbrido (recomendado)**.
- **D-8 (Etapa 3):** destino del `RecursiveDecomposer` — refactorizarlo para
  emitir señales y delegar el corte al pipeline adaptativo (recomendado) vs.
  mantener dos planificadores.

Ninguna requiere resolverse ahora: se listan para que la etapa correspondiente
arranque sin ambigüedad.

---

## Referencias
- Plan rector: [`../THESIS_COMPLETION_ROADMAP.md`](../THESIS_COMPLETION_ROADMAP.md)
- Matriz claim–evidencia: [`claim-evidence-matrix.md`](claim-evidence-matrix.md)
- Preguntas de investigación y decisiones: [`research-questions.md`](research-questions.md)
- Capacidades diferidas y nomenclatura: [`deferred-capabilities.md`](deferred-capabilities.md)
- Baseline: [`evidence/baselines/stage-1-baseline.md`](evidence/baselines/stage-1-baseline.md)
