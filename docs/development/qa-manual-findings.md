# QA Manual End-to-End — Registro de Hallazgos

> Loop de QA agent-driven. Cada hallazgo se documenta para análisis posterior de
> causa raíz y se arregla TDD (test rojo que reproduce → fix → verde).
>
> Estados: `OPEN` (detectado, sin verificar) · `CONFIRMED` (repro establecido) ·
> `FIXED` (test rojo + fix verde) · `WONTFIX` (no es bug / aceptado) ·
> `FALSE-POSITIVE` (descartado en verificación).
>
> Severidad: `S1` crash/data-loss · `S2` función rota visible al usuario ·
> `S3` degradación/edge · `S4` cosmético/robustez.

Iniciado: 2026-06-22. Modelo de auth en uso: suscripción Pro vía Claude Desktop.

---

## Tema transversal detectado

La app reduce un log append-only de `RunEvent` y proyecta vistas desde
`RunRecord`. Los campos `planning` y `execution` se persisten como `z.unknown()`.
**La clase de bug dominante es: consumidores que asumen la forma completa del
payload y crashean (o 500ean toda una lista) cuando el record viene parcial,
malformado, legacy o corrupto.** Todo proyector/presenter/reducer/selector debe
degradar, no tirar.

---

## Hallazgos

### F-001 — Token OAuth de suscripción expira a mitad de run → ejecución 401 · S1 · CONFIRMED
- **Síntoma:** planning OK, ejecución de hojas falla con `401 Invalid
  authentication credentials` (`duration_api_ms: 0`).
- **Causa raíz:** el `claude` anidado que spawnea el executor lee
  `~/.claude/.credentials.json` en disco, cuyo token OAuth había expirado
  (`expiresAt 22:28:00`). Planning corrió 22:27 (token válido), ejecución 22:31
  (vencido). El Desktop refresca el token en memoria para la sesión interactiva
  pero no persiste al archivo que leen los subprocesos standalone.
- **Repro:** `echo x | claude -p ... --output-format json` con `.credentials.json`
  vencido → 401 inmediato, independiente de flags (`--permission-mode plan` y
  `--dangerously-skip-permissions` fallan igual).
- **Fix de raíz propuesto:** los executors headless no deben depender del OAuth
  de suscripción (refresh in-memory inaccesible). Opciones: (a) usar
  `ANTHROPIC_API_KEY` dedicada en el env del server para los subprocesos; (b)
  pre-flight de credenciales antes de arrancar la ejecución y fallar con error
  accionable ("token vencido, reloguear") en vez de 401 por hoja; (c) detectar
  `api_error_status: 401` y emitir un gate de auth distinto de
  `leaf_validation_failed`. Ver F-00X (clasificación de error).
- **Estado:** causa raíz confirmada empíricamente. Fix pendiente de decisión.

### F-002 — Payload `planning` parcial crashea proyección/presenter/listado · S1 · FIXED (WIP, sin commitear)
- **Síntoma:** un `RunRecord` que persiste solo `{ decomposition: { graph } }`
  (run fallido) hace que `projectRunRecordToSnapshot` tire en
  `planning.decomposition.feature.id`, y `toRunPreview` tire en
  `planning.summary.taskCount` / `planning.riskMatrix.filter` — **un solo record
  malo 500ea todo `/api/runs`.**
- **Causa raíz:** `planning`/`execution` son `z.unknown()`; los consumidores
  asumían la forma completa sin guard.
- **Fix:** `isProjectablePlanning()` como single source of truth (en
  `live-graph.ts`), `presenter.ts` defensivo con `countBlockingRisks()`,
  `run-model-projection.ts` reusa el guard. Tests: `live-graph-partial-planning.test.ts`,
  `presenter.test.ts` (+18 líneas).
- **Estado:** arreglado en working tree (sin commit). Documentado como la clase.

### F-003 — Doble `node.execution.started` por hoja · S3 · FIXED
- **Síntoma:** en el event log del run `e300bfb2`, seq 59 (`22:31:28.533`) y
  seq 60 (`22:31:28.950`) son dos `node.execution.started` idénticos para
  `app-shell`, ~400ms aparte. La UI recibe dos "started" por cada intento de hoja.
- **Causa raíz:** NO era doble spawn — el executor corre una sola vez por intento.
  El trace-adapter (`run-model-trace-adapter.ts`) mapeaba **dos** trace events
  distintos al mismo `node.execution.started`: `agent_started` (emitido en
  `executor.ts:684`, pre-worktree, payload vacío) **y** `executor_started`
  (`executor.ts:758`, pre-spawn, con `executorId`+`model` reales). El gap de
  ~400ms es worktree-create + context-pack entre ambas líneas. Misma clase
  "dos cosas que driftaron".
- **Fix:** `agent_started` ya no emite `node.execution.started`; `executor_started`
  es la única fuente (lleva el payload preciso — `agent_started` hardcodeaba
  `claude-code-cli`, incorrecto para gemini/codex). El camino que saltea
  `executor_started` (falla de worktree) aborta el run igual, así que no se pierde
  señal útil.
- **Repro/regresión:** `tests/run-model-trace-adapter.test.ts` (test nuevo, rojo→verde).
  86 tests de proyección/reducer/live verdes; web typecheck OK.
- **Estado:** FIXED esta iteración (TDD).

### F-004 — Hoja `accept_failing` deja dependientes silenciosamente stranded · S2 · FIXED
- **Síntoma:** con `leaf-c` dependiente de `leaf-a`, si se acepta `leaf-a`
  fallando, `leaf-c` nunca se ejecuta. El run reporta `completed` dejando el
  subárbol dependiente sin ejecutar y sin ninguna señal.
- **Causa raíz:** `dependencySatisfied` (frontier de ejecución, `execution-nodes.ts:149`)
  usaba `leafSucceeded` (solo status `success`), mientras que el lado de
  integración (`childSettled`, mismo archivo) usa `leafSettled` (success **o**
  fallo aceptado). Las dos lógicas, que deberían ser el mismo predicado
  "settled", habían driftado: un fallo aceptado desbloqueaba la integración del
  padre composite pero NO los dependientes de tarea → strand silencioso.
- **Fix:** `dependencySatisfied` ahora usa `leafSettled` para productores
  leaf/integrator, espejando `childSettled`. Comentario agregado advirtiendo que
  ambos predicados deben mantenerse en sync.
- **Repro/regresión:** `packages/orchestrator-graph/src/graphs/repro-stranding.test.ts`
  (rojo → verde). 14 tests de `execution-graph.test.ts` siguen verdes.
- **Estado:** FIXED esta iteración (TDD).

### F-005 — Inconsistencia gemela en rama composite de `dependencySatisfied` · S3 · OPEN (latente)
- **Síntoma (latente):** misma clase que F-004 pero para productores composite.
  `dependencySatisfied` (rama composite) solo acepta `INTEGRATION_SUCCESS`,
  mientras `childSettled` también acepta un fallo de integración aceptado que
  preservó commit (`acceptedIntegrationFailures` + `integrationCommitSha`). Si
  una tarea depende de un composite cuyo fallo de integración fue aceptado, el
  dependiente quedaría stranded.
- **Causa raíz:** misma deriva entre los dos predicados, rama composite.
- **Estado:** OPEN. Sin red test todavía (requiere confirmar que el decomposer
  produce dependencias leaf→composite). Candidato a unificar `dependencySatisfied`
  y `childSettled` en un único predicado "settled-and-usable". Próxima iteración.

### F-006 — `applyPatchesUpTo` crashea con `planning`/`execution` parcial · S2 · FIXED
- **Síntoma:** `patches.ts` dereferenciaba `planning.decomposition.graph`,
  `execution.planning.decomposition.graph` y `execution.snapshot.graphSnapshot`
  sin guard estructural. Un record parcial (`{ summary: {} }` / `{ snapshot: {} }`)
  tira `TypeError` → 500 en cualquier request de edición/patch-replay.
- **Causa raíz:** misma clase que F-002 (payload `z.unknown()` asumido completo),
  en 3 accesos no guardados.
- **Fix:** guards `hasPatchablePlanning` / `hasPatchableSnapshot` focalizados
  (exactamente lo que el patch context dereferencia); degrada a no-op.
- **Repro/regresión:** `tests/patches-partial-record.test.ts` (4 tests, rojo→verde);
  16 de `editable-control-plane.test.ts` sin regresión. Detectado por workflow QA.
- **Estado:** FIXED esta iteración (TDD).

### F-007 — `projectRunRecordToSnapshot` devuelve snapshot malformado (viola contrato) · S2 · FIXED
- **Síntoma:** con `execution.snapshot = {}` (legacy/corrupto), la proyección
  retornaba ese `{}` en vez de `null`, y un consumidor crasheaba en
  `snapshot.graphSnapshot.nodes` (`run-model-projection.ts:115`).
- **Causa raíz:** `live-graph.ts:60` asignaba `execution.snapshot` sin validar la
  forma; el contrato declarado es `RunSnapshot | null`.
- **Fix:** guard `isProjectableSnapshot` (exigir `graphSnapshot.nodes` + `contracts`),
  reusado en `hasProjectableSnapshotInput`. Single source of truth como
  `isProjectablePlanning`.
- **Repro/regresión:** caso nuevo en `tests/live-graph-partial-planning.test.ts`
  (rojo→verde); 15 tests de proyección/presenter verdes; web typecheck OK.
- **Estado:** FIXED esta iteración (TDD).

---

## Catálogo de hallazgos del workflow QA (iter 1) — OPEN salvo indicación

> Sweep de 8 superficies, 71 agentes. 63 hallazgos brutos → 23 confirmados
> reales (verificación adversarial) → de esos, F-006/F-007 ya arreglados arriba.
> Resto pendiente, agrupado por tema y priorizado. `file:line` para análisis.

### Tema: robustez de proyección (payloads `z.unknown()` parciales)
Cubierto y cerrado por F-002/F-006/F-007. Patrón de fix: guard estructural
compartido + degradar a null/no-op. No quedan accesos no guardados conocidos.

### Tema: reducer/SSE — pérdida silenciosa por eventos huérfanos/desordenados
- **F-008 · S2 · OPEN** — `sse-adapter.ts:115`: al adaptar `status.changed` con
  status ya `approved` (resume mid-run / stream truncado) emite
  `decision.resolved` para `approve_plan` **sin** un `decision.raised` previo; el
  reducer (`reducer.ts:343`) no encuentra la decisión y descarta la resolución.
  Raíz: `adaptStreamEvent` es puro/sin estado y emite resolución según el status
  actual, no según si la decisión fue planteada.
- **F-009 · S2 · OPEN** — `reducer.ts:188-207`: `plan.seam.proposed` usa
  `ensureNode` y crea nodos mínimos (title/goal vacíos) para producer/consumer
  inexistentes → seams con edges colgantes; se ven en `focus-view`/`seamFocus`.
  (La reachability vía `selectInvalidatedNodes` que reclamaba el finder es falsa;
  el impacto real es en vistas de foco). Raíz: falta validar existencia antes de crear.
- **F-014 · S3 · OPEN** — `reducer.ts:323`: `amendment.applied` para un
  `amendmentId` inexistente (o antes de `amendment.proposed`) se ignora sin
  error/audit; no puede sintetizar la amendment (faltan kind/changeKind/...).
- **F-015 · S3 · OPEN** — `reducer.ts:363`: idéntico para `conflict.resolved`
  sobre un `conflictId` nunca `detected`: resolución perdida en silencio.
- **F-016 · S3 · WONTFIX (decisión de diseño)** — `reducer.ts:89-97`: eventos de
  tipo desconocido avanzan el cursor sin efecto → no re-reproducibles. Es un
  trade-off de forward-compat (monotonicidad/idempotencia) deliberado y
  documentado, no un defecto. Revisar solo si se quiere auditoría de eventos corruptos.
- **F-017 · S3 · WONTFIX (decisión de diseño)** — `reducer.ts:350-356`:
  `conflict.detected` con `nodeIds` inexistentes se acepta; los selectores solo
  iteran nodos existentes (política "missing node is not stale"). Tolerancia
  intencional; documentar, no romper.

### Tema: durabilidad y concurrencia de persistencia
- **F-011 · S2 · OPEN** — `checkpointer.ts:201/233-252`: sin lock por threadId.
  `put()` y `putWrites()` concurrentes (parallel leaves en gate HITL) → TOCTOU
  read-modify-write en `checkpoint.writes.json`: writes perdidas en resume.
  `JsonRunRecordStore` sí tiene `writeChains`; el checkpointer no. Raíz: falta
  serialización por thread.
- **F-012 · S2 · OPEN** — `atomic-write.ts:9` y `checkpointer.ts:219-220`: rename
  atómico pero `writeFile` sin `fsync` → crash/power-loss puede dejar el archivo
  final con buffers no flusheados = JSON truncado. run-store tira
  `RunValidationError` sin recovery; checkpointer puede cargar estado viejo
  (latest.json stale apunta a checkpoint previo). Raíz: falta durability fence.
- **F-021 · S3 · OPEN** — `repository.ts:203`: `readRawWithRetry` reintenta ENOENT
  4 veces asumiendo rename transitorio, pero ENOENT también = archivo borrado;
  `list()` lo saltea en silencio (catch 88-91). No distingue delete vs lock.

### Tema: integración / worktree
- **F-013 · S2 · FIXED** — `integration/agent.ts:566`: `attemptRepair` no guardaba
  `changedFiles.length === 0` (sí lo hace `ResultRecorder`). Repair con cero
  cambios → `git.commit()` sobre índice vacío **lanza** (no `--allow-empty`, sin
  try-catch) → excepción no manejada que crashea toda la integración. **Fix:**
  guarda de `changedFiles` vacío antes del commit → falla limpio como
  `validation_failed` (el conflicto sin resolver va al conflict gate). Regresión:
  2 tests en `execution-core-integration.test.ts` (uno reproduce el crash con
  `failOperations.commit`). 22 tests verdes; typecheck OK.
- **F-022 · S3 · OPEN** — `integration/agent.ts:279`: si tras un conflicto de
  cherry-pick una excepción (p.ej. `traceStore.append`/publish) ocurre antes de
  `cherryPickAbort()`, el worktree queda en estado `CHERRY_PICK_HEAD`; el
  `finally` de `executor.ts:538` solo limpia si `cleanupWorktrees === true`
  (nunca seteado en prod). Raíz: cleanup de estado de cherry-pick no garantizado.

### Tema: lifecycle — pre-validación contra snapshot stale (races confusas)
- **F-018 · S3 · OPEN** — `resume/route.ts:61`: lee el run fuera de lock y ramifica
  (65-89) sobre ese snapshot; el claim atómico (`claimRunMutation`) re-valida y
  tira 409 correcto, pero el mensaje de error refleja estado stale → confuso.
- **F-019 · S3 · OPEN** — `answer/route.ts:52`: mismo patrón; pasa snapshot stale a
  `answerExecutionGate`; el claim atómico protege, pero la pre-validación y los
  mensajes son contra estado viejo. (Ambos: el sistema NO corrompe estado, el
  claim atómico es la red de seguridad; es calidad de error, no integridad.)

### Tema: decomposer / API hardening
- **F-023 · S3 · OPEN** — `decomposer/src/llm/normalize.ts:177`: el decomposer
  single-pass hardcodea `validationCommands: []` y el schema no tiene campo para
  ellos → se pierden los comandos de validación del LLM. (El recursivo usa
  `leafValidationCommands` aparte.) Relacionado con `[[decomposer-validation-commands-gap]]`.
- **F-024 · S4 · FIXED** — `answer/route.ts:26`: `answer: z.string().min(1)` sin
  `.max()` → answers multi-MB aceptados/persistidos. **Fix:** `.max(10_000)`.
  Regresión: `tests/route-input-validation.test.ts`.
- **F-025 · S4(sec) · FIXED** — `fork/route.ts:40`: `checkpointId` sin validar
  formato; se pasa a `path.join` (`checkpointer.ts:70`) → path traversal
  (`../other-thread/...`) = **authz bypass** (clonar checkpoints de otros runs).
  **Fix:** `.regex(/^[A-Za-z0-9_-]+$/).max(200)` (UUID-shaped; rechaza `.`/`/`/`\`).
  Regresión: `tests/route-input-validation.test.ts` (incluye guard de no-over-reject).
- **F-026 · S4 · OPEN** — `decomposer/src/llm/guards.ts:119`: con `dependencies: []`
  el DFS de ciclos corre trivial; no se chequea consistencia árbol↔edges. Gap
  semántico (plan sin secuencia capturada), no crash.

### Falsos positivos (desmentidos empíricamente)
- **FP — auth con exitCode 0** (workflow #5/#15 + el "uncertain" #23): reclamaban
  que el CLI claude devuelve `exitCode 0` con `is_error:true`, dejando que
  `classifyExecutorFailure` saltee `AUTH_PATTERN`. **Verificado empíricamente:
  el CLI devuelve `EXIT_CODE=1` en el 401** (`is_error:true`, `subtype:"success"`).
  Como exitCode≠0, sí se clasifica como `auth`. La premisa es falsa → no es bug en
  el path real. (Lección: la verificación adversarial por lectura de código no
  sustituye correr el binario; el test empírico corrigió 3 hallazgos.)

### Refinamiento de F-001 (gate de auth)
- **F-027 · S3 · OPEN** — aunque `failureKind: "auth"` se computa bien (exitCode=1),
  el gate que se le muestra al usuario es el genérico `leaf_validation_failed`
  ("La validación falló tras la auto-reparación"), no uno de auth. Un 401 debería
  surgir como decisión de auth distinta (reloguear), no como fallo de validación.
  Ata con F-001(c).

---

## Superficie pendiente de barrer (próximas iteraciones)

- [x] Validación de input en rutas de API (cubierto parcial: F-024, F-025).
- [x] Reducer/selectores: eventos huérfanos/desordenados (F-008/F-014/F-015/F-017).
- [x] Lifecycle: races de pre-validación (F-018/F-019).
- [x] Checkpoint/persistencia: durabilidad y concurrencia (F-011/F-012/F-021).
- [x] Integración/worktree (F-013/F-022).
- [x] Clasificación de errores del executor (F-027; FP de exitCode aclarado).
- [ ] Próximo fix batch sugerido: F-024 + F-025 (hardening trivial/seguridad),
  luego F-008 (SSE) y F-014/F-015 (huérfanos reducer), luego F-012 (fsync).
- [ ] Profundizar: UI/cockpit en browser, SSE reconnection real, scope-checker en
  Windows (backslash), resume/fork end-to-end con checkpoint real.

---

## Resumen de iteraciones del loop

- **Iter 1:** baseline (1 rojo→verde), F-004 (stranding) FIXED, F-003 (doble
  started) FIXED, F-006 + F-007 (crashes de proyección) FIXED. Workflow QA: 23
  confirmados documentados, 3 FP desmentidos empíricamente. Suite global verde
  (1232 passed).
- **Iter 2:** hardening de API — F-024 (answer sin límite → `.max`) FIXED, F-025
  (path traversal en fork → regex UUID, authz bypass) FIXED. TDD ambos.
- **Iter 3:** F-013 (repair vacío → commit de índice vacío crashea la
  integración) FIXED TDD — guarda de `changedFiles` vacío. Nota de triage: varios
  hallazgos del reducer (F-014/F-015/F-016/F-017) caen en la "zona gris" de
  tolerancia forward-compat **intencional** — su fix necesita decisión de diseño
  de Francisco, no un cambio unilateral. Próximo: F-022 (worktree atascado en
  CHERRY_PICK_HEAD) y F-027 (gate de auth) — ambos inequívocos.

---

## Iter 4 — Run E2E supervisado (loop QA): Setup/preflight

> 2026-06-25. Loop de QA del run end-to-end supervisado (plan
> `quiero-que-planifiques-un-golden-seahorse.md`). Etapa Setup/preflight.
> Estado de auth en este entorno: **suscripción Claude vía OAuth (token en disco
> vencido)** + Codex CLI (usage limit agotado).

### Estado del entorno (bloqueo de ejecución, no es bug)
Ningún executor real seleccionable está utilizable AHORA para ejecutar hojas:
- `claude-code-cli`: **401** — token OAuth `~/.claude/.credentials.json`
  `expiresAt = 2026-06-22T22:28:00Z`, ya vencido (hoy 2026-06-25). Es F-001 vivo.
  Repro fresco: `claude -p "..." --output-format json` →
  `{is_error:true, api_error_status:401, duration_api_ms:0}`, **exit code = 1**.
- `codex-cli`: autenticado pero **usage limit agotado** ("try again at Jun 27th").
- `opencode-cli`: `enabled:false`.
Consecuencia: el run E2E (planning + ejecución) **no puede correr** hasta
reautenticar claude / configurar `ANTHROPIC_API_KEY` / esperar el reset de codex.

### Refinamiento de F-001 con evidencia fresca
- El **exit code real del CLI en 401 es `1`** (con `--output-format json`,
  `is_error:true`). Esto **confirma** la resolución del FP de exitCode (Iter 1):
  como `exitCode≠0`, `classifyExecutorFailure` sí clasifica `auth`. La premisa del
  FP (exit 0) queda nuevamente desmentida empíricamente.

### F-028 — Readiness/preflight de credenciales: presencia, no validez · S2 · FIXED
- **Etapa:** Setup/preflight (readiness + preflight de ejecución).
- **Síntoma:** `GET /api/providers/readiness` reportaba `auth: pass`
  ("Credenciales encontradas") para `claude-code-cli` **con el token OAuth
  vencido**. La única señal de un token muerto era un 401 por hoja a mitad de run.
- **Causa raíz:** dos `defaultHasCredentials` **duplicados** —
  `providers/readiness.ts:249` y `runs/preflight.ts:227`— chequeaban solo
  `existsSync(~/.claude.json)` (archivo de **config**, que ni siquiera contiene el
  token OAuth; el token vive en `~/.claude/.credentials.json`) o `ANTHROPIC_API_KEY`.
  Nunca parseaban `claudeAiOauth.expiresAt`. Doble fuente de verdad + validación
  ausente. El `runPreflight` (gate bloqueante) heredaba el mismo agujero → un run
  con token vencido arrancaba y 401eaba por hoja en vez de fallar accionable (F-001b).
- **Archivo/línea:** `apps/web/src/lib/server/providers/readiness.ts:109`,
  `apps/web/src/lib/server/runs/preflight.ts:103`.
- **Test agregado:** `tests/provider-credentials.test.ts` (5 casos rojo→verde:
  expired/valid/absent/malformed/api-key) sobre la función pura nueva
  `evaluateClaudeCredential`. Sin regresión en `tests/preflight.test.ts` (15).
- **Fix:** módulo compartido `apps/web/src/lib/server/providers/credentials.ts`
  (`evaluateClaudeCredential` + `defaultCredentialStatus` + `credentialMessageFor`),
  expiry-aware, **single source of truth** consumido por readiness y preflight.
  Token vencido → `auth: fail` con mensaje accionable; preflight ahora tira
  `PreflightError("auth", …)` antes de ejecutar. Cierra F-001(b).
- **Verificación manual:** readiness en vivo →
  `claude-code-cli | status: error | auth: fail - …token OAuth … está vencido…`.
  `pnpm web:typecheck` exit 0. 20 tests verdes (5 nuevos + 15 preflight).
- **Estado:** FIXED esta iteración (TDD). Relación: F-001(b), F-027.

### Pendiente de esta iteración
- F-027 (gate de auth distinto de `leaf_validation_failed`): sigue OPEN; ahora el
  preflight atrapa el token vencido *antes* de ejecutar, pero un 401 que aparezca
  **a mitad** de run (token que vence durante la corrida) todavía caería en el gate
  genérico. Candidato a fix una vez haya un run real en vuelo.

### Desbloqueo + Stages A–B (run `46b19d5a-72b5-4982-99f6-5960551ffc36`)
- **Auth:** Francisco reautenticó claude → token nuevo válido hasta 22:35Z; preflight
  `claude -p` exit 0, readiness `auth: pass` (mi fix F-028 discrimina bien en ambos
  sentidos). Executor del run: `claude-code-cli/sonnet`.
- **Repo throwaway:** `C:\Users\franc\manyhands-qa-throwaway` (commit `d86340b`),
  workspace `237cb8b9…`. Prompt: librería de validadores con interfaz compartida.
- **Etapa A — PASS (R-A1):** el selector de la UI gobierna planning+ejecución+repair:
  record con `planningExecutorId=claude-code-cli`, `defaultExecutionSelection` y
  `defaultRepairSelection = claude-code-cli/sonnet`. **Sin fallback silencioso**
  (el fallback de `command-center-shell.client.tsx:192` solo afecta a un executor
  sin capability de planning; claude y codex sí planifican, no se dispara).
- **Etapa B — PASS:** planning generó 1 root + 3 leaves + 1 seam (`ValidatorInterface`),
  critic `clean`. Gate `approve_plan` (blocking) renderizado en la UI. Aprobación vía
  decision channel → `decision.resolved` → `approved` → `running` (auto-arranca
  ejecución; el modelo agent-first no tiene affordance "run" separado).

#### Observaciones verificadas (NO son bugs — quedan como nota)
- **O-1 (dep edge direction):** las edges `graph.dependencies` van
  `consumer→producer` (`from=email/port, to=validator-interface`); bajo la convención
  `computeReadiness` (`fromTaskId` corre antes que `toTaskId`, task-graph:561) eso pone
  a los consumidores en wave 0 y al productor de la interfaz después. **No strandea**
  porque el `grounding` congela y scaffolda el seam (`seam.frozen` + `grounding.completed`
  con `skeletonCommit`) antes de las hojas. Sería problema solo en una dep **estructural
  sin seam**. `validateTaskGraph`=[] (node.deps consistente con las edges).
- **O-2 (`seam.frozen` duplicado):** 2 eventos para el mismo seam/revisión, con
  `extractedFrom` `contract:root` y `contract:validator-interface` — root (definidor) y
  el leaf (implementador) co-declaran `produces`. `validateExecutableTaskGraph`=0 issues
  (es legítimo, no `duplicate_produced_interface`). Redundancia cosmética S4; el reducer
  la absorbe (overwrite, revision 1). No es validación desconectada.
- **O-3 (a11y, watch-item):** los controles "Aprobar plan" / "Aprobar merge" aparecen
  como StaticText en el a11y tree, no como `button` con nombre accesible targeteable por
  selector. A verificar si hay un botón accesible en el chat de decisiones; posible gap
  CLAUDE.md §5.

#### Run 1 — resultado E2E (Stages A–D + delivery): **PASS completo**
- Ejecución: wave 0 `email-validator`+`port-validator` (paralelo) → wave 1
  `validator-interface` → integración `root` → `npm run test` **passed** →
  `finalApplicationStatus: applied` a branch `manyhands/run-46b19d5a-…`. Código correcto
  (`EmailValidator implements Validator<string>`, imports de `./types.ts`). Duración ~2 min.
- **`approve_merge` — verificado NO-bug:** delivery de 2 pasos. (1) `approve_merge`/
  "Aceptar resultado" resuelve la decisión (no toca el repo); (2) **DeliveryPanel** →
  `POST /api/runs/[id]/deliver {action:merge}` → `mergeRunBranch` hace el merge real.
  Resolver `approve_merge` vía `/decisions` solo appendea `decision.resolved` (esperado).
  La UI surfacea "Aprobar merge" junto a "Completado" (gate no huérfano).
- **Observaciones (verificadas, ninguna bug confirmado):**
  - **O-4 (`node.verify.iteration` x2 por nodo):** se emite dos veces por nodo con
    `testsPass` 1 y luego 0 (mismo `iteration:1`) — viene del trace-adapter mapeando
    `executor_completed` **y** `validation_started`/`executor` a `verify.iteration`.
    Provoca un flicker "tests 1/1 → 0/1" antes del `verify.passed`. Cosmético (S4); el
    estado terminal es correcto. Clase F-003 (dos trace events → un mismo RunEvent).
  - **O-5 (`pendingHumanAction:none` con merge gate pendiente):** el `RunRecord` reporta
    `pendingHumanAction:"none"` aunque el modelo tiene un `approve_merge` blocking sin
    resolver. El campo del record trackea pausas de execution-gate, no el merge gate
    (que vive en el decision channel). Inconsistencia menor de doble-fuente; no rompe.
  - **O-6 (grounding → master del repo base):** la grounding commitea el walking-skeleton
    (`src/types.ts` scaffold) **directo a `master` del repo base** (master pasó de
    `d86340b` a `3be5806`). El diff `master..final` por eso no muestra `types.ts`. Para un
    repo real esto avanza la master del usuario con un commit "scaffolded by ManyHands".
    A confirmar si es intencional (shared base de worktrees) o debería ir a una branch.

#### Run 2 — `14a468ad…` (granularidad ALTA, librería strings, 5 leaves)
- **O-7 (S3, perf) — serialización por scope-overlap del archivo barrel · VERIFICADO:**
  con granularidad Alta el decomposer generó root + 5 leaves + 4 seams, pero asignó
  `src/index.ts` al `executionScope` de **TODOS** los leaves (cada util:
  `["src/<fn>.ts","src/<fn>.test.ts","src/index.ts"]`) **además** de un nodo dedicado
  `barrel-exports` cuyo scope es solo `["src/index.ts"]`. Resultado: risk matrix
  `barrel×util=high`, `util×util=medium`; `planning.schedule.batches` = **5 singletons**
  `[[barrel],[capitalize],[slugify],[truncate],[wordcount]]` → **serialización total**.
  Evidencia: en `wave_selected` waveIndex 1 los 4 utils estaban en `readyTaskIds` pero
  se despachó 1 por wave, ~90s aparte (19:14→19:16→19:17→19:19). La granularidad Alta
  **no dio paralelismo** (lo contrario de lo esperado) porque el shared barrel quedó en
  todos los scopes. Correcto-pero-lento (el scope-checker evita conflictos), ~4x más
  lento. Raíz: scope sobre-asignado por el decomposer (el archivo de agregación debería
  ser exclusivo del nodo barrel; los utils no deberían tener `index.ts` en scope).
  Relacionado con [[run-execution-bottlenecks]]. Pendiente: ver si igual conflictúa en
  cherry-pick (cada util ramificó del skeleton tocando index.ts).
- **Outcome integración:** `conflict.detected:0`, `repair:0`, `integration.completed`
  status `success`, `npm run test` passed, aplicado a branch. **No conflictúo** porque
  `barrel-exports` escribió archivos `.js` (`src/index.js` re-exporta las 4) en vez de
  editar `src/index.ts` — tocó archivos distintos que los utils (`.ts`). Verificación
  empírica: `node --test` sobre la branch da **22 pass / 0 fail** (Node 24 corre `.test.ts`
  por type-stripping). El deliverable **funciona** pero queda off-spec (`src/index.ts`
  vacío; barrel en `src/index.js`; `.js` espurios). Master del repo2 quedó en `ed0fadf`
  (grounding skeleton → O-6 otra vez).
- **O-8 (NO bug — scope advisory, by-design):** `barrel-exports` declaró
  `executionScope=["src/index.ts"]` y escribió 5 `.js` **fuera de scope**; el ScopeChecker
  los registró en `outOfScope` pero `passed:true, violations:[]`. Es **intencional y
  documentado** (`scope/checker.ts:14-26`): el allow-list es advisory, solo `forbidden`
  enforcea; la aislación real es worktree + cherry-pick repair. No es defecto del sistema;
  es calidad del agente LLM (eligió compilar a `.js` en vez de editar `index.ts`), sin red
  de seguridad de spec más allá de la validación final (que pasó porque las funciones
  andan). Observación para Francisco: con allow-list advisory, un agente off-spec pasa.
- **O-9 (S3, cosmético/evidencia):** el run reportó `tests 1/1` (`verify.iteration` y
  `integration.validated` con `testsTotal:1`) pero el suite real es **22 tests**. El
  parser de conteo de `node --test` sub-reporta. La señal pass/fail es correcta
  (exitCode-based, sin falso-pass), pero los números de evidencia engañan. Relacionado con
  [[decomposer-validation-commands-gap]] (completed/passed con conteo no representativo).
- **Run 2 — veredicto:** **PASS funcional** (completed, applied, 22 tests reales pasan),
  con O-7 (serialización, único finding de sistema sustantivo) + O-8/O-9 (observaciones).

---

## Iter 5 — Run 3 PROFUNDO + recuperación de errores + bucle de fixes

### Run 3 — `cb0e29cd…` (granularidad ALTA, feature de 3 capas, depth-2)
Feature `core`/`store`/`bus` + barrel raíz, diseñada para jerarquía y conflicto.
- **Profundidad lograda:** 13 nodos, maxDepth 2 — root → leaves de `core` + **2
  composites** (`store-memory`, `bus-event-bus`) con leaves d2 + barrels. Ejercitó la
  **integración bottom-up de composites** que los runs planos no tocaron.
- **Recuperación de errores (✅ lo más importante) — 2 escenarios:**
  1. **Cuota de Claude agotada** a mitad de run (`core-event`, `validationOutput:
     "You've hit your session limit"`). El run pausó en `leaf_validation_failed`,
     **sobrevivió ~4h + reinicio del server**, y se reanudó con `retry_repair` desde el
     **checkpoint** → re-ejecutó la hoja y siguió. **El estado es durable** (checkpoint
     en disco + event log append-only). Confirma **F-027** en la práctica (la cuota cae
     en el gate genérico, no en uno de auth).
  2. **Fallo real de hoja** (`event-bus-test`: `ERR_MODULE_NOT_FOUND` por import
     extensionless `'./eventBus'`) → **Stage D (leaf gate real)** ejercitado. `retry_repair`
     reanudó pero **no lo fixeó** (ver O-10) → `accept_failing` para avanzar.
- **merge_conflict gate (Stage E/F) ejercitado:** la integración de **ambos** composites
  (`bus-event-bus`, `store-memory`) disparó `merge_conflict` → resueltos con
  `accept_conflict`.
- **Degeneración:** los agentes escribieron sistemáticamente imports extensionless
  incompatibles con `node --test`+ESM → **todas las hojas fallaron validación**; conduje
  con `accept_failing`/`accept_conflict`/`abort_run`. **Terminó `failed`** (la
  run-validation no pasó). **Veredicto positivo: el sistema NO reportó falso-éxito** — con
  todo roto, terminó `failed`, no `completed`.
- **O-11 (a verificar):** la run-validation final dio `errorMessage: "spawn cmd.exe
  ENOENT"` (Windows). Puede ser bug real del runner de validación (shell/COMSPEC) o
  artefacto del env del server levantado por preview. Pendiente de aislar.

### Bucle positivo — fixes aplicados (TDD, en `main`)
- **F-028 (S2) — FIXED** (`432c23f`): credencial expiry-aware compartida (readiness+preflight).
- **O-10 (S2) — FIXED** (`f665d1c`): `validationOutputOf` (`execution-nodes.ts`) usaba
  `output ?? stderrTail ?? ""`; `??` no cae en string vacío, así que un `validationResult.output`
  vacío (error a stderr, o timeout) dejaba el gate y el repair **en blanco** → el humano no
  veía la causa y `retry_repair` reparaba a ciegas (causó la degeneración de Run 3). Ahora
  toma el primer candidato **no vacío** (output→stderr→stdout) y, si todos vacíos, sintetiza
  un mensaje accionable con `taskId`+`status`. Test nuevo `validation-output.test.ts`
  (rojo→verde); 34 tests de orchestrator-graph verdes.
- **O-4 (S4) — FIXED** (`1af7fed`): el trace-adapter mapeaba `executor_completed` **y**
  `validation_started` a `node.verify.iteration`, con el segundo emitiendo `testsPass:0`
  tras el `testsPass:1` del primero → flicker "tests 1/1 → 0/N". `validation_started` ya no
  emite verify.iteration (single source = `executor_completed`, misma regla que F-003).
  `tests/run-model-trace-adapter.test.ts` (rojo→verde).
- **No fixeados (con criterio):** **O-9** (conteo `1/1` vs real) — el fix requiere parsear
  la salida de `node --test`, format-coupled; el `total:1` es una simplificación booleana
  pass/fail (sin riesgo de falso-pass). **O-7** (serialización por scope-overlap) — alto
  valor pero toca la lógica de scope del decomposer (más riesgoso); candidato a PR aparte.
  **O-6** (skeleton→master), **F-027** (gate de auth dedicado), **O-11** — decisiones de
  diseño / a verificar, pendientes de Francisco.
