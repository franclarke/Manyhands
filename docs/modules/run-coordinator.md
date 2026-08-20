# Guía Arquitectónica: @manyhands/run-coordinator

> **Ubicación en el Monorepo**: `packages/run-coordinator/`  
> **README del Paquete**: [`../../packages/run-coordinator/README.md`](../../packages/run-coordinator/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En arquitecturas dirigidas por eventos (*Event-Driven Architectures*), la separación entre la lógica de dominio pura y los efectos colaterales de infraestructura es indispensable para garantizar la reproducibilidad, la auditabilidad y la resiliencia del sistema. Si las reglas de transición de estado se mezclan con operaciones de red, lecturas de disco o invocaciones de APIs externas, el sistema se vuelve imposible de probar de forma determinista y susceptible a inconsistencias temporales.

**`@manyhands/run-coordinator`** es el **núcleo de dominio puro** de ManyHands. Define el catálogo canónico de eventos del sistema, los sobres de comandos con identidad criptográfica, el reductor de máquina de estados determinista (`reduceRun`, `foldRun`), el modelo causal de intentos inmutables (`InputFingerprint`), la gestión de decisiones humanas desacopladas y la taxonomía causal de fallos.

### Problemas Fundamentales que Resuelve

1. **Catálogo Canónico de Eventos de Dominio (`RunEvent`)**: Centraliza la definición estricta de los 42 tipos de eventos discriminados por [Zod](https://zod.dev) (`RunEventSchema`). Cada evento representa un hecho histórico inmutable del ciclo de vida de una corrida.
2. **Sobres de Comandos y Recibos Criptográficos (`RunCommandEnvelope`, `CommandReceipt`)**: Modela los comandos externos dirigidos al sistema con identidad canónica (`commandDigest`), verificación de revisión esperada (`expectedRevision`) y emisión de acuses de recibo firmados (`receiptId`).
3. **Reductor de Estado Puro y Determinista (`reduceRun`, `foldRun`)**: Función matemática pura libre de I/O que proyecta la historia completa de eventos en un estado estructurado (`RunProjection`). Rejugar cualquier secuencia ordenada de eventos produce exactamente la misma proyección.
4. **Identidad Inmutable de Intentos (`InputFingerprint`)**: Identifica de forma determinista cada intento de tarea mediante el hash de su nodo, contrato y artefactos consumidos, evitando reintentos ciegos.
5. **Decisiones Humanas Desacopladas (`Decision`)**: Modela solicitudes de intervención humana delimitando explícitamente los nodos afectados (`affectedNodeIds`), permitiendo que el planificador continúe ejecutando ramas independientes en paralelo.
6. **Clasificación Causal de Fallos y Enrutamiento de Reparación (`FailureClass`)**: Clasifica las excepciones en 7 categorías causales con presupuestos de reintento diferenciados y acciones de reparación permitidas.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `src/` está estructurado en módulos y submódulos de dominio puro:

```
packages/run-coordinator/src/
├── index.ts                    # Barrel export unificado
├── domain/                     # Submódulos de dominio puro
│   ├── events.ts               # RunEventSchema: catálogo de 42 eventos canónicos y sus payloads Zod
│   ├── lifecycle.ts            # Máquina de estados de ciclo de vida (RunLifecycle) y transiciones válidas
│   ├── attempts.ts             # Modelado de intentos inmutables (AttemptRecord)
│   ├── artifacts.ts            # AdoptedArtifactSchema, retenciones y autorizaciones de liberación
│   ├── decisions.ts            # DecisionInputSchema, resoluciones y autorizaciones permanentes
│   ├── evidence.ts             # EvidenceMatrixRecordSchema y bindings de evidencia
│   ├── failures.ts             # FailureClassSchema (7 clases) y observaciones de fallos
│   ├── fingerprint.ts          # Cálculo determinista de InputFingerprint
│   ├── human-review.ts         # Registros de revisión humana y gates de calidad
│   ├── outcomes.ts             # DeliveryApprovalSchema, DeliveryReceiptSchema y estado final
│   ├── autonomy.ts             # Políticas de autonomía y autorizaciones standing
│   └── repair-routing.ts       # Enrutamiento determinista de reparaciones según la causa del fallo
├── commands.ts                 # Schemas y tipos de comandos específicos
├── command-envelope.ts         # RunCommandEnvelope, CommandReceipt y validación de identidad
├── ipc-protocol.ts             # Protocolo IPC autenticado entre Daemon y Clientes Web
├── product-lifecycle.ts        # Definición de corrida de producto y fases
├── reducer.ts                  # Reductor de estado puro: reduceRun, foldRun, initialProjection
├── coordinator.ts              # RunCoordinator: orquestador de alto nivel
├── execution.ts                # Lógica de ejecución y transiciones de intentos
├── integration.ts              # Lógica de integración jerárquica y resolución
├── amendments.ts               # Propuesta y resolución de enmiendas al grafo
├── recovery-policy.ts          # Políticas de recuperación y circuit breakers
├── parallelism-observation.ts  # Métricas de paralelismo observado en tiempo de ejecución
└── ports.ts                    # Interfaces de puertos (Journal, State, etc.)
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `domain/events.ts` | Define `RunEventSchema` (42 variantes discriminadas por `type`), tipos auxiliares como `AttemptUsageSchema`, `PlanningCandidateEvaluationSchema` y las estructuras base de eventos. |
| `domain/lifecycle.ts` | Define el ciclo de vida `RunLifecycle` (`"created"`, `"planning"`, `"ready"`, `"running"`, `"paused"`, `"completed"`, `"failed"`, `"archived"`) y la función `assertLifecycleTransition`. |
| `domain/fingerprint.ts` | Expone `computeInputFingerprint` para garantizar la identidad inmutable de cada intento de ejecución. |
| `domain/failures.ts` | Define las 7 clases de fallos: `"tool_permission"`, `"budget"`, `"stale_basis"`, `"ambiguous_specification"`, `"verification_failure"`, `"infrastructure_transient"`, `"internal_invariant_violation"`. |
| `domain/decisions.ts` | Modela el ciclo de vida de decisiones (`raised`, `resolved`, `expired`), opciones de resolución y vinculación con `StandingAuthorization`. |
| `command-envelope.ts` | Implementa `buildRunCommandEnvelope`, `validateRunCommandEnvelopeIdentity`, `buildCommandReceipt` y `validateCommandReceiptIdentity`. |
| `reducer.ts` | Implementa el reductor de dominio `reduceRun(projection, event)` y `foldRun(events)`. Mantiene proyecciones de intentos, integraciones, artefactos adoptados, decisiones pendientes, matrices de evidencia y métricas de costos. |

---

## 3. Flujos de Control y Datos

### Reductor Puro y Desacoplamiento de Decisiones

```
   Historial de Eventos (RunEvent[])
                  │
                  ▼
         ┌──────────────────┐
         │     foldRun      │  (Pliegue determinista sin efectos I/O)
         └────────┬─────────┘
                  │
                  ▼
┌────────────────────────────────────┐       Nuevo RunEvent (Hecho)
│           RunProjection            │                  │
│ • Estado de ciclo de vida          │                  │
│ • Intentos y Artefactos Adoptados  │                  ▼
│ • Matrices de Evidencia            ├────────►┌──────────────────┐
│ • Decisiones Humanas Pendientes    │         │    reduceRun     │
└────────────────────────────────────┘         └────────┬─────────┘
                                                        │
                                                        ▼
                                               ┌──────────────────┐
                                               │  RunProjection   │ (Nueva Proyección)
                                               └──────────────────┘

                 Manejo de Decisiones Desacopladas
                                 │
                   Evento decision.raised(nodeX)
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       Nodos en affectedNodeIds          Ramas Independientes
        (nodeX y descendientes)           (nodeY, nodeZ, etc.)
                 │                               │
                 ▼                               ▼
      Pausados en el Scheduler        Continúan Ejecutándose
      en espera de resolución           en Paralelo Normal
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Catálogo de los 42 Eventos Canónicos de Dominio

| Categoría | Eventos Canónicos |
|---|---|
| **Ciclo de Vida** | `run.created`, `run.renamed`, `run.archived`, `run.pause_requested`, `run.resume_requested`, `run.restart_requested`, `run.failed`, `legacy.run_imported` |
| **Comandos y Efectos** | `command.accepted`, `effect.requested`, `effect.observed`, `effect.completed`, `effect.failed`, `effect.interrupted`, `operation.cancel_requested`, `operation.interrupted` |
| **Repositorio y Planificación** | `repository.inspected`, `planning.attempt_started`, `planning.node_discovered`, `planning.attempt_failed`, `planning.unit_unresolved`, `planning.granularity_strategy_selected`, `planning.envelope_created`, `planning.candidates_evaluated`, `planning.completed`, `planning.critic_recorded`, `planning.failed`, `graph.compiled` |
| **Intentos y Fallos** | `attempt.started`, `attempt.candidate_created`, `attempt.repair_attempted`, `attempt.failed`, `attempt.discarded`, `attempt.stale`, `failure.classified` |
| **Validación y Evidencia** | `evidence.matrix_recorded`, `validation.started`, `validation.evidence_recorded`, `validation.completed`, `human_review.recorded`, `final_candidate.verified` |
| **Artefactos e Integración** | `artifact.adopted`, `artifact.retention_release_authorized`, `integration.started`, `integration.repair_attempted`, `integration.completed`, `integration.failed` |
| **Grafo y Decisiones** | `graph.amendment.proposed`, `graph.revision.proposed`, `graph.revision.approved`, `decision.raised`, `decision.resolved`, `decision.expired`, `readiness.observed`, `wave.selected` |
| **Entrega** | `delivery.started`, `delivery.published`, `delivery.failed` |

### Firmas de Funciones Principales

```typescript
export function reduceRun(
  projection: RunProjection,
  event: RunEvent
): RunProjection;

export function foldRun(
  events: readonly RunEvent[],
  initial?: RunProjection
): RunProjection;

export function initialProjection(runId: string): RunProjection;

export function computeInputFingerprint(
  nodeId: string,
  contractDigest: string,
  consumedArtifactDigests: readonly string[]
): string;

export function routeRepair(
  failure: FailureClassificationRecord,
  context: RepairRoutingContext
): RepairActionRecommendation;
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Reductor de Estado Puro (State Machine as Pure Function)
`reduceRun` es una función matemática pura sin efectos colaterales ni dependencias del entorno:
- **Inmutabilidad Estricta**: No muta el objeto `RunProjection` de entrada; devuelve una nueva proyección con los cambios aplicados.
- **Reproducibilidad y Time-Travel**: Cualquier réplica, test o cliente web que reproduzca los eventos en orden obtendrá exactamente la misma proyección.

### 2. Identidad Causal de Intentos (`InputFingerprint`)
Un intento se identifica de forma determinista mediante su huella criptográfica de entradas:
$$\text{InputFingerprint} = \text{SHA-256}(\text{nodeId} \parallel \text{contractDigest} \parallel \text{consumedArtifactDigests})$$
Si un nodo falla, el sistema exige clasificar la causa del fallo (`failure.classified`). Si la causa es transitoria (`infrastructure_transient`), se permite un reintento bajo presupuesto; de lo contrario, se requiere una enmienda (`graph.amendment.proposed`).

### 3. Decisiones Humanas Desacopladas
Cuando un intento requiere intervención humana (ambigüedad o conflicto de integración):
1. Se emite `decision.raised` delimitando `affectedNodeIds`.
2. El scheduler bloquea únicamente los nodos declarados y sus dependientes transitivos.
3. Todas las ramas independientes del grafo continúan ejecutándose normalmente en paralelo.
4. Al recibir `decision.resolved`, se desbloquean los nodos afectados y se reanuda la ejecución.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 1 / G1 y Stage 3 / GR)**: El catálogo de 42 eventos canónicos, los sobres de comandos y el reductor de dominio puro están completamente cerrados y verificados en `docs/audits/stage-1/` y `docs/audits/stage-3/`.
2. **Proyección Unificada**: La misma lógica de `reduceRun` y `foldRun` se utiliza tanto en el servidor (`apps/daemon`) como en el cliente web (`apps/web`), garantizando coherencia absoluta de estado.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/run-coordinator/README.md`](../../packages/run-coordinator/README.md)
- **Módulos Relacionados**:
  - [`run-engine.md`](./run-engine.md): Motor de actores duraderos que ejecuta las decisiones de dominio.
  - [`run-store.md`](./run-store.md): Persistencia física de los 42 eventos en `.events.v2.jsonl`.
  - [`contracts.md`](./contracts.md): Definición de contratos que alimentan las proyecciones.
  - [`orchestrator-graph.md`](./orchestrator-graph.md): Driver de ejecución de olas conectado a `RunCoordinator`.
- **Documentación Central**: [`../README.md`](../README.md)
