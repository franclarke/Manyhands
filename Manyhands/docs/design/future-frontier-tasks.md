# Frontier Roadmap — Backend Orchestration & Control Room (owned by Claude Fable 5)

> Reescrito el 2026-06-10 tras la auditoría de alto esfuerzo. Este documento reemplaza
> el roadmap anterior. Cada tarea incluye el hallazgo que la justifica, el diseño
> elegido y su estado. Estado: `[x]` hecho · `[/]` en curso · `[ ]` pendiente.

---

## Hallazgos de la auditoría (2026-06-10)

1. **El StateGraph de ejecución estaba roto en producción.** `executeBatchNode`
   retornaba `Send[]` directamente desde un nodo; LangGraph 1.x lo rechaza con
   `InvalidUpdateError` ("Expected node to return an object or an array containing
   at least one Command object"). Verificado empíricamente con una sonda contra la
   librería instalada. Además, `currentBatchIndex` nunca se incrementaba tras
   despachar un batch (loop infinito latente) y el grafo de ejecución no tenía
   ningún test.
2. **El resume HITL no era nativo.** `/api/runs/[id]/resume` mutaba a mano el JSON
   del checkpoint (`channel_values.userAnswers`) y relanzaba el pipeline con
   `stream(null)`. Con `interrupt()` nativo eso re-ejecuta el nodo completo (re-corre
   Gemini) y vuelve a interrumpir: el run quedaba pausado para siempre. Los payloads
   de decisión que la UI ya enviaba (`action: retry_repair | accept_failing |
   accept_conflict`) se descartaban.
3. **Interrupts dentro de nodos caros.** `interrupt()` vivía dentro de
   `executeLeafNode` (tras ejecutar el executor) y dentro del loop de integración
   de un único nodo `integrateComposite` monolítico — re-ejecutar en resume
   significaba repetir trabajo de agente y cherry-picks sobre worktrees sucios.
4. **El scheduler de riesgo estaba desconectado.** El host LangGraph llamaba a
   `scheduleTasks` con `riskMatrix: []`, `contracts: {}` y política
   `parallel_naive`: toda la inteligencia risk-aware existente era letra muerta.
5. **`runner.ts` era un god-file de 2.382 líneas** que duplicaba dentro de la web
   app lógica de dominio de `execution-core` (el repair de hojas reconstruía a mano
   worktrees, recorder, validación) y mezclaba planificación, ejecución, proyección
   de eventos y revisión de nodos.
6. **UI legacy viva detrás de `?model=legacy`** (DagCanvas/React Flow, TaskInspector,
   kanban, timeline) coexistiendo con la sala agent-first, contra la política de
   cero código legacy.
7. El Composer no validaba sintácticamente el resultado del repair (podía commitear
   archivos con marcadores de conflicto), y el GroundingAgent dependía 100% del LLM
   para el walking skeleton (sin garantía de que compile).

---

## 1. Execution StateGraph idiomático: wavefront dinámico + gates de decisión `[x]`

**Diseño.** Se reescribe el grafo de ejecución con el patrón map-reduce nativo:

```
START → prepare → [routeFrontier]
executeLeaf → waveJoin → [routeFrontier]
leafGate (interrupt) → Command(goto: Send(executeLeaf) | waveJoin)
[routeFrontier] → integrateNextComposite → [routeIntegration]
conflictGate (interrupt) → [routeIntegration]
[routeIntegration] → runValidation → END
```

- **Wavefront dinámico (sin `currentBatchIndex`)**: `routeFrontier` es un
  conditional edge que computa la frontera ejecutable (hojas sin resultado cuyas
  dependencias están resueltas) y despacha `Send`s — el único lugar válido para
  Sends. La selección de la wave delega en el scheduler scope-aware (tarea 2).
- **Reducers por identidad**: `leafResults` e `integrationResults` se fusionan por
  `taskId`/`compositeTaskId` (last-wins), de modo que un retry reemplaza el
  resultado fallido en lugar de acumular duplicados.
- **Gates baratos para HITL**: `leafGate` y `conflictGate` son nodos puros cuyo
  primer statement es `interrupt()`. Re-ejecutarlos en resume es gratis. El valor
  de resume es la decisión tipada de la UI (`retry_repair`, `accept_failing`,
  `accept_conflict`, `abort_run`).
- **Integración incremental**: `integrateNextComposite` integra exactamente un
  composite por superstep, de modo que cada composite integrado queda checkpointeado
  (mejor time-travel y resume sin repetir cherry-picks).
- Suite de tests del grafo completo con deps falsas: paralelismo, waves
  encadenadas, retry vía gate, accept-failing, conflicto de integración, resume
  desde checkpoint en disco.

## 2. Scheduler adaptativo basado en scopes (wavefront disjunto) `[x]`

**Diseño.** Nueva función pura `selectScopeAwareWave` en `@manyhands/scheduler`:
- Firma de scope por tarea: `contract.executionScope.allowedPaths` +
  `producedInterfaces[].id` (rutas de archivo).
- Solapamiento conservador de globs por prefijo literal (`src/auth/**` vs
  `src/auth/login.ts` → solapan; `src/auth/**` vs `src/billing/**` → disjuntos).
- Pares con riesgo `high`/`blocking` en la matriz de conflictos se serializan
  siempre (la matriz por fin se conecta al host de ejecución).
- Greedy en orden topológico: una tarea entra a la wave si no solapa scope ni
  riesgo con las ya seleccionadas; `maxParallel` es opcional (D9: sin tope
  artificial por defecto).
- El host LangGraph pasa la `riskMatrix` real del planning (antes: `[]`).

## 3. Composer con validación AST y reintento con feedback de compilador `[x]`

**Diseño.** `integration/syntax-check.ts` en `execution-core`:
- Tras cada repair y antes de commitear: scan de marcadores de conflicto en todos
  los archivos cambiados + diagnóstico sintáctico de TypeScript
  (`ts.createSourceFile` → parse diagnostics) para `.ts/.tsx/.mts/.cts/.js/.jsx`.
- Si el repair produjo código malformado, se re-inyecta el error exacto al
  executor en un segundo intento (máx. 2 por conflicto); si persiste, la
  integración falla con `executor_repair_failed` y el detalle del diagnóstico.

## 4. Type Extractor pleno para el GroundingAgent `[x]`

**Diseño.** `run/skeleton-scaffolder.ts` en `execution-core`:
- Scaffolding **determinista** de los `InterfaceContract` cuyo `id` es una ruta
  `.ts/.tsx`: se generan candidatos (`signature` literal, `export ${signature}`,
  firma de función con cuerpo `throw new Error("Not implemented")`) y se acepta el
  primero que parsea limpio con el compilador de TypeScript.
- **Extracción de tipos del repo**: los identificadores tipo-referencia de la firma
  se resuelven contra los exports reales del repositorio (scan AST de los archivos
  fuente) y se emiten imports relativos correctos.
- El LLM queda como fallback únicamente para contratos que no se pueden scaffoldear
  de forma determinista; todo archivo creado se valida sintácticamente antes del
  commit del esqueleto (D6).

## 5. Resume/fork nativos de LangGraph `[x]`

- `/api/runs/[id]/resume` distingue planning (flujo de preguntas existente) de
  ejecución: para ejecución construye el host compartido y reanuda con
  `new Command({ resume: decision })` — cero mutación manual de checkpoints.
- Decisiones tipadas (`ResumeDecision`) compartidas entre la UI y el host.
- `/fork` sigue clonando checkpoints inmutables (sin cambios de fondo).

## 6. Descomposición del runner god-file `[x]`

- `apps/web/src/lib/server/runs/execution-host.ts`: construcción del grafo
  compilado + deps (executeLeaf/repairLeaf/integrateComposite/validateRun) y el
  loop de streaming/interrupt-handling, compartido por start y resume.
- El repair de hojas se movió a `execution-core` (`RunExecutor.repairLeaf`),
  eliminando la duplicación de worktree/recorder/validación dentro de la web app.
- `runner.ts` queda como pipeline de planificación + façade fina de ejecución.

## 7. Eliminación de la UI legacy `[x]`

- Borrados el flag `?model=legacy`, `RunCanvasBinding`, `DagCanvas`,
  `DagWorkspace`, `RunCanvasShell`, `TaskInspector` y todos los componentes/hooks
  solo alcanzables desde esa ruta (incl. `useLiveRun`, `nodeStatusOverrides`).
- `projectRunRecordToSnapshot` y `deriveConflictList` sobreviven como librerías de
  dominio (las usa el runner para los predicted conflicts del Composer).

## 8. Sala de control multipanel `[x]`

- `react-resizable-panels` instalado e integrado en la superficie agent-first
  (workspace ⇄ panel de foco redimensionables, con persistencia de layout).

---

## 9. Planning sobre LangGraph (HITL nativo) `[x]` — 2026-06-10

**Diseño.** Planning StateGraph v2 (`graphs/planning-graph.ts`) con el patrón del
execution graph: el nodo caro `decomposePlan` nunca interrumpe (las preguntas del
decomposer vuelven como dato; `DecomposerQuestionError` muere en el seam del host);
`questionGate` y `approvalGate` son nodos puros cuyo primer statement es
`interrupt()`, resumidos con `Command({ resume })`. Critics deterministas corren
in-loop (`criticReview`) y su veredicto viaja en el payload del approval gate.
Host web: `planning-host.ts` (deps + eventos vivos `plan.node.proposed` + checkpoints
en thread `${runId}__planning`). Rutas `resume`/`answer`/`decisions`/`approve-plan`
reanudan nativamente; `restart` borra el thread. Runs legacy sin checkpoint caen al
camino anterior.

## 10. Multi-executor por perfiles + Codex CLI + usage estructurado `[x]` — 2026-06-10

**Diseño.** `CliAgentExecutor` + `CliExecutorProfile`: los executors son datos, no
clases (perfil = argv builder + parser de salida + log scope). Gemini pasa a
`-o json` (response + token stats reales), Claude Code a `--output-format json`
(usage + costo exacto), y Codex CLI queda habilitado (`codex exec` headless,
sandbox workspace-write, prompt por stdin). Clasificador provider-agnóstico de
fallos (`failure.ts`: timeout/auth/quota/binary_missing/model_not_found) persistido
como `failureKind`/`failureHint` en cada resultado. Canal send-to-user: protocolo
`MH_STATUS {json}` por stdout → trazas `agent_status` en vivo.

## 11. Enrutamiento por complejidad con escalación en repair `[x]` — 2026-06-10

**Diseño.** `scoreNodeComplexity` (determinista y explicable: seams, scope, fan-in/out,
criterios, integrators) → tiers trivial/standard/complex/critical →
`ComplexityRoutingPolicy` con carriles ranked y fallback por disponibilidad real de
binarios (`probeExecutorAvailability`). Repairs rutean con `attempt ≥ 1` y escalan un
tier. Config por run: `executionConfig.routing: "complexity" | "fixed"`. Decisiones
auditadas como traza `executor_routed`.

## 12. Re-decomposición selectiva post-fallo `[x]` — 2026-06-10

**Diseño.** `graftSubtree` (task-graph): cirugía validada del DAG — el nodo fallido
conserva identidad, descendientes descartados, bordes re-apuntados, subárbol nuevo
bajo ids `-r{rev}-`. `AmendmentsEngine.invalidateTask` limpia el cierre (subárbol +
dependientes + integraciones ancestras). `replan-service.ts` re-decompone scoped con
seams congelados como restricciones duras, resetea el thread de ejecución y re-entra
el wavefront sembrado con supervivientes. Gate option `replan_subtree` en el leafGate.

---

## 13. Mutaciones idempotentes: versionado optimista + claims HITL `[x]` — 2026-06-11

**Hallazgo.** Ninguna ruta de mutación (`resume`, `restart`, `answer`, `approve-plan`,
`decisions`) tenía guard de concurrencia: dos POSTs concurrentes con la misma decisión
ganaban ambos (doble `Command({resume})`, doble pipeline). `RunRecord` no tenía
versión y los gates no tenían identidad, así que una pestaña vieja podía resolver
un gate re-acuñado.

**Diseño.** PR-1 del plan de robustez U1–U8 (INV-4):
- `RunRecord.version`: contador monotónico propiedad del repositorio (bump en cada
  `save`/`update`, leído del disco dentro del write-lock — nunca regresa).
- `pendingDecision.gateId`: id único por suspensión, acuñado en `gateFromInterrupt`;
  re-suspender la misma tarea acuña uno nuevo, así las decisiones apuntadas al gate
  anterior conflictúan en lugar de resolverlo.
- `claimRunMutation(runId, expectation, mutate)` (`mutation-guard.ts`): re-verifica la
  expectativa (status / pausedDuring / gateId / nodeId de pregunta / versión / runner
  activo) contra el registro FRESCO dentro del write-lock per-run, y el mutador
  consume el claim (limpia el gate, transiciona el status) — el segundo claimant
  idéntico falla su propia expectativa → `RunMutationConflictError` → **409
  estructurado** `{ error, conflict: { currentStatus, currentVersion } }`.
- Las 5 rutas reclaman antes de despachar el pipeline async; `processPlanApproval`
  reclama `approved` ANTES del resume nativo (exactamente un caller entrega el
  Command al approvalGate). `restart` además rechaza con runner in-process activo.
- API expone `version` + `pendingDecision` (con `gateId`); los clientes pueden anclar
  con `{ gateId, expectedVersion }`. La UI trata el 409 estructurado como info
  ("ya fue resuelta") — el modelo se auto-corrige por SSE.
- Tests: `tests/mutation-concurrency.test.ts` (claims, N concurrentes → 1 ganador) y
  `tests/resume-route-concurrency.test.ts` (INV-4 en el seam HTTP real).

---

## 14. Cancelación real: kill verificado de árboles de procesos + GC `[x]` — 2026-06-11

**Hallazgo.** El cancel era cooperativo: `abortRun()` disparaba el AbortSignal, pero
(a) en POSIX solo moría el hijo directo (los forks del CLI quedaban huérfanos
quemando cuota), (b) nadie verificaba que el kill aterrizara, (c) el signal ni
siquiera llegaba a `runNode`/`repairLeaf` en el camino LangGraph (solo al engine
mock), (d) los worktrees del run cancelado sobrevivían, y (e) "cancelado" se
respondía antes de que nada muriera.

**Diseño.** PR-2 del plan de robustez (INV-2):
- `executor/kill.ts`: en POSIX los executors se spawnean `detached` (process
  group propio) y el kill es `kill(-pid, SIGKILL)`; win32 sigue con
  `taskkill /pid /t /f`.
- `executor/live-process-registry.ts`: cada subprocess se registra bajo su
  `processOwnerId` (el runId, threaded por leaf/repair/grounding/composer).
  `killProcessTreeVerified` hace poll del PID raíz (~3s) con re-kill de
  escalación; `killOwnedProcessTrees(runId)` mata y verifica todo lo vivo.
- La ruta `cancel` reclama `interrupted` (claim INV-4), dispara el abort,
  **espera la verificación del kill**, corre `WorktreeManager.gcRun(runId)`
  (remove por convención de directorio + branch delete + `git worktree prune`,
  best-effort por entrada) y persiste el evento `run.cancelled` (durable antes
  del 200) con el inventario kill/GC.
- `driveExecution(host, input, signal)` corta el stream entre supersteps →
  outcome `aborted` (el checkpoint del último superstep completo ya está
  persistido; el run queda reanudable vía restart).

---

## 15. Reconciliador de mundo físico + checkpoints corruptos detectados `[x]` — 2026-06-11

**Hallazgo.** Un resume frío (restart tras crash/cancel) re-entraba al grafo sin
verificar que el mundo físico siguiera coincidiendo con el checkpoint: worktrees a
medio escribir rompían el `git worktree add` de la re-ejecución, commits de
evidencia desaparecidos (branch borrada, `git gc`) se cherry-pickeaban a ciegas, y
un `latest.json` corrupto se trataba como "sin checkpoint" → re-grounding
silencioso desde cero (el `catch { return undefined }` del checkpointer).

**Diseño.** PR-3 del plan de robustez (INV-3):
- **`run/world-reconciler.ts`** (execution-core): valida cada resultado registrado
  resolviendo su commit de evidencia (`rev-parse <sha>^{commit}`); lo desaparecido
  se invalida (la tarea re-ejecuta). Sweep de TODOS los worktrees sobrantes del run
  — preservando las branches `mh/<runId>/<taskId>` de la evidencia conservada, que
  anclan los commits contra `git gc` — y remoción del `index.lock` huérfano (en un
  restart frío ningún proceso del run vive: el cancel verifica kills).
- **`world-reconcile.ts`** (web): corre SIEMPRE antes de re-entrar al grafo cuando
  hay checkpoint. Audita la salud del thread (`inspectThread`) y persiste eventos
  durables: `checkpoint.degraded` (latest corrupto → resume desde el último válido),
  `checkpoint.lost` (nada legible → thread reset, re-entrada informada),
  `world.reconciled` (reporte completo). Invalidaciones → filtra el artifact +
  `resetExecutionThread` → el wavefront re-entra sembrado solo con supervivientes
  (el mismo mecanismo de reseed de los amendments). Base commit inalcanzable →
  `RunNotResumableError` + `interrupted` accionable.
- **Checkpointer**: distingue ENOENT de corrupción; `getTuple` cae al checkpoint
  inmutable válido más nuevo cuando `latest.json` está roto; un checkpoint pedido
  explícitamente (fork) corrupto no tiene sustituto. Fix de bug latente: `list()`
  parseaba `<id>.writes.json` como checkpoints.

---

## 16. Lock por repo destino + preflight endurecido `[x]` — 2026-06-12

**Hallazgo.** Dos runs `localPath` sobre el mismo repo corrían sin detección:
carrera sobre el índice git, el bookkeeping de worktrees y el final apply.
Además el preflight no chequeaba disco (la memoria del proyecto registra
incidentes de C: en 0 bytes) y tenía un bug latente: los artefactos propios de
`.manyhands/` (worktrees de un run previo) hacían fallar el check `repo_clean`
en los restarts.

**Diseño.** PR-4 del plan de robustez (U7):
- **`repo-lock.ts`**: lock file `<repoRoot>/.manyhands/run.lock` con
  `{runId, pid, acquiredAt}`. Adquisición atómica por flag `wx` (de N
  concurrentes gana exactamente uno), re-entrante para el run dueño. Locks
  stale se roban: pid muerto, o proceso ajeno vivo cuyo run dueño no está
  live / con heartbeat vencido (umbral del sweeper). Release owner-scoped.
- **Ciclo de vida**: los pipelines de ejecución (start y resume) reclaman al
  arrancar y liberan en su finally — un run suspendido en gate NO retiene el
  lock (sus worktrees/branches están namespaced por runId); la carrera
  catastrófica son dos pipelines *conduciendo* a la vez. Conflicto →
  `PreflightError("repo_busy")` accionable nombrando al run dueño.
- **Preflight**: nuevo check `disk_space` (statfs, mínimo 1 GiB, remedio
  concreto) y `repo_clean` ahora filtra las líneas `.manyhands/` del porcelain.

---

## 17. Toda falla recuperable es un gate: planning degradado + replan-question `[x]` — 2026-06-12

**Hallazgo.** Dos caminos degeneraban en estado muerto: (a) un fallo terminal del
decomposer (post-reintentos) caía en `failPlanning` → `failed` plano, perdiendo el
árbol parcial válido; (b) una pregunta aclaratoria durante un replan abortaba con
`RunLifecycleError` en vez de suspender. Además las excepciones no clasificables de
ejecución marcaban `failed` aunque existiera checkpoint reanudable.

**Diseño.** PR-5 del plan de robustez (INV-5):
- **`degradedPlanGate`** (planning graph, patrón interrupt-first): `decomposePlan`
  devuelve el fallo terminal como DATO (`kind:"failed"`); el routing lo manda al
  gate, que ofrece `retry` (re-entra el decomposer — el step-cache en el estado
  preserva el árbol parcial y las respuestas acumuladas) o `abort` (la única vía
  sancionada a `failed`, decisión explícita del humano). El pipeline lo proyecta
  como pendingQuestion sintética `__plan_degraded__` + `decision.raised`, así los
  caminos de respuesta existentes (con sus claims INV-4) lo conducen sin UI nueva;
  `planningResumeFor` traduce la etiqueta elegida a la acción tipada del Command.
- **Replan-question como gate (U2)**: `replanSubtree` acepta contexto reanudable;
  al atrapar `DecomposerQuestionError` persiste `pendingReplan` (taskId, reason,
  step-cache del decomposer, respuestas acumuladas) + pendingQuestion (pausa
  durante "running") + `decision.raised`. `resumeReplanWithAnswer` reclama el gate
  atómicamente, folda la respuesta y re-entra `replanSubtree` — el decomposer
  continúa de su step-cache. Cableado en resume/answer/decisions.
- **Barrido de `failed` en ejecución**: `settleExecutionException` — una excepción
  no clasificable con checkpoint existente deja el run `interrupted` (restart
  reconcilia y reanuda); `failed` queda solo para precondiciones (preflight,
  repo_busy, repo ausente) y aborts explícitos.

---

## 18. Presupuesto de tokens/costo por wave con budgetGate `[x]` — 2026-06-12

**Hallazgo.** El único corte de presupuesto era wall-clock; el usage real
(`tokensIn/tokensOut/costUsd`, reportado por Gemini/Claude desde la tarea 10)
no gateaba nada: un run fugitivo podía quemar tokens sin límite.

**Diseño.** PR-6 del plan de robustez (U5):
- `ExecutionConfigSchema` gana `maxTokensTotal`/`maxCostUsd`; el estado del grafo
  los lleva en `budgetLimits` (sembrado del run, sobreescribible por el gate) y
  `finishPartial`.
- `computeBudgetSpend` suma el usage reportado de hojas + repairs del Composer
  (`usageSource:"unavailable"` aporta cero; el watchdog wall-clock sigue siendo
  el respaldo para executors sin telemetría).
- El chequeo vive en `routeFrontier`, ENTRE waves: una hoja en vuelo jamás se
  corta por presupuesto. Excedido → **`budgetGate`** (interrupt-first):
  `extend_budget` (nuevos límites, o lift total sin parámetros) re-despacha la
  frontera; `finish_partial` deja de despachar e integra solo los composites
  completos (cierre explícito y auditado — los pendientes re-entran con un
  restart); `abort_run` como en los demás gates.
- Proyección web: gate `budget_exceeded` en `pendingDecision` con
  `spentTokens/spentUsd/pendingTasks`, opciones en español y mapeo
  answer→acción en los caminos de resume existentes (claims INV-4 heredados).

---

## 19. Reconexión SSE robusta con replay testeado `[x]` — 2026-06-12

**Hallazgo.** El stream `run-events` ya tenía `seq` monotónico + `?after=`, pero los
frames no llevaban `id:` (el Last-Event-ID nativo del browser no funcionaba), la
reconexión dependía del auto-retry sin control de cadencia ni detección de gaps, y
no existía ningún test del contrato de replay. El endpoint legacy `/events`
sobrevivía sin consumidores.

**Diseño.** PR-7 del plan de robustez (U8, INV-7):
- Frames SSE con `id: <seq>`; la ruta honra el header `Last-Event-ID` (gana el
  mayor entre header y `?after=` — ambos significan "ya foldeé hasta acá").
- `use-live-run-model` es dueño de la reconexión: cierre en error + reapertura con
  backoff exponencial con jitter (1s→30s) llevando como cursor el máximo seq
  foldeado; un seq no contiguo (log truncado/rotado) dispara UN replay completo
  desde cero — el reducer cursor-idempotente absorbe cualquier duplicado.
- Borrado el endpoint legacy `/events` (cero consumidores).
- Contrato testeado contra el route handler real: prefijo + sufijo reanudado por
  Last-Event-ID folda al MISMO modelo que un stream ininterrumpido, y un overlap
  total también (INV-7 como propiedad verificada, no aspiración).

---

## 20. Visor de evidencia: agent_status en vivo + diffs resaltados `[x]` — 2026-06-12

**Hallazgo (corregido).** La auditoría previa reportaba refs placeholder; en
realidad los refs diff/log por nodo ya eran reales con carga perezosa y
colapsables. Los gaps reales: los reportes MH_STATUS del agente no tenían
superficie en el panel de foco (ni en vivo ni post-mortem), el failureKind
clasificado no se mostraba, y los diffs se renderizaban sin resaltado.

**Diseño.** PR-8 del plan de robustez (U4):
- Nuevo ref `status://runs/{id}/node/{nodeId}` en el artifacts API: reportes
  `agent_status` (protocolo MH_STATUS) del nodo + decisión `executor_routed` +
  `failureKind`/`failureHint` clasificados del resultado.
- `focus-view` agrega "Estado del agente" a los refs del nodo — incluso para
  nodos EN ejecución (es el único artefacto que existe mientras el agente
  trabaja).
- `ArtifactViewer`: los refs `status://` se refrescan en vivo (poll 4s,
  abiertos por defecto); los diffs unificados se renderizan con resaltado
  +/−/@@ sobre los tokens del tema.
- Pendiente menor: auditoría visual con el harness de screenshots (requiere
  dev server).

---

## Plan de robustez E2E (U1–U8) — secuencia aprobada 2026-06-11

PR-1 `[x]` (§13) → PR-2 `[x]` (§14) → PR-3 `[x]` (§15) → PR-4 `[x]` (§16) →
PR-5 `[x]` (§17) → PR-6
presupuesto tokens/costo por wave → PR-7 SSE Last-Event-ID + replay testeado →
PR-8 visor de evidencia. Detalle completo en el plan de sesión
(invariantes INV-1…INV-7, criterios de aceptación y estrategia de tests por PR).

## Próximas fronteras (pendientes, en orden de valor)

- `[x]` **Kill duro de subprocesos** al abortar un run — resuelto en §14
  (kill verificado por process-group + registry por runId + GC de worktrees).
- `[x]` **Visor de evidencia enriquecido** — resuelto en §20 (status:// en vivo,
  diffs resaltados; los colapsables ya existían).
- `[x]` **HITL en replan** — resuelto en §17 (pendingReplan + gate reanudable por
  step-cache del decomposer).
- `[x]` **Presupuesto de tokens por wave** — resuelto en §18 (budgetGate con
  extend/finish_partial/abort entre waves).
- `[ ]` **Usage estructurado para Codex** (parsear el stream JSONL experimental de
  `codex exec --json` cuando se estabilice).
