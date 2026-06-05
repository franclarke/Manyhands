# Modelo operativo del run — núcleo técnico

> Estado: **congelado** (2026-06-05) con los refinamientos **A–P** (ver [Refinamientos A–P](#refinamientos-congelados-ap)). Validado por dos stress tests: [`golden-behavioral-conflict`](golden-fixtures.md) y [`golden-seam-amendment-blast-radius`](golden-fixtures.md).
>
> Este documento es la base directa para implementar `runStore`, el reducer, los fixtures golden, los eventos SSE y las proyecciones de UI. Define **contratos conceptuales**, no implementación. Los pseudo-tipos TypeScript aclaran forma; no son código a copiar.

---

## 0. Principio rector: dónde vive la verdad

> **Identidad y configuración del run = record mutable. Dinámica del run = event log append-only. Todo lo que la UI muestra como "estado actual" = derivado del log, nunca almacenado.**

- **Record** (pequeño, mutable): id, intención, workspace, config, puntero al snapshot.
- **Event log** (append-only, ordenado por `seq`): toda la dinámica (planning, grounding, waves, verify, conflictos, decisiones, integración, disposición).
- **Snapshot materializado** = un *fold* del log, cacheado para carga rápida y evidencia final. Es caché, **no** otra fuente de verdad.
- **Derivado** (fase, salud, wavefront, atención, `ExecutionState` de cada nodo, `freshness`, blast radius): se computa del log. Persistir cualquiera reintroduce doble fuente de verdad.

Consecuencia operativa: **fixtures y stream SSE comparten la misma forma** (arrays de `RunEvent`), procesados por el mismo reducer puro. Ver [`golden-fixtures.md`](golden-fixtures.md).

---

## 1. `RunEvent` — envelope

```ts
type RunEvent = {
  seq: number;          // monotónico por run — clave de orden y cursor
  at: string;           // ISO-8601
  runId: string;
  actor: "system" | "agent" | "human";
  type: string;         // punteado, p.ej. "node.verify.iteration"
  payload: Record<string, unknown>;
};
```

**Regla de payload:** nunca embeber diffs ni logs. Artefactos pesados van por referencia (`diffRef`, `logRef`, `diagnosisRef`, `failuresRef`, `narrativeRef`) y se resuelven on-demand. El log se mantiene liviano y barato de reducir.

---

## 2. Entidades centrales

```ts
Run         // identidad + config + contexto; ciclo de vida vía log
Node        // tarea del DAG; role ∈ {root, composite, leaf}; lleva ExecutionState
Seam        // contrato entre nodos (lo que habilita el paralelismo)
Wave        // grupo de nodos que se volvieron paralelizables juntos
Decision    // recurso unificado para intervención humana
Conflict    // incompatibilidad detectada, tipada por dimensión
Amendment   // cambio propuesto al plan vivo (scope / contrato / firma de seam)
Evidence    // resultado materializado final
```

### Run

```ts
type Run = {
  id: string;
  intent: string;
  workspaceId: string;
  config: { aggressiveness: "low" | "medium" | "high";
            planningModel: string; executionSelection: ExecutorSelection; repairSelection: ExecutorSelection };
  context?: { repo: string; baseCommit: string; readiness: "ok" | "warning" | "error" };
  snapshotRef?: string;
};
```

### Node

```ts
type Node = {
  id: string; parentId: string | null;
  role: "root" | "composite" | "leaf";
  title: string; goal: string; depth: number;
  scope: { paths: string[]; origin: "guessed" | "derived" };  // guessed en Proposal, derived en Foundation
  produces: SeamId[]; consumes: SeamId[];
  execution: ExecutionState;        // DERIVADO del fold de node.* / integration.*
};

type ExecutionState =
  | { kind: "idle" }
  | { kind: "blocked"; waitingOn: (NodeId | SeamId | DecisionId)[] }
  | { kind: "grounding" }
  | { kind: "running"; agent: string; model: string }
  | { kind: "verifying"; loop: VerifyLoop }
  | { kind: "integrated"; commit: string }
  | { kind: "failed"; cause: string };

type VerifyLoop = { iteration: number; maxIterations: number;
                    build: "pending" | "pass" | "fail"; testsPass: number; testsTotal: number };
```

> La **unidad verificable de trabajo** no es una entidad aparte: es un *leaf visto por su `VerifyLoop`*. "Anda" ⇔ `build:"pass"` ∧ `testsPass == testsTotal`.

### Seam

```ts
type Seam = {
  id: string; name: string;
  producerNodeId: NodeId; consumerNodeIds: NodeId[];
  signature: { draft: string; frozen?: string; extractedFrom?: string };  // SINTAXIS (tipos)
  contract?: Record<string, string>;   // SEMÁNTICA (p.ej. {"duration.unit":"ms"}) — se completa por demanda
  revision: number;                     // 1 al congelar; +1 en cada seam.amended
  state: "draft" | "frozen" | "amended";
};
```

> **Insight central:** congelar un seam fija su **sintaxis**, no su **semántica**. Por eso los conflictos conductuales sobreviven al grounding, y por eso resolver uno **enriquece `contract`** (vía `seam.amended`) para que no recurra.

### Wave

```ts
type Wave = { id: string; index: number; nodeIds: NodeId[]; unlockedBySeams: SeamId[];
              opened?: boolean; closed?: boolean };
```

> Membresía **emitida como evento** (auditable, la UI no re-corre el scheduler). El **wavefront vivo** (qué corre ahora) es **derivado** de los `ExecutionState`, no de los records de `Wave`. (Razón: la re-ejecución por enmienda no abre wave; ver [`golden-seam-amendment-blast-radius`](golden-fixtures.md).)

### Decision

```ts
type Decision = {
  id: string;
  kind: "approve_plan" | "clarify" | "resolve_conflict" | "approve_amendment" | "approve_merge";
  blocking: boolean;                                   // bloquea el subárbol afectado vs FYI
  context: { nodeIds?: NodeId[]; seamId?: SeamId; conflictId?: ConflictId;
             amendmentId?: AmendmentId; question?: string; options?: string[]; diffRef?: string };
  status: "pending" | "resolved";
  resolution?: { choice: DecisionChoice; actor: "human"; at: string };
};

type DecisionChoice =                                   // estructurado, NO string libre
  | { action: "approve" | "reject" | "accept" }
  | { resolutionId: string }                            // resolver conflicto
  | { answer: string };                                 // clarify
```

> Recurso **unificado**: todos los gates humanos son `decision.raised` / `decision.resolved` con distinto `kind`. Esto es lo que permite un canal de atención coherente.

### Conflict

```ts
type Conflict = {
  id: string;
  dimension: "textual" | "interface" | "behavioral" | "structural";
  status: "detected" | "decided" | "resolved";
  nodeIds: NodeId[]; seamId?: SeamId; files: string[];
  autoResolvable: boolean;
  diagnosisRef: string;                                 // dos interpretaciones, assertion que falla, candidatos + blast
  resolution?: { by: "system" | "human"; resolutionId: string };
};
```

> La taxonomía fina de "qué clase de conflicto conductual" vive en el `diagnosisRef`, **no** en más valores de `dimension`. No explotar el enum.

### Amendment

```ts
type Amendment = {
  id: string; nodeId: NodeId;
  kind: "scope" | "seam";
  changeKind: "contract" | "signature";                // signature = rompe consumidores
  detail: { seamId?: SeamId; fromRevision?: number; toRevision?: number;
            newSignature?: string; contract?: Record<string, string>; paths?: string[] };
  affects: NodeId[];                                    // snapshot del blast radius AS-PROPOSED (auditoría)
  status: "proposed" | "applied";
};
```

### Evidence

```ts
type Evidence = {
  aggregateDiffRef: string; tests: { pass: number; total: number };
  narrativeRef: string; integrationCommit: string;
  invalidationTrace?: Array<{ seamId: SeamId; from: number; to: number; cause: string;
                              reExecuted: NodeId[]; reIntegrated: NodeId[]; preserved: NodeId[] }>;
};
```

### Persistido vs derivado

| Persistido (record / log / evento) | Derivado (nunca almacenado) |
|---|---|
| Run record (identidad+config+contexto) | fase, salud, wavefront, atención |
| Event log (toda la dinámica) | `ExecutionState` de cada nodo |
| Decisions (pending/resolved) | `freshness` de cada nodo (stale/fresh) |
| Wave (membresía vía evento) | listas de blocked / invalidated / conflictos activos / pendientes-de-re-ejecución |
| Seam (revision, signature, contract — vía eventos) | blast radius vivo |
| Evidence (snapshot final) | `selectRenderableNodeState` (execution × freshness) |

---

## 3. Familias de eventos y payload mínimo

Marca: **v1** = necesario para demo con fixtures · **v2** = posterior, **no bloquea v1**. `M` = mapea de un evento/endpoint actual · `N` = nuevo.

### Framing
| type | actor | payload mínimo | | demo |
|---|---|---|---|---|
| `run.created` | system | `{intent, workspaceId, config}` | M | v1 |
| `run.context.resolved` | system | `{repo, baseCommit, readiness}` | M | v1 |

### Proposal
| type | actor | payload | | demo |
|---|---|---|---|---|
| `plan.started` | system | `{}` | M | v1 |
| `plan.node.proposed` | system | `{nodeId, parentId, role, title, goal, depth}` | M | v1 |
| `plan.seam.proposed` | system | `{seamId, name, producerNodeId, consumerNodeIds, draftSignature}` | N | v1 |
| `plan.node.thinking` | system | `{nodeId, attempt, maxAttempts}` | M | v2 |
| `plan.cli.output` | agent | `{nodeId, chunk, stream}` | M | v2 |
| `plan.ready` | system | `{rootId, nodeCount, seamCount, criticFindings}` | M | v1 |

### Foundation (todo N — el grounding no existe aún en backend)
| type | actor | payload | demo |
|---|---|---|---|
| `grounding.started` | system | `{}` | v1 |
| `skeleton.file.committed` | system | `{path, kind}` | v1 |
| `seam.frozen` | system | `{seamId, revision, frozenSignature, extractedFrom}` | v1 |
| `scope.derived` | system | `{nodeId, paths}` | v1 |
| `wave.planned` | system | `{waves:[{waveId, index, nodeIds, unlockedBySeams}]}` | v1 |
| `grounding.completed` | system | `{skeletonCommit}` | v1 |

### Supervision
| type | actor | payload | | demo |
|---|---|---|---|---|
| `wave.opened` | system | `{waveId, nodeIds}` | N | v1 |
| `node.execution.started` | agent | `{nodeId, agent, model, reason?}` | M | v1 |
| `node.verify.iteration` | agent | `{nodeId, iteration, maxIterations, build, testsPass, testsTotal}` | N | v1 |
| `node.verify.passed` | agent | `{nodeId, commit, changedFiles, builtAgainst, produces?}` | M~ | v1 |
| `node.verify.failed` | agent | `{nodeId, iteration, cause}` | N | v1 |
| `node.repair.started` | agent | `{nodeId, reason}` | N | v1 |
| `node.execution.failed` | agent | `{nodeId, cause}` | M~ | v1 |
| `node.blocked` | system | `{nodeId, waitingOn}` | N | v2 |
| `node.cli.output` | agent | `{nodeId, chunk, stream}` | M | v2 |
| `wave.closed` | system | `{waveId}` | N | v1 |
| `amendment.proposed` | agent | `{amendmentId, nodeId, kind, changeKind, detail, affects, diagnosisRef?}` | N | v1 (signature) |
| `seam.amended` | system | `{seamId, revision, changeKind, signature?, contract?}` | N | v1 |
| `amendment.applied` | system | `{amendmentId}` | N | v1 |

### Reconciliation
| type | actor | payload | | demo |
|---|---|---|---|---|
| `integration.started` | system | `{compositeNodeId, childNodeIds}` | M | v1 |
| `integration.cherrypick` | system | `{compositeNodeId, childNodeId, ok, conflictFiles}` | M | v2 |
| `conflict.detected` | system | `{conflictId, dimension, status, nodeIds, seamId?, files, autoResolvable, diagnosisRef}` | N | v1 |
| `conflict.repair.started` | system | `{conflictId}` | M | v2 |
| `conflict.resolved` | system | `{conflictId, by, resolutionId}` | N | v1 |
| `integration.validated` | system | `{compositeNodeId, testsPass, testsTotal, passed, builtAgainst, failuresRef?}` | N | v1 |
| `integration.completed` | system | `{compositeNodeId, commit, status}` | M | v1 |

### Disposition
| type | actor | payload | | demo |
|---|---|---|---|---|
| `run.evidence.ready` | system | `{aggregateDiffRef, tests, narrativeRef, integrationCommit, invalidationTrace?}` | N | v1 |
| `run.completed` | system | `{status}` | M | v1 |
| `run.accepted` / `run.rejected` | human | `{mergeCommit?, actor}` | N | v2 |

### Cross-cutting (decisiones humanas)
| type | actor | payload | | demo |
|---|---|---|---|---|
| `decision.raised` | system | `{decisionId, kind, blocking, context}` | M~ | v1 |
| `decision.resolved` | human | `{decisionId, choice, actor}` | M~ | v1 |

> **Emisión atómica de gates (refinamiento E).** `plan.ready` co-emite `decision.raised{approve_plan}`; `conflict.detected{autoResolvable:false}` co-emite `decision.raised{resolve_conflict}`; `amendment.proposed` co-emite `decision.raised{approve_amendment}`; `evidence.ready` co-emite `decision.raised{approve_merge}`. Esto elimina la "ventana de flicker" donde la salud diría "atención" pero el canal estaría vacío.

---

## 4. Reducer puro

El reducer `(model, event) → model` construye un `RunModel` normalizado. Puro ⇒ testeable sin servidor, idéntico para fixtures y SSE.

```ts
type RunModel = {
  run: Run;
  nodes: Map<NodeId, Node>;          // execution derivado de node.* / integration.*
  seams: Map<SeamId, Seam>;          // revision/signature/contract/state vía seam.*
  waves: Map<WaveId, Wave>;
  conflicts: Map<ConflictId, Conflict>;
  decisions: Map<DecisionId, Decision>;
  amendments: Map<AmendmentId, Amendment>;
  evidence?: Evidence;
  cursor: number;                    // último seq aplicado
};
```

**Reglas de reducción (ejemplos representativos):**
- `node.execution.started` → `nodes[id].execution = running{agent,model}`.
- `node.verify.iteration` → `execution = verifying{loop}`.
- `node.verify.passed` → `execution = integrated{commit}` y se registra `builtAgainst` del nodo.
- `seam.frozen` → `seams[id] = {…, revision:1, state:"frozen"}`.
- `seam.amended` → actualiza `revision`/`signature`/`contract`, `state:"amended"`. **No marca nodos**; la staleness se re-deriva (ver [§7](#7-invalidación-blast-radius-y-re-ejecución)).
- `decision.raised` → `decisions[id] = {…, status:"pending"}`.
- `decision.resolved` → `status:"resolved"`, guarda `resolution`.
- `conflict.detected` → `conflicts[id] = {…, status:"detected"}`; `conflict.resolved` → `status:"resolved"`.

**Invariante de reducción:** ningún evento escribe `freshness`, `phase`, `health`, `wavefront` ni listas de invalidación. Eso es trabajo de los selectores.

---

## 5. Selectores derivados

### `selectPhase(model)` — escalera de prioridad (gana el más avanzado activo)
```
1. run.accepted|rejected                              → Disposition (cerrado)
2. evidence ∨ decision{approve_merge} pendiente       → Disposition
3. integración activa ∨ leaves done sin compuesto integrado → Reconciliation
4. wave.opened ∨ algún nodo running/verifying         → Supervision
5. grounding activo                                   → Foundation
6. decision{approve_plan} resuelta y grounding no iniciado → Foundation (inminente)
7. plan.ready (sin approve)                           → Proposal (esperando)
   plan.started                                       → Proposal (formándose)
8. else                                               → Framing
```
> La escalera considera **gates resueltos**, no solo eventos de actividad, para evitar ventanas-gap entre fases.

### `selectHealth(model)` → `failing | attention | working | settled`
```
failing   = ∃ node.failed sin resolver ∨ integración sin resolver tras N intentos
attention = ∃ decisión pendiente bloqueante
          ∨ ∃ conflict con autoResolvable=false y status="detected"   // robusto al orden de emisión
working   = ∃ nodo running/verifying
settled   = en otro caso (pre-inicio o done limpio)
```

### `selectWavefront(model)` → `NodeId[]`
Nodos con `execution.kind ∈ {running, verifying}`. **Derivado de estados de nodo, no de `Wave`.**

### `selectAttention(model)` → `Decision[]`
Decisiones con `status="pending"`, ordenadas: bloqueantes primero, luego por `seq`. Es el feed del canal de decisiones.

### `selectBlocked(model)` → `{ nodeId, waitingOn }[]`
Nodos en `blocked` + de qué dependen (para atenuar el subárbol). Incluye compuestos cuya integración espera una decisión.

### `selectConflicts(model)` → `Conflict[]`
Conflictos con `status ≠ resolved`, agrupables por `dimension`.

### `selectEvidence(model)` → `Evidence | null`
`evidence` cuando fase = Disposition.

### `selectFreshness(model, nodeId)` → `"fresh" | "stale"` — eje ortogonal al `ExecutionState`
```
leaf      stale ⇔ consume/produce un seam S y builtAgainst[S] < S.revision
composite stale ⇔ su integración.builtAgainst[S] < S.revision
                ∨ algún hijo stale
                ∨ algún hijo re-pasó a una revisión > la de su integración
fresh     = en otro caso (incl. nodos sin seams)
```

### `selectInvalidatedNodes(model)` → `NodeId[]`
Todos los nodos con `freshness = stale`. (= "inválidos / obsoletos".)

### `selectAffectedByAmendment(model, amendmentId)` → `NodeId[]`
Blast radius **vivo** de una enmienda: `{productor} ∪ {consumidores directos del seam} ∪ {composites que contienen transitivamente un nodo stale} ∪ {root si algún descendiente stale}`. Mientras la enmienda esté solo *propuesta* (no aplicada), esto es la **proyección** (preview); tras `seam.amended` coincide con la invalidación real.

### `selectPendingReexecution(model)` → `NodeId[]`
`stale ∧ no corriendo ∧ sin un node.verify.passed a la revisión actual`.

### `selectRenderableNodeState(model, nodeId)` → estado para la tarjeta del nodo
Combina **`execution.kind × freshness`**. Regla crítica: `execution=integrated ∧ freshness=stale` **nunca** renderiza `done`; renderiza `obsolete`. La UI debe consumir este selector, no `execution` solo.

---

## 6. Invariantes del modelo (para tests)

1. **Estado de nodo derivado:** `ExecutionState` es siempre el fold de eventos; jamás se setea imperativamente (mata la clase `nodeStatusOverrides`).
2. **`freshness` totalmente derivada** de `builtAgainst` vs `Seam.revision`. No existe un estado `stale` persistido.
3. **No monotonicidad:** un nodo puede `integrated → running → integrated` (enmienda/reparación). No se asume progreso monotónico.
4. **`builtAgainst` siempre registrado** en `node.verify.passed` e `integration.validated`. Sin esto, la invalidación no es derivable.
5. **Wavefront derivado de estados de nodo**, nunca de records de `Wave`.
6. **Sin ventana de flicker:** tras `plan.ready` / `conflict.detected(non-auto)` / `amendment.proposed` / `evidence.ready`, `selectHealth = attention` en el **mismo** corte (gracias a la emisión atómica de gates y a la regla de `selectHealth`).
7. **`conflict.status = resolved`** solo tras un `integration.validated{passed:true}` posterior a la decisión (decidir ≠ resolver verificado).
8. **Un run no puede estar `completed` con algún nodo `stale`.**
9. **`selectInvalidatedNodes = ∅` mientras una enmienda esté solo propuesta** (no aplicada).
10. **`integrated + stale` nunca se renderiza como `done`** (vía `selectRenderableNodeState`).
11. **Una sola fuente de verdad:** "done", "integración pasó", `freshness`, blast radius — todos derivados; solo `Seam.revision`, `Node.builtAgainst` y `Seam.signature/contract` se almacenan (vía eventos).

---

## 7. Invalidación, blast radius y re-ejecución

**Disparador:** `seam.amended` sube `Seam.revision`. Nada se "marca"; todo se re-deriva.

**Reglas de propagación (por categoría):**
- **Consumidor directo** stale → re-ejecutar contra la nueva revisión (`node.execution.started{reason:"stale:S@rev"}`).
- **Consumidor indirecto / composite** stale → **re-integrar** (no re-implementar): sus hijos re-ejecutan, luego re-integra.
- **Nodo ya integrado** stale → su commit viejo queda *superseded* (no se borra; el nuevo lo reemplaza en la integración).
- **Nodo corriendo** que queda stale → cancelar y reiniciar contra la nueva revisión.
- **Nodo fallado** que queda stale → re-ejecutar contra la nueva revisión (la nueva firma puede ser justo lo que necesitaba).
- **Enmienda que afecta a otra costura** → **acotada (refinamiento P):** una enmienda por vez; tras aplicar, re-derivar staleness; si una segunda costura queda implicada, es una **nueva** enmienda con su propio gate. Nunca cascada automática entre costuras.

**Categorías derivadas (ninguna almacenada):**
| Categoría | Definición derivada |
|---|---|
| bloqueado | no puede arrancar: espera dependencia / seam no congelado / decisión |
| inválido / stale | era fresh, la revisión del seam avanzó |
| pendiente de re-ejecución | stale ∧ aún no corriendo |
| integrado pero obsoleto | `execution=integrated` ∧ stale |
| no afectado | fuera del blast radius (fresh) |

**Proyección vs realización:** el blast radius se **proyecta** en `amendment.proposed` (preview para decidir) y se **realiza** en `seam.amended`. `selectInvalidatedNodes` permanece `∅` hasta que la enmienda se aplica.

---

## 8. Por qué NO existe `node.invalidated`

La invalidación se **deriva** comparando `builtAgainst[S] < S.revision`. Un evento explícito de invalidación sería una **segunda fuente de verdad** que puede contradecir la realidad; una derivación no puede. Decisión congelada: **la invalidación es siempre derivada, nunca un evento.**

## 9. Por qué `stale` no es un estado persistido

`freshness` es un **eje ortogonal** al `ExecutionState`: un nodo puede ser `integrated+stale`, `running+stale`, `failed+stale`. Meter `stale` dentro de `ExecutionState` colapsaría dos dimensiones independientes (ciclo de vida × vigencia) y obligaría a recomputar/escribir estado en cada enmienda. Se deriva.

## 10. Por qué `integrated + stale` nunca es `done`

Si la UI consumiera `execution` directamente, mostraría como terminado algo que quedó obsoleto por un cambio de contrato — engañando al usuario y arriesgando un merge de trabajo inválido. `selectRenderableNodeState` combina `execution × freshness` y devuelve `obsolete` en ese caso. Es invariante de modelo **y** de producto.

---

## 11. Relación con la UI actual (mapeo / adaptadores)

| Actual | → modelo nuevo |
|---|---|
| `planning.node.*` (SSE) | `plan.node.proposed` / `plan.node.thinking` |
| `planning.question` | `decision.raised{kind:"clarify"}` |
| `status.changed` | **no se mapea a estado**; la fase se deriva |
| `agent.run.started/completed` | `node.execution.started` / `node.verify.passed|failed` |
| `validation.completed` | `node.verify.iteration` / `integration.validated` |
| `node.added` | redundante (cubierto por `plan.node.proposed`) |
| `planning.cli.output` | `plan.cli.output` (drawer) |
| `approve-plan` / `answer` (REST) | `decision.resolved` |
| `nodeStatusOverrides` | **se elimina**; estado de nodo derivado de `node.*` |

Detalle de adaptadores temporales en [`system-components.md`](system-components.md) y [`implementation-readiness.md`](implementation-readiness.md).

---

## 12. Decisiones pendientes (no congeladas)

- **Origen del skeleton (Foundation):** agente scaffolder genérico (decidido: generalidad) — pero el *contrato de eventos* de grounding (`skeleton.file.committed`, `seam.frozen`) es estable; la implementación del agente queda **pendiente**.
- **Diagnóstico de conflicto (`conflict.detected`):** la capacidad backend que distingue "conflicto cross-seam" de "defecto latente de un hijo" (refinamiento F) es no trivial y queda **pendiente**; el contrato de eventos ya la contempla.
- **Evento `integration.diagnosis.started`** (micro-estado "diagnosticando…") — **v2**, no bloquea demo.
- **Política exacta de `maxIterations` del verify-loop y de cancelación a mitad de wave** — **pendiente** (no afecta la forma del modelo).

---

## Refinamientos congelados (A–P)

Surgidos de dos stress tests (ver [`evolution-and-rationale.md`](evolution-and-rationale.md) y [`golden-fixtures.md`](golden-fixtures.md)). Todos incorporados arriba.

**De `golden-behavioral-conflict` (A–G):**
- **A.** Evento `seam.amended {seamId, contract}`.
- **B.** `Seam.contract?` (semántica más allá del tipo).
- **C.** `Conflict.diagnosisRef`, `Conflict.status`, `Conflict.seamId?`.
- **D.** `decision.resolved.choice` estructurado.
- **E.** Emisión atómica del gate con su disparador (mata el flicker).
- **F.** La falla de integración no siempre es conflicto: ramifica en `conflict.detected` o `node.execution.failed`.
- **G.** Invariantes: no monotonicidad; wavefront derivado; conflicto resuelto solo tras re-validación.

**De `golden-seam-amendment-blast-radius` (H–P):**
- **H.** `Seam.revision: number`.
- **I.** `seam.amended {seamId, revision, changeKind:"signature"|"contract", signature?, contract?}`.
- **J.** `builtAgainst` en `node.verify.passed` e `integration.validated/completed`; productor `produces`. *(El habilitador de la invalidación derivada.)*
- **K.** `Amendment.changeKind/fromRevision/toRevision/newSignature?/affects[]`.
- **L.** Selectores `selectFreshness`, `selectInvalidatedNodes`, `selectAffectedByAmendment`, `selectPendingReexecution` (+ `selectRenderableNodeState`).
- **M.** `ExecutionState` **no** se extiende con `stale` (freshness ortogonal).
- **N.** `Evidence.invalidationTrace`.
- **O.** Regla del reducer: `seam.amended` re-deriva; **no** existe `node.invalidated`.
- **P.** Acotamiento de cascadas entre costuras: una enmienda por vez, re-derivar.
