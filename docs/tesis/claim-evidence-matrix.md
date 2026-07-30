# Matriz Claim–Evidencia (Gate G1)

> **Gate:** G1 — Congelar alcance · **Commit auditado:** `5355d4b` · **Fecha:** 2026-07-23 (UTC)
> **ACTUALIZACIÓN (2026-07-28):** la tabla resumen y las fichas representan el
> estado conservador vigente. Las transiciones anteriores permanecen en las
> secciones de actualización y en la historia Git para trazabilidad.
> **Fuente de autoridad:** `PRODUCT.md` → `docs/DECISIONS.md` → `docs/core-pillars/` + `docs/system/` → `docs/design/` → `docs/adr/` → código/tests/runs.
> **Regla de clasificación:** un claim es `implemented` solo si se localizó ruta productiva **y** test de comportamiento; los claims end-to-end exigen además evidencia persistida. Ante duda se elige la clasificación más conservadora. Los runs persistidos actuales se declararon **no-evidencia** (decisión de Francisco, 2026-07-23); toda `Persisted evidence` end-to-end es `none` hasta el run canónico de la Etapa 4.
> **ACTUALIZACIÓN correctness closure (2026-07-28):** la auditoría productiva degradó provisionalmente CLAIM-020/021/040/041/053 a `partial`. Los módulos o tests aislados no prueban que el host V2 aplique presupuesto/recursos, evidencia relevante por criterio, controles negativos o recuperación integral. Tickets locales 18, 19, 21, 23, 24 y 25 son la aceptación canónica para volver a evaluar esos estados.

## Leyenda

- **Status:** `implemented` · `partial` · `missing` · `incompatible` · `deferred`
- **Decision:** `demonstrate` · `implement` · `clarify` · `downgrade` · `remove` · `defer`
- **Next gate:** etapa del roadmap responsable de resolver la brecha.

Distinción usada en todo el documento: **[hecho]** = observado en código/tests/runs; **[inferencia]** = deducción del auditor; **[decisión]** = propuesta del auditor; **[pendiente-Francisco]** = requiere aprobación de alcance.

---

## Tabla resumen

| ID | Claim (resumen) | Status | Decision | Next gate |
|---|---|---|---|---|
| CLAIM-001 | Decomposer adaptativo (Architect Pass + Graph Compiler) resuelve la paradoja de granularidad | partial | implement + downgrade | G3 |
| CLAIM-002 | `C_task` gobierna la decisión leaf/composite en el planning productivo | partial | implement | G3 |
| CLAIM-003 | Coalescing y Re-splitting critics de granularidad | partial | implement | G3 |
| CLAIM-004 | Compresor de contexto (scope tree, interface extractor, fingerprint) | partial | clarify | G3 |
| CLAIM-005 | Resultados cuantitativos `GEI` (90 % éxito, tabla comparativa) | missing | remove/regenerate | G5 |
| CLAIM-006 | 4 casos de estudio con comportamiento descrito como ocurrido | missing | downgrade | G4/G5 |
| CLAIM-010 | `GraphRevision` inmutable con reducer CAS + `deepFreeze` | implemented | demonstrate | G4 |
| CLAIM-011 | 4 relaciones tipadas canónicas | implemented | demonstrate | G4 |
| CLAIM-020 | Scheduler continuo por readiness (`selectReadyWaveV2`) | partial | implement + demonstrate | ticket 23 |
| CLAIM-021 | Aplazamiento simétrico por `ConflictConstraint` (`blocksPair`) | partial | implement + demonstrate | ticket 23 |
| CLAIM-022 | Cola atómica `recordQueue` en `V2ExecutionDriver` | implemented | demonstrate | G4 |
| CLAIM-030 | Worktree Recycling Pool con leases/fencing | implemented | demonstrate | G4 |
| CLAIM-031 | `ScopeChecker` OS-aware (path traversal + symlink + deny-wins) | implemented | demonstrate | G4 |
| CLAIM-032 | `LiveProcessRegistry` + `killProcessTreeVerified` (Signal-0) | implemented | demonstrate | G4 |
| CLAIM-033 | `buildAgentEnvironment` allowlist / filtrado de secretos | implemented | demonstrate | G4 |
| CLAIM-034 | `safeGitArgs` (`-c safe.directory`) | implemented | demonstrate | G4 |
| CLAIM-040 | Matriz de Evidencias sobre commit exacto | partial | implement + demonstrate | tickets 18–19 |
| CLAIM-041 | `ValidationContract` de obligaciones | partial | implement + demonstrate | tickets 18–19 |
| CLAIM-042 | Integración bottom-up | partial | demonstrate | G4 |
| CLAIM-043 | Delivery Engine (`FinalArtifactManifest`, publish, receipt) | partial | demonstrate | G4 |
| CLAIM-044 | Run real Codex hasta `completed` con commit no vacío | missing | demonstrate | G4 |
| CLAIM-050 | Event store JSONL append-only con escritura atómica `fsync` | implemented | clarify | G2 |
| CLAIM-051 | SQLite WAL como índice secundario durable | missing | remove | G6 |
| CLAIM-052 | Compactación por generaciones | partial | implement + demonstrate | tickets 25, 14 |
| CLAIM-053 | Recuperación durable ante crash | partial | implement + demonstrate | tickets 21, 23–25, 14 |
| CLAIM-060 | Indexación nativa por ripgrep | implemented | demonstrate | G4 |
| CLAIM-061 | Inicialización de índice < 150 ms | partial | downgrade | G5 |
| CLAIM-062 | `RepositorySnapshot` cacheado por commit; dirty aislado | implemented | demonstrate | G4 |
| CLAIM-070 | 5 estados de nodo distintos (candidate/verified/failed/stale/delivered) | partial | demonstrate | G4 |
| CLAIM-071 | Cola de decisiones no bloqueante + diff lado a lado | implemented | demonstrate | G4 |
| CLAIM-072 | Prohibición de `fitView`/recentrado automático | partial | demonstrate | G4/G6 |
| CLAIM-073 | Conformidad WCAG 2.2 AA | partial | downgrade | G6 |
| CLAIM-080 | Sistema local, self-hosted, single-user | implemented | demonstrate | G4 |
| CLAIM-081 | Privacidad / no envío de repos a terceros | partial | clarify | G6 |
| CLAIM-082 | Monorepo TS con dirección de dependencias unidireccional | implemented | demonstrate | G6 |
| CLAIM-090 | Nomenclatura "V3 / Decomposer V3 / GraphRevision V3" | incompatible | clarify | G1/G6 |

**Conteo vigente:** implemented 11 · partial 16 · missing 4 · incompatible 1 · deferred 0.

---

## Fichas detalladas

### Aporte central — Pilar 1 (Decomposer adaptativo)

---

**CLAIM-001 — El Motor de Descomposición Adaptativa (Architect Pass semántico + Graph Compiler determinista) resuelve la paradoja de granularidad.**

- **Source:** `docs/tesis/main.tex` Resumen, Obj. Específico 2, §3 "Pilar 1"; `docs/core-pillars/01-decomposer-engine.md` §2.
- **Target contract:** `docs/DECISIONS.md` A4 (Planner y Graph Compiler son responsabilidades distintas); `docs/core-pillars/01`.
- **Status:** `partial`.
- **Productive code:** `packages/decomposer/src/llm/architect-pass.ts`, `packages/decomposer/src/compiler/graph-compiler-v3.ts`, `packages/decomposer/src/granularity/*` **existen y se exportan** desde `packages/decomposer/src/index.ts`. **[hecho]** La ruta productiva de planning (`apps/web/src/lib/server/runs/v2/planning-host.ts`) invoca `plan()` → `WorkBreakdown` y `compile()` → `CompiledGraphRevision` a través del `Planner` + `compiler/graph-compiler.ts` (no el `-v3`) y de `ClaudeCodeRecursiveDecomposer`/`CodexRecursiveDecomposer` (`apps/web/src/lib/decomposer-policy.ts`). **[hecho]** Ni `architect-pass`, ni `graph-compiler-v3`, ni `complexity-evaluator` aparecen importados en `apps/web/**` ni en `packages/orchestrator-graph/**`.
- **Tests:** `tests/decomposer-adaptive-granularity.test.ts` ejercita `compileAdaptiveWorkUnitTree`, `evaluateIntrinsicComplexity`, `reviewGranularityProposal` con aserciones de **comportamiento** (una hoja para un typo; sub-composites para un módulo complejo). Es un test **unitario aislado del compilador**, no una prueba vertical de la ruta productiva.
- **Persisted evidence:** `none`.
- **Gap:** el aporte central existe como pieza aislada + test unitario, pero **no participa del pipeline productivo**. La afirmación de la tesis de que ManyHands "resuelve" la paradoja describe intención de diseño, no comportamiento productivo demostrado. **[inferencia]**
- **Decision:** `implement` (integrar el compilador adaptativo en la ruta productiva — Etapa 3) **+** `downgrade` transitorio del texto de la tesis a "diseño e implementación de una política adaptativa, evaluada exploratoriamente", hasta que G3 la integre.
- **Thesis impact:** Resumen, §1.2 (paradoja), Obj. Específico 2, §3 Pilar 1, Conclusión 1.
- **Next gate:** G3.

---

**CLAIM-002 — `C_task = w₁·Sᵣ + w₂·Iᵢ + w₃·Vₛ + w₄·Tₘ` gobierna la decisión leaf/composite (umbral 3.5; `k* = ⌈C_task/2⌉ ∈ [2,5]`).**

- **Source:** `docs/tesis/main.tex` §3 Pilar 1, ec. (2); `docs/core-pillars/01` §3.
- **Target contract:** `docs/DECISIONS.md` A3 (grafo híbrido, sin profundidad ni fan-out fijos).
- **Status:** `partial`.
- **Productive code:** `packages/decomposer/src/granularity/complexity-evaluator.ts` (`evaluateIntrinsicComplexity`) y `packages/decomposer/src/llm/architect-pass.ts`. **[hecho]** No invocado por la ruta productiva (ver CLAIM-001).
- **Tests:** `tests/decomposer-adaptive-granularity.test.ts` (comportamiento del umbral y del branching sobre entradas sintéticas de `complexity`).
- **Persisted evidence:** `none` — ningún run productivo persiste `C_task`, dimensiones, pesos ni versión de fórmula por nodo (requisito explícito del roadmap §9).
- **Gap:** faltan (a) obtención/validación de `scopeRadius`, `interfaceImpact`, `validationSurface`, `contextTokenMass` desde el `RepositorySnapshot`; (b) persistencia por nodo; (c) replay/UI que expliquen la decisión. Los pesos `w₁..w₄` y su versión no están fijados como contrato versionado en el código inspeccionado. **[hecho/inferencia]**
- **Decision:** `implement` (Etapa 3).
- **Thesis impact:** §3 Pilar 1; Obj. Específico 2; metodología §5.
- **Next gate:** G3.

---

**CLAIM-003 — Coalescing Critic (fusiona sub-tareas triviales) y Re-splitting Critic (redivide hojas demasiado amplias).**

- **Source:** `docs/tesis/main.tex` §3 Pilar 1; `docs/core-pillars/01` §4.
- **Target contract:** `docs/DECISIONS.md` A4 (críticos antes de aprobación).
- **Status:** `partial`.
- **Productive code:** `packages/decomposer/src/granularity/coalescing-critic.ts` **[hecho]**; el Re-splitting critic no fue localizado como módulo productivo independiente (posible cobertura parcial dentro de la revisión de granularidad — **[inferencia, requiere verificación en G3]**). No integrado en la ruta productiva.
- **Tests:** `tests/decomposer-adaptive-granularity.test.ts` cubre coalescencia; cobertura de re-splitting no confirmada.
- **Persisted evidence:** `none`.
- **Gap:** integración productiva y confirmación del Re-splitting critic.
- **Decision:** `implement` (Etapa 3).
- **Thesis impact:** §3 Pilar 1; Conclusión 1.
- **Next gate:** G3.

---

**CLAIM-004 — Compresor de contexto: Scope Tree Summarizer, Interface Signature Extractor, System-Prompt Channeling e Input Fingerprint.**

- **Source:** `docs/core-pillars/01` §4; `docs/tesis/main.tex` (implícito en aislamiento de contexto).
- **Target contract:** `docs/DECISIONS.md` A7 (contratos y contexto identificable), A8 (`InputFingerprint`).
- **Status:** `partial`.
- **Productive code:** `packages/decomposer/src/context-compressor.ts` **[hecho]**; el `InputFingerprint` sí es productivo en ejecución (ver CLAIM-022/030). Falta confirmar qué parte del compresor consume la ruta productiva de planning/ejecución.
- **Tests:** `tests/execution-core-context-packer.test.ts` (packer de contexto en ejecución). Cobertura específica del `context-compressor` del decomposer no confirmada.
- **Persisted evidence:** `none`.
- **Gap:** trazar qué componentes del compresor están en la ruta productiva vs. solo disponibles.
- **Decision:** `clarify` (delimitar en la tesis qué compresión es productiva).
- **Thesis impact:** §3 Pilar 1.
- **Next gate:** G3.

---

**CLAIM-005 — Resultados cuantitativos del experimento `GEI` (Config. A 40 % / B 65 % / C 90 %; tiempos y costos; `GEI` = 0.256 para ManyHands).**

- **Source:** `docs/tesis/main.tex` §5.3, Tabla `tab:resultados-cuantitativos`.
- **Target contract:** roadmap §11 (experimento reconstruible) y §5.
- **Status:** `missing`.
- **Productive code:** `packages/decomposer/src/granularity/thesis-metrics.ts` (`ThesisMetricsCollector`, `InMemoryThesisMetricsStore`) existe como colector **[hecho]**, pero no hay pipeline experimental que lo alimente ni dataset versionado.
- **Tests:** el colector se instancia en `tests/decomposer-adaptive-granularity.test.ts`; no hay test que valide los números publicados.
- **Persisted evidence:** `none` — no existe `docs/tesis/evidence/experiment/` con `runs.csv`, artefactos ni scripts. Los valores de la tabla no tienen procedencia reconstruible. **[hecho]**
- **Gap:** los resultados cuantitativos son **números sin dataset**. Presentarlos como medidos es insostenible académicamente. **[inferencia]**
- **Decision:** `remove`/`regenerate` — **aprobado por Francisco (D-4, 2026-07-23):** rotular/remover ahora y regenerar con el experimento real de la Etapa 5.
- **Thesis impact:** §5.3, §5.4, Resumen (frase "demostrando las ventajas"), Conclusión 1.
- **Next gate:** G5.

---

**CLAIM-006 — Cuatro casos de estudio (refactor simple; módulo+API; migración multimodular; reparación autónoma) descritos con comportamiento, tiempos ("12 s", "attempt ordinal = 2") y hallazgos.**

- **Source:** `docs/tesis/main.tex` §5.2, Tabla `tab:casos-matriz`.
- **Target contract:** roadmap §10 (run canónico con evidencia).
- **Status:** `missing` (como evidencia experimental); los mecanismos descritos existen en código (ver claims de pilares 2 y 3).
- **Productive code:** los mecanismos citados (worktree pool, seams, `blocksPair`, evidence matrix, bucle de reparación) existen; la **narración de los cuatro casos como ejecuciones ocurridas** no tiene run persistido de respaldo.
- **Tests:** n/a a nivel de caso de estudio.
- **Persisted evidence:** `none` (decisión de Francisco: runs actuales no son evidencia).
- **Gap:** los casos se leen como resultados empíricos pero son ilustraciones de diseño. **[inferencia]**
- **Decision:** `downgrade` a "escenarios de diseño ilustrativos" **hasta** que la Línea 1 cualitativa de la Etapa 4/5 los produzca con evidencia. **Aprobado por Francisco (D-4, 2026-07-23).**
- **Thesis impact:** §5.1, §5.2.
- **Next gate:** G4/G5.

---

### Grafo y relaciones

---

**CLAIM-010 — `GraphRevision` es inmutable; toda mutación pasa por un reductor CAS puro con `deepFreeze`.**

- **Source:** `docs/tesis/main.tex` §3.2.1, Obj. Específico 1; `docs/core-pillars/01`.
- **Target contract:** `docs/DECISIONS.md` A5–A6; `docs/system/01-task-graph*`.
- **Status:** `implemented`.
- **Productive code:** `packages/task-graph/src/graph-revision.ts`, `packages/task-graph/src/graph-reducer.ts`, `packages/task-graph/src/relations.ts`. Consumido por `execution-pipeline.ts` (`GraphRevisionSchema.parse`). **[hecho]**
- **Tests:** `tests/task-graph-reducer.test.ts`, `tests/task-graph-artifact-cycles.test.ts`, `tests/task-graph-graft.test.ts`, `tests/graph-amendment-v2.test.ts`.
- **Persisted evidence:** grafos compilados aparecen en runs V2 (`graph.compiled`), pero se descartan como evidencia formal.
- **Gap:** ninguno material a nivel de estructura; confirmar `deepFreeze` en runtime en G4.
- **Decision:** `demonstrate` (via run canónico).
- **Thesis impact:** ninguno (afirmación sostenible).
- **Next gate:** G4.

---

**CLAIM-011 — Solo 4 relaciones tipadas canónicas: `parentId`, `ArtifactRequirement`, `SeamBinding`, `ConflictConstraint`.**

- **Source:** `docs/tesis/main.tex` §3.2.2; `docs/DECISIONS.md` A5.
- **Target contract:** `docs/DECISIONS.md` A5 (única representación canónica; sin `node.dependencies` duplicado).
- **Status:** `implemented`.
- **Productive code:** `packages/contracts/src/relations.ts`, `packages/task-graph/src/relations.ts`, `packages/task-graph/src/validate-v2.ts`. **[hecho]**
- **Tests:** `tests/contract-relations.test.ts`, `tests/conflict-constraint-evidence.test.ts`, `tests/scheduler-conflict-constraints.test.ts`.
- **Persisted evidence:** presente en grafos V2 (descartados como evidencia).
- **Gap:** ninguno material. Nota: `docs/DECISIONS.md` retira `node.dependencies` y `ordering_only`; confirmar ausencia total en G2.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

### Scheduler — Pilar 2

---

**CLAIM-020 — Scheduler continuo por eventos que re-evalúa readiness de artefactos (`selectReadyWaveV2` / `ReadinessStateV2`).**

- **Source:** `docs/tesis/main.tex` §3 Pilar 2; `docs/core-pillars/02` §1.
- **Target contract:** `docs/DECISIONS.md` A10 (readiness, presupuesto, riesgo); `docs/system/12-scheduler.md`.
- **Status:** `partial`.
- **Productive code:** `packages/scheduler/src/wave-selector-v2.ts`, `packages/scheduler/src/readiness-v2.ts`; consumido vía `V2ExecutionDriver` en `execution-pipeline.ts`. **[hecho]**
- **Tests:** `tests/scheduler-readiness-v2.test.ts`, `tests/scheduler-scope-aware-wave.test.ts`, `tests/repository-aware-scheduling.test.ts`.
- **Persisted evidence:** `wave.selected`/`readiness.observed` en runs V2 (descartados).
- **Gap:** el host V2 entrega `activeResourceNodeIds: []` y `budgetAvailable: true`; no consume todavía presupuesto, recursos exclusivos ni circuit breakers reales.
- **Ticket 24 note:** el integration journal V2 ya recupera un crash entre
  children y reconstruye el manifest desde replay; CLAIM-053 permanece
  `partial` hasta cerrar ticket 25.
- **Decision:** `implement + demonstrate`.
- **Thesis impact:** no afirmar scheduling adaptado a recursos/presupuesto hasta cerrar ticket 23.
- **Next gate:** ticket 23.

---

**CLAIM-021 — Aplazamiento simétrico por conflicto: `blocksPair(A,B) = c(A,B) ∨ c(B,A)`, difiere el nodo (`deferred=true`).**

- **Source:** `docs/tesis/main.tex` §3 Pilar 2, ec. (3); `docs/core-pillars/02` §2.
- **Target contract:** `docs/DECISIONS.md` A5 (`ConflictConstraint` como scheduling), A10.
- **Status:** `partial`.
- **Productive code:** `packages/scheduler/src/wave-selector-v2.ts` (`blocksPair`, `activeResourceNodeIds`). **[hecho]**
- **Tests:** `tests/scheduler-conflict-constraints.test.ts`, `tests/scheduler-scope-aware-wave.test.ts`.
- **Persisted evidence:** `tests/integration-manifest.test.ts` demuestra
  recovery de un crash entre children sin repetir el primer efecto y
  reconstrucciÃ³n del `IntegrationManifest` desde el journal; permanece
  evidencia de test, no una corrida acadÃ©mica. **[hecho, ticket 24]**
- **Gap:** `blocksPair` está testeado, pero la ruta productiva no aporta estado real de recursos y no valida freshness de la evidencia de conflicto.
- **Decision:** `implement + demonstrate`.
- **Thesis impact:** valida §5.2 Caso 3 sólo después de cerrar ticket 23 y producir evidencia.
- **Next gate:** ticket 23.

---

**CLAIM-022 — `V2ExecutionDriver` serializa la grabación de hechos concurrentes con una cola atómica `recordQueue`.**

- **Source:** `docs/tesis/main.tex` §3 Pilar 2 (listado JS); `docs/core-pillars/02` §3.
- **Target contract:** `docs/DECISIONS.md` A12 (event log canónico sin condiciones de carrera).
- **Status:** `implemented`.
- **Productive code:** `packages/orchestrator-graph/src/v2/execution-driver.ts`; instanciado en `execution-pipeline.ts`. **[hecho]**
- **Tests:** `tests/execution-driver-concurrency.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

### Sandboxing — Pilar 2

---

**CLAIM-030 — Worktree Recycling Pool: worktrees pre-creados, reciclados con `git reset --hard` + `git clean -fd`, con lease durable y fencing.**

- **Source:** `docs/tesis/main.tex` §3 Pilar 2, §2 Estado del Arte, Conclusión 2; `docs/core-pillars/02` §4.
- **Target contract:** `docs/DECISIONS.md` A16, A20; ADR 0011; `docs/system/05-worktree-layer.md`.
- **Status:** `implemented`.
- **Productive code:** `packages/execution-core/src/worktree/worktree-pool.ts`, `fenced-lease.ts`, `execution-workspace.ts`, `manager.ts`; instanciado en `execution-pipeline.ts` (`WorktreePool`, `PooledExecutionWorkspaceProvider`). **[hecho]**
- **Tests:** `tests/worktree-recycling-pool.test.ts`, `tests/execution-core-worktree.test.ts`, `tests/worktree-dependency-isolation.test.ts`, `tests/run-store-lock-ownership-fencing.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material; el reciclado real bajo carga se observará en el run canónico.
- **Decision:** `demonstrate`.
- **Thesis impact:** valida Conclusión 2 con run.
- **Next gate:** G4.

---

**CLAIM-031 — `ScopeChecker` OS-aware: `validatePathBoundary` bloquea path traversal (`../`) y escapes por symlink (`realpathSync`), regla "Deny Wins".**

- **Source:** `docs/tesis/main.tex` §3 Pilar 2, §4 (implementación); `docs/core-pillars/02` §5.
- **Target contract:** `docs/DECISIONS.md` A16; `docs/system/07-context-and-scope.md`, `security-boundary.md`.
- **Status:** `implemented`.
- **Productive code:** `packages/execution-core/src/scope/checker.ts`, `scope/scope-errors.ts`. **[hecho]**
- **Tests:** `tests/scope-path-traversal.test.ts`, `tests/execution-core-scope.test.ts`, `tests/scope-critic-calibration.test.ts`, `tests/local-boundary.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-032 — Supervisión estricta de procesos: `LiveProcessRegistry` + `killProcessTreeVerified` con sondeo Signal-0 hasta confirmar muerte del PID.**

- **Source:** `docs/tesis/main.tex` Obj. Específico 4; `docs/core-pillars/02` §5.
- **Target contract:** `docs/DECISIONS.md` A16 (supervisor cancelable; cancelación invalida autoridad).
- **Status:** `implemented`.
- **Productive code:** `packages/execution-core/src/executor/live-process-registry.ts`, `executor/process.ts`; `apps/web/.../process-supervision.ts` (`runWithProcessSupervision`). **[hecho]**
- **Tests:** `tests/durable-process-kill.test.ts`, `tests/execution-core-kill-verify.test.ts`, `tests/process-supervisor.test.ts`, `tests/process-evidence-journal.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-033 — `buildAgentEnvironment` sanea `process.env` con allowlist estricta; los subprocesos no heredan secretos ni `MANYHANDS_*`.**

- **Source:** `docs/tesis/main.tex` §4 (Filtrado de Secretos); `docs/core-pillars/02` §5.
- **Target contract:** `docs/DECISIONS.md` A16; `docs/system/security-boundary.md`.
- **Status:** `implemented`.
- **Productive code:** `packages/execution-core/src/executor/agent-env.ts`. **[hecho]**
- **Tests:** `tests/agent-env-allowlist.test.ts`, `tests/security-env-audit.test.ts`, `tests/decomposer-env-sanitization.test.ts`, `tests/provider-credentials.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-034 — `safeGitArgs` inyecta `-c safe.directory=<cwd>` en cada invocación de Git sin tocar el `~/.gitconfig` global.**

- **Source:** `docs/tesis/main.tex` §4; `docs/core-pillars/02` §5.
- **Target contract:** `docs/system/security-boundary.md`.
- **Status:** `implemented`.
- **Productive code:** `packages/execution-core/src/git/runner.ts` (`safeGitArgs`); usado en `execution-pipeline.ts`. **[hecho]**
- **Tests:** `tests/git-safe-directory-inventory.test.ts`, `tests/execution-core-git-runner.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

### Integración y evidencia — Pilar 3

---

**CLAIM-040 — Matriz de Evidencias: cada obligación se valida sobre el SHA del commit candidato exacto; el registro se sella con `InputFingerprint`.**

- **Source:** `docs/tesis/main.tex` §3 Pilar 3, Conclusión 3; `docs/core-pillars/03` §1.
- **Target contract:** `docs/DECISIONS.md` A15; `docs/system/08-result-pipeline.md`.
- **Status:** `partial`.
- **Productive code:** `packages/execution-core/src/validation/evidence-matrix.ts`, `v2/exact-candidate-validator.ts`, `validation/candidate-validator.ts`; instanciado en `execution-pipeline.ts` (`ExactCandidateValidatorV2`). **[hecho]**
- **Tests:** `tests/evidence-matrix.test.ts`, `tests/exact-candidate-validation.test.ts`, `tests/exact-candidate-cache.test.ts`, `tests/execution-core-validation-runner.test.ts`; ticket 19 ejecuta el oráculo Node value-aware de `tests/fixtures/validation/wide-graph-order/tests/projections.test.mjs` contra el candidato adverso retry-2 y prueba que criterios con atribución explícita pueden compartir una sola ejecución física sin duplicar evidencia.
- **Persisted evidence:** `validation.completed` presente en run V2 `613040c9` (descartado como evidencia formal).
- **Gap:** la ruta productiva ya exige referencias exactas, digest, duración y atribución criterio-obligación; sigue faltando evidencia externa válida sobre un run nuevo, por lo que el claim permanece conservadoramente `partial`.
- **Decision:** `implement + demonstrate`.
- **Thesis impact:** Conclusión 3 queda no soportada hasta cerrar tickets 18–19 y obtener evidencia externa.
- **Next gate:** tickets 18–19.

---

**CLAIM-041 — `ValidationContract` define obligaciones `required`, baseline, control negativo y manejo de flakiness.**

- **Source:** `docs/core-pillars/03` §1; `docs/DECISIONS.md` A7, A15.
- **Target contract:** `docs/system/08-result-pipeline.md`, `docs/system/02-contracts.md`.
- **Status:** `partial`.
- **Productive code:** `packages/contracts/src/validation-contract.ts`, `packages/decomposer/src/compiler/validation-obligations.ts`. **[hecho]**
- **Tests:** `tests/validation-recipe.test.ts`, `tests/contracts-v2.test.ts`, `tests/contract-acceptance-allocation.test.ts`, `tests/contract-boundary-validation.test.ts`; ticket 19 cubre fail-closed sin binding, selectors focales exactos y declaración consistente de evidencia compartida.
- **Persisted evidence:** `none` (formal).
- **Gap:** el schema y el compiler ya garantizan evidencia pertinente por criterio y la ruta V2 ejecuta baseline/control negativo; aún no existe evidencia externa formal de un run nuevo, por lo que el claim permanece `partial`.
- **Decision:** `implement + demonstrate`.
- **Thesis impact:** no equiparar contrato declarado con validación efectiva hasta cerrar tickets 18–19.
- **Next gate:** tickets 18–19.

---

**CLAIM-042 — Integración bottom-up: los composites adoptan artefactos verificados de sus hijos y validan su propio contrato antes de subir.**

- **Source:** `docs/tesis/main.tex` §3 Pilar 3; `docs/core-pillars/03` §2.
- **Target contract:** `docs/DECISIONS.md` A14; `docs/system/09-composer.md`.
- **Status:** `partial`.
- **Productive code:** `packages/execution-core/src/integration/agent.ts`, `manifest.ts`, `operation-journal.ts`, `pre-merge.ts`, `packages/run-coordinator/src/integration.ts`. **[hecho]**
- **Tests:** `tests/execution-core-integration.test.ts`, `tests/integration-manifest.test.ts`, `tests/integration-operation-journal.test.ts`, `tests/integration-operation-recovery.test.ts`, `tests/integration-real-git.test.ts`, `tests/integrator-strict-dag.test.ts`, `tests/integration-repair-policy.test.ts`.
- **Persisted evidence:** `none` — **ningún run V2 alcanza la fase de integración**; el `execution-pipeline` productivo termina antes (ver CLAIM-043/044). **[hecho]**
- **Gap:** cobertura de tests fuerte, pero sin recorrido productivo end-to-end que la ejercite hasta la raíz.
- **Decision:** `demonstrate` (Etapa 4).
- **Thesis impact:** valida §3 Pilar 3 con run.
- **Next gate:** G4.

---

**CLAIM-043 — Delivery Engine: sella `FinalArtifactManifest` (`final_candidate.verified`) y publica atómicamente el commit verificado en la rama destino; audit trail completo.**

- **Source:** `docs/tesis/main.tex` §3 Pilar 3; `docs/core-pillars/03` §3; `docs/DECISIONS.md` A15.
- **Target contract:** `docs/DECISIONS.md` A15 (`prepare → validate → publish`); `docs/system/08-result-pipeline.md`.
- **Status:** `partial`.
- **Productive code:** `packages/execution-core/src/delivery/publisher.ts`, `delivery/candidate-preparer.ts`, `integration/manifest.ts`; `FinalCandidatePreparer` se usa en `execution-pipeline.ts`. **[hecho]** Observación crítica: el `RunCoordinator` del pipeline de ejecución define `delivery: { publish: async () => { throw new Error("Delivery is not available from the execution pipeline."); } }` — **la publicación es una fase separada, no ejecutada por el pipeline de ejecución**. **[hecho]**
- **Tests:** `tests/final-candidate.test.ts`, `tests/delivery-state-machine.test.ts`.
- **Persisted evidence:** `none` — ningún run V2 emite `final_candidate.verified` ni publica una rama candidata (`git branch -a` no muestra `manyhands/run-*`). **[hecho]**
- **Gap:** la máquina de estados de delivery existe y está testeada, pero el recorrido productivo hasta `completed`/publicación no se ha ejercido ni persistido.
- **Decision:** `demonstrate` (Etapa 4).
- **Thesis impact:** §3 Pilar 3; Conclusión 3; Resumen ("publicando el trabajo verificado").
- **Next gate:** G4.

---

**CLAIM-044 — Un run real con Codex alcanza `completed` sobre un repositorio controlado y entrega un commit no vacío, validado y publicado.**

- **Source:** roadmap §2.4, §10; implícito en Resumen y §5 de la tesis.
- **Target contract:** roadmap §10 (criterios de éxito del run canónico).
- **Status:** `missing`.
- **Productive code:** la ruta productiva V2 de ejecución (`execution-pipeline.ts`) existe y está cableada, pero la cadena ejecución→integración→delivery→`completed` no se ha recorrido con evidencia.
- **Tests:** cobertura por unidad de cada eslabón; ninguna prueba end-to-end productiva persistida.
- **Persisted evidence:** `none`. Los runs V1 legacy con `codex` que alcanzaron `run.completed`/`integration.completed` (p. ej. `880dba1d`, `e1885451`) usan el **schema de eventos V1 retirado**, no están versionados y fueron declarados no-evidencia por Francisco. **[hecho + decisión de Francisco]**
- **Gap:** es el objetivo central de la Etapa 4. Sin este run, la tesis no puede afirmar un recorrido end-to-end demostrado.
- **Decision:** `demonstrate` (Etapa 4, con el run "V3/definitivo").
- **Thesis impact:** Resumen, §5, Conclusiones (cualquier frase que implique end-to-end demostrado).
- **Next gate:** G4.

---

### Persistencia y durabilidad

---

**CLAIM-050 — Event store JSONL append-only `O(1)` con escritura atómica: `.tmp` + `fsync` + `fs.rename`.**

- **Source:** `docs/tesis/main.tex` §3 (Persistencia), Obj. Específico 5; `docs/core-pillars` (implícito).
- **Target contract:** `docs/DECISIONS.md` A12; `docs/system/02-persistence-and-durability.md`.
- **Status:** `implemented` (con matiz).
- **Productive code:** `packages/run-store/src/jsonl-event-store.ts`, `durable-file.ts`. **[hecho]** Matiz: el `fsync` está detrás de un flag (`durableWritesEnabled()`): en `jsonl-event-store.ts` `if (durableWritesEnabled()) fsync(descriptor, finish)` y en `durable-file.ts` `options.fsync ?? durableWritesEnabled()`. El reemplazo atómico `.tmp`→`rename` es incondicional. **[hecho]**
- **Tests:** `tests/atomic-write-durability.test.ts`, `tests/workspace-file-lock-commit.test.ts`, `tests/repo-lock-atomic.test.ts`.
- **Persisted evidence:** los `.events.jsonl` existen como artefacto del mecanismo.
- **Gap:** aclarar si el modo durable (`fsync`) está activo por defecto en la configuración de tesis, o describirlo como opcional. **[decisión]**
- **Decision:** `clarify` (documentar el flag; decidir default en G2).
- **Thesis impact:** §3 Persistencia (precisar "con `fsync`" → "con `fsync` opcional/activable").
- **Next gate:** G2.

---

**CLAIM-051 — SQLite WAL como índice secundario durable (`PRAGMA journal_mode=WAL`) para alimentar las vistas del cliente web.**

- **Source:** `docs/tesis/main.tex` Resumen, Obj. Específico 5, §3 (Persistencia), Fig. arquitectura; `docs/core-pillars` (mención).
- **Target contract:** `docs/DECISIONS.md` A12 (snapshots como proyección, sin exigir SQLite); roadmap §4.2 (SQLite WAL diferible).
- **Status:** `missing` / `incompatible` con la ruta productiva.
- **Productive code:** **ninguno.** `packages/run-store/src/index.ts` exporta solo `event-store`, `jsonl-event-store`, `snapshot-store`, `durable-file`, `durable-lock`, `compactor`, `recovery`, `projection-fold`. **No existe módulo SQLite; `better-sqlite3` no es dependencia productiva de `run-store`.** Las coincidencias de "sqlite/WAL" en el repo son documentos, tests de terceros y substrings. **[hecho]**
- **Tests:** ninguno productivo.
- **Persisted evidence:** `none`.
- **Gap:** la persistencia real es 100 % JSONL + snapshots. SQLite WAL es una capacidad **declarada pero no implementada**. **[hecho]**
- **Decision:** `remove` — **aprobado por Francisco (D-3, 2026-07-23):** se remueve SQLite WAL por completo; la persistencia canónica de la tesis es JSONL append-only + escritura atómica + snapshots.
- **Thesis impact:** Resumen, Obj. Específico 5, §3 (Persistencia), Fig. `fig:arquitectura-general`.
- **Next gate:** G6 (corrección de tesis); confirmación de diferimiento en G1.

---

**CLAIM-052 — Compactación por generaciones del event log.**

- **Source:** `docs/tesis/main.tex` Resumen, Obj. Específico 5, §3 (Persistencia).
- **Target contract:** `docs/DECISIONS.md` A12; roadmap §4.2 (diferible).
- **Status:** `partial`.
- **Productive code:** `packages/run-store/src/compactor.ts` se invoca desde los hosts V2 después de escrituras durables, con lock/fencing. **[hecho]**
- **Tests:** `tests/store-recovery-traces-security.test.ts` cubre generación publicada, journal duplicado tras crash y recuperación. **[hecho]**
- **Persisted evidence:** la suite focal es evidencia de mecanismo; falta aún una demostración externa de tesis. **[hecho]**
- **Gap:** la evidencia científica de una serie productiva todavía no se debe inferir desde este test.
- **Decision:** `downgrade` a "mecanismo disponible" o `defer` según lo requiera el recorrido de tesis.
- **Thesis impact:** Resumen, Obj. Específico 5.
- **Next gate:** G3/G6.

---

**CLAIM-053 — Recuperación durable ante crash (reconstrucción desde eventos + snapshots; leases/fencing contra efectos tardíos).**

- **Source:** `docs/tesis/main.tex` §3 (Resiliencia); `docs/DECISIONS.md` A12, A16.
- **Target contract:** `docs/DECISIONS.md` A16; `docs/system/02-persistence-and-durability.md`.
- **Status:** `partial`.
- **Productive code:** `packages/run-store/src/recovery.ts`, `durable-lock.ts`, `projection-fold.ts`, `snapshot-store.ts`; `apps/web/.../run-operation-lease.ts`, `repo-lock.ts`. **[hecho]**
- **Tests:** `tests/integration-operation-recovery.test.ts`, `tests/run-store-lock-ownership-fencing.test.ts`, `tests/run-store-fencing.test.ts`, `tests/run-v2-cancellation.test.ts`.
- **Persisted evidence:** `none` (formal).
- **Gap:** recovery, compaction y trazas durables ya están conectados al host V2
  y tienen regresiones focales; el claim integral permanece `partial` hasta
  completar la evidencia externa y la matriz final sin sobreafirmar cobertura.
- **Decision:** `implement + demonstrate`.
- **Thesis impact:** toda afirmación de recuperación integral queda no soportada hasta cerrar tickets 21, 23, 24 y 25.
- **Next gate:** tickets 23–25.

---

### Grounding del repositorio

---

**CLAIM-060 — Indexación nativa por ripgrep (`rg --files --hidden --glob !.git`), respetando `.gitignore` a velocidad compilada.**

- **Source:** `docs/tesis/main.tex` §4 (Indexación); `docs/DECISIONS.md` A20.
- **Target contract:** `docs/DECISIONS.md` A20; `docs/system/14-repository-index.md`.
- **Status:** `implemented`.
- **Productive code:** `packages/repository-index/src/fast-indexer.ts` (`INDEXER_NAME = "ripgrep-native-v2"`, `rgPath`, resolución de binario). **[hecho]**
- **Tests:** `tests/repository-index.test.ts`, `tests/repository-fast-indexer.test.ts` (esta última la corre CI de forma dedicada).
- **Persisted evidence:** `repository.inspected` en runs V2 (descartados).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-061 — Inicialización del índice en tiempos inferiores a 150 ms.**

- **Source:** `docs/tesis/main.tex` §4 (Indexación).
- **Target contract:** ninguno (afirmación de rendimiento).
- **Status:** `partial` (afirmación de performance no verificada).
- **Productive code:** `fast-indexer.ts` cachea por SHA de `HEAD`; el mecanismo de caché existe. **[hecho]**
- **Tests:** ninguno que fije un presupuesto de 150 ms de forma reproducible.
- **Persisted evidence:** `none`.
- **Gap:** el número "< 150 ms" no tiene benchmark reproducible ni especificación de repositorio/hardware. **[inferencia]**
- **Decision:** `downgrade` (retirar el número absoluto o respaldarlo con un micro-benchmark documentado en la Etapa 5).
- **Thesis impact:** §4 (Indexación).
- **Next gate:** G5.

---

**CLAIM-062 — `RepositorySnapshot` cacheado por commit representa solo los bytes de ese commit; el working tree dirty usa una vista separada.**

- **Source:** `docs/DECISIONS.md` A20; `docs/system/14-repository-index.md`.
- **Target contract:** `docs/DECISIONS.md` A20; ADR 0011.
- **Status:** `implemented`.
- **Productive code:** `packages/repository-index/src/snapshot.ts`, `source-parser.ts`; `RepositorySnapshotSchema` consumido en `execution-pipeline.ts` y `planning-host.ts`. **[hecho]**
- **Tests:** `tests/repository-snapshot.test.ts`, `tests/grounding-agent-dirty-workspace.test.ts`.
- **Persisted evidence:** snapshots embebidos en `repository.inspected` (descartados).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

### Cockpit UI

---

**CLAIM-070 — El grafo distingue 5 estados de nodo: Candidate, Verified, Failed, Stale, Delivered.**

- **Source:** `docs/tesis/main.tex` §3 (Cockpit); `PRODUCT.md`; `docs/DECISIONS.md` A17.
- **Target contract:** `docs/DECISIONS.md` A17; `docs/design/08-cockpit-ui-interaction-model.md`; `docs/system/04-cockpit-ui-and-interaction.md`.
- **Status:** `partial`.
- **Productive code:** `apps/web/src/app/runs/[runId]/_components/task-node-v2.tsx`, `cockpit-run-graph.tsx`, `cockpit-state.ts`. **[hecho]** Presencia de los 5 estados como conjunto distinto no verificada exhaustivamente en esta auditoría.
- **Tests:** `tests/cockpit-layout.test.ts`, `tests/run-model-presentation.test.ts`, `tests/stage-selection-ui.test.ts`.
- **Persisted evidence:** `none`.
- **Gap:** verificar que los 5 estados existan como estados distintos y no derivados/colapsados.
- **Decision:** `demonstrate` (capturas del run canónico).
- **Thesis impact:** §3 (Cockpit).
- **Next gate:** G4.

---

**CLAIM-071 — Cola de decisiones no bloqueante (drawer lateral + `SideBySideDiffViewer`); una decisión pendiente solo pausa la rama dependiente afectada.**

- **Source:** `docs/tesis/main.tex` §3 (Cockpit); `docs/DECISIONS.md` A13, A17.
- **Target contract:** `docs/DECISIONS.md` A13 (decisiones locales no bloqueantes), A17.
- **Status:** `implemented`.
- **Productive code:** `apps/web/src/app/runs/[runId]/_components/DecisionQueueDrawer.tsx`, `SideBySideDiffViewer.tsx`, `accessible-dialog.tsx`, `decision-diff.actions.ts`. La lógica de "bloquea solo lo afectado" está en `packages/run-coordinator/src/domain/decisions.ts` (`supersededDecisionIds`) y `planning-host.ts`. **[hecho]**
- **Tests:** `tests/cockpit-decision-queue.test.ts`, `tests/local-decision-readiness.test.ts`.
- **Persisted evidence:** `decision.raised`/`decision.resolved`/`decision.expired` en runs V2 (descartados).
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-072 — Invariante de estabilidad espacial: se prohíbe el recentrado/zoom automático (`fitView`) ante eventos.**

- **Source:** `docs/tesis/main.tex` §3 (Cockpit); `docs/DECISIONS.md` A17.
- **Target contract:** `docs/DECISIONS.md` A17 ("el canvas nunca se recentra por eventos"); `PRODUCT.md`.
- **Status:** `partial` (declarado; no verificado exhaustivamente).
- **Productive code:** `apps/web/src/app/runs/[runId]/_components/cockpit-run-graph.tsx` y `run-model-view.client.tsx`. **[hecho: existen]** Ausencia de `fitView` reactivo no verificada línea por línea en esta auditoría.
- **Tests:** cobertura específica del invariante no confirmada.
- **Decision:** `demonstrate` (test de regresión del invariante + verificación en G4).
- **Thesis impact:** §3 (Cockpit).
- **Next gate:** G4/G6.

---

**CLAIM-073 — Conformidad WCAG 2.2 AA (teclado, foco visible, contraste, no depender solo del color, `prefers-reduced-motion`).**

- **Source:** `PRODUCT.md`; `docs/tesis/main.tex` (palabras clave, implícito); `docs/DECISIONS.md` A17.
- **Target contract:** `PRODUCT.md` (Accessibility & Inclusion).
- **Status:** `partial`.
- **Productive code:** atributos `aria-*`/`role=`/`prefers-reduced-motion` presentes en 24 archivos (162 ocurrencias), incl. `accessible-dialog.tsx`. **[hecho]** No hay auditoría de conformidad ni certificación.
- **Tests:** `tests/typography-scale.test.ts` (escala tipográfica); sin suite de a11y integral.
- **Persisted evidence:** `none`.
- **Gap:** hay atención real a accesibilidad, pero "conformidad WCAG 2.2 AA" es un claim de certificación no respaldado. La certificación externa está diferida (roadmap §4.2). **[inferencia]**
- **Decision:** `downgrade` a "diseñado siguiendo pautas WCAG 2.2 AA; sin auditoría de conformidad externa".
- **Thesis impact:** palabras clave / secciones de UI.
- **Next gate:** G6.

---

### Modelo de despliegue y transversales

---

**CLAIM-080 — ManyHands es un sistema local, self-hosted y single-user.**

- **Source:** `docs/tesis/main.tex` Resumen, §1.3, §3.1; `PRODUCT.md`.
- **Target contract:** `PRODUCT.md`; `docs/DECISIONS.md` A2.
- **Status:** `implemented`.
- **Productive code:** arquitectura Next.js local (`apps/web`), ejecución sobre worktrees locales, persistencia en `.manyhands/`. **[hecho]** No hay multiusuario, auth ni cloud (coherente con el claim y con las capacidades diferidas).
- **Tests:** n/a (propiedad arquitectónica).
- **Persisted evidence:** `none`.
- **Gap:** ninguno material.
- **Decision:** `demonstrate`.
- **Thesis impact:** ninguno.
- **Next gate:** G4.

---

**CLAIM-081 — Privacidad y propiedad intelectual: el sistema evita enviar repositorios privados a servidores de terceros.**

- **Source:** `docs/tesis/main.tex` §1.3.
- **Target contract:** `PRODUCT.md`; roadmap §12 (control plane local, no inferencia local).
- **Status:** `partial` (requiere matización).
- **Productive code:** el **control plane** (planning, scheduling, persistencia, grounding) es local. **[hecho]** Pero la ejecución delega en agentes LLM remotos (Claude Code, Codex CLI): el contenido del código **sí** se envía al proveedor del modelo durante la inferencia. **[hecho/inferencia]**
- **Tests:** n/a.
- **Persisted evidence:** `none`.
- **Gap:** "no enviar repos a terceros" es falso a nivel de inferencia; lo correcto es "control plane y datos en reposo locales; la inferencia usa proveedores remotos elegidos por el usuario". **[inferencia]**
- **Decision:** `clarify` (distinguir *control plane local* de *inferencia local*; el roadmap §12 lo exige explícitamente).
- **Thesis impact:** §1.3, Resumen, Conclusiones.
- **Next gate:** G6.

---

**CLAIM-082 — Monorepo TypeScript con dirección de dependencias unidireccional (`apps → packages → shared`).**

- **Source:** `docs/tesis/main.tex` §4.1, Fig. `fig:monorepo-map`.
- **Target contract:** `AGENTS.md` (boundaries), `docs/README.md`.
- **Status:** `implemented`.
- **Productive code:** estructura `apps/`, `packages/*` observada; `@manyhands/core` marcado legacy. **[hecho]**
- **Tests:** `tests/architecture-baseline.test.ts`.
- **Persisted evidence:** n/a.
- **Gap:** la Fig. `fig:monorepo-map` de la tesis omite paquetes reales (`run-coordinator`, `repository-index`, `conflict-risk`, `trace-store`, `orchestrator-graph`); actualizar el diagrama.
- **Decision:** `demonstrate` + actualizar figura en G6.
- **Thesis impact:** §4.1 (figura).
- **Next gate:** G6.

---

### Nomenclatura

---

**CLAIM-090 — La tesis y los core-pillars denominan al sistema "V3 / Decomposer V3 / GraphRevision V3"; el código productivo y `DECISIONS.md` usan "V2".**

- **Source:** `docs/tesis/main.tex` (Obj. Específico 1 "GraphRevision V3", Pilar 1 "Decomposer V3", Config. C "ManyHands V3"); `docs/core-pillars/01` ("GraphRevision v3"). Vs. `docs/DECISIONS.md` (ruta productiva V2), `schemaVersion:2` en eventos, símbolos `*V2` (`selectReadyWaveV2`, `V2NodeExecutor`, `V2ExecutionDriver`, `ExactCandidateValidatorV2`).
- **Target contract:** `docs/DECISIONS.md` A1; roadmap §7.3 (resolver V2/V3 vs `schemaVersion`).
- **Status:** `incompatible` (inconsistencia terminológica, no de comportamiento).
- **Productive code:** todos los símbolos productivos usan sufijo/semántica **V2**; no existe un `GraphRevisionV3` productivo. **[hecho]**
- **Tests:** n/a.
- **Persisted evidence:** `schemaVersion:2` en los `.events.v2.jsonl`.
- **Gap:** "V3" es un rótulo conceptual/aspiracional de la tesis que no corresponde a una versión de esquema implementada. Riesgo alto de pregunta de jurado. **[inferencia]**
- **Decision:** `clarify` — **resuelto por Francisco (D-1, 2026-07-23):** converger a una sola generación definitiva **sin sufijos**: eliminar el rótulo "V3" (los paquetes definitivos se entregan sin sufijo) y retirar el código/rótulo "V2" que la tesis no requiera. Rename de símbolos `*V2` y retiro de legacy en Etapas 2/3; texto de tesis en Etapa 6. Ver `deferred-capabilities.md` §3 y `research-questions.md` §4.
- **Thesis impact:** Título, Obj. Específico 1–2, §3 Pilar 1, §5.3 Config. C, core-pillars.
- **Next gate:** G1 (elevado) → G6 (aplicado).

---

## Cobertura y honestidad de la matriz

- **Claims materiales sin clasificar:** 0. Todos tienen Status y Decision.
- **Claims `implemented` sin código productivo:** 0 (cada uno cita ruta y test).
- **Claims end-to-end sin evidencia persistida:** CLAIM-042, 043, 044 — marcados `partial`/`missing` con `Persisted evidence: none`, no como `implemented`. Es lo correcto: ningún run cuenta como evidencia (decisión de Francisco).
- **Verificaciones que esta auditoría NO hizo (declaradas):** ejecución de la suite/gates (Etapa 2); línea-por-línea del invariante `fitView`; confirmación de los 5 estados de nodo; existencia del Re-splitting critic como módulo; integración productiva de `compactor`. Están marcadas como `partial`/`needs-verify` y no como `implemented`.

Ver decisiones pendientes de Francisco en [`research-questions.md`](research-questions.md) y el resumen de handoff.


---

## Actualización tras el run canónico (2026-07-24)

Las Etapas 2, 3 y 4 produjeron evidencia que modifica el estado de varias filas.
Esta sección es la **autoridad vigente**; la tabla original se conserva arriba
como registro del estado en G1.

| ID | Estado G1 | Estado actual | Evidencia nueva |
|---|---|---|---|
| CLAIM-001 | partial | **implemented** | La política adaptativa gobierna el planning productivo (`runPlanningV2` → `applyAdaptiveGranularity` → `compileGraphRevision`). Prueba vertical `tests/planning-v2-adaptive.test.ts`; run canónico `55f8ba9f` con topología adaptativa real. Commit `3a52b8b`. |
| CLAIM-002 | partial | **implemented** | `C_task` decide leaf/composite en producción y se persiste por nodo en `planning.granularity_assessed` (dimensiones, pesos, `formulaVersion c-task/1.0.0`, umbral, decisión, origen de señales). Sobrevive replay y snapshot. |
| CLAIM-003 | partial | **implemented (con corrección de diseño)** | Coalescencia verificada en run real (fusionó dominio+web). El crítico de re-división **ya no fabrica particiones**: registra `resplit_declined`. Ver §Resultado negativo de la tesis. |
| CLAIM-004 | partial | partial | Sin cambios; el compresor de contexto sigue sin trazarse a la ruta productiva de planning. |
| CLAIM-005 | missing | **removed** | Los números `GEI` fueron eliminados de la tesis (D-4). El estudio comparativo no se ejecutó; queda como trabajo futuro con protocolo especificado. |
| CLAIM-006 | missing | **replaced** | Los 4 casos narrados fueron reemplazados por **un caso canónico real** con evidencia persistida (`evidence/canonical-run/`). |
| CLAIM-042 | partial | **implemented** | Integración bottom-up ejecutada en run real con 1 pase de reparación semántica → `integration.completed` `verified`. |
| CLAIM-043 | partial | **implemented** | `final_candidate.verified` + `delivery.published` con receipt confirmado. Requirió corregir la verificación de limpieza del target (commit `9338419`). |
| CLAIM-044 | missing | **implemented** | Run `55f8ba9f`: `completed`, `finalSha c48835a ≠ base 1da878d`, 4 archivos modificados, 12 tests verdes en clon limpio. **Ejecutor Codex `gpt-5.5` en planning y ejecución.** |
| CLAIM-051 | missing | **removed** | SQLite WAL eliminado de la tesis; la persistencia declarada es JSONL + snapshots (D-3). |
| CLAIM-052 | partial | **deferred** | Compactación movida a trabajo futuro en la tesis reescrita. |
| CLAIM-061 | partial | **removed** | El número «< 150 ms» fue eliminado; la tesis describe el mecanismo (ripgrep) sin afirmar una cota no medida. |
| CLAIM-072 | partial | **implemented** | Guard repo-wide en `tests/run-canvas-no-auto-fit.test.ts` (prohíbe toda API de movimiento de viewport en `apps/web/src`). Commit `d552c5d`. |
| CLAIM-073 | partial | **downgraded (aplicado)** | La tesis ahora dice «sigue las pautas WCAG 2.2 AA … aunque no se realizó una auditoría externa de conformidad». |
| CLAIM-081 | partial | **clarified (aplicado)** | La tesis declara explícitamente «plano de control local con inferencia remota, no un sistema de inferencia local, y por lo tanto no ofrece garantías de privacidad absoluta». |
| CLAIM-090 | incompatible | **resolved** | Los rótulos «V3» fueron eliminados del texto de la tesis (D-1). |

### Claims nuevos surgidos de la evaluación

| ID | Claim | Status | Evidencia |
|---|---|---|---|
| CLAIM-100 | Una política determinista puede decidir *si* dividir, pero no *cómo*; fabricar el corte semántico produce unidades inejecutables | **implemented (resultado empírico)** | Run `88263695`: 3/3 agentes exit 0, 3/3 rechazados por `scope_violation` con particiones sintetizadas. Corrección en commit `673b32e`; tesis §4.5 y §7.3. |
| CLAIM-101 | Los fallos se recuperan según su causa real (`DECISIONS.md` A11) | **implemented** | Antes toda falla de hoja se etiquetaba `execution_failed`. `leafFailureObservation` mapea `scope_violation`/`unexpected_commit` a causa de alcance; verificado en run 6 (`scope_unexpected_commit`, `discard: true`). Commit `a73c6ba`. |
| CLAIM-102 | La reproducibilidad del planning está limitada por la variabilidad del modelo remoto | **limitación declarada** | Ejecuciones del mismo objetivo produjeron topologías distintas; una no completó. Reportado en la tesis §7.4 y como amenaza a la validez. |

### Claims que siguen sin evidencia

| ID | Claim | Estado | Consecuencia |
|---|---|---|---|
| — | Estudio comparativo de granularidad (A/B/C) con repeticiones | **no ejecutado** | La tesis **no afirma** superioridad de la política adaptativa, solo viabilidad. Protocolo especificado como trabajo futuro. |
| — | Segunda ejecución consecutiva del caso canónico con resultado válido | **no obtenido** | El gate G4 del roadmap pide dos ejecuciones válidas. Se obtuvo **una** completa. Ver `evidence/canonical-run/README.md` §6. |

---

## Actualización tras la corrección de la causa raíz de alcance (2026-07-24)

> Esta sección es la **autoridad vigente** sobre las anteriores. Corrige claims
> que la evidencia posterior volvió inexactos.

### Claims corregidos

| ID | Estado previo | Estado actual | Evidencia nueva |
|---|---|---|---|
| CLAIM-044 | implemented (1 run) | **implemented** | Además de `55f8ba9f`, el run `a55525c7` completó tras la corrección de alcance: `1da878d → 0e550b49`, receipt confirmado, **11 tests verdes** (baseline 5) y `tsc --noEmit` exit 0 en clon limpio. Ninguna de sus 3 hojas fue rechazada por alcance, donde antes fallaban 3 de 3. |
| CLAIM-102 | limitación declarada | **limitación declarada (ampliada)** | La variabilidad del planificador no solo cambia la topología: cambia **qué caminos del orquestador se ejercitan**. Un defecto de adopción de artefactos permaneció latente en todos los runs previos porque ningún planificador había declarado un artefacto entre hermanos. Ver CLAIM-104. |

### Claims nuevos

| ID | Claim | Status | Evidencia |
|---|---|---|---|
| CLAIM-103 | El alcance estricto admite **creación acotada** sin volverse escritura repo-wide | **implemented** | `outputRoots` en el contrato de alcance: derivados por el compilador de los directorios que el nodo ya posee, nunca pedidos por el modelo; una ruta en la raíz no produce root; solo autorizan crear, no editar un archivo preexistente no declarado; `forbiddenPaths` sigue ganando; «nuevo» lo determina `git diff --diff-filter=A`. El alcance efectivo entra en el `InputFingerprint` vía la revisión del contrato. Regresión: `tests/scope-bounded-creation.test.ts`. Commit `4bc0040`. |
| CLAIM-104 | Un requisito de artefacto insatisfacible produce un **estancamiento silencioso**, no un fallo | **limitación declarada** | Run `0c0f066a`: un nodo adoptaba solo su artefacto de resultado, así que un artefacto declarado entre hermanos nunca se satisfacía; el run quedó sin fallo, sin decisión y sin avance. Corregido en `c227205` (se adoptan todos los contratos producidos), **pero el orquestador sigue sin detectar una condición de readiness insatisfacible**: solo el límite de reloj externo la corta. Evidencia en `evidence/canonical-run/defects/silent-artifact-deadlock/`. |
| CLAIM-105 | Las condiciones experimentales A/B/C son configuración efectiva y persistida por run | **implemented** | Umbral, pesos y activación del crítico de coalescencia viajan como `GranularityPolicy` resuelta por run y plegada en `formulaVersion` (`c-task/1.0.0+condA`). Omitir la condición deja el comportamiento productivo idéntico. Regresión: `tests/granularity-policy-conditions.test.ts`. Commit `7d36faf`. |
| CLAIM-106 | El consumo de cada intento queda en la historia durable | **implemented (parcial por proveedor)** | `attempt.candidate_created` y `attempt.failed` llevan un registro de uso con `source` obligatorio; Codex reporta un **total**, no un desglose in/out, y se persiste como tal sin inventar la división. Un reporte ausente deja el registro vacío en lugar de un cero fabricado. Commits `fe6d5ab` y `3bc253d`. |

### Claims que siguen sin evidencia

| ID | Claim | Estado | Consecuencia |
|---|---|---|---|
| — | Detección de una condición de readiness insatisfacible | **no implementado** | Un requisito que ningún evento futuro puede satisfacer espera hasta el límite de reloj externo. Declarado como trabajo futuro (CLAIM-104). |
| — | Calibración empírica de los pesos de $C_{task}$ | **no ejecutado** | Los pesos son una asignación razonada. La tesis lo declara como limitación; el diseño experimental adoptado, deliberadamente, no permite calibrarlos. |

---

## Actualización tras la ejecución de G4 y G5 (2026-07-24, final)

> **Autoridad vigente.** Reemplaza a las secciones anteriores donde haya
> conflicto.

| ID | Estado previo | Estado final | Evidencia |
|---|---|---|---|
| CLAIM-005 | removed | **removed (confirmado)** | El `GEI` sigue fuera de la tesis. El estudio se ejecutó, pero la métrica primaria resultó endógena a la condición (CLAIM-107), de modo que ningún índice compuesto construido sobre ella sería interpretable. |
| CLAIM-044 | implemented | **implemented** | G4 = PASS: dos runs válidos consecutivos sobre `db096d0`, 13 y 10 tests verdes en clon limpio sobre una base de 5. `evidence/gates/g4-gate-results.md`. |
| CLAIM-102 | limitación declarada | **limitación declarada (medida)** | Las dos ejecuciones de G4 produjeron topologías distintas para el mismo objetivo; en G5, dos celdas discrepan entre repeticiones. La variabilidad ya no es una afirmación: está cuantificada. |

### Claims nuevos

| ID | Claim | Status | Evidencia |
|---|---|---|---|
| CLAIM-107 | Los criterios de aceptación son **endógenos a la condición** comparada | **implemented (resultado metodológico)** | Se compilan por unidad: 5 criterios en la condición A frente a 14 en B y C sobre la misma tarea. Las 12 celdas dieron cobertura 1,00 porque cada condición satisfizo su propia vara. Ninguna métrica de éxito construida sobre ellos compara condiciones. Tesis §7.6.2. |
| CLAIM-108 | La política adaptativa **no muestra ventaja** sobre no descomponer en este objetivo | **resultado negativo** | G5: sobre T1, A entregó 2/2 y B y C 1/2 cada una, con cerca de un tercio del tiempo y un cuarto de los tokens para la misma superficie pública. La hipótesis pre-registrada quedó falsada. `evidence/gates/g5-gate-results.md`. |
| CLAIM-109 | Ninguna configuración de umbral puede forzar un corte que el Architect no propuso | **implemented (corolario confirmado)** | Sobre T2, la condición B —diseñada para dividir siempre— produjo **una sola hoja**, igual que A y C. La frontera del resultado negativo es estructural, no un parámetro ajustable. |
| CLAIM-110 | Los conflictos de integración aparecen **únicamente** al descomponer, y su costo está medido | **implemented** | G5: las 6 celdas de T2 (una hoja) no registraron conflicto alguno; los conflictos aparecen solo en T1/B y T1/C. Costo del orden de 800 s y 75 000 tokens adicionales sobre el mismo objetivo. |

### Claims que siguen sin evidencia

| ID | Claim | Estado | Consecuencia |
|---|---|---|---|
| — | Ventaja de la descomposición bajo saturación de contexto | **no probado** | El repositorio objetivo es demasiado pequeño: con ~25 000 tokens por run ningún agente se acercó a saturar. El experimento **no puso a prueba su hipótesis en el régimen que le es favorable**, y la tesis lo declara. |
| — | Detección de una condición de readiness insatisfacible | **no implementado** | Sigue esperando en vez de fallar con su causa. |
| — | Calibración empírica de los pesos de $C_{task}$ | **no ejecutado** | El diseño adoptado, deliberadamente, no permite calibrarlos. |

---

## Programa C + Warehouse (iniciado 2026-07-24)

> Esta sección registra trabajo nuevo sin reescribir el resultado final de G5.
> Hasta que cada gate cierre, los ítems C permanecen `planned` o `partial` y no
> respaldan claims de la tesis.

| ID | Claim candidato | Estado | Evidencia requerida |
|---|---|---|---|
| CLAIM-111 | C selecciona una frontera semántica por utilidad esperada sin fabricar particiones por paths | **implemented; estabilidad PASS; comparación pendiente** | selector puro, ruta productiva, replan acotado, evento replayable e inspector; 2/2 runs reales entregados y verificados; falta estudio final A/B/C |
| CLAIM-112 | La masa de contexto usada por C se deriva de bytes versionados del snapshot y declara incertidumbre para paths no medidos | **implemented como componente** | commits `950dd18` + `e94b4b8`; índice exacto y estimator determinista |
| CLAIM-113 | Los criterios de aceptación del usuario no se multiplican por la topología seleccionada | **implemented; evidencia final pendiente** | `acceptance-allocation.ts`; cinco intents únicos bajo A/B/C y ownership por deepest owner/LCA en `contract-acceptance-allocation.test.ts` |
| CLAIM-114 | Warehouse Control Tower puede construirse incrementalmente con una única versión congelada de ManyHands | **instrumento implementado; construcción pendiente** | seed y assets W1–W8 hasheados, driver y oráculos externos verificados; faltan Pilot, freeze y Final |
| CLAIM-115 | El sucesor compacto Warehouse ofrece una operación visible verificable en WC1 | **implementación verificada; atribución pendiente** | sucesor W1 `71f61c9` → commit `8ce6e98`; 33 tests, typecheck, build, probe determinista y smoke HTTP PASS; faltan candidate execution, receipt, delivery y oráculo externo |
| CLAIM-116 | El sucesor compacto Warehouse planifica fulfillment reproducible bajo capacidad y congestión | **implementación verificada; atribución pendiente** | commit `4da4a45` sobre WC1; 37 tests acumulados, typecheck, build y probe WC2 PASS; faltan candidate execution, receipt, delivery y oráculo externo |
| CLAIM-117 | El sucesor compacto Warehouse conserva evidencia durable y operable en WC3 | **implementación verificada; atribución pendiente** | commit `5da6019` sobre WC2; 41 tests acumulados, typecheck, build, probes, smoke HTTP y revisión Playwright PASS; faltan candidate execution, receipt, delivery y oráculo externo |

El G5 anterior conserva su interpretación: C1 no mostró ventaja sobre A en el
target pequeño y la métrica de aceptación fue endógena. Es evidencia formativa
que motiva CLAIM-111..114, no evidencia a favor de ellos.
