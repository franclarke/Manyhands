# @manyhands/run-coordinator

Núcleo de dominio puro, catálogo canónico de eventos de dominio, sobres de comandos con recibos criptográficos, reductor de máquina de estados determinista y gestión de ciclo de vida para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/run-coordinator` es el núcleo de dominio de ManyHands. Define el vocabulario canónico, las interfaces de protocolo y el reductor de estado puro que gobierna el ciclo de vida completo de una corrida:

1. **Catálogo Canónico de Eventos de Dominio (`RunEvent`)**: Centraliza la definición de los 42 tipos de eventos discriminados por Zod (`RunEventSchema`). Cada evento representa un hecho inmutable del ciclo de vida (creación, planificación, intentos, validación, adopción de artefactos, decisiones e integración).
2. **Sobres de Comandos y Recibos Criptográficos (`RunCommandEnvelope`, `CommandReceipt`)**: Modela los comandos externos dirigidos al sistema (`submit`) con identidad canónica (`commandDigest`), verificación de revisión esperada (`expectedRevision`) y emisión de acuses de recibo firmados (`receiptId`).
3. **Reductor de Estado Puro y Determinista (`reduceRun`, `foldRun`)**: Función pura libre de I/O que proyecta la historia completa de eventos en un estado estructurado (`RunProjection`). Rejugar cualquier secuencia ordenada de eventos produce exactamente la misma proyección matemática.
4. **Identidad Inmutable de Intentos (`InputFingerprint`)**: Identifica de forma determinista cada intento de tarea mediante el hash de su nodo, contrato y artefactos consumidos, evitando reintentos ciegos y asegurando trazabilidad causal.
5. **Decisiones Humanas Desacopladas (`Decision`)**: Modela solicitudes de intervención humana (`decision.raised`, `decision.resolved`) delimitando explícitamente los nodos afectados (`affectedNodeIds`), permitiendo que el planificador continúe ejecutando ramas independientes en paralelo.
6. **Clasificación Causal de Fallos y Enrutamiento de Reparación (`FailureClass`)**: Clasifica las excepciones en 7 categorías causales con presupuestos de reintento diferenciados y acciones de reparación permitidas.

---

## 2. Arquitectura Modular Interna

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

### Desglose Detallado por Módulo

- **`domain/events.ts`**: Define `RunEventSchema` (42 variantes discriminadas por `type`), tipos auxiliares como `AttemptUsageSchema`, `PlanningCandidateEvaluationSchema`, `PlanningCandidateSelectionSchema`, `SchedulerExplanationSchema` y las estructuras base de eventos.
- **`domain/lifecycle.ts`**: Define el tipo `RunLifecycle` (`"created"`, `"planning"`, `"ready"`, `"running"`, `"paused"`, `"completed"`, `"failed"`, `"archived"`) y la función `assertLifecycleTransition`.
- **`domain/fingerprint.ts`**: Expone `computeInputFingerprint(nodeId, contractDigest, consumedArtifactDigests)` para garantizar la inmutabilidad e identidad única de cada intento.
- **`domain/failures.ts`**: Define las 7 clases de fallos: `"tool_permission"`, `"budget"`, `"stale_basis"`, `"ambiguous_specification"`, `"verification_failure"`, `"infrastructure_transient"`, `"internal_invariant_violation"`.
- **`domain/decisions.ts`**: Modela el ciclo de vida de decisiones (`raised`, `resolved`, `expired`), opciones de resolución y vinculación con `StandingAuthorization`.
- **`domain/artifacts.ts`**: Modela artefactos adoptados (`AdoptedArtifact`) con sus SHAs de árbol Git y digests de manifiesto.
- **`command-envelope.ts`**: Implementa `buildRunCommandEnvelope`, `validateRunCommandEnvelopeIdentity`, `buildCommandReceipt` y `validateCommandReceiptIdentity`.
- **`reducer.ts`**: Implementa el reductor de dominio `reduceRun(projection, event)` y `foldRun(events)`. Mantiene proyecciones de intentos, integraciones, artefactos adoptados, decisiones pendientes, matrices de evidencia y métricas de costos.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Reductor de Estado Puro (State Machine as Pure Function)

`reduceRun` es una función pura determinista sin efectos colaterales ni llamadas de I/O:

```
  RunProjection (Estado t) ──┐
                             ├─► reduceRun(projection, event) ──► RunProjection (Estado t+1)
        RunEvent (Hecho)   ──┘
```

- **Inmutabilidad Estricta**: No muta el objeto `RunProjection` de entrada; devuelve una nueva proyección con los cambios aplicados.
- **Reproducibilidad Garantizada**: Cualquier cliente o réplica que reproduzca los eventos en orden obtendrá exactamente la misma proyección, facilitando la depuración histórica (*time-travel debugging*).

### 3.2. Identidad Causal de Intentos (`InputFingerprint`)

Un intento no se identifica por un contador incremental simple, sino por su huella criptográfica de entradas:

$$\text{InputFingerprint} = \text{SHA-256}(\text{nodeId} \parallel \text{contractDigest} \parallel \text{consumedArtifactDigests})$$

Si un nodo falla y debe reintentarse sin cambios en sus dependencias ni en su contrato, el sistema exige clasificar la causa del fallo (`failure.classified`). Si la causa es un fallo transitorio de infraestructura, se permite un reintento con el mismo fingerprint bajo un presupuesto acotado (`automaticRetryBudget`); de lo contrario, se requiere una enmienda (`graph.amendment.proposed`) que actualice el contrato o las entradas.

### 3.3. Decisiones Humanas Desacopladas

Cuando un intento requiere intervención humana (por ambigüedad de especificación o conflicto de integración irresoluble):
1. Se emite `decision.raised` con la lista de `affectedNodeIds`.
2. El planificador (`@manyhands/scheduler`) bloquea **únicamente** los nodos declarados en `affectedNodeIds` y sus dependientes transitivos.
3. Todas las ramas independientes del grafo continúan ejecutándose normalmente en paralelo.
4. Al recibir `decision.resolved`, se desbloquean los nodos afectados y se reanuda la ejecución.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Clases, Funciones y Schemas

| Símbolo | Tipo | Archivo | Descripción |
|---|---|---|---|
| `RunEventSchema` | Zod Schema | `domain/events.ts` | Schema de validación para los 42 tipos de eventos de dominio. |
| `RunCommandEnvelopeSchema` | Zod Schema | `command-envelope.ts` | Schema de sobre de comando con verificación de identidad canónica. |
| `CommandReceiptSchema` | Zod Schema | `command-envelope.ts` | Acuse de recibo duradero emitido por un actor de corrida. |
| `reduceRun` | Función | `reducer.ts` | Aplica un evento a una proyección y retorna el nuevo estado proyectado. |
| `foldRun` | Función | `reducer.ts` | Pliega una lista completa de eventos en una `RunProjection`. |
| `initialProjection` | Función | `reducer.ts` | Crea la proyección vacía inicial para un `runId`. |
| `computeInputFingerprint` | Función | `domain/fingerprint.ts` | Calcula la huella inmutable de un intento. |
| `routeRepair` | Función | `domain/repair-routing.ts` | Determina la estrategia de reparación ante un fallo clasificado. |
| `AdoptedArtifactSchema` | Zod Schema | `domain/artifacts.ts` | Schema de validación de artefactos adoptados formalmente. |
| `DecisionInputSchema` | Zod Schema | `domain/decisions.ts` | Schema de solicitud de decisión humana. |
| `FailureClassSchema` | Zod Schema | `domain/failures.ts` | Enum Zod con las 7 clases canónicas de fallo. |

### 4.2. Catálogo de los 42 Eventos de Dominio

| Categoría | Eventos Canónicos |
|---|---|
| **Ciclo de Vida de Corrida** | `run.created`, `run.renamed`, `run.archived`, `run.pause_requested`, `run.resume_requested`, `run.restart_requested`, `run.failed`, `legacy.run_imported` |
| **Comandos y Efectos** | `command.accepted`, `effect.requested`, `effect.observed`, `effect.completed`, `effect.failed`, `effect.interrupted`, `operation.cancel_requested`, `operation.interrupted` |
| **Repositorio y Planificación** | `repository.inspected`, `planning.attempt_started`, `planning.node_discovered`, `planning.attempt_failed`, `planning.unit_unresolved`, `planning.granularity_strategy_selected`, `planning.envelope_created`, `planning.candidates_evaluated`, `planning.completed`, `planning.critic_recorded`, `planning.failed`, `graph.compiled` |
| **Intentos y Fallos** | `attempt.started`, `attempt.candidate_created`, `attempt.repair_attempted`, `attempt.failed`, `attempt.discarded`, `attempt.stale`, `failure.classified` |
| **Validación y Evidencia** | `evidence.matrix_recorded`, `validation.started`, `validation.evidence_recorded`, `validation.completed`, `human_review.recorded`, `final_candidate.verified` |
| **Artefactos e Integración** | `artifact.adopted`, `artifact.retention_release_authorized`, `integration.started`, `integration.repair_attempted`, `integration.completed`, `integration.failed` |
| **Grafo, Decisiones y Scheduling** | `graph.amendment.proposed`, `graph.revision.proposed`, `graph.revision.approved`, `decision.raised`, `decision.resolved`, `decision.expired`, `readiness.observed`, `wave.selected` |
| **Entrega** | `delivery.started`, `delivery.published`, `delivery.failed` |

### 4.3. Ejemplo de Uso: Reducción Determinista y Creación de Comandos

```typescript
import {
  foldRun,
  reduceRun,
  buildRunCommandEnvelope,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";
import { createHash } from "node:crypto";
import type { DigestHasher } from "@manyhands/contracts";

const hasher: DigestHasher = (data: string) =>
  `sha256:${createHash("sha256").update(data, "utf8").digest("hex")}`;

// 1. Construir un sobre de comando canónico
const commandEnvelope = buildRunCommandEnvelope({
  commandId: "cmd-001",
  runId: "run-2026-08-18-001",
  expectedRevision: 0,
  submittedAt: new Date().toISOString(),
  command: {
    type: "create_run",
    goal: "Refactorizar autenticación a JWT"
  }
}, hasher);

console.log("Comando construido con digest:", commandEnvelope.commandDigest);

// 2. Historial de eventos
const events: RunEvent[] = [
  {
    eventId: "evt-1",
    runId: "run-2026-08-18-001",
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: "run.created",
    payload: { goal: "Refactorizar autenticación a JWT" }
  },
  {
    eventId: "evt-2",
    runId: "run-2026-08-18-001",
    sequence: 2,
    occurredAt: new Date().toISOString(),
    type: "planning.attempt_started",
    payload: { attempt: 1 }
  }
];

// 3. Proyectar el estado mediante foldRun
const projection: RunProjection = foldRun(events);
console.log(`Estado: ${projection.lifecycle}, Secuencia: ${projection.sequence}`);

// 4. Aplicar un nuevo evento mediante reduceRun
const nextEvent: RunEvent = {
  eventId: "evt-3",
  runId: "run-2026-08-18-001",
  sequence: 3,
  occurredAt: new Date().toISOString(),
  type: "decision.raised",
  payload: {
    decision: {
      id: "dec-auth-flow",
      kind: "clarify_goal",
      question: "¿Utilizar RS256 o EdDSA como algoritmo JWT?",
      options: [
        { id: "opt-rs256", label: "RS256" },
        { id: "opt-eddsa", label: "EdDSA" }
      ],
      affectedNodeIds: ["node-auth-service"],
      evidenceRefs: [],
      impact: "architecture"
    }
  }
};

const updatedProjection = reduceRun(projection, nextEvent);
console.log(`Decisiones registradas: ${Object.keys(updatedProjection.decisions).length}`);
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan maestro normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Secciones 9.11 a 9.15):

| Componente | Estado de Rediseño | Observaciones |
|---|---|---|
| **Catálogo de 42 Eventos** | Estable ✅ | Define el vocabulario canónico completo sin dependencias circulares. |
| **Reductor Determinista** | Estable ✅ | `reduceRun` y `foldRun` implementan la totalidad de transiciones de dominio. |
| **Compatibilidad Histórica** | Estable ✅ | Admite replays de corridas antiguas con payloads legacy (`breakdown` en `planning.completed`). |
| **Sobres de Comandos e IPC** | Estable ✅ | Protocolo autenticado entre Daemon y Clientes Web formalizado. |

---

## 6. Comandos de Verificación y Testing

Para verificar los tipos estáticos y compilar `@manyhands/run-coordinator`:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/run-coordinator typecheck

# Compilación de paquetes (ESM y CJS con DTS)
pnpm --filter @manyhands/run-coordinator build
```
