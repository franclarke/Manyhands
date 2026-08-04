# 02 — TASKGRAPH V3, GRAPHREVISION Y RELACIONES TIPADAS CANÓNICAS

Este documento especifica la arquitectura, modelos de datos, reducer de estado CAS (*Compare-And-Swap*) e invariantes del **TaskGraph V3** y su sistema de **Relaciones Tipadas Canónicas** en **ManyHands**.

---

## 1. RESUMEN EJECUTIVO Y PROPÓSITO ARQUITECTÓNICO

El TaskGraph V3 es la estructura de datos central de ManyHands. Modela el desglose topológico y la red de dependencias entre las tareas necesarias para completar un *Goal* de software.

A diferencia de los grafos de tareas convencionales basados en bordes dirigidos genéricos ("ejecutar A antes que B"), TaskGraph V3 impone una **topología de árbol jerárquico híbrido con relaciones dirigidas explícitas por tipo de contrato**.

```mermaid
flowchart TD
    Root["Root Node (Composite)\nKind: 'root'"] --> CompA["Composite Node A\nKind: 'composite'"]
    Root --> CompB["Composite Node B\nKind: 'composite'"]
    
    CompA --> Leaf1["Leaf Node 1 (Atomic)\nKind: 'leaf'"]
    CompA --> Leaf2["Leaf Node 2 (Atomic)\nKind: 'leaf'"]
    
    CompB --> Leaf3["Leaf Node 3 (Atomic)\nKind: 'leaf'"]
    CompB --> Integ1["Integrator Node 1\nKind: 'integrator'"]

    Leaf1 -. "ArtifactRequirement\n(execution)" .-> Leaf2
    Leaf2 -. "SeamBinding\n(interface)" .-> Leaf3
    Leaf1 == "ConflictConstraint\n(resource lock)" == Leaf3
```

---

## 2. INVARIANTES ARQUITECTÓNICOS DEL TASKGRAPH V3

1. **Grafo Jerárquico Híbrido Requerido**: El grafo posee un único nodo raíz (`root`) o una única hoja atómica aislada. Todos los nodos no-raíz deben tener un `parentId` válido que pertenezca al grafo.
2. **Propiedad de Nodos por Kind**:
   - `root` / `composite`: Deben poseer obligatoriamente al menos un nodo hijo (`hasChildren === true`). No pueden ejecutar código directamente.
   - `leaf` / `integrator`: Tareas ejecutoras cohesivas que **prohibido** tener nodos hijos (`hasChildren === false`).
3. **Inmutabilidad de Revisiones**: Una revisión ([GraphRevision](../../packages/task-graph/src/graph-revision.ts#L23-L38)) es una foto inmutable e identificada por su número de revisión entero monótono creciente ($r \ge 1$).
4. **Mutación Vía Reducer CAS**: Ningún nodo o relación se muta in-place. Toda modificación se canaliza mediante [reduceGraphRevision()](../../packages/task-graph/src/graph-reducer.ts#L26-L106) requiriendo la versión esperada (`expectedRevision`).
5. **Aislamiento en Commits Exactos**: Todo `GraphRevision` está estrictamente vinculado a un commit base Git (`baseCommit`) y a un snapshot del repositorio (`repositorySnapshotId`).

---

## 3. ESQUEMA DE DATOS Y MODELO ZOD (`GraphRevision`)

El modelo formal está implementado en [graph-revision.ts](../../packages/task-graph/src/graph-revision.ts) y validado mediante **Zod**.

### 3.1 Nodos del Grafo (`TaskNodeV2`)

```typescript
export const TaskNodeV2Schema = z.object({
  id: EntityIdSchema,
  parentId: EntityIdSchema.nullable(),
  kind: z.enum(["root", "composite", "leaf", "integrator"]),
  title: NonEmptyStringSchema,
  goal: NonEmptyStringSchema
}).strict();

export type TaskNodeV2 = z.infer<typeof TaskNodeV2Schema>;
```

### 3.2 Estructura del `GraphRevision`

```typescript
export const GraphRevisionSchema = z.object({
  schemaVersion: z.literal(2),
  graphId: EntityIdSchema,
  revision: z.number().int().positive(),
  rootId: EntityIdSchema,
  baseCommit: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  nodes: z.record(EntityIdSchema, TaskNodeV2Schema),
  artifactRequirements: z.array(ArtifactRequirementSchema).default([]),
  seamBindings: z.array(SeamBindingSchema).default([]),
  conflictConstraints: z.array(ConflictConstraintSchema).default([]),
  legacyOrderingConstraints: z.array(LegacyOrderingConstraintSchema).default([]),
  createdAt: IsoTimestampSchema
}).strict();
```

---

## 4. MOTOR DE MUTACIÓN ESTADO CAS (`reduceGraphRevision`) Y CONGELAMIENTO PROFUNDO (`deepFreeze`)

### 4.1 Semántica del Reducer CAS (*Compare-And-Swap*)

El reducer [reduceGraphRevision()](../../packages/task-graph/src/graph-reducer.ts#L26-L106) aplica operaciones semánticas deterministas sobre la revisión actual, verificando la consistencia atómica del número de revisión.

```typescript
export function reduceGraphRevision(
  current: GraphRevision,
  input: ReviseGraphInput
): ReduceGraphResult {
  if (current.revision !== input.expectedRevision) {
    throw new Error(
      `Stale CAS GraphRevision write: expected revision ${input.expectedRevision}, but current revision is ${current.revision}.`
    );
  }
  // ...
}
```

> [!IMPORTANT]
> Si otro proceso o evento modificó la revisión del grafo en el store (`current.revision !== input.expectedRevision`), el reducer **rechaza la transacción de inmediato lanzando una excepción**, evitando condiciones de carrera o sobreescrituras desincronizadas.

### 4.2 Operaciones Admitidas (`GraphRevisionOperation`)

El reducer acepta una lista ordenada de operaciones atómicas:
- `upsert_node`: Crea o actualiza la definición de un `TaskNodeV2`.
- `remove_node`: Elimina un nodo por su `nodeId`.
- `update_node_goal`: Modifica el objetivo de un nodo existente.
- `add_artifact_requirement` / `remove_artifact_requirement`: Gestiona relaciones de artefactos.
- `add_seam_binding` / `remove_seam_binding`: Gestiona contratos de interfaz (seams).
- `add_conflict_constraint` / `remove_conflict_constraint`: Gestiona restricciones de exclusión mutua.
- `remove_legacy_ordering_constraint`: Elimina restricciones de orden heredadas.

### 4.3 Garantía de Inmutabilidad en Tiempo de Ejecución (`deepFreeze`)

Una vez validada la nueva revisión, el objeto retornado es recursivamente congelado mediante [deepFreeze()](../../packages/task-graph/src/graph-reducer.ts#L13-L24), impidiendo cualquier mutación accidental de propiedades en el runtime de JavaScript/TypeScript.

```typescript
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as any)[key];
    if (val !== null && (typeof val === "object" || typeof val === "function")) {
      deepFreeze(val);
    }
  }
  return obj;
}
```

---

## 5. RELACIONES TIPADAS CANÓNICAS (V3)

TaskGraph V3 reemplaza las aristas arbitrarias de ordenamiento por 4 tipos de relaciones canónicas fuertemente tipadas en [relations.ts](../../packages/task-graph/src/relations.ts):

| Relación | Categoría | Propósito Arquitectónico | Restricción de Dominio |
|---|---|---|---|
| `parentId` | **Estructural** | Define la pertenencia y jerarquía de contención en el árbol. | `parentId !== null` (salvo Root). `leaf`/`integrator` no pueden tener hijos. |
| `ArtifactRequirement` | **Datos / Salida** | Exige la generación previa de un artefacto de código o evidencia. | `producerNodeId !== consumerNodeId`. |
| `SeamBinding` | **Interfaz / API** | Alinea los contratos de tipos e interfaces entre dos nodos. | Requiere coincidencia exacta de `seamContract.revision`. |
| `ConflictConstraint` | **Exclusión / Concurrencia** | Previene la ejecución en paralelo por solapamiento de rutas. | Requiere dos nodos distintos con `risk: "low" \| "medium" \| "high"`. |

### 5.1 `parentId` (Jerarquía de Contención)
Establece la relación Padre-Hijo en el DAG. Determina la estructura de desglose y el orden de integración ascendente (*Bottom-Up Integration*).

### 5.2 `ArtifactRequirement` (Dependencia de Artefacto)
Modela la necesidad de un artefacto generado por un nodo productor para que el nodo consumidor pueda ejecutarse, validarse o integrarse.

```typescript
export const ArtifactRequirementSchema = z.object({
  id: EntityIdSchema,
  artifactContract: ContractReferenceSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  requiredFor: z.enum(["execution", "validation", "integration"])
}).strict();
```

- **`requiredFor: "execution"`**: Bloquea el despacho del nodo consumidor en el Scheduler hasta que el artefacto sea producido y verificado.
- **`requiredFor: "validation"`**: Requerido durante la fase de prueba o auditoría.
- **`requiredFor: "integration"`**: Requerido durante el merge del árbol composite.

### 5.3 `SeamBinding` (Contrato de Interfaz)
Vincular nodos que comparten una frontera de interfaz (*Seam*), garantizando que las firmas de tipos exportados concuerden exactamente en su revisión declarada (`producerRevision === consumerRevision`).

```typescript
export const SeamBindingSchema = z.object({
  id: EntityIdSchema,
  seamContract: ContractReferenceSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  producerRevision: NonEmptyStringSchema,
  consumerRevision: NonEmptyStringSchema
}).strict();
```

### 5.4 `ConflictConstraint` (Guard de Exclusión Mutua)
Declara una restricción de conflicto entre dos nodos independientes que intentan modificar el mismo archivo o subsistema crítico.

```typescript
export const ConflictConstraintSchema = z.object({
  id: EntityIdSchema,
  leftNodeId: EntityIdSchema,
  rightNodeId: EntityIdSchema,
  reason: NonEmptyStringSchema,
  risk: z.enum(["low", "medium", "high"])
}).strict();
```

> [!NOTE]
> El Continuous Scheduler utiliza `ConflictConstraint` para evitar despachar `leftNodeId` y `rightNodeId` de forma simultánea en Worktrees paralelos, eliminando conflictos de merge predecibles.

### 5.5 Depreciación de `LegacyOrderingConstraint`
Las aristas genéricas `LegacyOrderingConstraint` están marcadas como desaconsejadas (`deprecated: true`, `requiresReplan: true`). El compilador de grafos de ManyHands V3 no genera relaciones legacy y promueve automáticamente su reemplazo por `ArtifactRequirement` o `ConflictConstraint`.

---

## 6. VALIDACIÓN DEL GRAFO Y DETECCIÓN DE CICLOS (`validateGraphRevision`)

El módulo [validate-v2.ts](../../packages/task-graph/src/validate-v2.ts) implementa la suite completa de validación de integridad para todo `GraphRevision`.

### 6.1 Algoritmo de Detección de Ciclos (DFS por Tipo de Arista)

El sistema construye un grafo de adyacencia combinando aristas de jerarquía (`parentId`), dependencias de artefactos de ejecución (`ArtifactRequirement`) y restricciones legacy.

```typescript
type EdgeType = "hierarchy" | "artifact" | "legacy";
```

Mediante una Búsqueda en Profundidad (**DFS**) con conjuntos de nodos en visita (`visiting`) y visitados (`visited`), identifica ciclos topológicos y clasifica el error con precisión:

- **`hierarchy_cycle`**: Si todas las aristas involucradas en el ciclo son de tipo `hierarchy`.
- **`artifact_cycle`**: Si el ciclo contiene al menos una arista de dependencia de artefacto o legacy.
- **`self_relation`**: Si un nodo hace referencia a sí mismo como padre o participante de una relación.

```typescript
function dfs(nodeId: string, path: string[], edgesInPath: EdgeType[]) {
  if (visiting.has(nodeId)) {
    const startIdx = path.indexOf(nodeId);
    if (startIdx !== -1) {
      const cycleEdges = edgesInPath.slice(startIdx);
      const isHierarchyOnly = cycleEdges.every((e) => e === "hierarchy");
      const code = isHierarchyOnly ? "hierarchy_cycle" : "artifact_cycle";
      // Registra el issue de ciclo
    }
    return;
  }
  // ... Traversal estándar DFS ...
}
```

### 6.2 Códigos de Issue de Diagnóstico (`GraphRevisionIssueCode`)

| Código | Severidad | Descripción del Diagnóstico |
|---|---|---|
| `schema_invalid` | Error | Fallo de parseo en Zod Schema. |
| `missing_root` | Error | El `rootId` declarado no existe en la colección de nodos. |
| `invalid_root` | Error | El nodo raíz posee padre o no cumple el rol `root`/`composite`. |
| `invalid_node_kind` | Error | Conflicto entre el `kind` y la presencia/ausencia de nodos hijos. |
| `node_key_mismatch` | Error | La clave del diccionario de nodos no coincide con `node.id`. |
| `missing_parent` | Error | El `parentId` de un nodo hijo no existe en el grafo. |
| `hierarchy_cycle` | Error | Se detectó un ciclo en el árbol de estructura jerárquica. |
| `artifact_cycle` | Error | Se detectó un ciclo en el flujo de ejecución de artefactos. |
| `self_relation` | Error | Una relación apunta al mismo nodo como origen y destino. |
| `missing_relation_node` | Error | Una relación hace referencia a un `nodeId` inexistente. |
| `duplicate_relation` | Error | Identificador `id` duplicado entre relaciones. |

### 6.3 Evaluación de Disponibilidad Ejecutable (`ExecutableReadinessV2`)

Para decidir qué nodos `leaf` o `integrator` están listos para ser despachados, la función [getExecutableReadinessV2()](../../packages/task-graph/src/validate-v2.ts#L64-L78) evalúa los requerimientos de artefactos de ejecución contra el conjunto de contratos ya disponibles (`availableArtifactContractIds`):

$$\text{Ready}(n) \iff \forall r \in \text{ArtifactRequirements}(n, \text{"execution"}), \, r.\text{artifactContract.id} \in \text{AvailableContracts}$$

---

## 7. PAQUETE DE CONTRATOS (`TaskContractBundle`)

Cada nodo hoja o integrador del TaskGraph está vinculado a un paquete inmutable de contratos de tareas definido en [packages/contracts](../../packages/contracts/src/task-contract.ts):

```typescript
export interface TaskContractBundle {
  taskContract: TaskContract;
  scopeContract: ScopeContract;
  consumesArtifactContracts: ArtifactContract[];
  producesArtifactContracts: ArtifactContract[];
  seamContracts: SeamContract[];
  validationContract: ValidationContract;
}
```

- **`taskContract`**: Objetivo, id de nodo y lista estricta de criterios de aceptación (`acceptanceCriteria`).
- **`scopeContract`**: Define las rutas permitidas de lectura y modificación (`allowedPaths`).
- **`validationContract`**: Define los comandos de prueba y validación estática que el ejecutor debe satisfacer.

---

## 8. UBICACIÓN DE ARCHIVOS DE CÓDIGO FUENTE

- **Modelos y Schemas Zod**: [packages/task-graph/src/graph-revision.ts](../../packages/task-graph/src/graph-revision.ts)
- **Reducer CAS e Inmutabilidad**: [packages/task-graph/src/graph-reducer.ts](../../packages/task-graph/src/graph-reducer.ts)
- **Relaciones Tipadas Canónicas**: [packages/task-graph/src/relations.ts](../../packages/task-graph/src/relations.ts)
- **Validación y Detección de Ciclos**: [packages/task-graph/src/validate-v2.ts](../../packages/task-graph/src/validate-v2.ts)
- **Definiciones de Contratos**: [packages/contracts/src/task-contract.ts](../../packages/contracts/src/task-contract.ts)
