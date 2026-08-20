# Guía Arquitectónica: @manyhands/orchestrator-graph

> **Ubicación en el Monorepo**: `packages/orchestrator-graph/`  
> **README del Paquete**: [`../../packages/orchestrator-graph/README.md`](../../packages/orchestrator-graph/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

La ejecución de un grafo de tareas no consiste únicamente en invocar subprocesos aislados: exige coordinar la resolución de dependencias transitivas de datos, garantizar que los parches de código se apliquen en el orden causal exacto y verificar que ningún par de tareas concurrentes colisione sobre los mismos archivos antes de autorizar el despacho.

**`@manyhands/orchestrator-graph`** es un subsistema transicional que aloja el **driver canónico de ejecución de grafos** (`CanonicalExecutionDriver`), el algoritmo de clausura transitiva de bases de ejecución (`executionBaseArtifacts`) y los verificadores de invariantes de concurrencia de recursos (`assertNoConcurrentResourceConflict`).

### Problemas Fundamentales que Resuelve

1. **Driver Canónico de Ejecución (`CanonicalExecutionDriver`)**: Orquesta el ciclo de vida de ejecución iterativo sobre revisiones de grafo directas (`GraphRevision`). Consulta al planificador (`@manyhands/scheduler`), selecciona la ola ejecutable, despacha los intentos a `@manyhands/execution-core` y registra los resultados de dominio en `@manyhands/run-coordinator`.
2. **Cierre de Requisitos de Artefactos (`executionBaseArtifacts`)**: Determina el orden topológico y el conjunto exacto de artefactos transitivos necesarios para construir el árbol de trabajo Git (*execution base*) de un nodo consumidor, evitando fallos por parches intermedios faltantes.
3. **Invariante de Recursos Concurrentes (`assertNoConcurrentResourceConflict`)**: Barrera de contención preventiva que impide que dos nodos en la misma ola reclamen permisos de modificación (`modify`) sobre el mismo recurso o compartan leases exclusivas.
4. **Capa de Compatibilidad Histórica (`V2ExecutionDriver`)**: Mantiene el driver de ejecución V2 para validación de tests de regresión y replay sobre journals antiguos.

---

## 2. Arquitectura Interna y Componentes

El código fuente en `src/` está estructurado de la siguiente forma:

```
packages/orchestrator-graph/src/
├── index.ts                            # Barrel export unificado (canónico y V2)
├── canonical-execution-driver.ts       # CanonicalExecutionDriver: bucle de olas sobre GraphRevision
├── concurrent-resource-invariant.ts    # assertNoConcurrentResourceConflict: verificación de colisiones
├── execution-base-closure.ts           # executionBaseArtifacts: clausura transitiva de dependencias
└── v2/
    └── execution-driver.ts             # V2ExecutionDriver: driver histórico para compatibilidad
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-execution-driver.ts` | Conduce el bucle principal de ejecución de una corrida sobre `GraphRevision`. Evalúa `selectFrontier`, valida la autoridad de recursos (`checkResourceAuthority`), gestiona transiciones entre hojas y compositos y coordina la verificación de candidatos finales. |
| `concurrent-resource-invariant.ts` | Implementa `assertNoConcurrentResourceConflict`. Lanza una excepción inmediata si dos nodos en la misma ola intentan acceder concurrentemente a un recurso y al menos uno declara acceso `"modify"`. |
| `execution-base-closure.ts` | Implementa `executionBaseArtifacts`. Recorre en profundidad (*depth-first*) las dependencias declaradas en `graph.artifactRequirements` desde el nodo consumidor hacia los productores, generando la lista ordenada de referencias necesarias para la base de trabajo. |
| `v2/execution-driver.ts` | Implementación del driver V2 para compatibilidad histórica con modelos de grafo anteriores. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el bucle de orquestación conducido por `CanonicalExecutionDriver`:

```
   GraphRevision + TaskContractBundles
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                 CanonicalExecutionDriver                    │
│                                                             │
│   1. coordinator.load(runId)                                │
│   2. evaluateReadiness() ──► CanonicalReadinessExplanation  │
│   3. selectFrontier()    ──► Nodos Listos en la Ola         │
│   4. assertNoConcurrentResourceConflict() (Barrera Fail-Fast│
│   5. Para cada nodo listo:                                  │
│      • executionBaseArtifacts(graph, nodeId)               │
│      • executeNodeInParallel() ──► @manyhands/execution-core│
│   6. coordinator.record(event) (attempt / artifact / etc.)  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                    Actualización de Estado
                   en @manyhands/run-store
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Clases, Funciones y Tipos Principales

| Símbolo | Tipo | Propósito |
|---|---|---|
| `CanonicalExecutionDriver` | Clase | Motor de ejecución canónico para revisiones de grafo directas. |
| `assertNoConcurrentResourceConflict` | Función | Valida que ninguna ola concurrente contenga colisiones de modificación de recursos. |
| `executionBaseArtifacts` | Función | Computa la lista ordenada de artefactos requeridos para construir la base de ejecución. |
| `CanonicalExecutionRunInput` | Interfaz | Parámetros de entrada para iniciar la ejecución de un grafo. |
| `CanonicalNodeExecutionInput` | Interfaz | Contexto de ejecución provisto a cada tarea individual. |
| `CanonicalNodeExecutionOutcome` | Tipo Unión | Resultado producido por la ejecución física (`success`, `needs_input`, `failure`). |
| `ExecutionBaseArtifactRef` | Interfaz | Referencia a un artefacto productor requerido en la base. |
| `V2ExecutionDriver` | Clase | Driver de ejecución histórico para compatibilidad con corridas previas. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Clausura Transitiva de Bases de Ejecución (`executionBaseArtifacts`)
En ManyHands, un artefacto es un conjunto de cambios (*change set*) relativo a un `baseTreeSha` exacto. Si el nodo $C$ depende de un artefacto producido por $B$, y a su vez $B$ fue construido sobre un artefacto producido por $A$, el worktree de $C$ no puede materializar únicamente $B$ sobre el commit inicial:
$$\text{Base}(C) = \text{Tree}_0 \oplus \text{Artifact}(A) \oplus \text{Artifact}(B)$$
`executionBaseArtifacts` realiza una búsqueda en profundidad respetando el grafo de dependencias y eliminando entradas redundantes, garantizando que el materializador aplique los parches en el orden causal exacto.

### 2. Invariante de Exclusión de Recursos Concurrentes
Aunque el selector de frontier ya filtra nodos en conflicto, `assertNoConcurrentResourceConflict` actúa como una barrera de contención (*fail-fast defense in depth*):
- Si dos nodos lectores (`access: "read"`) acceden al mismo archivo o símbolo, se permite la ejecución concurrente.
- Si uno de los nodos declara `access: "modify"`, se aborta inmediatamente la ola para evitar corrupción en el árbol de trabajo o estados intermedios inconsistentes.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Migración hacia el Daemon**: La lógica de orquestación y conducción de olas se migra progresivamente hacia `packages/run-engine` y `apps/daemon`.
2. **Uso Actual**: `CanonicalExecutionDriver` se utiliza en workers locales y pruebas de integración de ciclo de vida completo.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/orchestrator-graph/README.md`](../../packages/orchestrator-graph/README.md)
- **Módulos Relacionados**:
  - [`task-graph.md`](./task-graph.md): Modelo del grafo `GraphRevision` y verificación de autoridad.
  - [`scheduler.md`](./scheduler.md): Evaluación de readiness y selección de olas ejecutables.
  - [`execution-core.md`](./execution-core.md): Ejecución física y materialización de bases.
  - [`run-coordinator.md`](./run-coordinator.md): Registro de eventos canónicos y transiciones de estado.
- **Documentación Central**: [`../README.md`](../README.md)
