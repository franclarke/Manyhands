# Informe de Inspección Técnica Exhaustiva — Explorer 2: Scheduling, Execution, Engine, Persistence & Coordination

> **Módulos asignados**: `packages/scheduler`, `packages/conflict-risk`, `packages/execution-core`, `packages/run-store`, `packages/trace-store`, `packages/run-engine`, `packages/run-coordinator`, `packages/orchestrator-graph`.  
> **Fecha de relevamiento**: 2026-08-18  
> **Autor**: Agente Explorer 2 (Teamwork Explorer & Synthesizer)  
> **Normativa de referencia**: `PRODUCT.md`, `AGENTS.md`, `docs/plans/2026-08-12-correctness-first-system-redesign.md`.

---

## 1. Resumen Ejecutivo y Mapa de Interacción Global

ManyHands coordina agentes de codificación de forma distribuida y local para transformar objetivos de software en resultados verificados e integrados. Dentro de esta arquitectura modular basada en monolito local duradero:

1. **`run-coordinator`** actúa como el núcleo de dominio: define el vocabulario canónico de eventos de dominio (`RunEvent`), comandos (`RunCommandEnvelope`), proyecciones (`RunProjection`), y contiene el reductor puro (`reduceRun` / `foldRun`) y la máquina de estados de ciclo de vida.
2. **`run-store`** implementa la persistencia canónica duradera: journal transaccional append-only en formato JSONL (`JsonlRunEventStore`), locks duraderos (`acquireDurableLock`), storage inmutable direccionado por contenido para intents y receipts de efectos físicos (`FileEffectInputStore`, `FileEffectReceiptStore`), compactación por generaciones y reconstrucción de snapshots.
3. **`trace-store`** almacena trazas diagnósticas no autoritativas (prompts crudos, logs de streaming, timings, salidas de procesos) con redacción automática de credenciales/secretos (`redactSecrets`).
4. **`scheduler`** evalúa precondiciones duras y explicables para calcular el *frontier* ejecutable sobre `GraphRevision` y `TaskContractBundle` (`evaluateReadiness`), seleccionando olas concurrentes (`selectFrontier`) según capacidad, `ResourceClaim`s, `RuntimeLeaseClaim`s y riesgo de integración consultivo.
5. **`conflict-risk`** es un módulo de predicción *pairwise* transicional ($O(N^2)$) basado en contratos y el índice de repositorio, en proceso de ser retirado en favor de `ResourceClaim` indexado por recurso.
6. **`orchestrator-graph`** aloja el `CanonicalExecutionDriver` (que orquesta el bucle de ejecución de una revisión de grafo) y módulos de compatibilidad V2, cuya lógica se encuentra en transición hacia `run-engine` y `apps/daemon`.
7. **`run-engine`** es el kernel de ejecución duradera del daemon (`DurableRunEngine`, `RunActor`, `EffectDispatcher`), donde cada corrida posee un único actor que ejecuta comandos, registra intents antes de mutaciones externas físicas (patrón outbox) y reconcilia efectos tras caídas o reinicios.
8. **`execution-core`** provee los adaptadores operativos para aislamiento de checkout (`WorktreeManager`), sandboxing de procesos (`SandboxProvider`, `CredentialBroker`), constructores de bases de ejecución puras sobre manifests (`ExecutionBaseBuilder`, `ExactGitManifestMaterializer`, `GitArtifactBuilder`), ejecución de agentes (`CliExecutor`, perfiles Claude Code / Codex), validación de candidatos exactos (`CandidateValidator`, `EvidenceMatrix`, `TestIntegrityValidator`), integración compuesta (`IntegrationManifestExecutor`, `PreMergeValidator`) y entrega (`Publisher`, CAS delivery).

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                                apps/daemon                                  │
 │   (Proceso local duradero: expone IPC local autenticado / UDS / Named Pipe)  │
 └──────────────────────┬──────────────────────────────────────────────────────┘
                        │
                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                           @manyhands/run-engine                             │
 │   DurableRunEngine ──► RunActorRegistry ──► RunActor (1 por runId)          │
 │                                                  │                          │
 │                   ┌──────────────────────────────┴──────────┐               │
 │                   ▼                                         ▼               │
 │           EffectDispatcher                        RunActorJournalPort       │
 │      (PhysicalEffectAdapters)                               │               │
 └───────────────────┬─────────────────────────────────────────┼───────────────┘
                     │                                         │
        ┌────────────┴─────────────┐                           │
        ▼                          ▼                           ▼
 ┌──────────────┐          ┌────────────────┐       ┌────────────────────────┐
 │execution-core│          │   run-store    │◄──────┤    run-coordinator     │
 │  Worktrees   │          │  JSONL Events  │       │ Domain Events, Reducer,│
 │  Sandboxes   │          │  Effect Inputs │       │ Projection, Commands,  │
 │  Validators  │          │  Effect Receipts       │ Lifecycle State Machine│
 │  Git Builder │          │  Durable Locks │       └───────────┬────────────┘
 │  Integrator  │          └────────────────┘                   │
 └──────┬───────┘                                               │
        │                                                       ▼
        │                                           ┌────────────────────────┐
        └──────────────────────────────────────────►│       scheduler        │
                                                    │ evaluateReadiness()    │
                                                    │ selectFrontier()       │
                                                    └───────────┬────────────┘
                                                                │ (advisory)
                                                                ▼
                                                    ┌────────────────────────┐
                                                    │  conflict-risk (legacy)│
                                                    └────────────────────────┘
```

---

## 2. Inspección Detallada por Paquete

---

### 2.1 `@manyhands/scheduler` (`packages/scheduler`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/scheduler` es un planificador puro responsable de determinar qué nodos de un grafo son ejecutables en un instante dado (*frontier readiness*) y seleccionar el subconjunto óptimo para ejecución concurrente. Opera sobre hechos y precondiciones duras (artefactos adoptados requeridos, contratos vigentes, decisiones humanas resueltas, claims de recursos, leases físicas y capacidad/presupuesto del ejecutor).

#### B. Arquitectura Modular y Layout Interno
```
packages/scheduler/
├── src/
│   ├── index.ts                # Barrel export y scheduler V1 (legacy pairwise/batch)
│   ├── canonical-frontier.ts   # Scheduler canónico (Stage 6 / GS): evaluateReadiness y selectFrontier
│   ├── readiness-v2.ts         # Evaluación de readiness V2 sobre LegacyGraphRevisionV2
│   ├── types-v2.ts             # Tipos de estado y razones de bloqueo V2
│   └── wave-selector-v2.ts     # Selector de olas V2 con restricciones de conflicto
├── package.json
└── README.md                   # Stub de 11 líneas
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Separación estricta entre Readiness y Selección**: `evaluateReadiness` analiza únicamente precondiciones duras e invariantes sobre `GraphRevision` y `TaskContractBundle`. El riesgo de integración (`IntegrationRiskEstimate`) **nunca** invalida una precondición; sólo se usa de forma consultiva en `selectFrontier` para ordenar candidatos ya listos.
2. **Evaluación de Recursos Indexada (`ResourceClaim` y `RuntimeLeaseClaim`)**: En lugar de construir una matriz $O(N^2)$, compara el claim de acceso (`read` vs `modify`) de cada recurso y el modo de la lease (`shared` vs `exclusive`) respecto a los nodos activos.
3. **Explicabilidad Exhaustiva**: Cada nodo evaluado produce un `CanonicalReadinessExplanation` detallando si está listo y la lista exacta de códigos de razón (`missing_artifact`, `stale_contract`, `unresolved_decision`, `resource_claim_conflict`, `runtime_lease_conflict`, `executor_unavailable`, `budget_exhausted`, `already_active`, `already_adopted`).

#### D. Símbolos, Tipos e Interfaces Exportados
- **Canónicos (Stage 6+)**:
  - Funciones: `evaluateReadiness(input: CanonicalReadinessSnapshot): CanonicalReadinessEvaluation`, `selectFrontier(input): CanonicalFrontierSelection`.
  - Interfaces: `CanonicalReadinessSnapshot`, `CanonicalAdoptedArtifact`, `CanonicalPendingDecision`, `CanonicalReadinessExplanation`, `CanonicalReadinessEvaluation`, `IntegrationRiskEstimate`, `CanonicalSelectionPolicy`, `CanonicalFrontierSelection`.
  - Tipos: `CanonicalReadinessReason` (`"missing_artifact"` | `"stale_contract"` | `"unresolved_decision"` | `"resource_overlap_unknown"` | `"resource_claim_conflict"` | `"runtime_lease_conflict"` | `"executor_unavailable"` | `"budget_exhausted"` | `"already_active"` | `"already_adopted"`).
- **V2 / Legacy**:
  - `explainReadiness(input: ReadinessInputV2): ReadinessExplanationV2`
  - `selectReadyWaveV2(input: ReadyWaveSelectionInput): ReadyWaveSelection`
  - `scheduleTasks(input: SchedulerInput): SchedulerPlan`
  - `selectScopeAwareWave(input: ScopeAwareWaveInput): string[]`
  - `buildSchedulingSafetyContext(input: SchedulingSafetyContextInput): SchedulingSafetyContext`
  - `applyHumanGateToSchedule(input): HumanGateResult`
  - Schemas Zod: `SchedulingPolicySchema`, `SchedulerBatchDecisionSchema`, `ExecutionBatchSchema`, `BlockedTaskSchema`, `SchedulerPlanSchema`, `HumanGateDecisionSchema`, `HumanGateMetricsSchema`, `HumanGateResultSchema`.

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Stage 6 / GS completado. La ruta canónica usa `canonical-frontier.ts`.
- **Brechas / Código Legacy**: `index.ts` mantiene algoritmos legacy (`scheduleTasks`, `selectScopeAwareWave`) basados en heurísticas de globs de rutas y matrices de riesgo par a par. Estos serán eliminados formalmente al completar la migración de todos los callers hacia la interfaz de `canonical-frontier.ts`.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 11 líneas.
- **Deficiencias**: No documenta las interfaces `evaluateReadiness` ni `selectFrontier`, no describe los tipos de razones de bloqueo ni el modelo de `ResourceClaim` / `RuntimeLeaseClaim`.

---

### 2.2 `@manyhands/conflict-risk` (`packages/conflict-risk`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/conflict-risk` es un paquete transicional que implementa predicción estática y heurística de conflictos par a par entre tareas (`TaskPairRiskMatrix`). Analiza intersecciones de rutas (`allowed.paths`, `changedFiles`), símbolos exportados/consumidos (`producedSymbols`, `consumedSymbols`), relaciones de imports del `RepositoryIndex` y dependencias de esquemas.

#### B. Arquitectura Modular y Layout Interno
```
packages/conflict-risk/
├── src/
│   ├── index.ts                # Algoritmos de predicción, ponderación de señales y esquemas Zod
│   └── constraint-evidence.ts  # Interface ConflictConstraintEvidence y factory
├── package.json
└── README.md                   # Stub de 13 líneas
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Composición Ponderada de Señales**: Asigna pesos a distintas señales (`file_overlap`: 0.75, `path_overlap`: 0.3, `symbol_overlap`: 0.35, `producer_consumer`: 0.5, `critical_path`: 0.5, `shared_test_fixture`: 0.2, etc.) y computa un score acotado $[0, 1]$.
2. **Clasificación Categórica y Recomendaciones**: Mapea scores a niveles (`low`, `medium`, `high`, `blocking`) y genera recomendaciones deterministas (`run_parallel`, `serialize`, `add_dependency`, `requires_human_review`).
3. **Pares Canónicos Simétricos**: Emplea una clave canónica ordenada `taskA\0taskB` para evitar duplicar el análisis entre pares.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Esquemas Zod**:
  - `ConflictRiskLevelSchema` (`"low"` | `"medium"` | `"high"` | `"blocking"`)
  - `ConflictEvidenceSignalSchema` (18 señales posibles: `file_overlap`, `path_overlap`, `symbol_overlap`, `producer_consumer`, `static_import_dependency`, `static_shared_schema_dependency`, etc.)
  - `ConflictEvidenceSchema`, `ConflictRiskScoreSchema`, `ConflictRecommendationSchema`, `ConflictPredictionSchema`, `TaskPairRiskMatrixSchema`
  - `StaticConflictSignalTypeSchema`, `StaticConflictEvidenceSchema`, `StaticConflictSignalSchema`, `StaticConflictSignalsSchema`
- **Funciones**:
  - `buildTaskPairRiskMatrix(input: BuildRiskMatrixInput): TaskPairRiskMatrix`
  - `buildRepositoryAwareRiskMatrix(input: BuildStaticConflictSignalsInput): TaskPairRiskMatrix`
  - `predictConflict(taskA, taskB, staticSignals): ConflictPrediction`
  - `buildStaticConflictSignals(input): StaticConflictSignal[]`
  - `findRiskPrediction(matrix, taskAId, taskBId): ConflictPrediction | undefined`
  - `createConflictConstraintEvidence(input): ConflictConstraintEvidence`

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Módulo deprecado en camino de retiro.
- **Brechas / Destino**: El rediseño reemplazó la matriz par a par por `ResourceClaim` indexado por recurso en `task-graph`. Stage 6 retiró la autoridad efectiva de selección de este módulo, convirtiéndolo en señal consultiva (`IntegrationRiskEstimate`). En Stage 11 (GArch / GProd), el paquete será eliminado una vez verificada la reachability.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 13 líneas que describe correctamente que el módulo es transicional.
- **Deficiencias**: Carece de documentación de las señales estáticas, interfaces públicas y esquemas de evidencia para los consumidores que aún lo referencian.

---

### 2.3 `@manyhands/execution-core` (`packages/execution-core`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/execution-core` es el paquete operativo central para la ejecución de intentos físicos de agentes, construcción y materialización de bases de ejecución Git, supervisión de procesos, verificación estricta de alcances (*scope*), validación contra matrices de evidencia en candidatos exactos, integración de nodos compuestos y publicación de entrega.

#### B. Arquitectura Modular y Layout Interno
```
packages/execution-core/src/
├── base/           # ExecutionBaseBuilder, ExecutionBaseManifest, ArtifactMaterializer
├── git/            # GitRunner, GitArtifactBuilder, ExactGitManifestMaterializer, GitArtifactRetainer
├── sandbox/        # SandboxProvider, CredentialBroker, ExecutionWorkspaceProvider, tipos de SandboxProfile
├── supervisor/     # ProcessSupervisor, árbol de procesos, buffer acotado (BoundedOutputBuffer)
├── executor/       # CliExecutor, MockExecutor, perfiles (claude-code, codex), LiveProcessRegistry, FailureClassifier
├── validation/     # CandidateValidator, EvidenceMatrix, RecipeCompiler, ExactEvidenceBinding, TestIntegrityValidator, BaselineValidator
├── integration/    # IntegrationManifestExecutor, OperationJournal, PreMergeValidator, SyntaxChecker
├── delivery/       # CandidatePreparer, Publisher, TargetCleanlinessValidator
├── scope/          # Glob matcher, ScopeChecker, ScopeErrors, ArtifactScopes
├── routing/        # ComplexityRouter, AvailabilityChecker, RoutingPolicy
├── v2/             # V2NodeExecutor, V2ExactCandidateValidator
├── run/            # WorldReconciler, AmendmentsEngine, SkeletonScaffolder, GroundingAgent
├── types.ts        # Tipos centrales de resultados, worktrees, configuración y vectores de granularidad
└── errors.ts       # Jerarquía de errores tipados
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Materialización Exacta por Manifiesto Git (no whole-commit cherry-pick)**: `ExactGitManifestMaterializer` crea árboles de ejecución aplicando únicamente las entradas declaradas (`ChangeSetEntry`) con sus preimágenes y postimágenes exactas validadas mediante `read-tree` y `write-tree`, sin invocar hooks ni filtros `smudge`.
2. **Aislamiento de Worktree vs Sandboxing de Procesos**: Modela cuatro dimensiones ortogonales: aislamiento de directorio de trabajo (`WorktreeManager`), aislamiento de recursos/procesos (Windows Job Objects / sandbox), permisos de red/archivos y broker de credenciales efímeras con limpieza garantizada tras salida o timeout (`CredentialBroker`).
3. **Supervisión de Procesos Robusta**: `ProcessSupervisor` registra PIDs en `LiveProcessRegistry`, captura streaming con `BoundedOutputBuffer` (evitando desbordamiento de memoria por logs masivos) y garantiza la terminación del árbol completo de procesos ante señales de cancelación.
4. **Matriz de Evidencia Jerárquica y Controles Negativos**: `CandidateValidator` y `buildEvidenceMatrix` evalúan obligaciones de validación (`ValidationObligation`) contra candidatos exactos, exigiendo pruebas de sensibilidad con controles negativos (`negativeControl`) y verificación de integridad de tests (`TestIntegrityValidator` para detectar tests debilitados o assertions eliminadas).
5. **Integración Compuesta como Intento de Primer Nivel**: `IntegrationManifestExecutor` realiza integración jerárquica con contrato (`IntegrationContract`), bitácora de operaciones (`IntegrationOperationJournal`) y validación sintáctica/pre-merge previa.
6. **Publicación por Compare-and-Swap (CAS)**: `Publisher` valida la limpieza del destino (`TargetCleanlinessValidator`) y ejecuta la entrega únicamente si el head remoto coincide exactamente con el head esperado.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Tipos y Schemas Principales (`types.ts`)**:
  - `AgentResultStatusSchema` (`success`, `empty_diff`, `scope_violation`, `scope_gated`, `validation_failed`, `executor_error`, `timeout`, `agent_committed_unexpectedly`, `internal_error`).
  - `WorktreeRecordSchema`, `ScopeCheckResultSchema`, `ValidationRunResultSchema`, `AgentExecutionResultSchema`.
  - `IntegrationStatusSchema`, `AppliedChildCommitSchema`, `OmittedChildCommitSchema`, `IntegrationRepairAttemptSchema`, `IntegrationResultSchema`.
  - `AgentExecutorOptionsSchema`, `ExecutionConfigSchema`, `GranularityVectorSchema`.
- **Clases Operativas Clave**:
  - `GitArtifactBuilder`: Construye `ChangeSetManifest` y `CandidateTreeManifest` a partir de diffs de Git.
  - `ExactGitManifestMaterializer`: Materializa manifests exactos en el árbol de trabajo.
  - `ExecutionBaseBuilder`: Orquesta la creación del worktree y materialización de artefactos previos requeridos.
  - `WorktreeManager`: Gestión de ramas y directorios de worktrees efímeros.
  - `ProcessSupervisor`, `CliExecutor`, `MockExecutor`.
  - `CandidateValidator`, `buildEvidenceMatrix`, `bindExactEvidence`.
  - `TestIntegrityValidator`: Detección de manipulación de tests (`test_removed`, `test_script_weakened`, `assertion_removed`, etc.).
  - `IntegrationManifestExecutor`, `IntegrationOperationJournal`.
  - `Publisher`, `CandidatePreparer`.
  - `V2NodeExecutor`: Orquestador de ejecución de nodo físico (hoja o compuesto).

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Etapas 7 (GA), 8 (GLeaf), 9 (GI) y 10 (GDel) implementadas.
- **Brechas / Notas de Transición**: Coexisten rutas V2 con la arquitectura canónica. `V2NodeExecutor` aún admite transporte transicional de commits bajo flag (`allowCommitArtifactTransport`), el cual se deshabilita para la ruta canónica pura donde todo intercambio es vía `ArtifactManifest`.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 12 líneas.
- **Deficiencias**: No explica la arquitectura modular interna (18 subcarpetas), ni los contratos de manifests, sandboxing, validación con matriz de evidencia, ni el flujo de entrega.

---

### 2.4 `@manyhands/run-store` (`packages/run-store`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/run-store` es la capa de almacenamiento y persistencia canónica de ManyHands. Garantiza la durabilidad, consistencia ante caídas (*crash recovery*) y serialización determinista de la corrida mediante un journal de eventos append-only en JSONL, storage inmutable direccionado por contenido para intents y receipts de efectos físicos, y locks de exclusión duraderos con fencing tokens.

#### B. Arquitectura Modular y Layout Interno
```
packages/run-store/src/
├── index.ts                # Barrel export
├── event-store.ts          # Interfaces de FencedRunEventStore, FencingAuthority y errores
├── jsonl-event-store.ts    # Implementación JsonlRunEventStore (JSONL append-only, fsync, checksums)
├── event-upcaster.ts       # Migración y upcasting de versiones de eventos
├── durable-file.ts         # Escrituras atómicas con reemplazo y fsync
├── durable-lock.ts         # Lock de archivo exclusivo con lease y detección de stale locks
├── effect-input-store.ts   # FileEffectInputStore: storage inmutable direccionado por contenido (hard-links)
├── effect-receipt-store.ts # FileEffectReceiptStore: almacenamiento de recibos físicos
├── attempt-store.ts        # Almacenamiento inmutable de intentos
├── artifact-store.ts       # Almacenamiento inmutable de artefactos
├── snapshot-store.ts       # Almacenamiento y carga de snapshots reconstruibles
├── projection-fold.ts      # Funciones puras foldRunEvents y reduceRunEvents
├── compactor.ts            # Compactador de logs JSONL con manifiestos de generación
├── recovery.ts             # Reconciliación y recuperación ante reinicio sucio
└── migrations.ts           # Utilidades de migración de esquema
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Event Sourcing Canónico**: La única fuente de verdad de una corrida es la secuencia ordenada de `RunEvent` en su journal `.events.v2.jsonl`. Las proyecciones (`RunProjection`) son derivadas puros reproducibles por `reduceRunEvents`.
2. **Patrón Outbox Duradero para Efectos Físicos**: `FileEffectInputStore` persiste de forma inmutable y con `fsync` el `EffectInput` (con digest SHA-256) usando *hard-links* atómicos antes de iniciar cualquier mutación externa. Tras la ejecución, se registra el `PhysicalEffectReceipt` en `FileEffectReceiptStore`.
3. **Fencing Tokens y Single-Writer Authority**: `JsonlRunEventStore` valida `FencingAuthority` (`operationId` y `fencingToken`) en cada append (`appendFenced`), lanzando `StaleFencingTokenError` si otro proceso o epoch tomó posesión de la corrida.
4. **Resiliencia ante Caídas y Truncamiento Automático**: Si el archivo JSONL termina en una línea incompleta o corrupta (por corte de energía), `JsonlRunEventStore` detecta la última línea válida, trunca el archivo al punto consistente (`truncate`) y recupera el estado sin perder la historia previa.
5. **Compactación por Generaciones**: `Compactor` comprime periódicamente eventos históricos en generaciones inmutables referenciadas por manifiesto, manteniendo bajo el tiempo de replay.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Interfaces**:
  - `FencedRunEventStore`, `FencingAuthority`, `RunEventLogInspection`, `FileEffectInputStoreOptions`, `FileEffectReceiptStoreOptions`.
- **Clases**:
  - `JsonlRunEventStore`, `FileEffectInputStore`, `FileEffectReceiptStore`, `FileAttemptStore`, `FileArtifactStore`, `SnapshotStore`.
  - Errores: `SequenceConflictError`, `StaleFencingTokenError`, `CorruptRunEventLogError`, `EffectInputCorruptionError`, `EffectReceiptCorruptionError`.
- **Funciones**:
  - `acquireDurableLock(lockPath, options): Promise<DurableLock>`
  - `atomicWriteJson(filePath, data, options): Promise<void>`
  - `atomicWriteFile(filePath, buffer, options): Promise<void>`
  - `foldRunEvents(events: readonly RunEvent[]): RunProjection`
  - `reduceRunEvents(state: RunProjection, event: RunEvent): RunProjection`
  - `upcastEventToCurrent(rawEvent): RunEvent`
  - `readCompactedGeneration(dir, runId)`

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Plenamente operativo con soporte de Fencing, Outbox de efectos, Compaction y Replay.
- **Transición**: La autoridad de escritura pasó de múltiples puntos en la aplicación web a un único `RunActor` por corrida administrado por `apps/daemon` y `@manyhands/run-engine`.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 12 líneas.
- **Deficiencias**: No documenta el esquema de almacenamiento de efectos (`effect-inputs`, `effect-receipts`), los mecanismos de lock duradero, el protocolo de fencing ni el manejo de truncamiento de logs corruptos.

---

### 2.5 `@manyhands/trace-store` (`packages/trace-store`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/trace-store` es responsable de la persistencia de datos diagnósticos, observabilidad y métricas de ejecución. A diferencia del event journal de `run-store`, las trazas **no tienen autoridad de dominio** (no gobiernan el ciclo de vida ni la validez de resultados). Registra prompts completos, fragmentos de salida de agentes, timings y estados internos para depuración y visualización en UI.

#### B. Arquitectura Modular y Layout Interno
```
packages/trace-store/src/
├── index.ts                # Barrel export
├── trace-types.ts          # TraceEventTypeSchema (62 tipos), TraceEventSchema, InMemoryTraceStore
└── jsonl-trace-store.ts    # JsonlTraceStore con sobres de checksum duraderos y redacción de secretos
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Separación de Autoridad (Diagnóstico vs Hechos de Dominio)**: Los datos pesados o volátiles (como salidas intermedias de LLMs o streams de procesos) residen en trazas para no inflar ni comprometer el journal transaccional canónico.
2. **Redacción Automática de Secretos (`redactSecrets`)**: Antes de persistir cualquier payload, se analizan cadenas y objetos recursivamente para ocultar API keys (OpenAI, Anthropic, GitHub tokens, AWS keys, Bearer tokens, cookies, passwords).
3. **Sobres con Checksum SHA-256**: Cada entrada en el archivo `traces.jsonl` está encapsulada en un `DurableTraceEnvelope` con validación de checksum y `fsync` inmediato.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Esquemas Zod**: `TraceEventTypeSchema` (62 tipos de eventos diagnósticos), `TraceActorSchema` (`"system"` | `"human"` | `"agent"`), `TraceEventSchema`.
- **Tipos**: `TraceEventType`, `TraceActor`, `TraceEvent`, `TraceEventInput`.
- **Interfaces**: `TraceStore` (`append`, `list`, `findByType`, `findByTask`, `clear`).
- **Clases**: `JsonlTraceStore`, `InMemoryTraceStore`.
- **Funciones**: `redactSecrets<T>(value: T): T`.

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Estable y maduro. Alineado con la Sección 9.17 del plan normativo.
- **Brechas**: Ninguna funcional crítica.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 11 líneas.
- **Deficiencias**: No lista los tipos de eventos diagnósticos, no explica el mecanismo de redacción de secretos ni las diferencias de autoridad respecto a `run-store`.

---

### 2.6 `@manyhands/run-engine` (`packages/run-engine`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/run-engine` es el motor de ejecución duradera del daemon de ManyHands. Administra el ciclo de vida de los actores por corrida (`RunActor`), despacha comandos con generación de recibos criptográficos (`CommandReceipt`), ejecuta efectos físicos a través de adaptadores seguros (`PhysicalEffectAdapters`), e implementa el protocolo de reconciliación ante reinicios para garantizar consistencia en operaciones con efectos colaterales (Git, procesos, sandboxes).

#### B. Arquitectura Modular y Layout Interno
```
packages/run-engine/src/
├── index.ts                    # Barrel export
├── durable-run-engine.ts       # DurableRunEngine: fachada de consultas y comandos para el daemon
├── run-actor.ts                # RunActor: actor de dominio por corrida (mailbox secuencial)
├── run-actor-registry.ts       # Registro y ciclo de vida de instancias RunActor en memoria
├── effect-dispatcher.ts        # EffectDispatcher: enrutador y despachador de intents de efectos
├── physical-effect-adapters.ts # Adaptadores para Git, Procesos, File System y Sandboxes
└── run-event-journal.ts        # Adaptador del journal de eventos para el actor
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Actor Model por Corrida (Single-Writer In-Memory)**: Cada `runId` tiene como máximo un `RunActor` en memoria con un *mailbox* secuencial (`mailbox: Promise<unknown>`), garantizando que los comandos y transiciones de estado se procesen en orden estricto sin colisiones de concurrencia.
2. **Despacho de Efectos con Intención Duradera (Two-Phase Effect Outbox)**:
   - *Fase 1*: Se persiste el `EffectIntent` en el journal de eventos canónico antes de cualquier llamada al sistema operativo.
   - *Fase 2*: `EffectDispatcher` delega en `PhysicalEffectAdapters`, obtiene un `PhysicalEffectReceipt` y emite los eventos de completitud (`effect.completed` o `effect.failed`).
3. **Reconciliación de Efectos Pendientes tras Crash (`recoverPendingEffects`)**: Al iniciar el daemon o revivir un actor, se buscan efectos no terminales en el journal y se reconcilian contra el estado real del sistema operativo (consultando si el proceso sigue vivo o si el commit Git fue creado).
4. **Consultas Libres de Efectos Secundarios**: `DurableRunEngine.query` y `eventsReady` reconstruyen la proyección directamente leyendo el journal de `run-store`, sin instanciar actores ni mutar estado.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Clases**:
  - `DurableRunEngine`: Punto de entrada principal con métodos `submit`, `query`, `eventsReady`.
  - `RunActor`: Actor de corrida con `submit`, `recoverPendingEffects`, `drainEffects`.
  - `RunActorRegistry`: Registro con `getOrCreate(runId)`.
  - `EffectDispatcher`: Despachador de efectos con `observe` y `reconcile`.
  - `PhysicalEffectAdapters`: Colección de adaptadores para efectos del sistema.
  - `RunActorJournal`: Implementación de `RunActorJournalPort`.
- **Interfaces**:
  - `DurableRunEngineOptions`, `DurableRunEngineActor`, `DurableRunEngineActorRegistry`, `RunEventPage`.
  - `RunActorOptions`, `RunActorDecisionContext`, `RunActorDecision`, `RunActorReactionContext`, `RunActorReaction`, `RunActorTerminalObservation`.
  - `RunActorJournalPort`, `RunActorDispatcherPort`.

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Núcleo del daemon (Stage 2/3 y Stage 11 en progreso).
- **Brechas**: `orchestrator-graph` todavía contiene lógica de orquestación de alto nivel que está migrando hacia este paquete y `apps/daemon`.

#### F. Diagnóstico del README.md
- **Estado actual**: **INEXISTENTE**. No hay archivo `README.md` en `packages/run-engine`.
- **Deficiencias**: Requiere la creación completa de un `README.md` exhaustivo en español que detalle el modelo de actores, el despacho de efectos físicos y la arquitectura de tolerancia a fallos.

---

### 2.7 `@manyhands/run-coordinator` (`packages/run-coordinator`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/run-coordinator` define el modelo de dominio canónico, las interfaces de protocolo y el reductor de estado puro para ManyHands. Centraliza la definición de eventos de dominio (`RunEvent`), comandos de control (`RunCommandEnvelope`), artefactos adoptados, intentos inmutables, matriz de evidencia, decisiones humanas y la máquina de estados de ciclo de vida del producto.

#### B. Arquitectura Modular y Layout Interno
```
packages/run-coordinator/src/
├── domain/                     # Submódulos de dominio puro
│   ├── events.ts               # RunEventSchema (42 tipos de eventos canónicos y payloads Zod)
│   ├── lifecycle.ts            # Estados del ciclo de vida (created, running, paused, failed, etc.)
│   ├── attempts.ts             # Modelado de intentos inmutables
│   ├── artifacts.ts            # AdoptedArtifactSchema, retenciones y autorizaciones
│   ├── decisions.ts            # DecisionInputSchema, resoluciones y autorizaciones standing
│   ├── evidence.ts             # EvidenceMatrixRecordSchema y bindings
│   ├── failures.ts             # FailureClassSchema (7 clases) y observaciones
│   ├── fingerprint.ts          # Cálculo determinista de InputFingerprint
│   ├── human-review.ts         # Registros de revisión humana
│   ├── outcomes.ts             # DeliveryApprovalSchema, DeliveryReceiptSchema
│   ├── autonomy.ts             # Políticas de autonomía y autorización
│   └── repair-routing.ts       # Enrutamiento de reparaciones por causa
├── commands.ts                 # Schemas de comandos y tipos
├── command-envelope.ts         # RunCommandEnvelope, CommandReceipt y validación de identidad
├── ipc-protocol.ts             # Protocolo IPC autenticado Daemon <-> Cliente Web
├── product-lifecycle.ts        # Definición de corrida de producto y fases
├── reducer.ts                  # Reductor de estado puro: reduceRun, foldRun
├── coordinator.ts              # RunCoordinator: orquestador de alto nivel
├── execution.ts                # Hechos y lógica de ejecución
├── integration.ts              # Hechos y lógica de integración
├── amendments.ts               # Propuesta y resolución de enmiendas al grafo
├── recovery-policy.ts          # Políticas de recuperación ante fallos
├── parallelism-observation.ts  # Métricas de paralelismo observado
└── ports.ts                    # Interfaces de puertos (Journal, State, etc.)
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Reductor de Dominio Puro (State Machine as Pure Function)**: `reduceRun(projection, event)` es una función pura determinista sin I/O. Dado el estado anterior y un `RunEvent`, calcula la siguiente `RunProjection`. Rejugar 1,000 eventos produce exactamente la misma proyección.
2. **Identidad Inmutable por InputFingerprint**: Los intentos de tareas (`Attempt`) están identificados de forma única e inmutable por `computeInputFingerprint(nodeId, contractDigest, consumedArtifactDigests)`. Re-ejecutar con el mismo fingerprint está prohibido a menos que exista evidencia de una nueva causa.
3. **Decisiones Desacopladas que no Bloquean el Trabajo Independiente**: Las decisiones humanas (`decision.raised`, `decision.resolved`) declaran `affectedNodeIds`. El planificador continúa ejecutando todas las ramas del grafo no afectadas mientras una decisión local está pendiente.
4. **Clasificación Causal de Fallos**: Los fallos se clasifican en 7 categorías (`tool_permission`, `budget`, `stale_basis`, `ambiguous_specification`, `verification_failure`, `infrastructure_transient`, `internal_invariant_violation`), cada una con acciones de recuperación permitidas y presupuesto de reintentos específico.

#### D. Símbolos, Tipos e Interfaces Exportados
- **Eventos y Schemas (`domain/events.ts`)**:
  - `RunEventSchema`, `RunEvent`, `RunEventType`, `RunEventInput`.
  - 42 tipos de eventos: `run.created`, `command.accepted`, `effect.requested`, `effect.observed`, `effect.completed`, `effect.failed`, `planning.attempt_started`, `planning.completed`, `graph.compiled`, `attempt.started`, `attempt.candidate_created`, `attempt.failed`, `validation.started`, `validation.completed`, `artifact.adopted`, `integration.started`, `integration.completed`, `decision.raised`, `decision.resolved`, `readiness.observed`, `wave.selected`, `final_candidate.verified`, `delivery.published`, etc.
- **Comandos (`command-envelope.ts`, `commands.ts`)**:
  - `RunCommandEnvelopeSchema`, `CommandReceiptSchema`, `RunCommandEnvelope`, `CommandReceipt`.
  - `validateRunCommandEnvelopeIdentity`, `validateCommandReceiptIdentity`, `buildCommandReceipt`.
- **Reductor y Proyección (`reducer.ts`)**:
  - `reduceRun(projection: RunProjection, event: RunEvent): RunProjection`
  - `foldRun(events: readonly RunEvent[]): RunProjection`
  - `initialProjection(runId: string): RunProjection`
- **Dominio**:
  - `computeInputFingerprint`, `routeRepair`, `AdoptedArtifactSchema`, `EvidenceMatrixRecordSchema`, `FailureClassSchema`, `DecisionInputSchema`.

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Paquete central plenamente activo en la arquitectura canónica.
- **Brechas**: Mantiene compatibilidad con payloads de eventos históricos (`legacy.run_imported`, `planning.completed` con `breakdown` legacy) para permitir replay de corridas antiguas sin pérdida de fidelidad.

#### F. Diagnóstico del README.md
- **Estado actual**: **INEXISTENTE**. No hay archivo `README.md` en `packages/run-coordinator`.
- **Deficiencias**: Requiere la redacción completa de un `README.md` pedagógico que documente el catálogo de eventos de dominio, los schemas de comandos, la máquina de estados del reductor y el ciclo de vida de artefactos y decisiones.

---

### 2.8 `@manyhands/orchestrator-graph` (`packages/orchestrator-graph`)

#### A. Propósito y Rol en el Ciclo de Vida
`@manyhands/orchestrator-graph` es un paquete transicional que aloja el `CanonicalExecutionDriver` (el motor que itera sobre las olas de un `GraphRevision`, evalúa el readiness con `scheduler`, genera intentos, invoca a `execution-core` y registra eventos en `run-coordinator`), además de mantener el `V2ExecutionDriver` histórico para tests de compatibilidad.

#### B. Arquitectura Modular y Layout Interno
```
packages/orchestrator-graph/src/
├── index.ts                            # Barrel export
├── canonical-execution-driver.ts       # Driver canónico para GraphRevision directa
├── concurrent-resource-invariant.ts    # Verificación de invariantes de no-conflicto de recursos concurrentes
├── execution-base-closure.ts           # Cálculo del cierre transitivo de artefactos para bases de ejecución
└── v2/
    └── execution-driver.ts             # Driver V2 histórico (retained for compatibility tests)
```

#### C. Patrones de Diseño y Estrategias Técnicas
1. **Bucle de Ejecución Concurrente Basado en Olas**: `CanonicalExecutionDriver.run` evalúa el estado actual de la corrida, consulta `selectFrontier` para obtener los nodos listos, verifica la invariante de no-colisión de recursos (`assertNoConcurrentResourceConflict`), despacha la ola concurrente y registra los resultados de forma atómica.
2. **Cierre de Requisitos de Artefactos (`executionBaseArtifacts`)**: Determina el conjunto mínimo y exacto de artefactos requeridos por un nodo transitivamente para construir su base de ejecución limpia.
3. **Invariante de Recursos Concurrentes**: `assertNoConcurrentResourceConflict` valida en tiempo de ejecución que dos nodos en la misma ola no posean claims conflictivos (`modify` sobre el mismo recurso o leases de runtime exclusivas sobre la misma clave).

#### D. Símbolos, Tipos e Interfaces Exportados
- **Canónicos**:
  - `CanonicalExecutionDriver`: Clase del driver canónico.
  - `assertNoConcurrentResourceConflict(nodeIds, graph, contracts)`: Verificador de invariantes.
  - `executionBaseArtifacts(graph, nodeId, adoptedArtifacts)`: Calculador de cierre de artefactos.
  - Tipos: `CanonicalExecutionDriverOptions`, `CanonicalExecutionRunInput`, `CanonicalExecutionTarget`, `CanonicalExecutorProfile`, `CanonicalNodeExecutionInput`, `CanonicalNodeExecutionOutcome`.
- **V2 / Legacy**:
  - `V2ExecutionDriver`, `leafFailureObservation`, `orderArtifactRequirementsForMaterialization`, `retryBudgetFor`.
  - Tipos: `V2ExecutionDriverOptions`, `V2ExecutionFreshnessInputs`, `V2ExecutionRunInput`, `V2ExecutionTarget`, `V2ExecutorProfile`, `V2NodeExecutionInput`, `V2NodeExecutionOutcome`, `V2RepairObservation`.

#### E. Estado de Transición y Brechas vs Rediseño
- **Estado**: Módulo transicional.
- **Destino / Plan de Retiro**: Según la Sección 9.12 del plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`), la coordinación de ejecución se consolida dentro de `packages/run-engine` y `apps/daemon`. Este paquete será retirado formalmente en Stage 11 tras completar la migración de callers y las pruebas de reachability.

#### F. Diagnóstico del README.md
- **Estado actual**: Stub de 11 líneas.
- **Deficiencias**: No documenta el funcionamiento de `CanonicalExecutionDriver`, ni las funciones de invariantes de recursos (`assertNoConcurrentResourceConflict`), ni la clausura de artefactos (`executionBaseArtifacts`).

---

## 3. Matriz Comparativa de Estado y Diagnóstico de READMEs

| Paquete | Rol en Arquitectura | Estado de Transición | Estado del README.md Actual | Acción Requerida |
|---|---|---|---|---|
| `packages/scheduler` | Scheduler puro de readiness y olas | Canónico (Stage 6 GS) + Legacy V1/V2 | ⚠️ Stub (11 líneas) | Reescribir en español con interfaces completas, `evaluateReadiness` y `selectFrontier`. |
| `packages/conflict-risk` | Predicción pairwise de riesgos | Transicional (a retirar en Stage 11) | ⚠️ Stub (13 líneas) | Documentar señales estáticas, schemas y justificación de retiro en favor de `ResourceClaim`. |
| `packages/execution-core` | Ejecución física, sandboxes, Git, validación | Canónico profundo (Stages 7-10) | ⚠️ Stub (12 líneas) | Reescribir en español detallando los 18 submódulos, manifests, sandboxes y validación. |
| `packages/run-store` | Persistencia de eventos, locks, outbox | Canónico (Stage 11 en progreso) | ⚠️ Stub (12 líneas) | Reescribir documentando JSONL, Fencing, FileEffectInputStore, Compactor y Replay. |
| `packages/trace-store` | Trazas diagnósticas no autoritativas | Canónico (estable) | ⚠️ Stub (11 líneas) | Reescribir documentando 62 tipos de trazas, redacción de secretos y durabilidad con checksum. |
| `packages/run-engine` | Motor de ejecución del daemon y actores | Canónico (Stage 2/3/11) | ❌ **Inexistente** | Crear `README.md` completo en español explicando el modelo de actores y efecto outbox. |
| `packages/run-coordinator` | Dominio, eventos, comandos y reductor | Canónico central | ❌ **Inexistente** | Crear `README.md` completo en español con catálogo de 42 eventos, reducer y proyecciones. |
| `packages/orchestrator-graph` | Driver de ejecución de grafos | Transicional (a consolidar en run-engine) | ⚠️ Stub (11 líneas) | Reescribir explicando `CanonicalExecutionDriver`, invariantes y plan de retiro. |

---

## 4. Guía de Interfaz y Dependencias Cruzadas entre Paquetes

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              MATRIZ DE DEPENDENCIAS                                    │
├──────────────────────┬─────────────┬──────────────┬──────────────┬──────────┬──────────┤
│ Consumidor \ Prov.   │ contracts   │ task-graph   │ run-coord.   │run-store │scheduler │
├──────────────────────┼─────────────┼──────────────┼──────────────┼──────────┼──────────┤
│ scheduler            │      X      │      X       │              │          │          │
│ conflict-risk        │      X      │              │              │          │          │
│ execution-core       │      X      │      X       │              │          │    X     │
│ run-store            │      X      │              │      X       │          │          │
│ trace-store          │             │              │              │          │          │
│ run-engine           │      X      │              │      X       │    X     │          │
│ run-coordinator      │      X      │      X       │              │          │          │
│ orchestrator-graph   │      X      │      X       │      X       │          │    X     │
└──────────────────────┴─────────────┴──────────────┴──────────────┴──────────┴──────────┘
```

---

## 5. Próximos Pasos para la Fase de Documentación

1. **Reescritura de los 8 `README.md`**:
   - Redactar en español claro, pedagógico y exhaustivo, preservando identificadores técnicos y código en inglés.
   - Incluir tablas de interfaces públicas, schemas Zod, clases y ejemplos de uso de código.
   - Declarar explícitamente el estado de transición de cada módulo según el plan del 2026-08-12.
2. **Generación de Guías de Arquitectura Centralizadas en `docs/modules/`**:
   - Consolidar guías técnicas detalladas para cada subsistema (Persistencia, Scheduling, Ejecución, Motor de Daemon).
   - Crear diagramas de flujo y matrices de interacción para terceros.
3. **Limpieza de Afirmaciones Obsoletas**:
   - Asegurar que no se describan conceptos descartados (e.g. pools de threads legacy, dependencias circulares a `@manyhands/core`, modelos de locks pairwise globales como permanentes).
