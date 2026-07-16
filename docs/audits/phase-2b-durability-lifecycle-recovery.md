# Fase 2B — Durability, Lifecycle and Recovery Audit (ManyHands)

> Estado: **complete** (con salvedades explícitas en §23/§28).
> Matriz reanudable: [`phase-2b-crash-consistency-matrix.json`](phase-2b-crash-consistency-matrix.json).
> Entradas: Fase 1 ([informe](phase-1-system-coverage-audit.md), [ledger](phase-1-coverage-ledger.json)) y
> Fase 2A ([informe](phase-2a-configuration-capability-integrity.md), [ledger](phase-2a-configuration-ledger.json)) —
> los entregables de 2A no existían al iniciar esta fase (00:40) y fueron incorporados al cierre (§26, F2B-10).

## 1. Executive summary

El lifecycle de un run de ManyHands está construido sobre un modelo de convergencia
entre stores independientes (no transaccional), y ese modelo **funciona notablemente
bien para crashes de proceso único**: claims CAS dentro de un mutex de filesystem,
operation lease con fencing token dentro del propio RunRecord, repo lease machine-safe
con generation fencing, attempt journal con máquina de estados monotónica e
idempotencyKey, checkpoints con fsync y fallback ante corrupción, y un reconciliador
de mundo (git vs evidencia) previo a todo cold resume. 100 tests dirigidos (14 archivos)
pasan y cubren exactamente estas costuras.

Los dos agujeros reales están en la **capa de procesos**, no en la de datos:

1. **F2B-1 (alta severidad): `allDead` vacuo.** El registry de procesos vivos es un
   `Map` in-memory. Un cancel posterior a un restart del server (o desde otro proceso
   Next) no ve nada que matar, reporta `allDead=true` con 0 verificaciones y transiciona
   el run a `interrupted` mientras ejecutores huérfanos siguen escribiendo sus worktrees.
2. **F2B-2 (media): el sweeper no invalida la operation lease.** Un worker congelado
   que despierta después de que su run fue marcado `interrupted` sigue pasando el fence
   hasta que un restart hace takeover.

H2 queda **confirmada como segura** (el evento de wave es durable antes del dispatch en
todos los caminos del grafo, con dos matices menores) y H4 queda **descompuesta**: no hay
atomicidad entre stores ni se pretende; las ventanas residuales concretas son la
divergencia RunRecord→JSONL tras crash entre save y evento (sin reparación general,
F2B-3) y los eventos de detalle best-effort (F2B-4). El resto de las fronteras
(commit sin persistir, integración a medias, final apply interrumpido, checkpoint
atrasado) se recuperan por reconciliación y son idempotentes por diseño.

## 2. Baseline

- Fecha: 2026-07-13T00:40:43-03:00 · Branch `main` · HEAD `deb370a14d6dca2bf63a50c4564d8d2fa8fa160a`.
- `git status`: idéntico a Fase 1 (docs locales) + `docs/audits/` untracked (entregables de auditoría).
- **Cero cambios productivos desde `deb370a1`** (verificado también por 2A con `git diff --stat HEAD -- apps packages`).

## 3. State topology

Fuentes de estado de un run (detalle completo con schema/owner/atomicidad/recovery en
`stateSources[]` del JSON):

| Fuente | Ubicación | Atomicidad | Cross-process | Canónica para |
|---|---|---|---|---|
| RunRecord | `.manyhands/runs/<id>.json` | tmp+rename (sin fsync) + mutex fs (pid+30s) | sí | control: status, gates, config, resultados, lease |
| RunEvent JSONL | `<id>.events.jsonl` | rewrite completo tmp+rename + lock fs (mtime 30s) | sí | UI/audit (seq, checksum, eventId) |
| Checkpoint LangGraph | `checkpoints/<id>/` | tmp+rename **con fsync** | no (chain process-local) | posición del grafo |
| Attempt journal | `attempts/<id>.json` | tmp+rename + lock fs | sí | dedup de invocaciones de executor |
| Integration journal | `integrations/` | (no leído línea a línea; recovery testeado) | — | operaciones de integración |
| Repo lock | `<git-common-dir>/manyhands/run.lock/` | mkdir + rename atómico | sí (machine) | exclusión por repositorio |
| Operation lease | campo `activeOperation` del RunRecord | la del RunRecord | sí | un solo escritor de pipeline |
| Git (worktrees/ramas/commits) | repo del run | git | sí | el código |
| FinalArtifactManifest | campo del RunRecord | la del RunRecord | sí | artifact/delivery outcome |
| runner-state / abort registry / process registry / event-bus legacy | in-memory | **ninguna** | **no** | nada (derivadas) |
| Heartbeats | RunRecord + lock del repo | — | sí | liveness |
| Estado de UI | cliente (reducer) | — | — | nada (derivada del JSONL) |

## 4. Canonical and derived sources

Canónicas: RunRecord (control), JSONL (audit/UI), checkpoint (posición del grafo),
attempt/integration journals (dedup de side effects), repo lock, git.
Derivadas y **sin durabilidad**: runner-state, abort registry, **live-process-registry**
(raíz de F2B-1), bus legacy StreamEvent (ya señalado en Fase 1 como sink muerto),
sparse offset cache del JSONL, estado de UI.

El diseño NO intenta atomicidad entre canónicas; los invariantes de convergencia
reales son: (a) status = save→evento-REQUIRED→rollback compensatorio; (b) resultados
= RunRecord primero, checkpoint después, journal como árbitro de re-ejecución;
(c) git vs evidencia = world reconcile en cold resume; (d) UI = solo JSONL.

## 5. Persistence guarantees

- **RunRecord**: read-modify-write serializado in-process (write chain) **y**
  cross-process (mutex `mkdir` con quarantine de locks stale por pid vivo + 30s —
  [repository.ts:203-312](apps/web/src/lib/server/runs/repository.ts:203)).
  `version` monotónica repo-owned; `mutationFence` nunca retrocede. `save()` es
  last-wins (solo lo usan caminos de creación); `update()` es el primitivo CAS.
- **JSONL**: cada append **reescribe el archivo completo** y lo publica por rename
  ([run-model-event-log.ts:331-377,466-477](apps/web/src/lib/server/runs/run-model-event-log.ts:331)).
  Ventajas: crash-atómico, línea parcial = `degraded` reparable, seq contigua y
  checksum validados en cada lectura, dedupe por `eventId`. Costos: O(n) por append
  y una ventana de robo de lock (F2B-5).
- **Checkpoints**: el único store con fsync ([checkpointer.ts:295-309](packages/orchestrator-graph/src/checkpointer.ts:295)).
- **Sin fsync** en RunRecord/JSONL/attempts: las garantías son de crash de proceso,
  no de power loss (R2B-3).
- Corrupción: JSONL corrupto **bloquea** appends (required fallan → la operación
  falla, correcto); RunRecord corrupto **desaparece silenciosamente** de `list()`
  (F2B-6); checkpoint corrupto degrada con evento de auditoría.

## 6. Lifecycle state machine

`ALLOWED_TRANSITIONS` centralizada ([lifecycle.ts:4-28](apps/web/src/lib/server/runs/lifecycle.ts:4)).
Hallazgos de máquina: `cancelling` solo sale por `interrupted|failed` y **no es
barrido por el sweeper** (`isLiveStatus` = generating|running|paused) — un crash en
mitad de un cancel deja el run en `cancelling` hasta un re-cancel manual (recuperable,
no automático). `created` y `approved` tampoco son barridos: `approved` es estable por
diseño; `created` sin planning arrancado queda huérfano sin camino de UI (F2B-9).

La enforcement de transiciones es **por convención de call site** (`transitionTo`,
rutas y cancel llaman `assertTransition`; `saveRunWithRequiredStatusEvent` no la
impone por sí misma). No se encontró ningún call site que la omita con una transición
ilegal, pero no hay guard estructural en el store.

## 7. Mutation protocol by action

Orden exacto por acción (tabla completa en `mutationProtocols[]`/`lifecycleActions[]`
del JSON). Los patrones:

| Acción | Guard | Lease | Orden |
|---|---|---|---|
| create | zod + capabilities | — | write RunRecord → 201 → planning fire-and-forget |
| start | claim `approved`+rejectActiveRunner | pipeline luego | claim→evento→respuesta→pipeline bg |
| pause | claim `generating|running` | **no toca la lease** (cooperativa) | claim→evento; leaves en vuelo siguen |
| resume/answer/decision | claim gateId-pinned que **consume** el gate | pipeline takeover | claim→eventos REQUIRED (decision.resolved)→pipeline bg |
| cancel | claim CANCELLABLE (re-entrante desde `cancelling`) | **invalidada en el claim** | claim→evento→fence attempts→abort→kill verificado→gc→`run.cancelled`→`interrupted` |
| restart | claim `interrupted|failed` que consume el estado | pipeline takeover (bump fence) | claim→evento→world-reconcile→re-drive |
| leaf | attempt journal (9 estados) | attempt fenced | reserve→…→commit_created→persist RunRecord→result_persisted |
| terminal | grafo END | lease + repo lease fence | artifact.started→applyFinalPatch→terminal+manifest→artifact.finished |

## 8. LangGraph / checkpoint consistency

Correspondencia (estados alcanzables y su divergencia):

| Estado LangGraph | RunRecord | Evento durable | Side effect | Divergencia posible |
|---|---|---|---|---|
| superstep con leaf ok | leafResult ya persistido (persistNodeResult ocurre dentro del nodo) | task.attempt.* + agent.completed | commit en rama del task | checkpoint atrasado → reuse vía journal (safe) |
| interrupt en gate | paused+pendingDecision (persistExecutionPause, después) | decision.raised | ninguno (gates puros) | crash antes de proyectar → restart re-plantea el gate (safe) |
| Command resume | gate consumido + decision.resolved | sí | ninguno | crash antes del pipeline → re-decisión humana (F2B-7) |
| END completed | terminal + manifest | artifact.finished | rama manyhands/run-* | crash intermedio → re-settle idempotente |
| thread lost | intacto | checkpoint.lost + world.reconciled | reseed | ninguna: reseed desde RunRecord |

Claves verificadas: los `interrupt()` viven **solo** en nodos puros (resume nunca
re-ejecuta un executor ni un cherry-pick); `putWrites` persiste los outputs de
siblings terminados dentro del superstep interrumpido (resume cross-process sin
replay); el frontier se recalcula desde `leafResults`, y la re-dispatch de un leaf
ya ejecutado la corta `beginAttempt` (reuse o `recovery_required`, **nunca retry
automático de una invocación ambigua** — [execution-host.ts:279-295](apps/web/src/lib/server/runs/execution-host.ts:279)).
Los checkpoints no pueden retroceder el estado canónico (I18): los resultados
canónicos están en el RunRecord y el journal fencea re-ejecuciones.

## 9. Lease and fencing model

- **Operation lease** (`claimRunOperation`): vive dentro del RunRecord ⇒ es
  cross-process de facto. `fencingToken = mutationFence+1`; todo write con lease
  valida `operationId+fencingToken+mutationFence` dentro del mutex
  ([mutation-guard.ts:118-131](apps/web/src/lib/server/runs/mutation-guard.ts:118)).
  Heartbeat cada 4s **fenced** (un renew de lease perdida falla y se apaga).
  Takeover explícito (`allowTakeover`) bumpea el fence; el attempt journal exige
  además token **estrictamente mayor** para `claimRecovery`.
- **Gaps**: (1) el sweeper no invalida la lease (F2B-2); (2) `updateRunForOperation`
  con lease `undefined` y `repo.update` directo (sweep, world-reconcile filter,
  editing) escriben sin fence — last-wins amortiguado por la `version` monotónica;
  (3) los appends al JSONL no llevan fence (cualquier caller puede escribir eventos).

## 10. Repository locking

`repo-lock.ts` es la pieza más endurecida: lock por **git common dir** (worktrees
enlazadas contienden en el mismo lock), owner con token inmutable + `generation`
monotónica, liveness heartbeat-first (PID y RunRecord solo como fallback), takeover
atómico con re-check + rename a quarantine + verificación read-back, release que
restaura a la víctima si perdió la carrera. `withRepositoryLease` fencea **antes y
después** de cada mutación git envuelta (final apply standalone, delivery,
world-reconcile). Verificado por `repo-lock-atomic.test.ts` (N contenders ⇒
exactamente 1 owner, 13/13). Límite conocido (R2B-2): un takeover **durante** una
operación larga no la detiene — requiere un owner congelado >10 min exactamente
durante el side effect.

## 11. Process supervision

`ProcessSupervisor` registra cada subproceso bajo su runId con label y operationId
(spawns de planner vía `supervisedSpawnFn`, git helpers vía AsyncLocalStorage +
`supervisedExecFile`). **Pero el registro es un `Map` a nivel de módulo**
([live-process-registry.ts:37](packages/execution-core/src/executor/live-process-registry.ts:37)):

- muere con el proceso Next ⇒ huérfanos invisibles tras restart (F2B-1);
- no es compartido entre procesos Next;
- la verificación de kill cubre el PID raíz del árbol (taskkill /t en Windows;
  process group en POSIX) — R2B-4;
- `TaskAttempt.process{pid}` existe en el schema pero no se encontró el write
  (área no verificada) — sería la base natural del fix (RU1).
- **Cross-finding con 2A**: replan y regen llaman `pickDecomposer` **sin** el spawn
  supervisado ⇒ sus subprocesos no son cancelables ni en el caso feliz (F2B-10,
  = F6/F1x de 2A visto desde cancelación).

## 12. Cancellation semantics

Traza completa verificada ([cancel-service.ts:79-192](apps/web/src/lib/server/runs/cancel-service.ts:79)):

```
cancel request
→ claim CAS (status CANCELLABLE) + invalidateRunOperation   [atómico, mismo write]
→ status.changed REQUIRED
→ fence de attempts en vuelo (journal → cancelled, tolerante a carreras)
→ abortRun (AbortSignal cooperativo; el drive corta entre supersteps)
→ killOwnedProcessTrees + verificación por PID raíz (escalada + poll)
→ gc de worktrees SOLO con allDead (preserva ramas con commits de evidencia)
→ run.cancelled REQUIRED (killedProcesses/survivors/allDead durables)
→ claim cancelling→interrupted SOLO con allDead + status.changed
→ HTTP 200 (terminal) | 202 (sobrevivientes: reintentar cancel)
```

Distinciones reales del sistema: `cancelling` (no terminal, reintentable),
`interrupted` (terminal-resumable, solo con allDead verificado), `202+survivors`
(incertidumbre comunicada honestamente). **La violación** (I10) es el caso registry
vacío: allDead vacuo tras restart / otro proceso / spawns no supervisados de
replan-regen ⇒ `interrupted` con procesos vivos. Los mitigantes (attempts en
`recovery_required` sin re-uso automático, world-reconcile pre-resume, aislamiento
por worktree) acotan el daño a basura en worktrees y confusión operativa, no a
corrupción del estado canónico.

## 13. Scheduling durability (H2 — resuelta)

**Confirmada segura.** Único punto de dispatch de waves: `routeFrontier` →
`frontierDeps.selectWave` ≡ `selectAndPersistSchedulingWave`, que persiste
`run.scheduling.wave_selected` como evento **required con seq bajo el lock del log**
y recién entonces devuelve la selección que genera los `Send`
([execution-host.ts:666-689](apps/web/src/lib/server/runs/execution-host.ts:666),
[scheduling-audit-events.ts:40-79](apps/web/src/lib/server/runs/scheduling-audit-events.ts:40),
[execution-nodes.ts:280-313](packages/orchestrator-graph/src/nodes/execution-nodes.ts:280)).
Esto cubre initial/next-wave/resume/restart/recovery/reseed/post-decision porque
todos re-entran por el mismo router. 8/8 tests de wave audit pasan.

Crash entre pasos: evento sin dispatch ⇒ el resume recomputa el frontier y emite un
segundo `wave_selected` (waveId nuevo — duplicación benigna del audit); dispatch sin
attempts ⇒ los leaves re-dispatchados chocan con `beginAttempt` (reuse o recovery).
Una wave no puede perderse (frontier derivado de resultados) ni ejecutarse dos veces
(journal). Matices: `retry_repair` despacha un `Send` puntual sin evento de wave
(auditable solo por `task.attempt.*`), y `TaskAttempt.waveId` nunca se setea (F2B-8:
sin correlación durable wave→attempt).

## 14. Git side-effect durability

| Side effect | Idempotencia | Evidencia durable | Recovery |
|---|---|---|---|
| worktree add | path determinístico runId+taskId | attempt.worktreePath | gc/prune/re-crear |
| commit del orquestador | sha en `commit_created` | attempt journal | ambiguo→recovery_required; `adopt(commitSha, verifyCommit)` reutiliza el trabajo |
| cherry-pick+repair | integration journal + attempt integrator | IntegrationResult | testeado (integration-operation-recovery) |
| final apply | **`branch -f` a nombre determinístico** ⇒ re-aplicar converge al mismo commit | manifest + artifact.finished | re-settle tras restart; degradación explícita `exported_patch`→`failed` |
| delivery | withRepositoryLease + working tree limpio | deliveryOutcome | **no verificado línea a línea** |
| gc | re-ejecutable; preserva ramas con evidencia | run.cancelled payload | re-cancel |

"Ocurrió pero no se persistió" está cubierto en todos los casos por evidencia git +
journal + reconciler. "Se persistió pero no ocurrió" lo detecta el world reconciler
(sha inalcanzable ⇒ invalidación con **cierre transitivo sobre el DAG canónico**).

## 15. World reconciliation

`reconcileExecutionWorld` corre **siempre** antes de un cold resume con checkpoint
(execution-pipeline:573-580), bajo repo lease. "World" = checkpoints (salud),
git (alcanzabilidad de commits de evidencia), worktrees (gc), locks, attempts
(fingerprint del target) — no procesos (gap coherente con F2B-1). Corrige: filtra
resultados invalidados + resetea el thread (reseed); detecta y audita: degraded/lost,
warnings; aborta con error accionable: base commit inalcanzable (`RunNotResumableError`,
run→interrupted). Es idempotente (recomputa desde durable) y no puede empeorar un
estado válido (mundo consistente ⇒ no-op auditado). Verificado: 5/5 tests
world-reconcile-web, incluidos cierre transitivo y latest.json corrupto.

## 16. Crash consistency analysis

Matriz completa en `crashScenarios[]` del JSON (21 operaciones, ventanas colapsadas
cuando el resultado es idéntico). Resumen de clasificaciones:

- **safe / safe-by-reconciliation**: la enorme mayoría — leaf en cualquier estado,
  commit sin persistir, integración a medias, gate sin proyectar, final apply
  interrumpido, gc parcial, wave duplicada.
- **duplicate-risk**: re-cancel post-restart con huérfanos (F2B-1 — el "duplicado"
  es el estado terminal sin kill real); re-pregunta de decisión ya tomada (F2B-7).
- **stuck-risk (menor)**: run `created` sin planning (F2B-9); `cancelling` tras crash
  (recuperable con re-cancel manual); `approved` tras crash del restart (re-POST /run).
- **safe-under-assumption**: divergencia visual REST vs SSE hasta el próximo status
  event (F2B-3); fencing del repo lease durante operaciones largas (R2B-2); rename
  sin fsync (R2B-3, supuesto "crash ≠ power loss").
- **unverified**: ventana post-merge de delivery.
- **corruption-risk**: ninguno bajo crash de proceso; bajo power loss, RunRecord
  ilegible que además desaparece del listado (F2B-6 + R2B-3).

## 17. Concurrency analysis

Matriz completa en `concurrencyScenarios[]`. Los 12 escenarios pedidos:

| Escenario | Árbitro | Resultado |
|---|---|---|
| 2× POST start | claim `approved` (consume) | 1 gana, otro 409 |
| start + cancel | claims secuenciales; cancel invalida lease | cancel gana siempre; writes zombie fenced |
| pause + cancel | CANCELLABLE incluye paused | cancel procede |
| resume + resume | claim gateId-pinned | 409 determinístico (19/19 tests) |
| resume + restart | estados requeridos disjuntos | el segundo 409 |
| decision + cancel | claims sobre status | sin efectos incompatibles |
| watchdog + humano | cancelRun fenced + expectativa de status | seguro |
| 2 procesos Next | locks fs sí; registries in-memory no | claims correctos; kill/rejectActiveRunner ciegos (F2B-1) |
| stale worker + nuevo owner | takeover bumpea fence | zombie fenced **después** del takeover; antes escribe (F2B-2) |
| 2 runs mismo repo | repo lease common-dir | 2º falla preflight `repo_busy` accionable (13/13 tests) |
| delivery + otro run | mismo repo lease | serializado |
| restart de swept con zombie vivo | takeover ok, repo lease del zombie vivo | restart marca `failed` (repo_busy); recuperable después (R2B-1) |

## 18. Confirmed invariants

I1, I4 (por convención), I5, I6, I7, I8, I9, I11, I12, I13 (H2), I14, I15, I16,
I17, I18, I19 (con caveat F2B-3/4), I20 (con caveats created/cancelling) — evidencia
y tests por invariante en `confirmedInvariants[]` del JSON.

## 19. Violated invariants

- **I10** — cancel puede declarar certeza que no tiene: allDead vacuo con registry
  vacío (restart / multi-proceso / spawns no supervisados de replan-regen). F2B-1 + F2B-10.
- **I3 (parcial)** — el sweep preserva la lease del worker congelado: zombie escribe
  sobre un run `interrupted` hasta el takeover. F2B-2.

## 20. Confirmed findings

Diez findings F2B-1…F2B-10 con invariante violado, ventana exacta, causa raíz,
stores/side-effects afectados, plan de reproducción y severidad en
`confirmedFindings[]` del JSON. Ranking: **F2B-1** (alta), F2B-10 y F2B-2 (media),
F2B-3/F2B-5 (media-baja), F2B-4/6/7/8/9 (bajas).

## 21. Strong risks

R2B-1 (restart con zombie remoto marca `failed` un run recuperable), R2B-2 (ventana
interna del lease en operaciones largas), R2B-3 (sin fsync fuera del checkpointer),
R2B-4 (verificación de kill solo del PID raíz).

## 22. Safe-under-assumption behaviors

1. Una sola instancia Next por `.manyhands/runs` (registries in-memory,
   `rejectActiveRunner`, abort, kill).
2. Crash = muerte de proceso, no power loss (renames sin fsync).
3. `staleMs` de 10 min distingue congelado de muerto.
4. Los CLIs respetan su worktree (scope advisory) — un huérfano no escribe fuera.
5. Divergencia REST/SSE tras crash entre save y evento es tolerable hasta el
   próximo status event.

## 23. Unverified behaviors

`delivery.ts` línea a línea (ventana post-merge), clonado de thread en fork (2A
verificó la copia de config; el checkpoint clonado no), ventanas internas de
replan-service/plan-mutation-journal, persistencia real de `TaskAttempt.process.pid`,
dos checkpointers en procesos distintos sobre el mismo thread, terminal-sessions
como vector de procesos supervivientes.

## 24. Missing tests

1. Cancel tras restart del server con executor vivo (reproduce F2B-1) — hoy no existe
   ningún test multi-proceso/registry-vacío.
2. Write fenced de un zombie tras el sweep (F2B-2).
3. Crash inyectado entre save del RunRecord y append del evento (F2B-3: hoy nada
   verifica la convergencia posterior).
4. Robo del lock del event log con writer lento >30s (F2B-5).
5. Cancel durante replan/regen mata los subprocesos del decomposer (F2B-10).
6. Run `created` huérfano y run `cancelling` post-crash: caminos de recovery de UI.
7. Delivery: crash post-merge/pre-persist.

## 25. Reproduction scenarios

Por finding en el JSON (`reproduction`). Los dos prioritarios:

- **F2B-1**: run con leaf largo → matar el proceso Next (no el CLI hijo) → relanzar
  server → POST cancel ⇒ observar 200 terminal con `killedProcesses: 0` y el CLI aún
  vivo en `tasklist`.
- **F2B-2**: test unitario — claim de operation lease → simular `sweepRunIfStale` →
  `updateRunForOperation(lease)` debería fallar con 409 y hoy escribe.

## 26. Remediation architecture

Principio rector: **cerrar la capa de procesos con evidencia durable, y generalizar
el patrón de outbox que ya existe** — no introducir transaccionalidad nueva.

1. **Kill durable (RU1, resuelve F2B-1/R2B-4)**: persistir pid+startTime de cada
   subproceso supervisado (el campo `process` del attempt ya existe) o un sidecar
   `processes.jsonl` por run; cancel = registry vivo ∪ pids durables con verificación
   de identidad (evita matar pids reciclados); Windows: evaluar Job Objects.
2. **Sweep invalida lease (RU2, F2B-2)**: `invalidateRunOperation` dentro de
   `sweepRunIfStale`.
3. **Outbox general RunRecord→JSONL (RU3, F2B-3/9)**: extender `requiredInputsForRun`
   a cualquier divergencia status-vs-último-evento con eventId determinístico
   (runId+version); sweep de `created` sin planning.
4. **Lock del JSONL endurecido (RU4, F2B-5)**: verificación de pid (como ya hace
   repository.ts) + heartbeat de mtime durante appends largos.
5. **Re-aplicar decisiones durables (RU5, F2B-7)**: al re-plantear un gate en restart,
   detectar un `decision.resolved` posterior no aplicado y auto-resumir/sugerir.
6. **fsync opcional + corrupción visible (RU6, R2B-3/F2B-6)**.
7. **Correlación wave→attempt + evento para retries (RU7, F2B-8)**.
8. **Supervisión de replan/regen (RU8, F2B-10)**: se resuelve estructuralmente con
   U2A-3 de la Fase 2A (PlanningInvocationService único); si esa unidad se posterga,
   fix puntual inyectando `supervisedSpawnFn`.

## 27. Ordered implementation units

RU1 → RU2 → RU8 (o dentro de U2A-3) → RU3 → RU4 → RU5 → RU6 → RU7.
Dependencias cruzadas con 2A: RU8 ⊂ U2A-3; RU1 es independiente de todas las U2A;
ninguna unidad 2B bloquea a las 2A. Cada unidad con TDD usando los tests de §24.

## 28. Residual uncertainty

Las áreas de §23; el comportamiento real bajo dos instancias Next simultáneas
(analizado causalmente, no reproducido); el impacto de F2B-5 en logs muy grandes
(no se midió el tamaño real de un JSONL de producción); y la interacción de un
huérfano de larga vida con un run re-provisionado sobre el mismo target (el
reconciler corre antes del resume, pero el huérfano puede escribir después —
mitigado por fingerprint del target en attempts, no eliminado).

### Comparación con Fase 2A (análisis independiente + integración)

Esta fase se ejecutó de forma independiente; los entregables de 2A aparecieron
durante la sesión y se integraron al cierre. Coincidencias: preflight de ejecución
revalida CLI/auth en todos los re-entries (refina las celdas de resume de esta
matriz; el "R4" de Fase 1 queda degradado igual que lo concluyó 2A). Aportes de 2A
a 2B: F6/F1x (spawns sin supervisar en replan/regen) reinterpretado aquí como gap de
cancelación (F2B-10, remediación RU8/U2A-3); fork copia config verificado por 2A
(reduce mi área no verificada al clonado de checkpoint). Sin contradicciones entre
ambas fases.
