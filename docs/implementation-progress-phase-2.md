# ManyHands — Phase 2 progress

## Baseline and scope

- Baseline checkpoint branch: `checkpoint/phase-0-1-stable-2`.
- Baseline commit: `f346f0f9e18fd293503dce426852c7be8a8eb855` (`stabilize phase 0 and phase 1 baseline`).
- B-015 branch: `phase-2/b-015-task-attempt-journal`, created exactly from that SHA.
- B-016 and later work are deliberately out of scope.

## B-015 — Task Attempt Journal

- **Estado:** completada para Phase 2 checkpoint; el journal durable, CAS/fencing, state machine y wiring de scheduled/manual/integrator/repair están implementados. B-016 queda explícitamente fuera de alcance.
- **Causa raíz confirmada:** la identidad de ejecución de nodo sólo existía implícitamente en el worktree, el proceso en memoria y los arrays `leafResults`/`integrationResults`. RunExecutor capturaba diff, scope, validation y commit, pero no había una entidad durable entre esas fronteras. Un crash podía dejar un commit o proceso real sin una referencia recuperable, y resume podía volver a invocar el executor.
- **Diseño aplicado:** `JsonTaskAttemptJournal` persiste un archivo por run bajo `runs/attempts/<runId>.json`; es la fuente canónica de estado del attempt y usa escritura atómica, lock filesystem y CAS por versión. El RunRecord conserva sólo resultados compactos y el event log canónico recibe evidencia correlacionada.
- **Schema:** `TaskAttempt` version 1 contiene `attemptId`, run/node/operation, fencing, wave opcional, kind (`scheduled|manual|integrator|repair`), base commit, worktree/target, hashes de contrato/prompt/config, executor/model, timestamps, estado, process metadata, executor result, diff identity, scope/validation references, commit SHA, disposition, adoption/discard reason y error estructurado.
- **State machine:** `prepared → invocation_reserved → executor_running → executor_finished → diff_captured → scope_evaluated → validation_finished → commit_created → result_persisted`; recovery puede marcar `recovery_required`, desde donde sólo una adopción o descarte explícitos avanzan. `failed`, `cancelled` y `discarded` son terminales. No se permiten transiciones hacia atrás.
- **Idempotencia:** `reserve` acepta una idempotency key estable por run/node/kind/base/generation; reservas concurrentes devuelven el mismo attempt. CAS exige `expectedVersion`. El fencing exige operación y token coincidentes; `claimRecovery` sólo acepta un token mayor para transferir un attempt ambiguo a la operación actual.
- **Recovery:** antes de invocar executor, el host inspecciona attempts previos. Un resultado persistido se reutiliza si el NodeResult correspondiente existe; un attempt activo o ambiguo se convierte en `recovery_required` y no dispara una segunda llamada silenciosa. La adopción exige commit SHA válido y permite un verificador Git inyectado; el descarte registra razón y evidencia.
- **Integración:** execution host journaliza scheduled, integrator atómico y repair; manual node execution usa el mismo store. `attemptId` se propaga a AgentExecutionResult/IntegrationResult, RunExecutor, CLI executor y ProcessSupervisor metadata. Cancel service marca attempts en vuelo como `cancelled` con el lease anterior antes de kill/allDead.
- **Eventos:** se agregaron eventos canónicos `task.attempt.*` para cada frontera durable, con `attemptId`, `nodeId`, operation/fencing y disposition/commit cuando corresponde. Validation sigue siendo un hecho separado del exit code.
- **Archivos modificados:** `apps/web/src/lib/server/runs/task-attempt-journal.ts`, `execution-host.ts`, `execution-pipeline.ts`, `cancel-service.ts`, `run-model/types.ts`; `packages/execution-core/src/types.ts`, `run/executor.ts`, `integration/agent.ts`, `executor/{process,cli-executor,live-process-registry}.ts`; tests `tests/task-attempt-journal.test.ts` y consumidores afectados.
- **Regresión roja observada:** el test inicial falló porque `@/lib/server/runs/task-attempt-journal` no existía. La primera implementación roja adicional detectó que `recovery_required → adopted` estaba bloqueado; se corrigió permitiendo únicamente adopción/descarte explícitos desde ese estado.
- **Tests actuales:** schema/persistencia, monotonicidad, idempotencia, stale CAS, stale fencing, filesystem serialization, recovery takeover y adoption verification pasan: `task-attempt-journal` 4/4. Suites de execution-core, runner provisioning, runner, ProcessSupervisor y cancelación pasan en la corrida dirigida disponible.
- **Fault injection:** las pruebas del journal cubren excepciones/reanudación por frontera de estado, CAS concurrente, dos recoverers, discard idempotente y adoption verification. La garantía no pretende simular un executor externo real ni afirmar exactly-once donde el side effect no es verificable.
- **Garantías reales:** idempotencia de reserva/adopción y at-most-once invocation cuando existe evidencia ambigua. No se afirma exactly-once para un executor externo; si no puede verificarse el side effect, el estado queda `recovery_required`.
- **Trabajo diferido:** B-016 reconciliation closure, recovery center, B-018 event store incremental/outbox, B-021 crash-safe cherry-pick/repair, B-022 delivery segura y tareas posteriores.
