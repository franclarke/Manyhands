# Estrategias de diseño e implementación

> Esta guía describe los problemas que el sistema debe controlar durante un run,
> la estrategia elegida para cada uno, su mecanismo concreto y la evidencia que
> permite comprobarlo. No es una lista de cambios entre versiones: es una lectura
> de la implementación actual desde sus decisiones de ingeniería.

Cada sección separa cuatro niveles: el riesgo, la estrategia, el mecanismo de
código y la garantía observable. Un enlace a código prueba que el mecanismo
existe; un test prueba un comportamiento acotado; ninguno sustituye por sí solo
la observación de un run productivo completo.

## 1. Una sola fuente de verdad para el estado del run

### Problema

Un run atraviesa HTTP, procesos, Git, persistencia y UI. Si cada capa conserva su
propio lifecycle, replay y recovery pueden producir respuestas incompatibles.

### Estrategia

Se eligió event sourcing acotado al dominio del run:

- `RunCoordinator` convierte comandos en hechos y pliega la historia antes de
  aceptar una transición.
- `JsonlRunEventStore` persiste envelopes versionados, checksums y secuencia CAS.
- `RunSnapshotStore` es una cache descartable reconstruida desde el journal.
- el `RunRecord` web conserva metadata/listado y una proyección compatible, pero
  no gobierna el lifecycle.

### Evidencia

- Código: [`coordinator.ts`](../../packages/run-coordinator/src/coordinator.ts),
  [`reducer.ts`](../../packages/run-coordinator/src/reducer.ts),
  [`jsonl-event-store.ts`](../../packages/run-store/src/jsonl-event-store.ts) y
  [`snapshot-store.ts`](../../packages/run-store/src/snapshot-store.ts).
- Tests: [`run-store-event-source.test.ts`](../../tests/run-store-event-source.test.ts)
  demuestra CAS, idempotencia, recuperación de trailing records y rechazo de
  corrupción intermedia; [`run-store-snapshot-rebuild.test.ts`](../../tests/run-store-snapshot-rebuild.test.ts)
  demuestra reconstrucción desde hechos.

La garantía no es “JSON nunca falla”, sino “una cache rota no puede reemplazar
la historia canónica y una historia corrupta falla cerrado”.

## 2. Separar comprensión semántica de compilación ejecutable

### Problema

Pedirle a un único paso probabilístico que comprenda el objetivo y además fije
IDs, relaciones, scopes y obligaciones hace difícil validar la propuesta y
facilita detalles que el repositorio no justifica.

### Estrategia

Se separaron tres responsabilidades:

1. `WorkBreakdownPlanner` describe unidades cohesivas, outputs, seams,
   incertidumbres y preguntas.
2. `compileGraphRevision` convierte esa propuesta en IDs, relaciones tipadas y
   contract bundles.
3. los critics revisan completitud, atomicidad, scope, compatibilidad, riesgo y
   cobertura antes de solicitar aprobación.

Zod rechaza en la salida semántica campos que pertenecen al compiler, y el
compiler es determinista respecto del breakdown y snapshot recibidos.

### Evidencia

- Código: [`planner/schema.ts`](../../packages/decomposer/src/planner/schema.ts),
  [`planner/work-breakdown.ts`](../../packages/decomposer/src/planner/work-breakdown.ts),
  [`compiler/graph-compiler.ts`](../../packages/decomposer/src/compiler/graph-compiler.ts)
  y [`critics/review.ts`](../../packages/decomposer/src/critics/review.ts).
- Tests: [`decomposer-work-breakdown.test.ts`](../../tests/decomposer-work-breakdown.test.ts),
  [`graph-compiler.test.ts`](../../tests/graph-compiler.test.ts) y
  [`graph-critics-v2.test.ts`](../../tests/graph-critics-v2.test.ts).

## 3. Planificar proyectos greenfield sin inventar evidencia

### Problema

Un proyecto greenfield necesita declarar outputs que todavía no existen, pero no
debe presentar esos paths futuros como archivos ya observados en el repositorio.

### Estrategia

El modelo separa `evidenceIds` de `plannedPaths`:

- evidence prueba algo que ya existe en el snapshot;
- planned paths declaran outputs futuros concretos;
- compiler, scopes, artifacts y critics consumen esa distinción sin presentar
  un planned path como evidencia observada.

### Evidencia

- Código: [`planner/schema.ts`](../../packages/decomposer/src/planner/schema.ts),
  [`planner/prompt.ts`](../../packages/decomposer/src/planner/prompt.ts) y
  [`compiler/contract-compiler.ts`](../../packages/decomposer/src/compiler/contract-compiler.ts).
- Regresión: [`decomposer-work-breakdown.test.ts`](../../tests/decomposer-work-breakdown.test.ts)
  cubre paths planificados y el rechazo de contradicciones.
- Smoke observado: [`v2-productive-run-audit-2026-07-18.md`](../audits/v2-productive-run-audit-2026-07-18.md)
  registra un run greenfield que llegó a `needs_approval` con scopes concretos.

## 4. Relaciones del grafo con un único significado

### Problema

Jerarquía, disponibilidad material, compatibilidad y riesgo afectan partes
distintas del sistema. Representarlas con una arista genérica haría que su
significado dependiera del consumidor.

### Estrategia

Se normalizó el grafo en cuatro conceptos:

- `parentId`: ownership de integración;
- `ArtifactRequirement`: disponibilidad material y readiness;
- `SeamBinding`: compatibilidad contractual sin orden obligatorio;
- `ConflictConstraint`: riesgo o exclusión para scheduling.

Las revisiones se clonan, validan y avanzan con optimistic revision matching.

### Evidencia

- Código: [`graph-revision.ts`](../../packages/task-graph/src/graph-revision.ts),
  [`relations.ts`](../../packages/task-graph/src/relations.ts) y
  [`validate-v2.ts`](../../packages/task-graph/src/validate-v2.ts).
- Tests: [`task-graph-v2.test.ts`](../../tests/task-graph-v2.test.ts),
  [`scheduler-readiness-v2.test.ts`](../../tests/scheduler-readiness-v2.test.ts)
  y [`conflict-constraint-evidence.test.ts`](../../tests/conflict-constraint-evidence.test.ts).

## 5. Freshness antes de adoptar un resultado

### Problema

Que un attempt termine o pase tests no demuestra que siga siendo adoptable si
cambió un contrato del nodo, el base commit o un artifact consumido (no la
revisión global del grafo por sí sola).

### Estrategia

Cada attempt recibe un `InputFingerprint` canónico que incluye todas las
entradas que afectan su significado. La adopción es una única puerta:

1. el attempt debe estar terminado y tener output digest;
2. su fingerprint debe coincidir con el vigente;
3. solo entonces se escribe el artifact inmutable y `artifact.adopted`.

Una enmienda calcula qué fingerprints quedan inválidos; no marca todo el run
stale por aproximación.

### Evidencia

- Código: [`fingerprint.ts`](../../packages/run-coordinator/src/domain/fingerprint.ts),
  [`attempts.ts`](../../packages/run-coordinator/src/domain/attempts.ts) y
  [`amendments.ts`](../../packages/run-coordinator/src/amendments.ts).
- Tests: [`input-fingerprint.test.ts`](../../tests/input-fingerprint.test.ts),
  [`attempt-adoption.test.ts`](../../tests/attempt-adoption.test.ts) y
  [`amendment-fingerprint-invalidation.test.ts`](../../tests/amendment-fingerprint-invalidation.test.ts).

## 6. Aislamiento y alcance verificable para cada agente

### Problema

Cada agente debe recibir solo los inputs declarados y sus cambios deben poder
atribuirse sin ambigüedad. Compartir contexto o aplicar commits upstream a
ciegas rompería esa propiedad.

### Estrategia

`ExecutionBaseBuilder` materializa el base commit, baseline contractual y solo
los artifacts requeridos. `NodeExecutor` corre en un worktree aislado; después
el orquestador inspecciona `git diff`, aplica deny-wins de scope y crea el commit
candidato. El stdout no decide qué cambió.

### Evidencia

- Código: [`execution-base-builder.ts`](../../packages/execution-core/src/base/execution-base-builder.ts),
  [`node-executor.ts`](../../packages/execution-core/src/v2/node-executor.ts),
  [`checker.ts`](../../packages/execution-core/src/scope/checker.ts) y
  [`manager.ts`](../../packages/execution-core/src/worktree/manager.ts).
- Tests: [`execution-base-builder.test.ts`](../../tests/execution-base-builder.test.ts),
  [`worktree-dependency-isolation.test.ts`](../../tests/worktree-dependency-isolation.test.ts),
  [`execution-core-scope.test.ts`](../../tests/execution-core-scope.test.ts) y
  [`execution-core-worktree.test.ts`](../../tests/execution-core-worktree.test.ts).

## 7. Decisiones humanas locales sin perder paralelismo

### Problema

Una aclaración local no debe detener siblings que ya tienen inputs suficientes
para continuar.

### Estrategia

Cada `Decision` declara `affectedNodeIds`. Readiness bloquea esos nodos, no sus
siblings. El lifecycle cambia a `waiting_for_input` únicamente cuando ya no hay
otro trabajo ready. Resolver una aclaración de planning inicia un replan con la
respuesta como requisito autoritativo.

### Evidencia

- Código: [`decisions.ts`](../../packages/run-coordinator/src/domain/decisions.ts),
  [`execution.ts`](../../packages/run-coordinator/src/execution.ts),
  [`scheduler/src/index.ts`](../../packages/scheduler/src/index.ts) y la
  [ruta de decisiones](../../apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts).
- Tests: [`local-decision-readiness.test.ts`](../../tests/local-decision-readiness.test.ts),
  [`run-v2-decision-control.test.ts`](../../tests/run-v2-decision-control.test.ts)
  y [`run-model-v2-reducer.test.ts`](../../tests/run-model-v2-reducer.test.ts).

## 8. Recuperación elegida por causa, no por contador

### Problema

Timeout, credenciales, tests rotos, scope inválido y conflicto de integración no
se resuelven repitiendo la misma acción.

### Estrategia

El sistema clasifica primero la causa y después selecciona una política:
transient retry, reparación local, suspensión de recurso, enmienda, descarte o
decisión humana. Los attempts permanecen inmutables y cada retry referencia a
su predecessor.

En planning, un stream que cierra sin resultado terminal exitoso genera
`NonRetryablePlanningError`: cambiar de intento no arreglaría un protocolo roto.

### Evidencia

- Código: [`failures.ts`](../../packages/run-coordinator/src/domain/failures.ts),
  [`recovery-policy.ts`](../../packages/run-coordinator/src/recovery-policy.ts),
  [`work-breakdown.ts`](../../packages/decomposer/src/planner/work-breakdown.ts)
  y [`run-coordinator-host.ts`](../../apps/web/src/lib/server/runs/v2/run-coordinator-host.ts).
- Tests: [`failure-recovery-policy.test.ts`](../../tests/failure-recovery-policy.test.ts),
  [`planning-cli-stream.test.ts`](../../tests/planning-cli-stream.test.ts) y
  [`execution-core-executor-failure.test.ts`](../../tests/execution-core-executor-failure.test.ts).

## 9. Evidencia explícita para cada criterio

### Problema

Un comando verde puede no cubrir el criterio solicitado, ejecutarse sobre otro
commit, ser flaky o pasar porque se debilitaron tests.

### Estrategia

`ValidationContract` congela obligaciones. Una recipe se compila según las
capabilities observadas y se ejecuta sobre el candidato exacto en limpio. La
`EvidenceMatrix` relaciona criterion, obligation, status, justificación y refs.
`uncovered` y `flaky` no se promueven a verified.

### Evidencia

- Código: [`validation-contract.ts`](../../packages/contracts/src/validation-contract.ts),
  [`recipe-compiler.ts`](../../packages/execution-core/src/validation/recipe-compiler.ts),
  [`evidence-matrix.ts`](../../packages/execution-core/src/validation/evidence-matrix.ts)
  y [`exact-candidate-validator.ts`](../../packages/execution-core/src/v2/exact-candidate-validator.ts).
- Tests: [`validation-recipe.test.ts`](../../tests/validation-recipe.test.ts),
  [`evidence-matrix.test.ts`](../../tests/evidence-matrix.test.ts) y
  [`exact-candidate-validation.test.ts`](../../tests/exact-candidate-validation.test.ts).

## 10. Integración explícita, incluso cuando Git no reporta conflictos

### Problema

Un cherry-pick sin conflicto textual no demuestra compatibilidad semántica. Una
integración también podría omitir un hijo si no declara sus inputs.

### Estrategia

Cada composite construye un `IntegrationManifest` con base, artifacts requeridos
y aplicados, candidate commit y evidencia. Se valida el contrato del padre. Hay
una reparación semántica acotada; si no converge, se eleva una decisión y no se
publica “éxito parcial”.

### Evidencia

- Código: [`integration/manifest.ts`](../../packages/execution-core/src/integration/manifest.ts),
  [`integration/agent.ts`](../../packages/execution-core/src/integration/agent.ts)
  y [`run-coordinator/integration.ts`](../../packages/run-coordinator/src/integration.ts).
- Tests: [`integration-manifest.test.ts`](../../tests/integration-manifest.test.ts),
  [`integration-contract-validation.test.ts`](../../tests/integration-contract-validation.test.ts),
  [`integration-repair-policy.test.ts`](../../tests/integration-repair-policy.test.ts)
  y [`integration-real-git.test.ts`](../../tests/integration-real-git.test.ts).

## 11. Publicar exactamente el árbol validado

### Problema

Preparar, validar y publicar con identidad ambigua permitiría target drift o
retries duplicados.

### Estrategia

El flujo es `prepare → validate exact candidate → approve → publish → receipt`.
La aprobación fija manifest, final SHA, branch, target head/fingerprint, actor e
idempotency key. Solo `delivery.published` con receipt confirmado lleva a
`completed`.

### Evidencia

- Código: [`candidate-preparer.ts`](../../packages/execution-core/src/delivery/candidate-preparer.ts),
  [`publisher.ts`](../../packages/execution-core/src/delivery/publisher.ts),
  [`outcomes.ts`](../../packages/run-coordinator/src/domain/outcomes.ts) y
  [`coordinator.ts`](../../packages/run-coordinator/src/coordinator.ts).
- Tests: [`delivery-state-machine.test.ts`](../../tests/delivery-state-machine.test.ts),
  [`run-v2-crash-recovery.test.ts`](../../tests/run-v2-crash-recovery.test.ts) y
  [`run-v2-e2e.test.ts`](../../tests/run-v2-e2e.test.ts).

## 12. Autoridad segura frente a concurrencia y procesos tardíos

### Problema

Dos writers pueden intentar ganar la misma secuencia; un proceso cancelado puede
terminar tarde y persistir; en Windows, rename/locks pueden fallar de forma
transitoria.

### Estrategia

Se combinan operation lease, fencing token, sequence CAS, event IDs estables,
lock durable y atomic writes con retry de errores transitorios de Windows. La
cancelación invalida autoridad antes de matar procesos y solo registra
`operation.interrupted` cuando el supervisor confirma `allDead`.

### Evidencia

- Código: [`jsonl-event-store.ts`](../../packages/run-store/src/jsonl-event-store.ts),
  [`run-operation-lease.ts`](../../apps/web/src/lib/server/runs/run-operation-lease.ts),
  [`process-supervision.ts`](../../apps/web/src/lib/server/runs/process-supervision.ts)
  y [`run-abort-registry.ts`](../../apps/web/src/lib/server/runs/run-abort-registry.ts).
- Tests: [`run-store-fencing.test.ts`](../../tests/run-store-fencing.test.ts),
  [`run-store-event-source.test.ts`](../../tests/run-store-event-source.test.ts)
  y [`run-v2-cancellation.test.ts`](../../tests/run-v2-cancellation.test.ts).

## 13. Una UI que proyecta el dominio sin reinterpretarlo

### Problema

Overrides imperativos, estados de negocio locales o auto-fit por eventos pueden
ocultar la historia real y hacer perder el contexto espacial durante planning.

### Estrategia

La UI reproduce eventos con un reducer puro. El grafo provisional se deriva de
`planning.node_discovered`; el compilado se parsea con los mismos schemas del
dominio. El layout y la presentación de relaciones son funciones puras. React
Flow solo renderiza: el viewport se inicializa una vez y `fitView` queda detrás
del botón `Encuadrar`.

Las relaciones se agrupan y filtran mediante lentes. Una decisión selecciona el
nodo afectado y usa el inspector; no crea un status paralelo.

### Evidencia

- Código: [`run-model/reducer.ts`](../../apps/web/src/lib/run-model/reducer.ts),
  [`presentation.ts`](../../apps/web/src/lib/run-model/presentation.ts),
  [`tree-layout.ts`](../../apps/web/src/lib/run-model/tree-layout.ts),
  [`minimal-run-graph.tsx`](../../apps/web/src/components/run-model/minimal-run-graph.tsx)
  y [`run-model-view.client.tsx`](../../apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx).
- Tests: [`run-model-v2-reducer.test.ts`](../../tests/run-model-v2-reducer.test.ts),
  [`run-model-presentation.test.ts`](../../tests/run-model-presentation.test.ts),
  [`run-model-tree-layout.test.ts`](../../tests/run-model-tree-layout.test.ts) y
  [`run-canvas-no-auto-fit.test.ts`](../../tests/run-canvas-no-auto-fit.test.ts).

## 14. Listados rápidos sin debilitar la seguridad de referencias

### Problema

La ruta caliente de la sidebar debe limitar trabajo y devolver exactamente la
cantidad solicitada. En cambio, una operación destructiva sobre un workspace
debe fallar cerrado si no puede determinar qué runs todavía lo referencian.

### Estrategia

El repositorio excluye archivados antes de llenar el slice y solo incluye
archivados bajo una consulta explícita. La lectura de referencias de workspace
falla cerrado con un error accionable si un registro primario está corrupto; no
borra datos ni confunde snapshots/fences con runs primarios.

### Evidencia

- Código: [`runs/repository.ts`](../../apps/web/src/lib/server/runs/repository.ts),
  [`api/runs/route.ts`](../../apps/web/src/app/api/runs/route.ts) y
  [`app-sidebar.tsx`](../../apps/web/src/components/app-sidebar.tsx).
- Tests: [`runs-list-performance.test.ts`](../../tests/runs-list-performance.test.ts),
  [`run-record-repository.test.ts`](../../tests/run-record-repository.test.ts) y
  [`workspace-run-reference-safety.test.ts`](../../tests/workspace-run-reference-safety.test.ts).

## Cómo interpretar esta evidencia

- Un schema prueba que un estado inválido se rechaza, no que el flujo completo
  llegue a producir el válido.
- Un unit test prueba una política aislada; el E2E de dominio y los smokes
  persistidos prueban composición.
- Un fixture UI prueba replay/presentación, no ejecución real.
- Un package manifest prueba que una dependencia está declarada, no que el
  código productivo la use. Esta distinción es especialmente importante para
  LangChain/LangGraph.
