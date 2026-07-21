# Modelo operativo del run

> Contrato de estado implementado por backend, reducer, selectores, streaming y
> fixtures. Los schemas TypeScript/Zod son la referencia exacta de campos.

## 1. Fuentes de verdad

- Metadata del run: identidad, objetivo, target inmutable y configuración
  efectiva; el `RunRecord` web es cache/listado, no lifecycle canónico.
- `GraphRevision` + contract bundles: grafo compilado y obligaciones de una
  revisión.
- `RunEventLog`: hechos dinámicos append-only con `sequence` y causalidad; es la
  historia canónica.
- `AttemptJournal` y `ArtifactRegistry`: intentos inmutables y outputs adoptados.
- `Snapshot`: proyección versionada para cargar y recuperar; nunca autoridad
  independiente.
- `TraceStore`: logs, prompts y telemetría diagnóstica; nunca lifecycle.

## 2. Entidades principales

```ts
type Run = {
  id: RunId;
  goal: string;
  target: RunTargetContext;
  effectiveConfig: ExecutionConfig;
  graphRevision: number;
  approvedGraphRevision?: number;
};

type TaskNode = {
  id: NodeId;
  parentId?: NodeId;
  role: "root" | "composite" | "leaf";
  goal: string;
  boundary?: string;
  contractId: ContractId;
};

type GraphRevision = {
  schemaVersion: 2;
  graphId: string;
  revision: number;
  rootId: NodeId;
  baseCommit: string;
  repositorySnapshotId: string;
  nodes: Record<NodeId, TaskNode>;
  artifactRequirements: ArtifactRequirement[];
  seamBindings: SeamBinding[];
  conflictConstraints: ConflictConstraint[];
  createdAt: string;
};
```

Los contract bundles se persisten junto al evento `graph.compiled`, pero no se
duplican dentro de `GraphRevision`.

`children` se deriva de `parentId`. Readiness se deriva de requirements,
contratos, decisiones, recursos y artefactos. No se persisten shortcuts que
deban sincronizarse.

## 3. Intentos e inputs

```ts
type InputFingerprintSource = {
  graphId: string; // namespacing only; the graph revision is NOT an input
  nodeId: NodeId;
  contractRevisions: Array<{ id: ContractId; revision: string }>;
  baseCommit: string;
  consumedArtifacts: Array<{ id: ArtifactId; digest: string }>;
  repositoryContextDigest: string;
  executorProfile: { id: string; revision: string };
  validationContract: { id: ContractId; revision: string };
};

type NodeAttempt = {
  attemptId: AttemptId;
  runId: RunId;
  nodeId: NodeId;
  inputFingerprint: string;
  retryOfAttemptId?: AttemptId;
  createdAt: string;
  status: "created" | "running" | "finished" | "stale" | "adopted" | "failed";
  outputDigest?: string;
};
```

Los intentos no se mutan para fingir un reintento. Una nueva ejecución crea otra
entidad. La adopción compara el fingerprint con la revisión vigente. Si difiere,
el intento es `stale` aunque haya pasado sus checks.

## 4. Decisiones

```ts
type Decision = {
  id: DecisionId;
  kind:
    | "clarify_goal"
    | "approve_plan"
    | "approve_amendment"
    | "resolve_conflict"
    | "approve_delivery";
  question: string;
  options: DecisionOption[];
  affectedNodeIds: NodeId[];
  evidenceRefs: string[];
  impact: DecisionImpact;
  status: "pending" | "resolved" | "expired";
};
```

Una decisión pendiente afecta readiness solo a los nodos declarados. La
resolución puede producir otra revisión del grafo, pero no modifica directamente
estados visuales.

## 5. Lifecycle del run

| Estado | Significado |
|---|---|
| `planning` | inspección, planning o compilación del grafo |
| `needs_approval` | grafo válido esperando aprobación inicial |
| `running` | existe trabajo planificable, ejecutable, validable o integrable |
| `waiting_for_input` | decisiones pendientes y ningún trabajo independiente ready |
| `paused` | dispatch detenido por el usuario; procesos tratados según política |
| `cancelling` | autoridad invalidada y procesos en terminación |
| `interrupted` | ejecución detenida sin aceptar resultados tardíos |
| `result_ready` | candidato final verificado, todavía no entregado |
| `delivering` | preparando o publicando entrega |
| `completed` | manifest final válido y entrega confirmada |
| `failed` | no existe política automática o decisión pendiente que permita avanzar |

El estado se deriva de eventos y outcomes. No se persiste como una verdad que
pueda contradecirlos; un campo materializado debe incluir versión/cursor.

## 6. Estado derivado de nodo

La proyección web actual deriva:

`pending | ready | running | waiting | succeeded | failed | stale`

`integrationStatus` se mantiene separado como `running | completed | failed |
decision_required`. La UI traduce esos estados a copy y señales visuales más
ricas sin inventar un segundo lifecycle.

Prioridad conceptual:

1. input vigente o stale;
2. decisión pendiente;
3. intento/integración activa;
4. evidencia adoptada;
5. readiness o razón de bloqueo;
6. fallo terminal aplicable.

Un nodo `verified` puede volver a `stale` si cambian sus inputs. Eso es evolución,
no un fallo.

## 7. Eventos de dominio

Familias implementadas:

- intake/migration: `run.created`, `legacy.run_imported`;
- inspection/planning: `repository.inspected`, `planning.attempt_started`,
  `planning.node_discovered`, `planning.attempt_failed`, `planning.completed`,
  `planning.critic_recorded`, `planning.failed`, `graph.compiled`;
- graph/decisions: `graph.revision.proposed`, `graph.revision.approved`,
  `graph.amendment.proposed`, `decision.raised`, `decision.resolved`;
- scheduling/execution: `readiness.observed`, `wave.selected`,
  `attempt.started`, `attempt.candidate_created`, `attempt.repair_attempted`,
  `attempt.failed`, `attempt.discarded`, `attempt.stale`, `failure.classified`;
- validation/artifacts: `validation.started`, `validation.evidence_recorded`,
  `validation.completed`, `evidence.matrix_recorded`, `artifact.adopted`;
- integration: `integration.started`, `integration.repair_attempted`,
  `integration.completed`, `integration.failed`;
- control/delivery: `run.pause_requested`, `run.resume_requested`,
  `run.restart_requested`, `operation.cancel_requested`,
  `operation.interrupted`, `final_candidate.verified`, `delivery.started`,
  `delivery.published`, `delivery.failed`, `run.failed`.

Un evento se emite cuando el efecto ocurrió, no cuando se desea que ocurra. Los
comandos no se representan como hechos completados.

## 8. Freshness e invalidación

Freshness compara el `InputFingerprint` del intento/artefacto con el fingerprint
node-local vigente del nodo (no con la revisión global del grafo). Una enmienda
calcula dos conjuntos:

- `projectedImpact`: preview antes de aprobar;
- `realizedInvalidation`: artefactos e intentos cuyo fingerprint ya no coincide.

La invalidación se registra como hecho para auditabilidad, pero la decisión de
si un artefacto es utilizable siempre se verifica contra fingerprints. Esto evita
depender tanto de un evento olvidado como de una derivación sin explicación.

## 9. Outcomes terminales

Se mantienen separados:

```ts
type RunOutcomes = {
  execution: "pending" | "succeeded" | "failed" | "interrupted";
  artifact: "missing" | "candidate" | "verified" | "unverified" | "failed";
  delivery: "not_started" | "ready" | "published" | "failed";
};
```

`completed` exige `succeeded + verified + published`. No existe un estado que
llame completo a un resultado aceptado con validaciones fallidas.

## 10. Reducer y selectores

El reducer es puro: `(model, event) -> model`. Los selectores derivan lifecycle,
readiness, atención, freshness, wavefront, evidencia y representación de nodos.

Reglas:

- la UI no aplica overrides de status;
- los fixtures y el stream real comparten envelopes;
- eventos duplicados se manejan por identidad/seq;
- snapshots incluyen el cursor que materializan;
- replay desde snapshot + tail produce el mismo modelo que replay completo.
