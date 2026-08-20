# @manyhands/orchestrator-graph

Driver canónico de ejecución de grafos de tareas sobre `GraphRevision`, cálculo del cierre transitivo de bases de ejecución y verificación de invariantes de recursos concurrentes para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

`@manyhands/orchestrator-graph` es un paquete transicional que aloja el motor de orquestación de ejecución iterativa (`CanonicalExecutionDriver`) y los verificadores de invariantes de concurrencia:

1. **Driver Canónico de Ejecución (`CanonicalExecutionDriver`)**: Orquesta el ciclo de vida de ejecución sobre revisiones de grafo directas (`GraphRevision`). En cada iteración, consulta el planificador (`@manyhands/scheduler`), selecciona la ola ejecutable (*frontier wave*), despacha los intentos a `@manyhands/execution-core` y registra los resultados de dominio en `@manyhands/run-coordinator`.
2. **Cierre de Requisitos de Artefactos (`executionBaseArtifacts`)**: Determina el orden topológico y el conjunto exacto de artefactos transitivos necesarios para construir el árbol de trabajo Git (*execution base*) de un nodo consumidor, evitando fallos por bases intermedias faltantes.
3. **Invariante de Recursos Concurrentes (`assertNoConcurrentResourceConflict`)**: Verificador de seguridad que impide que dos nodos en la misma ola concurrente reclamen permisos de modificación (`modify`) sobre el mismo recurso o compartan leases exclusivas, previniendo carreras en disco.
4. **Capa de Compatibilidad Histórica (`V2ExecutionDriver`)**: Mantiene el driver de ejecución V2 para permitir la validación de tests de regresión y replay sobre journals antiguos.

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` está estructurado de la siguiente forma:

```
packages/orchestrator-graph/src/
├── index.ts                            # Barrel export unificado (canónico y V2)
├── canonical-execution-driver.ts       # CanonicalExecutionDriver: orquestador de bucle de olas sobre GraphRevision
├── concurrent-resource-invariant.ts    # assertNoConcurrentResourceConflict: verificación de colisión de claims
├── execution-base-closure.ts           # executionBaseArtifacts: cálculo de la clausura transitiva de dependencias
└── v2/
    └── execution-driver.ts             # V2ExecutionDriver: driver histórico para compatibilidad de tests
```

### Desglose Detallado por Archivo

- **`canonical-execution-driver.ts`**:
  - `CanonicalExecutionDriver`: Conduce el bucle principal de ejecución de una corrida. Evalúa `selectFrontier`, asume revisiones de grafo, valida la autoridad de recursos (`checkResourceAuthority`), gestiona transiciones entre hojas y compositos, y coordina la verificación de candidatos finales contra la autoridad de evidencia (`CanonicalEvidenceAuthority`).
  - Tipos e interfaces: `CanonicalExecutionDriverOptions`, `CanonicalExecutionRunInput`, `CanonicalExecutionTarget`, `CanonicalExecutorProfile`, `CanonicalNodeExecutionInput`, `CanonicalNodeExecutionOutcome`, `ExecutionBlocker`.
- **`concurrent-resource-invariant.ts`**:
  - `assertNoConcurrentResourceConflict`: Función pura que recibe la lista de `ResourceClaim`s y los nodos seleccionados en la ola. Lanza una excepción inmediata si dos nodos distintos intentan acceder concurrentemente a un mismo recurso y al menos uno de ellos declara acceso `"modify"`.
- **`execution-base-closure.ts`**:
  - `executionBaseArtifacts`: Función que recorre en profundidad (*depth-first*) las dependencias declaradas en `graph.artifactRequirements` desde el nodo consumidor hacia los productores, generando la lista ordenada de referencias `ExecutionBaseArtifactRef` que deben materializarse secuencialmente sobre el árbol base.
- **`v2/execution-driver.ts`**:
  - `V2ExecutionDriver`: Implementación del driver V2 orientada a compatibilidad histórica con modelos de grafo anteriores.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Bucle de Ejecución Basado en Olas Continuas

`CanonicalExecutionDriver` desacopla la evaluación de precondiciones duras de la política de despacho:

```
  GraphRevision + TaskContractBundle
                  │
                  ▼
         evaluateReadiness() ──► CanonicalReadinessExplanation[]
                  │
                  ▼
          selectFrontier()   ──► Nodos Listos en la Ola
                  │
                  ▼
   assertNoConcurrentResourceConflict() ──► (Invariante de no-colisión)
                  │
                  ▼
        executeNodeInParallel() ──────► V2NodeExecutor / execution-core
                  │
                  ▼
         run-coordinator.record() ────► RunProjection Actualizada
```

1. Carga la proyección actual de la corrida desde `coordinator.load(runId)`.
2. Si el ciclo de vida es `"running"`, invoca `selectFrontier` pasando las restricciones de capacidad (`maxParallel`, presupuestos de tokens y costo USD) y la función consultiva de riesgo `estimateIntegrationRisk`.
3. Valida la invariante de concurrencia sobre los recursos seleccionados mediante `assertNoConcurrentResourceConflict`.
4. Despacha en paralelo los nodos de la ola a la función `execute` inyectada.
5. Registra de forma atómica los eventos resultantes (`attempt.candidate_created`, `validation.completed`, `artifact.adopted` o `attempt.failed`) en `RunCoordinator`.

### 3.2. Clausura Transitiva de Bases de Ejecución (`executionBaseArtifacts`)

En ManyHands, un artefacto es un conjunto de cambios (*change set*) relativo a un `baseTreeSha` exacto. Si el nodo $C$ depende de un artefacto producido por $B$, y a su vez $B$ fue construido sobre un artefacto producido por $A$, el worktree de $C$ no puede materializar únicamente $B$ sobre el commit inicial de la corrida:

$$\text{Base}(C) = \text{Tree}_0 \oplus \text{Artifact}(A) \oplus \text{Artifact}(B)$$

`executionBaseArtifacts` realiza una búsqueda en profundidad respetando el grafo de dependencias y eliminando entradas redundantes o de ramas paralelas, garantizando que el materializador aplique los parches en el orden exacto en que fueron producidos.

### 3.3. Invariante de Exclusión de Recursos Concurrentes

Aunque el selector de frontier ya filtra nodos en conflicto, `assertNoConcurrentResourceConflict` actúa como una barrera de contención (*fail-fast defense in depth*):
- Si dos nodos lectores (`access: "read"`) acceden al mismo archivo o símbolo, se permite la ejecución concurrente.
- Si uno de los nodos declara `access: "modify"`, se aborta inmediatamente la ola para evitar corrupción en el árbol de trabajo o estados intermedios inconsistentes.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Clases, Funciones y Tipos

| Símbolo | Tipo | Archivo | Descripción |
|---|---|---|---|
| `CanonicalExecutionDriver` | Clase | `canonical-execution-driver.ts` | Motor de ejecución canónico para revisiones de grafo directas. |
| `assertNoConcurrentResourceConflict` | Función | `concurrent-resource-invariant.ts` | Valida que ninguna ola concurrente contenga conflictos de modificación de recursos. |
| `executionBaseArtifacts` | Función | `execution-base-closure.ts` | Computa la lista ordenada de artefactos requeridos para construir la base de ejecución. |
| `CanonicalExecutionRunInput` | Interfaz | `canonical-execution-driver.ts` | Parámetros de entrada para iniciar la ejecución de un grafo. |
| `CanonicalNodeExecutionInput` | Interfaz | `canonical-execution-driver.ts` | Contexto de ejecución provisto a cada tarea individual. |
| `CanonicalNodeExecutionOutcome` | Tipo Unión | `canonical-execution-driver.ts` | Resultado producido por la ejecución física de un nodo (`success`, `needs_input`, `failure`). |
| `ExecutionBaseArtifactRef` | Interfaz | `execution-base-closure.ts` | Referencia a un artefacto productor requerido en la base. |
| `V2ExecutionDriver` | Clase | `v2/execution-driver.ts` | Driver de ejecución histórico para compatibilidad con corridas previas. |

### 4.2. Ejemplo de Uso: Ejecución de Grafo con Verificación de Invariantes

```typescript
import {
  CanonicalExecutionDriver,
  assertNoConcurrentResourceConflict,
  executionBaseArtifacts,
  type CanonicalNodeExecutionInput,
  type CanonicalNodeExecutionOutcome
} from "@manyhands/orchestrator-graph";
import type { GraphRevision } from "@manyhands/task-graph";
import type { RunCoordinator } from "@manyhands/run-coordinator";

// 1. Verificar el cierre de artefactos para un nodo específico
const graph: GraphRevision = {
  graphId: "graph-001",
  revision: 1,
  rootNodeId: "root-goal",
  nodes: {
    "node-auth": { id: "node-auth", title: "Auth", kind: "leaf" } as any,
    "node-api": { id: "node-api", title: "API", kind: "leaf" } as any
  },
  artifactRequirements: [
    {
      consumerNodeId: "node-api",
      producerNodeId: "node-auth",
      artifactContract: { id: "art-jwt", revision: 1 }
    }
  ],
  seamBindings: [],
  resourceClaims: [
    { nodeId: "node-auth", resourceId: "src/auth.ts", access: "modify" },
    { nodeId: "node-api", resourceId: "src/auth.ts", access: "read" }
  ]
};

const requiredArtifacts = executionBaseArtifacts(graph, "node-api");
console.log("Artefactos requeridos para node-api:", requiredArtifacts);

// 2. Comprobar que una ola no tenga conflictos de recursos
assertNoConcurrentResourceConflict(graph.resourceClaims, ["node-auth"]); // OK

// 3. Instanciar el driver canónico
const driver = new CanonicalExecutionDriver({
  coordinator: {} as RunCoordinator, // Instancia del coordinador de corrida
  execute: async (input: CanonicalNodeExecutionInput): Promise<CanonicalNodeExecutionOutcome> => {
    return {
      kind: "success",
      candidateCommit: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
      outputDigest: "sha256:out123",
      changedFiles: ["src/auth.ts"],
      evidenceMatrix: {
        evidenceMatrixId: "ev-mat-1",
        runId: input.runId,
        nodeId: input.node.id,
        outcome: "verified",
        criteria: []
      }
    };
  },
  estimateIntegrationRisk: () => ({ score: 0.1, level: "low", signals: [] }),
  now: () => new Date().toISOString()
});
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan de rediseño normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Sección 9.12 y Stage 11):

| Componente | Estado de Rediseño | Observaciones |
|---|---|---|
| **Driver Canónico (`CanonicalExecutionDriver`)** | Transicional ⚠️ | Conduce la ejecución sobre `GraphRevision` directa mientras se completa la migración a `apps/daemon`. |
| **Invariante de Recursos Concurrentes** | Canónico ✅ | `assertNoConcurrentResourceConflict` protege la concurrencia segura. |
| **Cierre de Artefactos Transitivos** | Canónico ✅ | `executionBaseArtifacts` resuelve dependencias multinivel correctamente. |
| **Consolidación en `run-engine`** | En progreso 🔄 | La lógica de este paquete se consolidará en `@manyhands/run-engine` y `apps/daemon`. Una vez completada la migración de callers y comprobada la reachability en Stage 11 / GProd, este paquete será formalmente retirado. |

---

## 6. Comandos de Verificación y Testing

Para verificar los tipos estáticos y compilar `@manyhands/orchestrator-graph`:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/orchestrator-graph typecheck

# Compilación de paquetes (ESM y CJS con DTS)
pnpm --filter @manyhands/orchestrator-graph build
```
