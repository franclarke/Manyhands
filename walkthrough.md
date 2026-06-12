# Walkthrough — Sesión 2026-06-12 (Robustez E2E, PR-5: fallas recuperables → gates)

> PR-5 del plan de robustez U1–U8 (diseño en
> [`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md) §17).
> Invariante cerrado: **INV-5 — toda falla recuperable termina en gate o `interrupted`
> reanudable; `failed` solo por decisión explícita o precondición**.

## Qué se hizo

1. **`degradedPlanGate` (U6)**: el fallo terminal del decomposer ya no muere en
   `failed` — `decomposePlan` lo devuelve como dato, el grafo rutea al gate
   (interrupt-first) y el humano elige reintentar (el step-cache preserva el árbol
   parcial y las respuestas previas) o abortar (única vía sancionada a `failed`).
   Proyección como pendingQuestion sintética + `decision.raised`: los caminos de
   respuesta existentes lo conducen con sus claims idempotentes, sin UI nueva.
2. **Replan-question como gate (U2)**: `replanSubtree` atrapa la pregunta del
   decomposer y persiste `pendingReplan` (step-cache + respuestas acumuladas) con
   la pausa; `resumeReplanWithAnswer` reclama el gate, folda la respuesta y
   re-entra el replan donde quedó. Cableado en resume/answer/decisions.
3. **`settleExecutionException`**: excepción no clasificable con checkpoint →
   `interrupted` reanudable con mensaje accionable; `failed` queda para
   precondiciones (preflight/repo_busy/repo ausente) y aborts explícitos.

## Verificación

- Typechecks (orchestrator-graph, web, raíz) ✅ · `pnpm test` ✅ — **979 passed / 4
  skipped** (+7)
- Nuevos: planning-graph degraded-gate (3 — retry re-entra, abort termina, el
  step-cache sobrevive a pregunta+fallo), `replan-question-gate.test.ts` (4 —
  resume consume el gate, duplicados → 1 ganador, sin replan → 409, ruta /answer).

---

# Walkthrough — Sesión 2026-06-12 (Robustez E2E, PR-4: lock por repo + preflight)

> PR-4 del plan de robustez U1–U8 (diseño en
> [`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md) §16).
> Historia cerrada: **U7 — dos runs sobre el mismo repo se detectan y rechazan**.

## Qué se hizo

1. **`repo-lock.ts`**: lock atómico por repo destino (`.manyhands/run.lock`, flag
   `wx`), re-entrante para el run dueño, con robo de locks stale (pid muerto u
   owner sin heartbeat) y release owner-scoped.
2. **Pipelines start/resume** reclaman el lock al arrancar y lo liberan en su
   finally; el conflicto es un `PreflightError("repo_busy")` accionable que nombra
   al run dueño. Un run gateado no retiene el lock (la carrera peligrosa son dos
   pipelines conduciendo a la vez).
3. **Preflight endurecido**: check `disk_space` (statfs, mínimo 1 GiB) y fix de un
   bug latente — los worktrees de `.manyhands/` de un run previo hacían fallar el
   `repo_clean` de los restarts.

## Verificación

- Typechecks (web + raíz) ✅ · `pnpm test` ✅ — **972 passed / 4 skipped** (+10)
- Nuevo: `repo-lock.test.ts` (10 tests: 5 adquirentes concurrentes → exactamente
  1 gana, steal de pid muerto, lock corrupto, release ajeno no clobbersea,
  preflight con `.manyhands/` ignorado / suciedad real / disco bajo / probe ausente).

---

# Walkthrough — Sesión 2026-06-11 (Robustez E2E, PR-3: reconciliador de mundo físico)

> PR-3 del plan de robustez U1–U8 (diseño en
> [`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md) §15).
> Invariante cerrado: **INV-3 — ningún resume opera sobre filesystem divergente sin
> reconciliación previa**.

## Qué se hizo

1. **`run/world-reconciler.ts`** (execution-core): antes de un resume frío valida
   cada resultado registrado resolviendo su commit de evidencia; lo desaparecido se
   invalida y re-ejecuta. Sweep de worktrees sobrantes (un leaf nuevo no puede
   crear worktree sobre un directorio viejo), **preservando las branches que anclan
   evidencia conservada** (sin ancla, un `git gc` destruiría la única copia del
   trabajo), y remoción del `index.lock` huérfano.
2. **`world-reconcile.ts`** (web): seam que corre SIEMPRE en `runExecutionPipeline`
   cuando existe checkpoint. Salud del thread + reconcile + eventos durables
   (`world.reconciled`, `checkpoint.degraded`, `checkpoint.lost`). Invalidaciones →
   filtra el artifact + reset del thread → reseed con supervivientes (mismo
   mecanismo que amendments). Base inalcanzable → `RunNotResumableError` +
   `interrupted` accionable.
3. **Checkpointer endurecido**: ENOENT ≠ corrupción; `getTuple` cae al último
   checkpoint inmutable válido cuando `latest.json` está roto (torn write);
   `inspectThread` reporta ok/degraded/lost/missing. Fix de bug latente: `list()`
   parseaba los `.writes.json` como checkpoints.
4. **Cancel también preserva evidencia**: `gcRun(runId, { preserveBranchesFor })`
   — un run cancelado queda reanudable con su trabajo completado intacto.

## Verificación

- Typechecks (web, execution-core, orchestrator-graph, raíz) ✅
- `pnpm test` ✅ — **962 passed / 4 skipped** (baseline 950; +12 nuevos)
- Nuevos: `checkpointer-corruption.test.ts` (5), `world-reconciler.test.ts` (3, git
  real: evidencia conservada/invalidada/huérfanos/locks), `world-reconcile-web.test.ts`
  (4: consistente / invalidación+reset / degraded / base perdida).

---

# Walkthrough — Sesión 2026-06-11 (Robustez E2E, PR-2: cancelación real)

> PR-2 del plan de robustez U1–U8 (diseño en
> [`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md) §14).
> Invariante cerrado: **INV-2 — cancelar detiene procesos hijos verificados y evita
> escrituras posteriores**.

## Qué se hizo

1. **POSIX process-group kill** (`executor/kill.ts`): los executors se spawnean
   `detached` (grupo propio) y el kill es `kill(-pid, SIGKILL)` — antes solo moría
   el hijo directo y los forks del CLI quedaban huérfanos. Win32 sigue con
   `taskkill /pid /t /f`.
2. **Registry de procesos vivos** (`executor/live-process-registry.ts`): cada
   subprocess se registra bajo `processOwnerId` (el runId), threaded por los 5
   puntos de spawn (leaf, repair × 2, grounding, composer).
   `killProcessTreeVerified` hace poll del PID raíz con re-kill de escalación;
   `killOwnedProcessTrees(runId)` mata y verifica todo lo que siga vivo.
3. **Ruta cancel reescrita**: claim de `interrupted` (INV-4) → abort cooperativo →
   **await del kill verificado** → `WorktreeManager.gcRun(runId)` (remove por
   convención `<repo>/.manyhands/worktrees/<runId>/*` + branch delete + `git
   worktree prune`, best-effort) → evento `run.cancelled` durable ANTES del 200,
   con inventario `{killedProcesses, escalatedKills, survivors, cleanedWorktrees}`.
4. **Loop del host abort-aware**: `driveExecution(host, input, signal)` corta el
   stream entre supersteps → outcome `aborted` (checkpoint del último superstep
   persistido; reanudable vía restart). Además el AbortSignal ahora llega a
   `runNode`/`repairLeaf` en el camino LangGraph — antes solo el engine mock lo
   recibía, así que cancelar durante ejecución LangGraph no mataba nada.

## Verificación

- `pnpm web:typecheck`, `pnpm -F @manyhands/execution-core typecheck`, `pnpm typecheck` (raíz) ✅
- `pnpm test` ✅ — **950 passed / 4 skipped** (baseline 939; +12 nuevos)
- Nuevos: `execution-core-kill-verify.test.ts` (6 — procesos reales, verificación
  post-kill, group-kill POSIX con nieto), `cancel-route.test.ts` (3 — e2e con git
  real: worktree+branch eliminados, proceso verificado muerto antes del 200,
  evento auditado, doble cancel → 409), `execution-host-abort.test.ts` (3).

---

# Walkthrough — Sesión 2026-06-11 (Robustez E2E, PR-1: mutaciones idempotentes)

> PR-1 del plan de robustez U1–U8 (diseño completo en
> [`docs/design/future-frontier-tasks.md`](docs/design/future-frontier-tasks.md) §13).
> Invariante cerrado: **INV-4 — toda decisión HITL es idempotente**.

## Qué se hizo

1. **`RunRecord.version`**: contador monotónico propiedad del repositorio. `save` lo
   lee del disco DENTRO del write-lock per-run (un snapshot viejo nunca lo regresa);
   `update` usa el registro fresco. Token de concurrencia optimista para la API.
2. **`pendingDecision.gateId`**: id único acuñado por cada suspensión en
   `gateFromInterrupt` (execution-host). Re-suspender la misma tarea acuña uno nuevo:
   una pestaña vieja no puede resolver un gate re-acuñado.
3. **`mutation-guard.ts` (nuevo)**: `claimRunMutation(runId, expectation, mutate)` —
   re-verifica status/pausedDuring/gateId/pregunta/versión/runner-activo contra el
   registro fresco dentro del lock, y el mutador consume el claim (limpia el gate,
   transiciona). El perdedor de la carrera recibe `RunMutationConflictError` → 409
   estructurado `{ error, conflict: { currentStatus, currentVersion } }`.
4. **Las 5 rutas de mutación reclaman antes de despachar pipelines**: `resume` (3
   ramas), `restart` (consume el status restartable + rechaza runner activo),
   `answer`, `approve-plan` y `decisions` (que ahora reusa `processPlanApproval` en
   vez de duplicarlo). `processPlanApproval` reclama `approved` ANTES del resume
   nativo: exactamente un caller entrega `Command({resume})` al approvalGate. La
   aprobación de amendments usa version-CAS para no sembrar el pipeline dos veces.
5. **API/UI**: `RunResponse` expone `version` + `pendingDecision` (con `gateId`);
   las rutas aceptan `{ gateId, expectedVersion }` opcionales. `route-errors.ts`
   unifica el mapeo de errores (dedup de 5 copias). El chat trata el 409
   estructurado como info ("ya fue resuelta") — el modelo se auto-corrige por SSE.

## Verificación

- `pnpm web:typecheck`, `pnpm -F @manyhands/execution-core typecheck`, `pnpm typecheck` (raíz) ✅
- `pnpm test` ✅ — **939 passed / 3 skipped** (baseline 925; +14 nuevos)
- Nuevos: `tests/mutation-concurrency.test.ts` (9 — claims, N concurrentes → exactamente
  1 ganador, gateId stale, versión stale, runner activo) y
  `tests/resume-route-concurrency.test.ts` (5 — INV-4 contra los route handlers reales:
  dobles POSTs a resume/answer/restart → un 200 y un 409 estructurado).

---

# Walkthrough — Sesión 2026-06-11 (UI/UX Professionalization Pass)

> PR: pase de profesionalización UI/UX del flujo core de ManyHands.
> Auditoría completa + plan + resultados: [`docs/ui-audit/manyhands-ui-audit.md`](docs/ui-audit/manyhands-ui-audit.md).
> Before/after: `docs/ui-audit/screenshots/{before,after}/`.

## Qué se hizo

1. **Auditoría escrita** (scorecard 11 dimensiones, issues por área, plan PR-shaped) antes de tocar código.
2. **Loop A — fundación**: fix de capas CSS (`@layer base` para resets — los resets sin capa pisaban TODAS las utilidades Tailwind en form controls, la causa raíz de los inline styles), `Button` con estados completos, `StatusPill`, `ConfirmDialog`, `.mh-skeleton` (el loading del run era invisible), fix SSR de `useDefaultLayout` (500 intermitente en /runs/[runId]), purga de 18 componentes muertos + `/counter` + jest vestigial roto, readiness/preflight traducidos al español.
3. **Loop B — shell**: sidebar tokenizada, sin links 404 (/compare /benchmarks /settings), conflictos en ámbar (rust solo si el run falló).
4. **Loop C — new run**: composer de una sola tarjeta (contexto + prompt + acciones + drawer avanzado con labels), CTA estable "Generar plan" con razón de bloqueo, pills Repo/Gemini separadas, ConfirmDialog para borrar workspace.
5. **Loop D — cockpit**: header jerárquico (sin UUIDs crudos), chat por id semántico de mensaje (sin string-sniffing), GateCard que apunta a su decisión por id, wave-progress con títulos reales de nodos, **eliminada la respuesta fake del asistente**, composer honesto conectado a `/api/runs/[id]/answer` (responde preguntas del planner), errores de acciones visibles, estado Conectado/Reconectando real, tabs ARIA con flechas.
6. **Loop E — DAG**: lanes sin ember (P1: el calor es estado vivo), nodo raíz distinto, minimapa >12 nodos, canvas sin banda inferior, failed/blocked/obsolete tintan el borde de la card (obsolete nunca rojo), bug del dato falso "Profundidad: 3" corregido.
7. **Loop F — polish**: FocusPanel 100% tokens semánticos, reduced-motion ampliado (`animate-pulse`, `.mh-skeleton`), selects con caret custom, targets 28px con aria-label.
8. **Build de producción reparado**: el patch de `@assistant-ui/tap` no era production-safe (accesos `React['x']` estáticamente analizables → errores webpack en prod); endurecido con accessors opacos. `pnpm web:build` ahora pasa.

## Verificación

- `pnpm test` → 925 passed / 3 skipped (1 assert actualizado por traducción de readiness).
- `pnpm typecheck`, `pnpm -F @manyhands/web typecheck`, `pnpm -F @manyhands/web lint`, `pnpm -F @manyhands/web contrast:check` → limpios.
- `pnpm web:build` → ✅ (estaba roto pre-pase).
- `pnpm lint` raíz → 56 errores **preexistentes** fuera del alcance UI (packages/, scratch/, tests/), documentados como follow-up.

## Notas operativas

- Screenshots reproducibles: `apps/web/scripts/ui-shots.mjs` y `ui-shot-crop.mjs` (puppeteer-core devDep raíz + Chrome del sistema; `MSYS_NO_PATHCONV=1` en git-bash).
- Se detuvo un dev server huérfano en :3000 (PID 9828, de ayer) que lockeaba `next-swc` y rompía los installs.
- Follow-ups priorizados en la sección 7.4 del audit doc.

---

# Walkthrough — Sesión UltraCode 2026-06-10 (frontera end-to-end)

Reporte de cambios de la sesión. Detalle completo del diseño y el mapa
instruir/evaluar/corregir: ver [`implementacion-frontera.md`](implementacion-frontera.md).

## Commits de checkpoint

1. `b3b798d` — **execution-core multi-executor**: capa por perfiles
   (`CliAgentExecutor` + `CliExecutorProfile`), rediseño Gemini (`-o json` con token
   stats), Claude Code con `--output-format json` (usage/costo reportados), Codex CLI
   habilitado (`codex exec` headless), clasificador de fallos (`failureKind`/`failureHint`),
   canal send-to-user (`MH_STATUS` → trazas `agent_status`), upgrade automático de
   `usageSource` en el recorder.
2. `411adc5` — **enrutamiento por complejidad**: scorer determinista explicable,
   política por tiers con fallback por disponibilidad real de binarios, escalación de
   tier en repairs, traza `executor_routed`, `executionConfig.routing`.
3. `5a5f2f2` — **planning sobre LangGraph**: StateGraph v2 con gates baratos
   (`questionGate`/`approvalGate` con `interrupt()` nativo), critics in-loop,
   `planning-host.ts`, resume nativo con `Command({ resume })` en
   resume/answer/decisions/approve-plan, thread `${runId}__planning`,
   `DecomposerQuestionError` eliminado del flujo de orquestación.
4. `9cf6439` — **re-decomposición selectiva**: `graftSubtree` (task-graph),
   `AmendmentsEngine.invalidateTask` (cierre subárbol+dependientes+ancestros),
   `replan-service.ts` (re-plan scoped con seams congelados), gate option
   `replan_subtree` en el leafGate.

## Verificación

- `pnpm -F @manyhands/execution-core typecheck` ✅
- `pnpm -F @manyhands/orchestrator-graph typecheck` ✅
- `pnpm -F @manyhands/task-graph typecheck` ✅
- `pnpm web:typecheck` ✅
- `pnpm build` ✅
- `pnpm typecheck` (raíz) ✅ — exit 0. Nota: el typecheck raíz estaba roto desde antes
  (sin mapping `@/*` y ~40 errores latentes en fixtures de tests que vitest nunca
  typecheckeó); se agregó el alias a `tsconfig.base.json`, lib DOM al programa raíz,
  y se repararon los 21 archivos de test afectados.
- `pnpm test` ✅ — 925 tests passed / 3 skipped (96 archivos; baseline previo: 868 / 88)

## Archivos clave nuevos

- `packages/execution-core/src/executor/{cli-executor,failure,status-channel}.ts`
- `packages/execution-core/src/executor/profiles/{gemini,claude-code,codex}.ts`
- `packages/execution-core/src/routing/{complexity,policy,availability}.ts`
- `packages/orchestrator-graph/src/graphs/planning-graph.ts` (v2) + test
- `apps/web/src/lib/server/runs/{planning-host,replan-service}.ts`

## Eliminado (cero legacy)

- `packages/execution-core/src/executor/{gemini-cli,claude-code-cli}.ts`
  (reemplazados por perfiles + executor genérico)
- Planning nodes v1 (cola por superstep con interrupt dentro del nodo caro) y su test
- Flujo exception-driven de preguntas en `planning-pipeline.ts` (653 → driver fino)
