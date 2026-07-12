# Auditoría de terminación del repositorio ManyHands

**Fecha de corte:** 11 de julio de 2026  
**Checkout auditado:** `C:\Users\franc\Documents\Proyectos\Manyhands`  
**Objetivo:** convertir el estado observado en un backlog ejecutable para terminar ManyHands como producto, sin implementar correcciones durante esta auditoría.  
**Fuente de verdad:** código y tests del checkout actual. Los documentos se usaron para conocer invariantes y detectar drift, no para dar por implementado un comportamiento.

## 1. Resumen ejecutivo

ManyHands ya contiene una arquitectura reconocible y valiosa: descomposición recursiva, contratos entre tareas, DAG canónico, scheduling `risk_aware`, ejecución con Claude Code o Codex en worktrees, detección por `git diff HEAD`, commits a cargo del orquestador, composición bottom-up, reparación semántica, gates humanos y una UI reconstruida desde eventos. Los packages compilan y pasan sus typechecks; hay 147 archivos de test y el flujo aislado de `RunExecutor` cubre git real con executor simulado. No se trata de un prototipo vacío.

Sin embargo, el producto todavía no es confiable frente a concurrencia, crash/restart y entrega real. Los bloqueantes principales son:

1. El grounding escribe y commitea sobre el checkout del usuario antes de crear el aislamiento de ejecución.
2. El checkpointer pierde escrituras concurrentes: una prueba de 50 `putWrites` paralelos conservó solo 1.
3. `RunRecord`, eventos y side effects no comparten una transacción/CAS; guardados con snapshots viejos pueden sobrescribir una cancelación o un estado terminal.
4. El takeover del repo lock tiene una carrera que permite dos dueños.
5. Un run puede terminar como `completed` aunque la aplicación final haya fallado o se hayan aceptado resultados parciales.
6. Cancelar no supervisa todos los procesos ni garantiza que hayan muerto antes de responder éxito.
7. La ruta productiva de LangGraph no ejecuta correctamente nodos `integrator`.
8. La recuperación mezcla checkpoint y `RunRecord` sin una semántica idempotente; puede reejecutar trabajo commiteado o reutilizar resultados inválidos.

El estado de release también está rojo: el build web de producción falla por lint; el typecheck raíz falla; el lint raíz acumula 78 errores; el suite completo presentó una falla flakey/no hermética; CI usa pnpm 7.29.3 aunque el manifest declara pnpm 11.7.0, no ejecuta el build web y tolera lint rojo.

**Dictamen:** no entregar todavía como producto final. Primero deben resolverse Phase 0 y Phase 1 del roadmap. Con esas fases, un run simple podrá considerarse confiable; Phase 2 y Phase 3 hacen defendibles restart, cancelación e integración; Phase 4 a Phase 6 convierten esa base en una demostración sólida y operable.

### Inventario de resultados

| Clase | Cantidad | Interpretación |
|---|---:|---|
| Hallazgos confirmados | 42 | Demostrados por lectura del camino ejecutado, tests/comandos o diagnóstico reproducible |
| Riesgos plausibles | 10 | El diseño permite el fallo, pero falta fault injection o un entorno productivo para confirmarlo |
| Mejoras recomendadas | 10 | No son bugs por sí mismas; reducen complejidad, costo u operación |

## 2. Alcance y metodología de la auditoría

Se revisaron los 12 packages, `apps/web`, rutas App Router, servicios server-side, modelo de eventos cliente, scripts, configuración, documentación vigente e histórica y tests. El inventario trazado comprende 411 archivos TypeScript/TSX/MJS versionados y aproximadamente 79.284 líneas, además de JSON, Markdown, YAML y artifacts persistidos locales.

La metodología fue:

1. Recuperar el estado del checkout y comprobar que no existía un informe parcial.
2. Identificar entry points (`POST /api/runs`, planning pipeline, execution pipeline, LangGraph hosts, delivery y UI).
3. Seguir contratos y side effects desde input hasta git, persistencia, eventos y selectores.
4. Contrastar las invariantes D1–D10 con el código realmente ejecutado.
5. Ejecutar checks generales y diagnósticos selectivos, sin cambiar implementación.
6. Revisar fallos parciales: crash windows, cancelación, retries, locks, decisiones pendientes, integración incompleta y reconexión.
7. Clasificar evidencia como confirmada, riesgo o mejora; no convertir preferencias en bugs.

### Verificaciones ejecutadas

| Verificación | Resultado observado |
|---|---|
| `pnpm test` | 150 archivos pasaron, 1 falló, 1 skipped; 1340 tests pasaron, 1 falló, 3 skipped. Falló `resume-route-concurrency.test.ts` por timeout/200 esperado vs 409. El rerun aislado pasó, pero lanzó Codex real y dependió de cuota externa. |
| `pnpm typecheck` | Falló con 3 errores en tests: `execution-core-run-executor.test.ts`, `patches-partial-record.test.ts`, `run-model-event-log-drain.test.ts`. |
| Typecheck de packages | Los 12 packages pasaron. |
| `pnpm web:typecheck` | Pasó. |
| `pnpm lint` | Falló con 78 errores. |
| `pnpm web:lint` | Falló por variable `model` sin usar en `apps/web/src/lib/decomposer-policy.ts:122`. |
| `pnpm build` | Build de packages pasó. |
| `pnpm web:build` | Compiló Next.js y luego falló por lint; no hay release build verde. |
| Checkpointer concurrente | 50 `putWrites` simultáneos dejaron 1 write persistido. |
| Validador de DAG | Aceptó sin issues un `rootId` apuntando a un `leaf` con `parentId=null` y `depth=7`; también omitió la dependencia canónica ausente en `node.dependencies`. |
| Persistencia local observada | Un run completado ocupa ~6,46 MB de JSON + ~4,94 MB de JSONL, con 2023 traces/1835 eventos `executor_output`; quedaron 8 `.tmp` por ~9,51 MB. |
| Límites de packages | No se encontró import de `apps` desde packages; la dirección principal se respeta. |

No se invocaron agentes LLM para ejecutar un run real completo: implicaría costo/cuota y mutaciones del repositorio objetivo, y no era necesario para confirmar los bloqueantes estructurales. Tampoco se modificó código de implementación.

## 3. Estado actual del sistema

### Fortalezas verificadas

- `graph.dependencies` es consumido como relación canónica en scheduling/readiness y existen helpers de mutación/sincronización.
- `goal` es el campo vigente del dominio; los schemas y el flujo principal ya no dependen de `intent`.
- Claude Code es el executor default y Codex es alternativa; el código productivo de ejecución pasa por `AgentExecutor`.
- `ResultRecorder` obtiene cambios desde git, no desde stdout.
- Existe detección explícita de commits inesperados y política `reject/accept`.
- `ScopeChecker` aplica forbidden paths como hard deny.
- La integración usa cherry-pick y dispone de reparación semántica con contexto de contratos/diffs.
- El scheduler de producción selecciona `risk_aware` y registra un evento antes de despachar una wave.
- Las decisiones humanas de ejecución se concentran mayormente en `execution-gate-service`.
- El cliente dispone de reducer/selectores para reconstruir el workspace desde el event log.
- Los packages activos están separados con una dirección razonable; ninguno importa desde `apps`.

### Estado por capacidad

| Capacidad | Estado | Observación |
|---|---|---|
| Planning/descomposición | Funcional pero sin límites | Puede producir DAG real, pero carece de presupuesto total de nodos/calls/tokens/tiempo y Codex planifica con sandbox escribible. |
| Contratos/DAG | Parcialmente sólido | Schemas ricos; validación estructural incompleta y drift entre scopes editables/runtime. |
| Scheduling | Conceptualmente correcto | `risk_aware` activo, pero el cap default de 6 no llega al selector de waves. |
| Ejecución aislada | Incompleta | Worktrees por tarea, pero grounding toca la base y `node_modules` se comparte escribible. |
| Integración | Implementada | Cherry-pick/repair existen; terminal success y entrega no garantizan resultado aplicado. |
| Persistencia/recovery | No segura | JSON + JSONL + checkpointer sin protocolo atómico único; pérdida confirmada bajo concurrencia. |
| Cancelación | Incompleta | Supervisa executors principales, no todo subprocess/side effect. |
| UI operativa | Amplia pero inconsistente | Buen workspace de run; proyecciones tardías/falsas, final view incorrecta y estados de recuperación insuficientes. |
| Tests/release | No verde | Buena cantidad de tests unitarios/integración, falta E2E productivo y los gates actuales fallan. |

## 4. Arquitectura observada y flujo principal real

```text
Command Center
  -> POST /api/runs
     -> RunRecord(created) + background planning
        -> planning StateGraph
           -> title (cosmético)
           -> repository grounding/index
           -> recursive decomposer
           -> plan/seam critics
           -> approval gate
              -> execution pipeline
                 -> provision target + grounding commit
                 -> execution StateGraph
                    -> risk-aware wave selection
                    -> RunExecutor.runNode(worktree, AgentExecutor, git diff, scope, commit)
                    -> bottom-up IntegrationAgent(cherry-pick, repair/gate)
                    -> run validation
                 -> final apply/export
                 -> terminal RunRecord

En paralelo:
  RunRecord JSON <-> lifecycle/routes/background runner
  Checkpoints JSON <-> LangGraph
  Run-model JSONL <-> SSE <-> reducer/selectors/UI
  Trace events ------> adapters/proyección parcial
```

El problema arquitectónico dominante es que esos cuatro estados persistentes y los side effects de git/procesos no se coordinan con una única operación durable. El sistema tiene CAS en rutas específicas, pero no un transaction boundary del run completo.

## 5. Mapa de módulos y responsabilidades

| Módulo | Responsabilidad real | Consumidores / observaciones |
|---|---|---|
| `packages/shared` | IDs, timestamps, helpers | Base estable. |
| `packages/contracts` | `AgentTaskContract`, interfaces, scopes, validaciones | Contrato entre planning y ejecución. |
| `packages/task-graph` | nodos, grafo, dependencias, validación/toposort/graft | Canónico para DAG; validación incompleta en CF-18/19. |
| `packages/decomposer` | descomposición recursiva y adapters LLM | Hotspot grande; sin budget global. |
| `packages/repository-index` | índice estructural de repo | Lectura amplia y cache débil. |
| `packages/conflict-risk` | riesgo de conflicto por pares | Alimenta scheduler; costo cuadrático. |
| `packages/scheduler` | selección de waves/policies | Producción usa `risk_aware`; cap default perdido en host. |
| `packages/execution-core` | git, worktrees, executor, scope, recorder, integración, validación | Dominio operativo más crítico. |
| `packages/orchestrator-graph` | StateGraphs planning/execution + checkpoint seam | Control plane, no es el DAG de tareas. |
| `packages/trace-store` | trazas de planning/ejecución | Convive con event log productivo. |
| `packages/run-store` | snapshot/patch persistence histórica/genérica | No es el repositorio efectivo principal del web; deuda. |
| `packages/core` | barrel legacy | Aún importado en 13 archivos web y tests; no agregar dependencias. |
| `apps/web/src/lib/server/runs` | lifecycle, store, runner, hosts, delivery, gates, replan | Actualmente concentra políticas y side effects sin transaction boundary único. |
| `apps/web/src/lib/run-model` | eventos, reducer y selectores cliente | Fuente derivada correcta en intención; recibe datos incompletos/duplicados. |
| `apps/web/src/app/api` | 38 endpoints de health, workspaces, runs, nodos, decisiones, terminal, archivos y delivery | Superficie local sin auth/bind guard. |
| `apps/web/src/app/runs/[runId]` | workspace operativo | Planning, DAG, ejecución, decisiones, terminal, files y resultado. |

## 6. Hallazgos críticos y bloqueantes

### CF-01 — Grounding muta y commitea el checkout del usuario

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — seguridad/aislamiento; bug confirmado |
| Ubicación | `apps/web/src/lib/server/runs/repo-provisioner.ts` (`provision` local); `execution-pipeline.ts` (grounding previo a ejecución); `packages/execution-core/src/run/grounding-agent.ts:90-101` |
| Evidencia | El provisioner local devuelve el repo real. `GroundingAgent` escribe, stagea y hace `git commit` en `params.repoRoot`; no recibe `AbortSignal` ni rollback. |
| Escenario | Iniciar un run sobre un checkout con trabajo del usuario; grounding crea skeleton o fallback LLM antes de worktrees. |
| Actual / esperado | Actual: cambia archivos y HEAD de la base. Esperado: toda mutación ocurre en un workspace de run aislado; la base solo cambia durante una entrega explícita. |
| Causa raíz | Se confundió “repo provisionado” con “repo seguro para mutar”. |
| Impacto | Pérdida/mezcla de trabajo, demo no reproducible, cancelación incapaz de restaurar estado. |
| Diseño recomendado | Capturar `sourceBaseCommit`; crear un worktree/base branch propio del run; ejecutar grounding allí; guardar `executionBaseCommit`; calcular entrega `sourceBaseCommit..finalCommit`; cleanup/abort idempotente. |
| Archivos probables | `repo-provisioner.ts`, `execution-pipeline.ts`, `execution-state.ts`, `grounding-agent.ts`, `final-apply.ts`, schema de run. |
| Riesgos del fix | Cambian refs y supuestos de paths; migrar runs existentes o declararlos no resumibles. |
| Tests | Checkout dirty intacto; grounding cancelado; crash entre grounding/commit; entrega final contiene grounding sin mover base anticipadamente. |
| Aceptación | Antes de “Deliver”, `git status` y `HEAD` del checkout origen son idénticos a los iniciales. |

### CF-02 — El checkpointer pierde escrituras paralelas

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — pérdida/corrupción de estado; bug confirmado por ejecución |
| Ubicación | `packages/orchestrator-graph/src/checkpointer.ts`, especialmente `JsonFileCheckpointSaver.putWrites`, `put` y el merge read-modify-write |
| Evidencia | No hay lock por thread/checkpoint ni rename atómico. Diagnóstico con 50 `putWrites` concurrentes: **expected 50, actual 1**. |
| Escenario | Varias tareas de una wave devuelven writes/checkpoints casi simultáneamente. |
| Actual / esperado | Actual: last writer conserva su snapshot y descarta writes ajenos. Esperado: todos los writes se conservan exactamente una vez. |
| Causa raíz | Read-merge-write sobre JSON compartido sin serialización. |
| Impacto | Resume inconsistente, nodos reejecutados/omitidos, decisiones o resultados perdidos. |
| Diseño recomendado | Lock por `(threadId, checkpointId)` + archivo temporal/`fsync`/rename; claves idempotentes por task/channel; o storage transaccional (SQLite) manteniendo el seam de LangGraph. |
| Archivos probables | checkpointer, tests de orchestrator-graph, configuración de runs dir. |
| Riesgos del fix | Compatibilidad con checkpoints existentes y Windows rename/locks. |
| Tests | 100–1000 writes concurrentes; proceso muerto antes/después de rename; replay repetido; dos procesos. |
| Aceptación | Conteo y contenido exactos luego de concurrencia, crash y reopen; ningún JSON parcial. |

### CF-03 — Guardados stale pueden sobrescribir cancelación o terminalidad

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — pérdida/corrupción de estado y concurrencia |
| Ubicación | `apps/web/src/lib/server/runs/store.ts` (`RunRepository.save/update`); `runner.ts`; `planning-pipeline.ts`; `execution-pipeline.ts`; `runner-watchdog.ts` |
| Evidencia | El lock de `update` es process-local y `save` documenta semántica last-wins. Pipelines conservan un `RunRecord` viejo, realizan side effects y vuelven a guardarlo. |
| Escenario | Usuario cancela mientras final apply corre; watchdog marca interrupted mientras el runner termina; planning falla luego de cancelación. |
| Actual / esperado | Actual: un save tardío puede “resucitar” `running/completed` o borrar campos nuevos. Esperado: toda transición valida versión, status y dueño de operación en el instante de commit. |
| Causa raíz | CAS puntual en endpoints, no en todos los writers/background jobs. |
| Impacto | Estado mentiroso, ejecución después de cancelar, pérdida de decisiones. |
| Diseño recomendado | `RunMutationService` único: CAS obligatorio, `operationId/lease`, transición + evento requerido, fencing de side effects; jamás guardar snapshots completos stale. |
| Archivos probables | store, lifecycle, runner-state, pipelines, routes, watchdog, event log. |
| Riesgos del fix | Refactor transversal y manejo explícito de conflictos de mutación. |
| Tests | Barreras deterministas cancel-vs-complete, watchdog-vs-complete, pause-vs-wave, restart-vs-old-runner. |
| Aceptación | Una vez terminal/cancelado, ningún writer con lease anterior cambia status o produce side effects aceptados. |

### CF-04 — Takeover del repo lock permite dos propietarios

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — riesgo de concurrencia; bug confirmado por código |
| Ubicación | `apps/web/src/lib/server/runs/repo-lock.ts`, adquisición stale y `release` |
| Evidencia | Dos contendientes pueden leer el mismo owner stale; A reemplaza lock; B ejecuta `rm` sobre el lock nuevo de A y crea el suyo. Release también hace read-then-remove sin token inmutable. |
| Escenario | Dos runs arrancan sobre el mismo repo tras un lock huérfano. |
| Actual / esperado | Actual: ambos pueden creer que tienen exclusión. Esperado: takeover atómico y release solo por dueño/generación. |
| Causa raíz | Archivo de lock tratado con operaciones separadas sin compare-and-swap filesystem. |
| Impacto | Worktrees/refs/entrega cruzados y posible corrupción del repo. |
| Diseño recomendado | Directorio lock creado atómicamente con token+lease; takeover por rename a quarantine o primitive transaccional; heartbeat y fencing token verificado antes de cada side effect. |
| Archivos probables | `repo-lock.ts`, execution/delivery/manual-run routes, cleanup. |
| Riesgos del fix | Semántica cross-platform; no depender solo de PID. |
| Tests | 20 procesos compitiendo; stale takeover; release tardío; reloj desplazado. |
| Aceptación | Nunca más de un token válido y un release viejo jamás elimina el lock actual. |

### CF-05 — DELETE puede borrar un run activo sin detenerlo

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — pérdida de estado; bug confirmado |
| Ubicación | `apps/web/src/app/api/runs/[id]/route.ts` (`DELETE`); repositorio de runs y cleanup |
| Evidencia | La ruta elimina el JSON sin exigir status terminal, cancelar procesos ni limpiar eventos/checkpoints/worktrees/branches. |
| Escenario | Borrar desde UI/API mientras una wave está activa. |
| Actual / esperado | Actual: el runner continúa con su snapshot y puede recrear/guardar estado; quedan artifacts huérfanos. Esperado: active run solo puede cancelarse; borrar es archive/purge terminal coordinado. |
| Causa raíz | CRUD genérico aplicado a una entidad con lifecycle/side effects. |
| Impacto | Run fantasma, procesos y costo sin UI, corrupción de artifacts. |
| Diseño recomendado | Reemplazar por `archive`; purge separado solo terminal, bajo mutation/repo lock, con cancel verified y cleanup journaled. |
| Archivos probables | route, lifecycle, runner/process registry, delivery cleanup, UI. |
| Riesgos del fix | Compatibilidad con clientes que esperan delete inmediato. |
| Tests | DELETE en cada status; crash durante purge; cleanup reintentado. |
| Aceptación | No se elimina metadata mientras quede runner/proceso/worktree activo; purge es idempotente y auditable. |

### CF-06 — Cancelar no alcanza todos los procesos ni garantiza muerte

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — lifecycle/seguridad/costo; bug confirmado |
| Ubicación | cancel route; `packages/execution-core/src/validation/runner.ts`; dependency installer; final apply; decomposers CLI; process registry |
| Evidencia | Validation/install/final git no aceptan el signal/owner común; planning usa spawn propio. Cancel responde 200 aun si `killReport.allDead=false` y reporta survivors. |
| Escenario | Cancelar durante test largo, install, planning, repair o aplicación final. |
| Actual / esperado | Actual: pueden quedar procesos y luego persistir resultados. Esperado: todos los subprocesses registrados, abortables y verificados; status no se confirma cancelado con supervivientes. |
| Causa raíz | Supervisor implementado solo para `AgentExecutor`. |
| Impacto | Consumo de cuota/CPU, mutaciones posteriores, falsa sensación de control. |
| Diseño recomendado | `ProcessSupervisor` único para executor, decomposer, git, validation, install y terminal; process-tree kill; operation fencing; estado `cancelling` hasta `allDead`. |
| Archivos probables | executor/process, validation, installer, decomposers, git runner/final apply, terminal, cancel route. |
| Riesgos del fix | Windows/POSIX y comandos cortos que terminan durante kill. |
| Tests | Cancel en cada fase, hijos/nietos reales, kill parcial, retry de cancel. |
| Aceptación | Respuesta terminal solo después de `allDead=true`; ningún evento/commit aceptado del lease cancelado. |

### CF-07 — Éxito terminal no exige que el resultado haya sido aplicado

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical** — bug confirmado; consistencia contractual |
| Ubicación | `execution-pipeline.ts` settle; `final-apply.ts`; delivery/result projection |
| Evidencia | Final apply puede devolver failed/undefined/patch vacío y el pipeline aún transicionar a `completed` o `completed_with_accepted`. |
| Escenario | Merge/cherry-pick final falla, branch objetivo cambió o patch no se puede aplicar. |
| Actual / esperado | Actual: badge de completado sin deliverable utilizable. Esperado: success implica artifact final materializado/exportable y validación/disposición explícita. |
| Causa raíz | Se equipara “execution graph terminó” con “producto entregable existe”. |
| Impacto | Demostración engañosa; usuario puede creer que su repo contiene cambios inexistentes. |
| Diseño recomendado | Separar `executionOutcome`, `artifactOutcome`, `deliveryOutcome`; terminal `completed` solo si commit final existe y se verificó; estados `partial/needs_delivery/failed_delivery`. |
| Archivos probables | schema/lifecycle, pipeline, final apply, presenter, selectors/UI. |
| Riesgos del fix | Migración de estados y filtros UI. |
| Tests | Apply vacío/fallido/conflictivo; export-only; validación ausente/fallida. |
| Aceptación | Todo completed referencia commit/patch final comprobable y su base exacta. |

### CF-08 — Endpoints sin boundary local/auth exponen shell y filesystem

| Campo | Detalle |
|---|---|
| Severidad / categoría | **Critical si el servidor es accesible fuera de loopback; High en uso estrictamente local** — seguridad |
| Ubicación | toda `apps/web/src/app/api`; terminal routes; workspace/file routes; configuración de start/bind |
| Evidencia | No hay auth, CSRF/origin enforcement ni guard de loopback. La API permite elegir carpetas, leer archivos, iniciar runs y abrir una shell que hereda `process.env`. |
| Escenario | Next escucha en red local, reverse proxy o navegador carga una página hostil que alcanza localhost. |
| Actual / esperado | Actual: superficie administrativa sin frontera explícita. Esperado: local-only verificable o autenticación/capability token y origin checks. |
| Causa raíz | Supuesto local implícito, no convertido en control. |
| Impacto | Lectura/escritura/ejecución arbitraria con credenciales del usuario. |
| Diseño recomendado | Bind loopback por defecto y rechazo de Host/Origin no permitido; token por sesión para mutaciones/SSE/terminal; banner de modo local; documentar threat model. |
| Archivos probables | middleware/server launcher, API helpers, terminal, docs. |
| Riesgos del fix | Desarrollo, tests y uso LAN intencional. |
| Tests | Requests sin token, origin hostil, Host externo, SSE/terminal cross-run. |
| Aceptación | Instalación default no acepta clientes remotos/no autorizados y no expone shell por CSRF. |

## 7. Hallazgos por subsistema

> Los campos “confirmación, ubicación, evidencia, escenario, actual/esperado, causa, impacto, diseño, archivos, riesgos, tests y aceptación” se mantienen en cada ficha. La clasificación distingue bug, inconsistencia, seguridad, performance, UX o deuda.

### Planning, DAG y contratos

#### CF-09 — `integrator` falla en el camino productivo de LangGraph

- **Severidad/categoría/confirmación:** High; bug confirmado e inconsistencia contractual.
- **Ubicación/evidencia:** `packages/orchestrator-graph/src/graphs/execution-graph.ts` incluye `leaf` e `integrator` en el frontier y los envía a `executeLeaf`; `apps/web/src/lib/server/runs/execution-host.ts` llama `RunExecutor.runNode`; `runNode` solo trata `leaf` como ejecución atómica y deriva `integrator` al camino composite, donde no tiene children. El E2E que “prueba integrators” usa `RunExecutor.run`, no el host productivo.
- **Escenario y actual/esperado:** al crear un integrator desde UI o planning, termina en “Composite task has no children”; debería ejecutarse como tarea atómica dependiente o eliminarse como kind.
- **Causa/impacto:** dos semánticas distintas en `run` y `runNode`; una función visible no funciona.
- **Diseño/archivos/riesgos:** elegir una sola semántica y aplicarla en task-graph, executor, host, readiness, integration y UI; migrar nodos persistidos. Riesgo: doble integración si se lo trata simultáneamente como leaf y parent.
- **Tests/aceptación:** E2E por `executionGraph` + host con integrator; debe producir commit, respetar dependencies e integrarse una sola vez.

#### CF-10 — El límite default `maxParallel=6` no limita las waves

- **Severidad/categoría:** High; performance/concurrencia, confirmado.
- **Ubicación/evidencia:** `ExecutionConfigSchema` default 6; `execution-host.ts` pasa `run.executionConfig?.maxParallel` solo si fue persistido; el config almacenado es parcial y el scheduler interpreta ausencia como sin límite. Cada `Send` crea una ejecución independiente, por lo que el cap interno de otro camino no compensa.
- **Escenario:** frontier con más de seis nodos en un run que usa defaults.
- **Actual/esperado:** se despacha todo el frontier; deben existir como máximo seis tareas activas.
- **Causa/impacto:** defaults aplicados tarde y en una capa que el selector no ve; exceso de CLIs, memoria, cuota y presión sobre checkpoint.
- **Diseño/archivos/riesgos:** normalizar config una vez (`executionConfigFor(run)`) antes de scheduler y persistir config efectiva; `execution-host.ts`, schemas y tests. Cuidado con resume de runs legacy.
- **Tests/aceptación:** 20 nodos listos, medir concurrencia máxima = 6 con default y = N con override.

#### CF-11 — Un agente sin diff puede declararse exitoso por archivos preexistentes

- **Severidad/categoría:** High; bug confirmado.
- **Ubicación/evidencia:** `packages/execution-core/src/result/recorder.ts`, `ResultRecorder.baselineSatisfiesContract`: omite expected files inexistentes y devuelve true si encuentra cualquier archivo no stub; contradice el comentario de verificar todos.
- **Escenario:** contrato espera A y B; A ya existía, B no; agente no cambia nada.
- **Actual/esperado:** success/no-op aceptado; debería exigir todos los outputs concretos o evidencia de aceptación/validación.
- **Causa/impacto:** heurística “algún baseline útil” usada como prueba completa; falsos positivos de implementación.
- **Diseño/archivos/riesgos:** comprobar todos los paths no-glob; para outputs abstractos exigir validación explícita; distinguir `already_satisfied` con evidencia. Riesgo en tareas de análisis/config sin archivo concreto.
- **Tests/aceptación:** matrices 0/1/N archivos, stubs, glob y validation; no success sin diff salvo prueba completa registrada.

#### CF-12 — El DAG acepta raíces y profundidades estructuralmente inválidas

- **Severidad/categoría:** Medium; inconsistencia contractual confirmada por ejecución.
- **Ubicación/evidencia:** `packages/task-graph/src/index.ts:180-389`. El diagnóstico aceptó `rootId` apuntando a `leaf`, `parentId=null`, `depth=7` sin issues. No se verifica `node.id === key`, root kind/depth, depth padre+1 ni duplicados de children/dependencies.
- **Escenario:** LLM devuelve graph schema-valid pero jerárquicamente incoherente.
- **Actual/esperado:** el error aparece luego en layout/readiness/integration; debe rechazarse antes de aprobar/ejecutar.
- **Causa/impacto:** schema sintáctico más checks parciales, sin invariantes completas de árbol+DAG.
- **Diseño/archivos/riesgos:** endurecer `validateExecutableTaskGraph`, normalizar solo legacy conocido y bloquear lo demás; puede invalidar fixtures históricos.
- **Tests/aceptación:** root leaf/composite, depth incorrecta, key/id mismatch, duplicate edge/child; todos producen error accionable.

#### CF-13 — `node.dependencies` puede divergir silenciosamente del canónico

- **Severidad/categoría:** Medium; inconsistencia contractual confirmada.
- **Ubicación/evidencia:** `validateTaskGraph` solo advierte si el shortcut contiene un ID ausente en `graph.dependencies`; no advierte el caso inverso. Diagnóstico con edge canónico `a->b` y `b.dependencies=[]` no emitió divergence.
- **Escenario:** patch/parser muta edges canónicos sin sincronizar shortcut o viceversa.
- **Actual/esperado:** consumidores del shortcut ven otra realidad; D1 exige sincronía.
- **Causa/impacto:** validación unidireccional; UI/prompts/readiness auxiliares pueden discrepar.
- **Diseño/archivos/riesgos:** derivar el shortcut al serializar o validar igualdad de conjuntos; mutación solo con helpers. Migrar snapshots legacy.
- **Tests/aceptación:** divergencia en ambas direcciones falla o se normaliza determinísticamente antes de persistir.

#### CF-14 — La edición de paths no cambia el scope usado en runtime

- **Severidad/categoría:** High; feature façade/inconsistencia contractual.
- **Ubicación/evidencia:** `apps/web/src/lib/server/runs/patches.ts` (`NODE_PATHS_EDITED`) actualiza `contract.allowed/forbidden`; `RunExecutor`/`ScopeChecker` usan `executionScope` y `forbiddenPaths`.
- **Escenario:** usuario corrige el alcance desde el plan y ejecuta.
- **Actual/esperado:** la UI muestra el cambio pero enforcement conserva el anterior; ambos deben editar el contrato canónico o desaparecer la opción.
- **Causa/impacto:** coexistencia de schemas legacy y refinado; pérdida de confianza/aislamiento.
- **Diseño/archivos/riesgos:** un modelo canónico de scope, migración y presenter común; riesgo de ampliar scopes accidentalmente.
- **Tests/aceptación:** editar scope, ejecutar agente que toca viejo/nuevo path y comprobar el resultado real.

#### CF-15 — Editar un plan aprobado puede dejarlo sin gate aprobable

- **Severidad/categoría:** High; lifecycle/UX confirmado.
- **Ubicación/evidencia:** persist de patches vuelve a `needs_review`, pero la decisión `approve_plan` previa ya está resuelta y no se crea una decisión por nueva revisión; la UI no ofrece un camino coherente adicional.
- **Escenario:** aprobar, renombrar/cambiar un nodo y volver a ejecutar.
- **Actual/esperado:** run atascado o aprobación previa ambiguamente reutilizada; cada `planRevision` debe tener gate propio.
- **Causa/impacto:** aprobación ligada al run, no a la versión de plan.
- **Diseño/archivos/riesgos:** introducir `planRevision`, `approvedPlanRevision` y decisión idempotente por revisión; invalidar approval al cambiar semántica. Definir qué patches cosméticos no invalidan.
- **Tests/aceptación:** edit-after-approve produce exactamente una nueva decisión y solo esa revisión aprobada puede ejecutar.

#### CF-16 — Patches concurrentes se pisan por save sin expected version

- **Severidad/categoría:** High; concurrencia/pérdida de estado.
- **Ubicación/evidencia:** `persistRunPatches` lee run/base, calcula candidate y llama `save`; no CAS. Dos requests desde el mismo version generan dos snapshots y gana el último.
- **Escenario:** edición en dos pestañas o chat y canvas simultáneos.
- **Actual/esperado:** se pierde un patch; se debe rechazar stale o rebasear explícitamente.
- **Causa/impacto:** endpoint editable fuera del mutation protocol.
- **Diseño/archivos/riesgos:** expectedVersion obligatorio, append de patch idempotente y recomputación sobre latest; conflictos UX.
- **Tests/aceptación:** barrera con dos edits: uno 200 y otro 409/rebase, nunca pérdida silenciosa.

#### CF-17 — “Mark manual” no altera la ejecución

- **Severidad/categoría:** Medium; feature façade.
- **Ubicación/evidencia:** patch `NODE_MARKED_MANUAL` solo cambia `metadata.authoredBy`; readiness/frontier/host no lo interpretan como skip/gate/manual result.
- **Escenario:** usuario marca tarea manual esperando que no se envíe a un agente.
- **Actual/esperado:** se ejecuta normalmente; debería abrir gate y requerir evidencia/commit humano o retirarse el control.
- **Causa/impacto:** metadata sin policy consumer; UX engañosa.
- **Diseño/archivos/riesgos:** estado/tipo `manual`, contrato de entrega humana y validación; riesgo de dependencias desbloqueadas sin artifact.
- **Tests/aceptación:** nodo manual nunca despacha executor y solo se resuelve con artifact validado.

#### CF-18 — La aprobación desde chat reconoce errores críticos automáticamente

- **Severidad/categoría:** High; problema de UX/seguridad de decisión.
- **Ubicación/evidencia:** flujo del chat envía aprobación con `acknowledgeCriticErrors: true` sin una confirmación separada visible.
- **Escenario:** plan critic marca errores y usuario pulsa la acción genérica de aprobar.
- **Actual/esperado:** los warnings se saltean implícitamente; debe existir reconocimiento explícito, informado y auditable.
- **Causa/impacto:** conveniencia del control unificada con override de seguridad.
- **Diseño/archivos/riesgos:** dos acciones distintas y resumen de riesgos; preservar fast path si no hay errores.
- **Tests/aceptación:** con critic errors, aprobación normal falla; override explícito genera evento con actor y lista reconocida.

#### CF-19 — Planning puede analizar repo A y ejecutar repo B

- **Severidad/categoría:** High; inconsistencia contractual.
- **Ubicación/evidencia:** create run acepta `repoSpec` override; planning/index/grounding de contexto usan `workspace.repoPath`; execution provisiona `run.repoSpec`.
- **Escenario:** override fixture/local distinto o workspace editado tras crear el run.
- **Actual/esperado:** contratos/scopes se diseñan para un repo y se aplican a otro; el target debe ser inmutable y único.
- **Causa/impacto:** dos resolvers de workspace target; DAG inválido y cambios fuera de intención.
- **Diseño/archivos/riesgos:** `RunTargetContext` persistido al crear (realpath, remote, branch, commit); todas las fases lo usan; restringir override público.
- **Tests/aceptación:** cambiar workspace luego de create no cambia target; planning y execution prueban mismo fingerprint.

#### CF-20 — Planning carece de presupuesto global y Codex puede escribir

- **Severidad/categoría:** High; performance/costo y aislamiento.
- **Ubicación/evidencia:** decomposer recursivo tiene depth budget, hasta 12 children por paso y `callCount` solo métrico; no hay max total nodes/calls/tokens/wall clock. Adapter Codex usa `--sandbox workspace-write` dentro del repo aunque el prompt diga no modificar.
- **Escenario:** respuesta siempre composite, repo grande o prompt injection desde archivos.
- **Actual/esperado:** explosión de llamadas/nodos y posibilidad de cambios durante planning; debería haber budgets duros y sandbox read-only/aislado.
- **Causa/impacto:** límites locales sin presupuesto de run; instrucción textual usada como control.
- **Diseño/archivos/riesgos:** `maxPlanningNodes/calls/tokens/duration`, cancel/gate al exceder, read-only sandbox y diff guard; permitir excepciones solo explícitas.
- **Tests/aceptación:** árbol adversarial corta en budget con error/gate accionable; `git diff` permanece idéntico tras planning.

### Ejecución, recuperación e integración

#### CF-21 — Crash entre persistir resultado y checkpoint provoca reejecución

- **Severidad/categoría:** High; recuperación/idempotencia.
- **Ubicación/evidencia:** el host guarda resultado/commit en `RunRecord` dentro del node y LangGraph checkpointa después de que retorna; al resume con checkpoint, el seed de `RunRecord` no domina.
- **Escenario:** proceso muere justo después del commit/save y antes de checkpoint.
- **Actual/esperado:** la tarea puede ejecutarse otra vez sobre leftovers; debería adoptar evidencia existente o continuar exactamente una vez.
- **Causa/impacto:** commit, record y checkpoint no comparten operation ID/commit protocol.
- **Diseño/archivos/riesgos:** operation journal por task attempt; antes de ejecutar, reconciliar commit/diff/contract y marcar checkpoint; commits idempotentes. Cuidado con aceptar evidencia incompleta.
- **Tests/aceptación:** fault injection en cada frontera; reabrir no llama executor si artifact válido ya existe.

#### CF-22 — Reconciliación no invalida dependientes y ancestros completos

- **Severidad/categoría:** High; recuperación/consistencia.
- **Ubicación/evidencia:** world reconciliation elimina IDs con evidencia faltante, pero no aplica cierre transitivo de `graph.dependencies` y jerarquía; existe lógica de invalidación más completa en otra ruta.
- **Escenario:** falta branch/commit de A, mientras B dependiente y parent root conservan resultados.
- **Actual/esperado:** B/root pueden sembrarse como resueltos; todo downstream/ancestor afectado debe invalidarse.
- **Causa/impacto:** dos implementaciones de invalidación.
- **Diseño/archivos/riesgos:** un helper canónico de closure con reason graph y preview; puede reejecutar más tareas, pero de forma segura.
- **Tests/aceptación:** cadena/diamante/parent integration; ningún resultado sobreviviente depende de evidencia ausente.

#### CF-23 — GC puede borrar el root worktree requerido por resume

- **Severidad/categoría:** High; recuperación.
- **Ubicación/evidencia:** `WorktreeManager.gcRun` barre todas las dirs por convención, incluido root, preservando a veces branch; `validateRun` espera el path determinista del root worktree. Un checkpoint puede retomar directamente en validación.
- **Escenario:** cancel/restart/cleanup tras integración y resume desde checkpoint.
- **Actual/esperado:** validación falla por cwd inexistente; debe recrearse desde final/root commit o no eliminarse hasta terminal.
- **Causa/impacto:** branch preservada se confundió con workspace materializado.
- **Diseño/archivos/riesgos:** artifact descriptor (`commitSha`, role) y recreación lazy; GC stage-aware.
- **Tests/aceptación:** GC + resume en run-validation completa usando worktree recreado correcto.

#### CF-24 — Replan puede resucitar un run cancelado y usar workspace mutable

- **Severidad/categoría:** High; lifecycle/concurrencia.
- **Ubicación/evidencia:** `replan-service.ts` ejecuta operación larga con status running sin marcar runner/heartbeat/abort/repo lock; usa `workspace.repoPath` actual y guarda al final.
- **Escenario:** cancelar o stale-sweep mientras el modelo replantea; editar workspace en paralelo.
- **Actual/esperado:** save tardío vuelve a running y lanza ejecución sobre path posiblemente distinto; debe ser una operación poseída, cancelable y sobre target inmutable.
- **Causa/impacto:** replan fuera del runner protocol.
- **Diseño/archivos/riesgos:** mutation lease + repo lock + signal + target snapshot; checkpoint reset después de commit transaccional de nuevo plan.
- **Tests/aceptación:** cancel mid-replan nunca resucita; workspace edit no cambia repo; dos replans no se pisan.

#### CF-25 — Amendment publica éxito y borra checkpoint antes del CAS

- **Severidad/categoría:** High; pérdida/corrupción de estado.
- **Ubicación/evidencia:** decision route agrega `decision.resolved`/`amendment.applied` y resetea thread antes del compare-and-swap de `RunRecord`.
- **Escenario:** otra mutación gana la versión justo antes del CAS.
- **Actual/esperado:** log dice aplicado y checkpoint desaparece, pero record conserva graph anterior; side effects deben ocurrir luego de claim durable o ser recuperables.
- **Causa/impacto:** orden inverso entre commit lógico y efectos.
- **Diseño/archivos/riesgos:** journal `prepared -> committed -> effects_done`, eventos con mutation ID, recovery worker idempotente.
- **Tests/aceptación:** CAS forzado a fallar no altera log/checkpoint o recovery completa exactamente la mutación ganadora.

#### CF-26 — Resultados aceptados pueden terminar parciales

- **Severidad/categoría:** High; consistencia/UX.
- **Ubicación/evidencia:** routeIntegration admite aceptar integraciones fallidas usando commit parcial/base; root accepted sin validation commands puede resolver `completed_with_accepted` sin root commit completo.
- **Escenario:** conflicto irresoluble o child fallido que el humano “acepta”.
- **Actual/esperado:** se presenta como variante de completado; debería ser `partial/accepted_risk` con artifact exacto y tareas omitidas visibles.
- **Causa/impacto:** aceptación humana tratada como transformación de failure a success.
- **Diseño/archivos/riesgos:** decisión cambia disposition, no hechos; manifest de omissions/conflicts; bloquear delivery automática por defecto.
- **Tests/aceptación:** artifact parcial enumera cada ausencia y nunca usa copy de “completado/verificado”.

#### CF-27 — Worktrees comparten `node_modules` escribible

- **Severidad/categoría:** High; seguridad/aislamiento y concurrencia.
- **Ubicación/evidencia:** `packages/execution-core/src/worktree/manager.ts:33-40,269-297` crea symlink/junction desde cada worktree al `node_modules` base.
- **Escenario:** agente ejecuta install/postinstall o modifica un paquete; dos agentes instalan simultáneamente.
- **Actual/esperado:** muta dependencias no trackeadas del checkout y de otros agentes; aislamiento debe incluir dependencias mutables.
- **Causa/impacto:** optimización para disponer de binarios reemplaza aislamiento; ScopeChecker/git diff no lo detectan.
- **Diseño/archivos/riesgos:** store global de pnpm con node_modules por worktree; instalación preparatoria controlada o toolchain read-only; no permitir agent install sobre junction. Impacto en tiempo/disco.
- **Tests/aceptación:** escribir/instalar en un worktree no cambia hash/mtime/contenido del base ni de otro worktree.

#### CF-28 — Executors y terminales heredan secretos del servidor

- **Severidad/categoría:** High; seguridad confirmada.
- **Ubicación/evidencia:** `executor/process.ts:101-104` usa `{...process.env}`; `terminal-sessions.ts:122-140` pasa `process.env`. El agente ejecuta comandos y puede leer env/HOME/red.
- **Escenario:** prompt injection en repo o tarea maliciosa imprime/exfiltra tokens.
- **Actual/esperado:** todas las credenciales del servidor quedan disponibles; debe existir un env allowlist y threat model explícito.
- **Causa/impacto:** conveniencia operativa; exposición de tokens no relacionados y secretos de desarrollo.
- **Diseño/archivos/riesgos:** allowlist mínima (`PATH`, temp, locale, provider requerido), secret broker/credential files scoped, red opcional; algunos CLIs dependen de HOME.
- **Tests/aceptación:** variable canaria no aparece en agente/terminal; solo credenciales declaradas y necesarias están disponibles.

#### CF-29 — Delivery opera sobre branch actual y fuera del repo lock

- **Severidad/categoría:** High; integración/concurrencia.
- **Ubicación/evidencia:** delivery resuelve el branch actual del checkout, no el `baseBranch` capturado; no adquiere repo lock global. Manual node execution tampoco lo adquiere.
- **Escenario:** usuario cambia de branch o inicia otro run durante delivery/manual run.
- **Actual/esperado:** merge en branch inesperado o colisión con otro run; target debe confirmarse y exclusión abarcar todas las mutaciones git.
- **Causa/impacto:** lock limitado al pipeline principal.
- **Diseño/archivos/riesgos:** delivery plan muestra target/base/dirty diff; requiere explicit confirm + same repo lease; manual execution también. No auto-checkout con cambios dirty.
- **Tests/aceptación:** branch cambiado produce 409/decision, dos runs/delivery nunca mutan simultáneamente.

#### CF-30 — La vista “final” lee el checkout base y el agregado no es evidencia final

- **Severidad/categoría:** High; bug/UX confirmado.
- **Ubicación/evidencia:** `resolveRunWorkspaceContext` para final usa `appliedToRepoPath ?? repoRoot`; si no se entregó, apunta a base, no a final commit. El fallback concatena diffs de leaves y la lista de files es unión, que no refleja repair/overwrites.
- **Escenario:** run completado no entregado, con conflictos reparados.
- **Actual/esperado:** Files/terminal etiquetados resultado muestran base y “Final aggregate diff” puede ser falso; debe leer el árbol de `finalCommit` y diff contra source base.
- **Causa/impacto:** no existe artifact final de primera clase.
- **Diseño/archivos/riesgos:** final read-only worktree o `git show`; manifest derivado solo de commits reales; terminal final claramente read-only. Coste de worktree adicional.
- **Tests/aceptación:** archivo creado/reparado se ve exactamente como `git show finalCommit:path`; files = `git diff --name-only base final`.

#### CF-31 — Scope permitido es advisory aunque la UI sugiere enforcement

- **Severidad/categoría:** Medium; consistencia/UX.
- **Ubicación/evidencia:** `ScopeChecker` solo falla forbidden; allowed fuera de scope llena `outOfScope` y pasa. Trazas advisory no llegan claramente al modelo nativo/UI.
- **Escenario:** agente modifica muchos archivos no previstos, sin tocar deny-list.
- **Actual/esperado:** run continúa silenciosamente; producto debe explicar policy y permitir gate/strict según repo/riesgo.
- **Causa/impacto:** decisión razonable para greenfield no representada al operador.
- **Diseño/archivos/riesgos:** policy `advisory|gate|strict`, default conservador para repo existente; evento/decision durable con diff. Strict puede bloquear paths legítimos mal planeados.
- **Tests/aceptación:** cada policy tiene resultado visible y auditable; no hay out-of-scope oculto.

#### CF-32 — GC puede dejar metadata git stale

- **Severidad/categoría:** Medium; cleanup/deuda operativa.
- **Ubicación/evidencia:** `WorktreeManager.gcRun`: si `git worktree remove` falla, ejecuta prune antes de `rm(runRoot)`; como path aún existe, prune puede conservar registro y luego el `rm` manual deja metadata stale.
- **Escenario:** file lock de Windows o proceso con cwd en worktree.
- **Actual/esperado:** futuros create fallan/recrean destructivamente; cleanup debe informar pendiente y reintentar prune después de remover path.
- **Causa/impacto:** best-effort con orden incorrecto y resultado `failed` no impide borrar root.
- **Diseño/archivos/riesgos:** cleanup journal, kill/cwd release, remove path, prune final, verificar `git worktree list --porcelain`; preservar evidencia branches.
- **Tests/aceptación:** fallo inyectado deja estado recuperable y segundo GC limpia por completo sin tocar otra run.

### Persistencia, eventos, API y UI

#### CF-33 — Una línea JSONL truncada rompe todo el run y SSE

- **Severidad/categoría:** High; corrupción/recuperación.
- **Ubicación/evidencia:** `run-model-event-log.ts` lee líneas y hace `JSON.parse` sin tolerancia; append no usa framing/checksum; reconciliación solo cubre casos puntuales.
- **Escenario:** servidor muere a mitad de append o disco lleno.
- **Actual/esperado:** detalle/SSE fallan por una línea; debería conservar prefijo válido, marcar corrupción y recuperar/truncar cola.
- **Causa/impacto:** JSONL tratado como atómico sin fsync/protocolo.
- **Diseño/archivos/riesgos:** append serialized, sequence+checksum, parser tolerante solo a trailing partial, quarantine y reconciliation desde RunRecord/checkpoint.
- **Tests/aceptación:** byte truncation en cada posición; UI abre en degraded mode y no inventa eventos.

#### CF-34 — Eventos de detalle fire-and-forget pueden faltar para siempre

- **Severidad/categoría:** Medium; observabilidad/consistencia.
- **Ubicación/evidencia:** publishers de detalle no awaited y `drain` existe principalmente para tests; solo status/decisiones se consideran required.
- **Escenario:** proceso termina/reinicia inmediatamente tras node result.
- **Actual/esperado:** record tiene resultado pero timeline nunca; todo evento necesario para derivar UI debe ser durable o reconciliable.
- **Causa/impacto:** optimización de latencia sin outbox.
- **Diseño/archivos/riesgos:** transactional outbox por mutation ID; detalles diagnósticos pueden ser best effort, estados no. Aumenta writes.
- **Tests/aceptación:** kill después de save; restart genera exactamente el terminal event faltante.

#### CF-35 — Event log y cliente escalan aproximadamente O(n²)

- **Severidad/categoría:** High; performance confirmado por código/datos.
- **Ubicación/evidencia:** append relee/ordena log completo; SSE relee repetidamente; cliente copia y reduce arrays crecientes. Run observado: ~4,94 MB JSONL/2023 traces.
- **Escenario:** output verboso, graph grande, ejecución larga o varias reconexiones.
- **Actual/esperado:** CPU/I/O/memoria crecen de forma superlineal; append y catch-up deben ser incrementales.
- **Causa/impacto:** almacenamiento de archivo completo sin índice/cursor y reducer batch no incremental.
- **Diseño/archivos/riesgos:** append-only O(1), cursor byte/seq, batches, snapshots compactados y límites de output; migrar logs existentes.
- **Tests/aceptación:** benchmark 100k eventos con latencia por append estable y reconnect desde `after` sin leer prefijo completo.

#### CF-36 — `waveIndex` se reinicia y sobrescribe historia derivada

- **Severidad/categoría:** Medium; idempotencia/UX.
- **Ubicación/evidencia:** `execution-host.ts` inicializa índice local en 0 por host/resume; reducer guarda waves en `Map` keyed por index.
- **Escenario:** restart/resume luego de waves previas.
- **Actual/esperado:** wave nueva 0 reemplaza visualmente a la antigua 0; cada dispatch necesita ID global/seq estable.
- **Causa/impacto:** identity basada en contador de proceso, no event log.
- **Diseño/archivos/riesgos:** `waveId` UUID/operation seq persistido o derivado del checkpoint/event sequence; migrar reducer legacy.
- **Tests/aceptación:** dos resumes conservan todas las waves en orden sin colisión.

#### CF-37 — Bus de eventos legacy deja ejecución manual fuera de la UI nativa

- **Severidad/categoría:** High; inconsistencia entre capas.
- **Ubicación/evidencia:** la página productiva consume run-model JSONL; `publishRunEvent` legacy no tiene subscriber productivo. Manual node pipeline y partes de planning publican al bus/trace anterior; tests del SSE adapter no prueban el consumidor actual.
- **Escenario:** ejecutar/revisar nodo manualmente y refrescar.
- **Actual/esperado:** estado no aparece o desaparece tras refresh; todos los productores deben escribir el log canónico.
- **Causa/impacto:** migración de modelo de eventos incompleta.
- **Diseño/archivos/riesgos:** eliminar bus/adapter después de migrar producers; eventos nativos tipados e idempotentes.
- **Tests/aceptación:** manual run visible live y tras reload solo desde JSONL; no hay segundo source of truth.

#### CF-38 — La proyección declara tests pasados antes de validar

- **Severidad/categoría:** High; bug de evidencia/UX.
- **Ubicación/evidencia:** live trace adapter traduce `executor_completed exitCode=0` a `node.verify.iteration` con tests 1/1 pass; ignora eventos reales de validation. Leaves pueden quedar “verifying” hasta proyección final.
- **Escenario:** executor termina 0 pero tests posteriores fallan/no existen.
- **Actual/esperado:** UI muestra señal falsa; executor success y validation result deben ser eventos distintos.
- **Causa/impacto:** adapter inferencial para llenar el nuevo modelo.
- **Diseño/archivos/riesgos:** emitir eventos nativos en el punto real de validation/result persist; remover inferencia; ajustar fixtures.
- **Tests/aceptación:** exit 0 + validation fail nunca muestra pass; no commands muestra `unverified`.

#### CF-39 — Workspace inválido puede mutar el filesystem antes de responder 400

- **Severidad/categoría:** High; validación/seguridad.
- **Ubicación/evidencia:** workspace POST/PATCH llama `ensureRunnableRepo` durante normalización antes de terminar schema validation; puede `git init`, escribir README/.gitignore y committear.
- **Escenario:** path válido + name/body inválido.
- **Actual/esperado:** request 400 deja repo inicializado; toda validación debe preceder side effects y bootstrap requerir confirmación.
- **Causa/impacto:** normalización impura.
- **Diseño/archivos/riesgos:** parse/realpath/inspect read-only, devolver proposed actions, confirm y recién ejecutar; rollback si falla. Cambia UX de alta rápida.
- **Tests/aceptación:** cualquier 4xx deja árbol/HEAD idénticos.

#### CF-40 — File API puede seguir symlinks fuera del workspace

- **Severidad/categoría:** High; seguridad/aislamiento.
- **Ubicación/evidencia:** workspace-file valida containment lexical del path solicitado, pero `stat/readFile` sigue symlinks; no compara `realpath` final con root real.
- **Escenario:** repo contiene symlink `inside -> C:\Users\...\.ssh` y API lee `inside/config`.
- **Actual/esperado:** lectura fuera de root; debe rechazar symlink escape o resolver containment real en cada componente.
- **Causa/impacto:** protección contra `..` no cubre enlaces.
- **Diseño/archivos/riesgos:** `realpath(root/target)` containment, `lstat` policy, manejo de symlink válido interno; Windows junctions.
- **Tests/aceptación:** symlink/junction externo da 403; enlace interno permitido según policy.

#### CF-41 — Terminales no validan ownership de run y expiran solo al tocar el registry

- **Severidad/categoría:** Medium; seguridad/recursos.
- **Ubicación/evidencia:** rutas `[id]/terminals/[terminalId]` obtienen sesión por terminal ID sin comprobar que `session.runId === id`; sweep TTL ocurre en create/get, no por timer; close de fallback mata hijo directo.
- **Escenario:** usar terminal ID de otro run o abandonar terminal sin más requests.
- **Actual/esperado:** cross-run access y shell ociosa indefinida; ownership estricto y reaper periódico/process-tree kill.
- **Causa/impacto:** ID global considerado capability suficiente; cleanup lazy.
- **Diseño/archivos/riesgos:** bind a run/user token, timer unref, supervisor común, límite input/backlog/sesiones.
- **Tests/aceptación:** ID bajo run equivocado 404/403; TTL mata hijos/nietos sin request posterior.

#### CF-42 — Release gates y documentación operativa contradicen el producto

- **Severidad/categoría:** High; calidad/release y documentación incompleta.
- **Ubicación/evidencia:** root typecheck 3 errores, lint 78, web lint/build falla; CI usa pnpm 7.29.3 vs `packageManager` 11.7.0, lint nonblocking y no corre web build. `README.md:91-144` aún declara Gemini default, pnpm 7.29.3 y link a doc inexistente; `apps/web/README.md:118` conserva `MANYHANDS_GEMINI_BIN`.
- **Escenario:** clone limpio, CI o preparación de demo.
- **Actual/esperado:** instalación confusa y release no verificable; todos los gates oficiales deben ser verdes y docs reflejar Claude/Codex.
- **Causa/impacto:** migraciones incompletas y deuda tolerada en CI.
- **Diseño/archivos/riesgos:** fijar una versión pnpm, agregar `verify` obligatorio (typecheck/lint/test/web build), corregir docs y separar históricos marcados; limpiar lint en cambios acotados.
- **Tests/aceptación:** clone limpio en Windows/Linux ejecuta el mismo comando CI y pasa; búsqueda current docs no presenta Gemini como activo.

## 8. Análisis de consistencia entre contratos y capas

| Contrato/invariante | Productor | Consumidor | Estado observado |
|---|---|---|---|
| `goal` canónico | decomposer/parsers | prompts, graph, UI | Consistente en el flujo actual; quedan nombres históricos en docs/tests, no un blocker. |
| `graph.dependencies` canónico | decomposer/patches | scheduler/readiness/invalidation | El consumidor principal es correcto; el shortcut se puede desincronizar (CF-13). |
| `AgentTaskContract` | planning | executor/context/scope/validation | Rico y útil; edición de paths toca campos distintos de runtime (CF-14). |
| `InterfaceContract/sharedInterface` | decomposer | grounding/integration repair | Se usa para skeleton/repair; grounding viola aislamiento de base (CF-01). |
| `git diff HEAD` verdad de cambios | ResultRecorder/GitRunner | scope/commit/evidence | Respetado. El falso positivo proviene del caso diff vacío (CF-11), no de stdout. |
| Orquestador commitea | recorder/worktree | integration | Implementado con unexpected-commit policy; debe mantenerse. |
| Worktree + ScopeChecker aíslan | execution-core | agentes | Parcial: grounding y node_modules escapan; allowed scope advisory (CF-01/27/31). |
| Bottom-up cherry-pick | IntegrationAgent | final apply | Implementado, pero disposition y artifact final no son honestos en todos los fallos (CF-07/26/30). |
| Gates centralizados | execution-gate-service | routes/graph | Correcto para execution gates principales; plan edits/chat/amendment abren caminos laterales (CF-15/18/25). |
| `gated` derivado | decisions/selectors | UI | La intención es correcta; eventos faltantes/corruptos pueden hacerlo divergir. |
| `assertRunActionAllowed` | lifecycle | routes | Cobertura parcial: background saves, delete, replan y algunos side effects no quedan protegidos. |
| Scheduling `risk_aware` | host | scheduler | Política correcta; cap efectivo y wave identity incorrectos (CF-10/36). |
| Event log fuente UI | native publishers | reducer/selectors | La página lo consume, pero legacy bus e inferencias aún compiten (CF-34/37/38). |
| Packages no importan apps | packages | build | Verificado: no se encontró violación. |
| Claude principal/Codex alternativa | registry/policy | UI/executor | Flujo activo correcto; OpenCode/effort/docs conservan drift descrito en deuda. |

Conclusión: los contratos locales son mejores que la coordinación entre capas. La prioridad no es agregar otra abstracción de dominio, sino cerrar los transaction boundaries que conectan RunRecord, checkpoint, event log, git y procesos.

## 9. Análisis del flujo completo de un run

### 9.1 Creación y planning

Input schema cubre prompt, workspace, granularidad y selections, pero el target puede bifurcarse entre workspace y `repoSpec` (CF-19). La generación de título es una llamada extra cosmética; su fallback no rompe el run, aunque agrega latencia/costo. Planning construye grounding estructural e invoca descomposición recursiva; schema/critics reducen respuestas inválidas, pero no existen budgets globales ni una sandbox read-only real para Codex (CF-20).

### 9.2 Revisión y aprobación

El gate de plan y los critics existen. Falta versionar la aprobación por revisión; editar un plan puede dejar un gate incoherente (CF-15/16), y chat reconoce critic errors de forma implícita (CF-18). `validateExecutableTaskGraph` debe ser el último requisito antes de aprobar y volver a ejecutarse justo antes de dispatch, no solo durante una edición.

### 9.3 Preparación y dispatch

Preflight valida git, executor y parte del workspace. Luego el grounding muta la base (CF-01). El scheduler registra la wave antes de dispatch, punto positivo, pero omite el cap default (CF-10). Antes de cada wave debe verificarse lease de run, repo fencing token, abort signal y graph revision.

### 9.4 Ejecución de nodo

Para leaves, worktree, context packer, CLI, `git diff HEAD`, ScopeChecker, validation y commit del orquestador forman una cadena coherente. Los puntos débiles son: integrator inconsistente (CF-09), dependencies compartidas (CF-27), secretos heredados (CF-28), no-op falso (CF-11), allowed scope solo advisory (CF-31) y outputs/procesos sin límites uniformes.

### 9.5 Integración y gates

La integración bottom-up y repair semántico son un aporte sólido. Un conflicto puede derivar a gate, pero aceptar no debe convertir hechos fallidos en success (CF-26). Cada cherry-pick/repair necesita operation ID, estado `prepared/applied/validated/committed`, abort seguro y recuperación de `CHERRY_PICK_HEAD`.

### 9.6 Validación, artifact y entrega

`validateRun` devuelve pass técnico con lista vacía y la proyección puede mostrar “unverified”; eso es preferible a inventar pass, pero la UI debe mantener esa distinción. El pipeline hoy puede completar sin artifact aplicado (CF-07), la vista final abre la base (CF-30) y delivery puede apuntar al branch actual sin repo lock (CF-29). El producto debe culminar en un `FinalArtifactManifest` verificable.

## 10. Análisis de fallos, retries y recuperación

### Matriz explícita de edge cases

| Escenario solicitado | Comportamiento actual / evidencia | Acción requerida |
|---|---|---|
| Run vacío / input inválido | Zod rechaza buena parte; workspace normalization puede mutar antes del 400. | Validación pura antes de side effects; tests de no mutación. |
| DAG inválido/cíclico/incompleto | Ciclo/dangling/orphan detectados; root/depth/sync incompletos. | Endurecer validación (CF-12/13) en approval y dispatch. |
| Nodo sin padre/dependencia inexistente | Parent mismatch/dangling se detectan; root no canónico puede pasar. | Reglas completas de árbol. |
| Scope vacío/ambiguo/amplio | Empty leaf scope puede fallar; edit drift y advisory permiten amplitud. | Scope canónico + policy/gate. |
| Scopes solapados | Conflict-risk/scheduler intenta separarlos; no es hard invariant. | Mostrar riesgo y testear overlaps exactos/globs. |
| Archivo fuera de scope | Se registra `outOfScope` pero pasa salvo forbidden. | Policy visible `advisory/gate/strict`. |
| Agente sin cambios | Puede pasar por baseline parcial (CF-11). | Evidencia completa de already-satisfied. |
| Archivo prohibido | ScopeChecker falla; mantener tests de deny-wins. | Asegurar que paths reales/symlinks y edits usan mismo forbidden. |
| Agente commitea | Se detecta contra baseHead, default reject; repair captura expectedHead. | Mantener; agregar crash/retry real. |
| Executor falla/timeout/output inválido | Se clasifica y hay retry/repair en partes; todos los procesos no comparten cancel. | Supervisor y budgets comunes. |
| Muerte durante wave | Checkpoint puede perder writes y crash window reejecuta. | CF-02/21 + journal idempotente. |
| Reinicio de servidor | Watchdog/recovery existen, pero stale saves y root GC rompen garantías. | Lease durable + reconciliation closure. |
| Event log corrupto | Una línea rompe lectura total. | Prefix recovery/checksum/outbox. |
| Eventos duplicados/out-of-order/faltantes | Reducer tolera parte; identity de wave y fire-and-forget fallan. | `eventId`, seq monotónica, idempotency y reconciliation. |
| Retry parcialmente ejecutado | Branch/worktree pueden reutilizarse; checkpoint no adopta evidencia de forma atómica. | Attempt journal + verify/adopt/discard explícito. |
| Cancel en execution/verify/integration | Solo executors principales tienen signal completo. | CF-06. |
| Pause/resume | Gates y loop existen; races last-wins y wave index afectan. | CAS lease + wave IDs. |
| Cherry-pick parcial | Agent maneja conflictos normales; crash at exact git states no está cubierto end-to-end. | Risk RK-04 y fault injection. |
| Conflicto irresoluble/repair fallida | Gate humano existe; accept puede producir partial-completed. | Disposition honesta y artifact manifest. |
| Integración parcial | Puede aceptarse y culminar como completed variant. | CF-26. |
| Decisión pendiente al reiniciar | Persistida en RunRecord/eventos, pero dual truth/reconciliation no es general. | Derivar gate de decisions persistidas y reparar evento faltante. |
| Dos acciones sobre mismo run | Algunas rutas tienen CAS; patches/replan/background no. | Mutation service único. |
| Dos runs mismo repo | Repo lock existe; takeover, delivery y manual run tienen huecos. | CF-04/29. |
| Lock huérfano | Se intenta takeover, pero tiene race. | Lease token atómico. |
| Watchdog timeout | Puede stale-save interrupted sobre completion. | CAS + owner heartbeat. |
| Replan con tareas integradas | Hay invalidación/graft; no es operación atómica y puede usar target mutable. | Journal de replan y closure. |
| Cambios externos en repo | Preflight parcial; grounding/delivery usan checkout mutable. | Fingerprint base + repo lock + decision si diverge. |
| Estado persistido vs derivado | RunRecord/checkpoint/log pueden divergir. | Reconciliation general con autoridad definida por campo. |
| SSE reconnect | `after` existe; lectura completa/corrupción afectan escalabilidad. | Cursor/index incremental. |
| Refresh UI durante run | Replay funciona si JSONL íntegro; eventos legacy/faltantes alteran estado. | Unificar producers/outbox. |
| Respuesta incompleta/alucinada | Schemas/critics ayudan; un graph semánticamente inválido aún puede pasar. | Validators completos, budget y gate. |
| Config workspace/executor errónea | Preflight aporta errores; docs/registry drift y side effects tempranos confunden. | Validación pura y registry único. |
| Repo/graph grande | Index, conflict matrix, logs y reducer crecen sin bounds. | Sección 17. |
| Operación repetida | CAS/idempotency existen solo en partes. | Idempotency key obligatoria por mutation/attempt/event. |

### Política de retry recomendada

- Retry automático solo para fallos clasificados transitorios y antes de commit aceptado.
- Si existe commit/diff, primero `reconcile/adopt`; nunca volver a invocar el modelo a ciegas.
- Cada attempt tiene ID, base SHA, executor selection, prompt hash, started/finished timestamps y disposition.
- Repair, validation y integration poseen budgets independientes pero subordinados al budget global.
- Un retry humano crea una nueva operación; no reescribe evidencia histórica.

## 11. Análisis de concurrencia, locks e idempotencia

El sistema necesita tres niveles explícitos:

1. **Run mutation lease:** un único writer lógico por operación larga, con versión y fencing token.
2. **Repository lease:** exclusión entre runs y acciones manuales/delivery sobre el mismo git common dir.
3. **Task attempt identity:** permite adoptar resultados después de crash y deduplicar events/checkpoint writes.

Los locks process-local sirven para ordenar calls dentro de un bundle, pero no protegen reinicio, dos procesos Next ni scripts. Toda acción debe verificar el token inmediatamente antes de escribir RunRecord, appendear un evento terminal, hacer commit/cherry-pick o entregar. Idempotencia no significa ignorar duplicados indiscriminadamente: la misma key con payload distinto es conflicto.

## 12. Análisis de persistencia y event log

### Autoridad recomendada

| Dato | Fuente autoritativa propuesta |
|---|---|
| Identidad/config/target/revision/disposition | RunRecord versionado |
| Progreso de StateGraph | Checkpoint transaccional |
| Historia/auditoría/UI | Event log append-only con outbox |
| Código producido | Objetos/commits git identificados por SHA |
| Proceso vivo | Lease durable + registry local como observación, no verdad única |

Actualmente el RunRecord contiene campos `unknown`/opcionales que permiten artifacts incompatibles y no hay `schemaVersion`/migrations robustas para todos los blobs. Los `.tmp` observados demuestran que el mecanismo atómico parcial deja residuos; no son corrupción por sí mismos, pero requieren startup cleanup seguro y métricas.

La consistencia no exige meter todo en una única base inmediatamente. Puede implementarse un journal local sobre SQLite o archivos atómicos, siempre que cada mutation tenga un orden recuperable: `claim -> persist intent -> side effects -> persist result -> outbox events -> release`. El checkpointer no puede seguir con read-modify-write sin lock.

## 13. Análisis de integración y conflictos

Aspectos correctos: cherry-pick preserva commits de leaves, integración es bottom-up, conflictos abortan el cherry-pick normal y repair recibe parent goal, interfaces, intent/goal y diffs. Esto debe conservarse.

Faltantes para robustez:

- snapshot explícito del estado git antes de cada child;
- detección/recovery de `CHERRY_PICK_HEAD`, index conflictivo y repair commit existente;
- validation del árbol integrado antes de publicar success;
- no aceptar “base commit” como equivalente a integración exitosa;
- manifest final derivado de SHAs, no concatenación de diffs;
- repo lease también en delivery/manual actions;
- límites de repair passes, output y costo visibles al humano.

## 14. Análisis de UI y experiencia operativa

La UI ya ofrece command center, selección de workspace/modelo, plan, DAG, timeline, decisions, terminal, files y delivery. Para percibirse terminada necesita:

- un estado inequívoco por fase: queued/running/validating/integrating/cancelling/partial/unverified/delivered;
- evidencia inmediata por nodo, sin esperar la proyección terminal;
- warnings visibles para out-of-scope, accepted failures y validation ausente;
- error boundary del run con opción de reload/reconcile/export diagnostics; existe `loading.tsx`, pero no error boundary específica;
- reconexión SSE con “reconnecting / caught up / degraded log”;
- resultado final leído desde commit real;
- cancelación que muestre supervivientes y no confirme antes de tiempo;
- delivery que muestre repo, branch, base SHA, dirty state y estrategia antes de mutar;
- no mostrar controles sin semantics reales (`manual`, integrator hasta corregirlo, effort en executor que lo ignora);
- virtualización/paginación de logs y output.

## 15. Análisis de tests y gaps de cobertura

### Lo que sí cubren

- Schemas/contratos/task graph/scheduler.
- Git runner, worktree paths, scope, recorder, executor profiles y kill en varias plataformas.
- `RunExecutor` con git real y executor simulado.
- Rutas de decisions, lifecycle, CAS en casos específicos y reducer/selectores.
- Planning/decomposer con spawns inyectados en muchas suites.

### Gaps prioritarios

1. No hay E2E del camino productivo completo `HTTP -> planning host -> approval -> executionGraph -> persistence -> SSE -> reducer -> delivery`.
2. El test de integrator cubre `RunExecutor.run`, no `runNode` del host (CF-09).
3. No había stress test de checkpointer concurrente; el diagnóstico perdió 49/50 writes.
4. Faltan tests multiproceso del repo lock y repository persistence.
5. Faltan fault-injection tests entre commit/save/checkpoint/event y durante cherry-pick/final apply.
6. Cancelación no se prueba en planning, validation, install, git final y terminal descendants.
7. Falta test de symlink/junction escape y env secret canary.
8. Falta un browser E2E estable de refresh/SSE reconnect/pending decision/delivery.
9. `vitest.config.ts` usa `retry:1`, que puede esconder flaky races; el fallo observado se volvió verde aislado.
10. `resume-route-concurrency.test.ts` dispara background planning y en aislado lanzó Codex real; no es hermético y depende de cuota/tiempo. Los comentarios reconocen fugas previas de runs al directorio real.
11. El suite opt-in `execution-core-real-run.test.ts` depende de entorno externo; debe quedar separado de CI hermético y usarse como smoke controlado.
12. No hay performance budgets para 1000 nodos/100k eventos/repos grandes.

Recomendación: mantener unit/integration actuales, crear un harness productivo con fake deterministic **solo como test double del executor/decomposer**, no reintroducir Lab Mode ni rutas de benchmark. El test debe usar los mismos hosts, stores y events que producción.

## 16. Deuda técnica y código que debería eliminarse o simplificarse

- Migrar 13 imports de `@manyhands/core` en web a packages específicos y luego reducir/eliminar el barrel legacy.
- Decidir el destino de `packages/run-store`; el web usa otro RunRepository. No sostener dos modelos de persistencia sin consumidor claro.
- Eliminar `publishRunEvent`/SSE adapter legacy una vez migrados todos los producers.
- Consolidar registry de executors: web duplica descriptors/capabilities; usage source difiere entre package y app.
- Remover OpenCode de schemas/IDs productivos si está deshabilitado; no reintroducir Gemini. Preservar parser de runs legacy solo en una capa de migración.
- Mostrar reasoning effort solo para selections que realmente lo consumen; hoy Claude puede aparecer effort-capable aunque el profile lo ignora.
- Eliminar/generalizar skeletons hardcodeados como `NotesFrontendApp`; no mezclar fixture específica con grounding genérico.
- Partir hotspots después de estabilizar comportamiento: recursive decomposer (~1560 LOC), decomposer index (~1560), executor (~1450), execution pipeline (~1250), IntegrationAgent (~1030), scheduler/task-graph (~950), run-model types (~936).
- Corregir mojibake visible en comentarios/tests y nombres engañosos como `runMockPlanningFlow` en camino real.
- Archivar claramente specs/ADRs históricos sin reescribir historia; corregir README/docs operativas vigentes.

## 17. Mejoras de performance y escalabilidad

1. Event append O(1), cursor por byte/seq, compacted snapshots y output chunk aggregation.
2. Limitar stdout/stderr por proceso y por run; persistir tail + artifact comprimido opcional, no miles de eventos pequeños.
3. Repository index con `.gitignore`, límites de files/bytes, pool de concurrencia, fingerprint que incluya dirty state y cache incremental.
4. Conflict-risk evita materializar matriz O(n²) para graphs grandes; calcular candidatos de frontier/scopes y persistir resumen, no matriz completa en RunRecord.
5. Budgets planning/repair/execution globales; evitar llamada separada de titler o combinarla con planning.
6. Reducer incremental y UI virtualizada; no recalcular todo el historial por chunk.
7. Worktree dependency preparation cacheada por lockfile hash, manteniendo node_modules aislado.
8. Backpressure global de CLIs además de cap por run, para varios runs/repo diferentes.

### Mejoras recomendadas (no bugs autónomos)

| ID | Prioridad | Mejora | Beneficio / aceptación |
|---|---|---|---|
| IM-01 | P0 | `RunMutationService` + journal/outbox | Reduce races; ninguna transición/evento requerido fuera del protocolo. |
| IM-02 | P0 | `RunTargetContext` + base aislada | Planning/grounding/execution/delivery comparten target y la base queda intacta. |
| IM-03 | P1 | `FinalArtifactManifest` | SHA base/final, files, validations, omissions y delivery verificables. |
| IM-04 | P1 | `ProcessSupervisor` común | Cancel/timeout/ownership uniforme y métricas de survivors. |
| IM-05 | P2 | Event store incremental y compactable | Reconnect y runs largos con latencia acotada. |
| IM-06 | P2 | Registry/capabilities único de executors | Elimina options que no funcionan y drift web/package/docs. |
| IM-07 | P3 | Harness E2E productivo hermético | Prueba el sistema real sin Lab Mode ni cuota externa. |
| IM-08 | P4 | Recovery center en UI | Operador entiende reconcile, partial, unverified y entrega. |
| IM-09 | P5 | Observabilidad con operation/attempt IDs | Correlación exacta de events, process, commit y checkpoint. |
| IM-10 | P5 | Simplificar core/run-store/legacy bus | Menos superficies y menor costo de mantenimiento. |

## 18. Riesgos de seguridad y aislamiento

Los riesgos confirmados más graves son API local sin frontera explícita (CF-08), base mutation (CF-01), `node_modules` compartido (CF-27), herencia de secretos (CF-28), symlink escape (CF-40) y terminal cross-run (CF-41). Forbidden paths protegen archivos versionados, pero no secrets en env/HOME, dependencias gitignored ni side effects de red/proceso.

### Riesgos plausibles que requieren validación adicional

| ID | Severidad potencial | Evidencia disponible | Evidencia faltante / cómo verificar | Recomendación |
|---|---|---|---|---|
| RK-01 | High | Live process registry de execution-core es module-level; Next puede generar bundles/instances distintas. | Build instrumentado: registrar en una route y cancelar desde otra, comparar singleton. | Mover registry al app global singleton o supervisor durable. |
| RK-02 | High | Run/event/checkpoint locks son process-local/archivo simple. | Dos procesos Node escribiendo el mismo runs dir. | Definir single-process hard guard o storage cross-process. |
| RK-03 | High | Paths de workspace se realpath-checkean de forma desigual y pueden cambiar entre check/use. | Fault test que reemplaza dir/symlink entre validación y spawn. | Handles/fingerprints y revalidación justo antes del side effect. |
| RK-04 | High | Integration maneja conflictos normales, pero no se probó kill en cada estado de cherry-pick. | Fault injection tras apply, index conflict, abort y commit. | State journal + `git status --porcelain=v2` recovery. |
| RK-05 | High | Checkpoint/event JSON no tiene schema migration integral. | Abrir snapshots de varias versiones y mutaciones truncadas. | `schemaVersion`, migrators y quarantine explícita. |
| RK-06 | Medium | Events pueden repetirse/out-of-order; reducer usa distintos keys según tipo. | Fuzz de permutaciones/duplicados de todos los event types. | Event ID/seq y reducers idempotentes con invariant checks. |
| RK-07 | Medium | Cambios externos al checkout durante run pueden alterar branch/dirty state. | Modificar branch/ref durante execution y delivery. | Captured fingerprint + decision gate ante divergence. |
| RK-08 | Medium | Layout/UI no fue probado con miles de nodos ni strings/output extremos. | Browser benchmark 1k/5k nodes, 100k events, mobile. | Virtualización, collapsing y limits. |
| RK-09 | Medium | Respuesta LLM puede ser schema-valid pero semánticamente pobre/hostil. | Corpus adversarial de plans reales y repo prompt injection. | Validators, critics independientes, budgets y approval evidence. |
| RK-10 | Medium | Cleanup de branches preservadas puede dejar commits dangling o acumular refs indefinidamente. | Ejecutar muchos runs, GC/restart, inspeccionar refs/objects. | Retention policy y artifact export antes de borrar refs. |

Ningún fix debe prometer sandbox fuerte si el agente conserva shell, red y credenciales de usuario. El producto debe declarar su threat model: software local para repos confiables, con aislamiento de cambios git y reducción de secretos, no contenedor de código hostil. Si se pretende repos no confiables, se requiere un boundary adicional (VM/container/usuario OS), decisión de producto futura.

## 19. Backlog priorizado de implementación

Las tareas están ordenadas; no iniciar fases posteriores para “hacer visible progreso” si los invariants de la fase anterior siguen rojos. El agente implementador debe comenzar cada tarea con un test de regresión/fault injection, mantener diffs quirúrgicos y no mezclar limpieza no relacionada.

### Phase 0 — Bloqueantes y seguridad del estado

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-001 / P0 | Aislar base y grounding (CF-01) | provisioner, execution pipeline/state, grounding, final apply, run schema | Persistir source target/SHA; crear base worktree/branch de run; grounding solo allí; cleanup/abort idempotente | Ninguna; habilita casi todo | Dirty checkout, cancel/crash grounding, final diff | Checkout origen no cambia antes de delivery | Alto: paths/refs de runs existentes |
| B-002 / P0 | Checkpoint sin pérdida (CF-02) | JSON checkpointer + graph tests | Lock por key, temp+fsync+rename, writes idempotentes; decidir migración o SQLite | Ninguna | 1000 concurrent writes, multiproceso, kill/reopen | 100% writes y JSON íntegro | Alto: compatibilidad LangGraph/checkpoints |
| B-003 / P0 | Mutation/lease protocol (CF-03) | store, lifecycle, runner, watchdog, pipelines, event log | CAS obligatorio, operation lease/fencing, mutaciones parciales; evento requerido por outbox | Diseño de schema version | Race matrix determinista | Cancel/terminal nunca resucitan | Muy alto: transversal |
| B-004 / P0 | Repo lock atómico (CF-04) | repo-lock, runner, delivery/manual routes | Token/generation, atomic acquire/takeover/release, heartbeat; verificar common git dir | B-003 para fencing | Stress 20 procesos, stale/release tardío | Un solo owner válido | Alto: Windows FS |
| B-005 / P0 | Cancelación realmente terminal (CF-06) | supervisor/executor, decomposers, validation, installer, git, terminal, cancel | Unificar spawn/signal/owner/tree kill; `cancelling` hasta verified; fence outputs | B-003 | Cancel por fase e hijos/nietos | `allDead=true`, cero commits/events posteriores | Alto: procesos cross-platform |
| B-006 / P0 | Cerrar API local (CF-08/28/40/41) | launcher/middleware/API helpers, terminal/file APIs | Loopback default, Host/Origin + session token; realpath containment; env allowlist; terminal ownership | Threat model decidido | CSRF/Host/symlink/canary/cross-run | Shell/files solo para cliente autorizado | Alto: UX dev y CLI auth |
| B-007 / P0 | Impedir delete activo (CF-05) | run route, lifecycle, cleanup, UI | Archive semántico; purge terminal journaled; active => cancel primero | B-003/B-005 | Todos los statuses, crash purge | Sin metadata borrada con process activo | Medio |

### Phase 1 — Corrección del flujo principal

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-008 / P0 | Target único e inmutable (CF-19) | create schema/route, workspace, planning/execution hosts | `RunTargetContext` con realpath/branch/SHA/fingerprint; eliminar doble resolver | B-001 | Workspace edit/override/fixture-local | Todas las fases usan mismo fingerprint | Alto: runs legacy |
| B-009 / P0 | Semántica de integrator + DAG estricto (CF-09/12/13) | task-graph, RunExecutor, execution graph/host, integrator service | Elegir integrator atómico o retirarlo; invariants root/depth/sync; normalizer legacy | B-008 | Product-host E2E, invalid graph corpus | No graph inválido despacha; integrator funciona una vez | Alto: snapshots/fixtures |
| B-010 / P0 | Aplicar config efectiva antes de scheduling (CF-10/36) | config defaults, execution host, scheduler, events/reducer | Normalizar/persistir defaults; waveId durable | B-003 | >6 frontier, overrides, resume waves | Concurrency cap exacto e historia intacta | Medio |
| B-011 / P0 | Resultado de nodo honesto (CF-11/31) | recorder, scope checker/policy, events/UI | All expected outputs o validation evidence; `already_satisfied`; policy advisory/gate/strict | B-009 | No-op matrix, out-of-scope policies | Ningún falso success; warnings/gates visibles | Alto: tareas greenfield |
| B-012 / P0 | Artifact y terminal disposition explícitos (CF-07/26/30) | run schema/lifecycle, integration settle, final apply, presenter | `FinalArtifactManifest`; separar execution/artifact/delivery; partial/unverified states | B-001/B-003 | Apply fail/empty/partial/repair | Completed siempre tiene final SHA válido | Alto: UI/status filters |
| B-013 / P1 | Eventos nativos en el punto de verdad (CF-37/38) | execution host, trace adapter, manual pipeline, run-model types | Emitir start/result/validation/integration durables; retirar inferencias | B-003 | Exit0+testfail, manual run+refresh | UI nunca infiere tests ni pierde manual run | Medio |
| B-014 / P1 | Aprobación revisionada y edits CAS (CF-14/15/16/18) | patches/editing, approval service, chat/UI, run schema | Scope canónico; planRevision; expectedVersion; override critic explícito | B-003/B-009 | concurrent edit, edit-after-approve | Cada graph revision tiene approval inequívoco | Alto: UX plan |

### Phase 2 — Recuperación, concurrencia e idempotencia

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-015 / P0 | Journal de task attempts (CF-21) | execution host/state, RunRecord schema, recorder/checkpoint | attempt ID/base/prompt hash/commit; adopt/discard antes de execute | B-002/B-003 | Fault cada frontera | Crash no duplica llamada/commit válido | Alto |
| B-016 / P0 | Reconciliation closure y root recreation (CF-22/23) | execution-state, world reconciler, WorktreeManager | Helper único de invalidación; descriptors; recreate worktree desde SHA | B-015 | chain/diamond/GC+resume | No resultado depende de evidencia faltante | Alto |
| B-017 / P0 | Replan/amendment transaccional (CF-24/25) | replan service, decision route, checkpoint reset, runner | Claim lease; prepare new graph; CAS; outbox; reset idempotente; target captured | B-003/B-008/B-009 | cancel/race/crash en cada paso | Evento, graph y checkpoint siempre concuerdan | Alto |
| B-018 / P1 | Event log durable y recuperable (CF-33/34) | run-model event log, RunRepository/outbox, startup recovery | Serialized append + seq/checksum; trailing repair; reconciliation general | B-003 | Truncation/duplicate/missing/restart | Prefijo válido visible y cola reparable | Alto |
| B-019 / P1 | Todas las acciones git bajo repo lease (CF-29) | delivery, node run/review, cleanup, workspace bootstrap | Adquirir mismo lease/fence o rechazar; no side paths | B-004 | dos runs + manual/delivery | Una sola mutación git por common dir | Medio |
| B-020 / P1 | Cleanup/retention idempotente (CF-32/RK-10) | WorktreeManager, cleanup, startup sweeper | Journal de artifacts, prune después de rm, verify refs; retention configurable | B-004/B-016 | locked cwd, retry, preserved refs | Segundo cleanup converge sin leaks | Medio |

### Phase 3 — Integración, conflictos y validación

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-021 / P0 | Cherry-pick/repair crash-safe (RK-04) | IntegrationAgent, GitRunner, integration state/events | Operation states por child; inspeccionar/abort/adopt git state; commit evidence | B-003/B-015 | Kill tras cada git step | Resume converge al mismo final SHA | Muy alto |
| B-022 / P0 | Delivery segura y explícita (CF-29) | delivery route/service/UI | Confirm target branch/base/dirty; repo lease; merge/patch/export con receipt | B-004/B-012/B-021 | branch changed, dirty, conflict | No muta branch no confirmada; receipt exacto | Alto |
| B-023 / P1 | Dependencias aisladas (CF-27) | WorktreeManager, installer, preflight | node_modules por worktree, cache por lockfile/store compartido no escribible | B-001/B-005 | concurrent install/hash isolation | Ningún worktree muta deps de otro/base | Alto: performance |
| B-024 / P1 | Validation/costo/output supervisados | validation runner, executor process, installer, schemas | signal/owner, max bytes, tails/artifact, budgets y `unverified` explícito | B-005/B-012 | huge output, no commands, timeout | Memoria/eventos acotados y disposition correcta | Medio |

### Phase 4 — UI y experiencia operativa

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-025 / P1 | Estados y recovery center | run-model reducer/selectors, run page, error boundary | Render cancelling/partial/unverified/degraded/reconcile; acciones permitidas desde lifecycle | B-012/B-018 | Story/browser por estado y refresh | Ningún estado queda sin explicación/acción segura | Medio |
| B-026 / P1 | Final viewer basado en commit | workspace file/tree/terminal, result UI | Read-only final worktree o git object API; manifest como única entrada | B-012 | repair/overwrite/deleted files | UI coincide byte a byte con final SHA | Medio |
| B-027 / P1 | SSE incremental/reconnect | run-events route, log reader, client hook/reducer | Cursor seq/offset, batches/backpressure, connection state, dedup | B-018 | disconnect/gap/100k events | Reconnect sin full replay ni pérdida | Alto |
| B-028 / P2 | Ocultar o completar controles fachada | manual/integrator/effort/model UI | Capability-driven controls; manual workflow real o retirar; critic override claro | B-009/B-014 | UI contract tests | Toda opción visible cambia conducta real | Bajo |

### Phase 5 — Performance, observabilidad y limpieza

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-029 / P1 | Budgets de planning/repo index (CF-20) | decomposer, planning host, repository-index/cache | Limits globales; pool; gitignore; dirty fingerprint; read-only planning | B-008 | adversarial tree/large repo/cancel | Costo/tiempo/nodos nunca exceden config | Medio |
| B-030 / P2 | Escalar events/risk/UI (CF-35/RK-08) | event store, conflict-risk/scheduler, reducer/DAG | Benchmark first; compact/log tail; frontier risk; virtualización | B-027 | 1k nodes/100k events | Budgets de latencia/memoria documentados y verdes | Medio |
| B-031 / P2 | Registry único y limpieza legacy | execution-core registry, web models/policy, core/run-store/event bus | Fuente canónica; adapters legacy solo en migrator; eliminar código sin consumidores | B-013/B-028 | schema migration + import graph | Solo Claude/Codex activos; no packages->apps | Medio |
| B-032 / P2 | Telemetría y retención operativa | structured logging, manifests, cleanup metrics | operation/attempt/event/commit IDs; tails; disk/branch retention; diagnostics export | B-015/B-018 | correlation tests, disk quota | Un run se diagnostica sin leer archivos a mano | Bajo |
| B-033 / P2 | Documentación reproducible (CF-42) | README, apps/web README, system docs, scripts | Actualizar comandos, threat model, recovery/delivery; históricos marcados | B-031 | doc link/check scripts | Clone limpio sigue docs y usa Claude/Codex | Bajo |

### Phase 6 — Verificación final y hardening

| ID / prioridad | Objetivo y problema | Archivos involucrados | Estrategia de implementación | Dependencias | Tests requeridos | Criterio de aceptación | Riesgo de regresión |
|---|---|---|---|---|---|---|---|
| B-034 / P0 release | Harness E2E productivo | tests + app test seams, sin rutas Lab | Mismos routes/hosts/stores/SSE; fake executor/decomposer inyectados; git real | Phases 0–4 | happy, conflict/gate, cancel, crash/resume, delivery | Todos los critical flows herméticos en CI | Medio |
| B-035 / P0 release | Gates CI verdes (CF-42) | package scripts, CI, lint/type errors | Alinear pnpm; hard lint/typecheck/test/web build; quitar retry global al estabilizar | B-034 | Windows/Linux clean install | `pnpm verify` verde en ambos OS | Medio |
| B-036 / P1 release | Smoke real controlado | script/docs de smoke, fixture temporal genérica | Run Claude default y Codex alternativo desde UI; registrar receipt; no benchmark suite | B-035 | checklist manual + artifact | Dos runs reales terminan, se cancelan y entregan de forma trazable | Costo/cuota externa |

## 20. Roadmap recomendado por fases

```text
Phase 0  Estado y aislamiento
   -> Phase 1  Happy path honesto
      -> Phase 2  Crash/restart/concurrencia
         -> Phase 3  Integración y delivery
            -> Phase 4  Operación/UI
               -> Phase 5  Escala y simplificación
                  -> Phase 6  Release/hardening
```

### Hitos de salida

- **Salida Phase 0:** cancelar es real, el checkout base no se toca, checkpoint no pierde writes y un repo tiene un solo owner.
- **Salida Phase 1:** un run simple con leaves/integrator produce un artifact final verdadero, con cap de concurrencia y approval revisionado.
- **Salida Phase 2:** kill/restart en cualquier frontera converge sin duplicar, perder o resucitar trabajo.
- **Salida Phase 3:** conflicto, repair, partial y delivery tienen dispositions y receipts honestos.
- **Salida Phase 4:** el operador puede comprender y recuperar todos los estados desde UI/refresh/SSE.
- **Salida Phase 5:** repos/runs grandes tienen budgets; se eliminan sources of truth y opciones legacy.
- **Salida Phase 6:** checks herméticos verdes más smoke real documentado.

No se recomienda paralelizar B-001/B-002/B-003 entre agentes que editen los mismos pipelines/schemas. Sí pueden avanzar en paralelo, una vez fijados contracts: seguridad API (B-006), DAG/integrator (B-009) y CI/docs (parte de B-035/B-033).

## 21. Plan de verificación posterior a la implementación

### Pirámide de verificación

1. **Unit:** validators, lifecycle transitions, lock tokens, event reducers, scope y artifact manifest.
2. **Integration in-process:** stores/checkpointer/event outbox, executor simulado, git real temporal.
3. **Integration multiproceso:** repo lock, concurrent writers, process kill y restart.
4. **Product E2E hermético:** routes + background runner + LangGraph + SSE + UI model + delivery.
5. **Browser E2E:** happy path, approval, conflict decision, cancel, reconnect, reload, partial y error recovery.
6. **Smoke real:** Claude Code y Codex contra repo temporal, iniciado desde UI, con cuota controlada.

### Fault injection mínimo

Insertar barreras/kill hooks después de: claim lease, create worktree, executor exit, diff, orchestrator commit, RunRecord save, checkpoint write, event append, cada cherry-pick, repair commit, run validation, final manifest y delivery apply. Tras restart, verificar invariants y final SHA, no solo status.

### Matriz de plataformas

- Windows 11: junctions, cmd shims, taskkill, file locks, long paths.
- Ubuntu CI: process groups/signals, symlinks y filesystem semantics.
- Node 22 + una única versión pnpm declarada.

### Métricas de aceptación de performance

Definir números tras baseline, pero como mínimo medir: planning max calls/nodes/duration, max CLIs activos, event append p95, reconnect catch-up, RSS del server, disk por run, cleanup convergence, index time/bytes y UI interaction p95 para 1k nodes/100k events.

## 22. Criterios para considerar el producto terminado

ManyHands está terminado para entrega cuando, simultáneamente:

1. Todos los P0 de Phases 0–3 están cerrados con regressions.
2. El checkout origen permanece idéntico hasta una delivery confirmada.
3. Cancel garantiza process tree muerto y no hay side effects posteriores.
4. Crash/restart en la matriz de fault injection no pierde ni duplica evidencia.
5. Dos runs sobre el mismo repo nunca mutan git en paralelo.
6. `completed` siempre referencia `FinalArtifactManifest` y commit/patch verificables.
7. Partial, accepted risk, unverified y failed delivery nunca se presentan como success pleno.
8. Conflictos llegan a repair o gate humano y pueden resumirse después de restart.
9. UI se reconstruye exclusivamente desde el event log canónico y reconcilia gaps.
10. Scopes, forbidden paths y controles editados son los realmente usados en runtime.
11. No se filtran secrets no requeridos ni se permite file/terminal cross-root/run.
12. Planning y execution respetan budgets y `maxParallel` efectivo.
13. `pnpm verify` pasa en Windows/Linux desde clone limpio.
14. El E2E productivo cubre happy, failure, cancel, restart, conflict y delivery.
15. Un smoke real con Claude Code y otro con Codex producen receipts reproducibles.
16. README y operación describen el producto actual, sin Gemini/Lab Mode como mecanismos activos.

## 23. Apéndice de archivos, símbolos y evidencias

### Archivos/símbolos centrales revisados

| Área | Evidencia principal |
|---|---|
| Domain/DAG | `packages/task-graph/src/index.ts` — schemas, `validateTaskGraph`, `validateExecutableTaskGraph`, topo/readiness/graft |
| Contracts | `packages/contracts/src/index.ts` — task/interface/scope/validation command boundaries |
| Decomposition | `packages/decomposer/src/llm/recursive/*`, scope y step schemas/prompts |
| Scheduling | `packages/scheduler/src/*`, conflict-risk y repository-index |
| Executor | `packages/execution-core/src/run/executor.ts`, executor profiles/process/kill/registry |
| Git/worktrees | git runner, `worktree/manager.ts`, ResultRecorder, ScopeChecker |
| Integration | `integration/agent.ts`, repair/syntax/validation paths |
| Graph control plane | planning/execution graphs, nodes y JSON checkpointer en orchestrator-graph |
| Lifecycle/store | web `store.ts`, `lifecycle.ts`, runner-state, watchdog, planning/execution pipelines |
| Recovery | `execution-state.ts`, replan/amendment/decision services, checkpoint reset |
| Events/client | `run-model-event-log.ts`, projection/adapters, `apps/web/src/lib/run-model/*`, SSE route |
| API | 38 route handlers bajo `apps/web/src/app/api`, especialmente run actions, files, terminal, delivery y workspaces |
| UI | command center, model picker, `runs/[runId]`, graph, thread, decisions, result/delivery/files/terminal |
| Tests/config | 147 root tests, orchestrator graph tests, Vitest/TypeScript/ESLint/package scripts/CI |
| Docs | `AGENTS.md`, `CLAUDE.md`, `docs/DECISIONS.md`, `docs/system`, `docs/design`, ADRs y READMEs |

### Evidencias cuantitativas reproducibles

```text
pnpm test                 -> 1 file/test failed en suite completa; aislado pasó usando Codex real
pnpm typecheck            -> 3 errores
package typechecks        -> 12/12 pasan
pnpm web:typecheck        -> pasa
pnpm lint                 -> 78 errores
pnpm web:lint             -> 1 error
pnpm build                -> pasa packages
pnpm web:build            -> falla por lint
checkpoint stress (50)    -> actual=1
invalid root DAG probe    -> []
canonical dep drift probe -> sin dependency_sync_divergence
```

### Zonas no verificadas completamente

1. **Run real completo con Claude/Codex:** no ejecutado por costo/cuota y por el riesgo confirmado de mutar el checkout base. Requiere repo temporal tras B-001.
2. **Comportamiento de dos procesos Next/bundles:** el análisis confirma locks locales, pero RK-01/RK-02 requieren build instrumentado/multiproceso.
3. **Crash real en cada estado de cherry-pick:** IntegrationAgent fue inspeccionado y cubre conflictos normales; falta fault injection RK-04.
4. **Carga extrema de browser/UI:** se verificó el patrón algorítmico y artifacts grandes locales, no un benchmark 1k/5k nodes en browser.
5. **Threat model de red deseado:** el código no impone local-only; decidir si LAN/remoto será soportado cambia auth, no el diagnóstico del default inseguro.
6. **Compatibilidad de snapshots muy antiguos:** no se inventaron migraciones; hace falta un corpus real de runs que el producto decida conservar.

### Reglas para el agente implementador

- No reintroducir Gemini CLI, Lab Mode, benchmark routes ni deterministic product fallback.
- Mantener D1–D10 y discutir cualquier cambio de invariant antes de implementarlo.
- TDD estricto en bloqueantes: primero reproducción roja, luego fix mínimo, luego checks amplios.
- No usar stdout para cambios; `git diff HEAD` sigue siendo la verdad.
- No permitir commits de agentes; el orquestador conserva responsabilidad.
- No llamar “completed” a un resultado que no tenga artifact final verificable.
- No cerrar un finding solo porque el unit test pasa: ejecutar su escenario de aceptación en la capa productiva indicada.
