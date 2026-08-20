# @manyhands/scheduler

Motor puro de evaluación de disponibilidad (*readiness*) y selección continua del frente ejecutable (*frontier selection*) para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

En la arquitectura de ManyHands, `@manyhands/scheduler` es el componente responsable de responder dos preguntas fundamentales en cualquier instante del ciclo de vida de una corrida:

1. **¿Qué nodos del grafo cumplen rigurosamente todas sus precondiciones duras para ser ejecutados?** (*Readiness Evaluation*).
2. **De aquellos nodos listos, ¿cuáles deben despacharse de inmediato considerando la capacidad del sistema, los claims de recursos y el riesgo de integración?** (*Frontier Selection*).

### ¿Por qué existe y qué problemas resuelve?

- **Desacoplamiento entre Corrección y Heurística**: Tradicionalmente, los planificadores mezclan restricciones duras (como la falta de un artefacto previo) con heurísticas de optimización (como estimaciones de riesgo de conflicto). En ManyHands, el riesgo de integración **nunca** altera la validez o la autoridad de un nodo; solo interviene de forma consultiva en el momento de ordenar y seleccionar candidatos listos.
- **Eliminación de Barreras Rígidas (Olas Monolíticas)**: En lugar de forzar a todos los agentes a esperar que termine una "ola" completa antes de avanzar, el scheduler opera sobre un **frente continuo** (*continuous execution frontier*). Tan pronto como un intento finaliza y adopta un artefacto en el journal duradero, el frente se reevalúa inmediatamente.
- **Indexación por Recurso vs. Matrices $O(N^2)$**: Reemplaza el cómputo exhaustivo de matrices de riesgo par a par por un modelo indexado por recurso (`ResourceClaim` y `RuntimeLeaseClaim`), verificando colisiones directas de lectura/modificación de forma lineal.
- **Explicabilidad Total y Determinismo Puro**: El scheduler es una función matemática pura sin efectos secundarios ni I/O. Para cada nodo evaluado, produce un conjunto estructurado de razones tipadas (`CanonicalReadinessReason`) que justifican con precisión por qué fue admitido o diferido.

---

## 2. Arquitectura Modular Interna

El código fuente en `src/` se organiza en submódulos bien delimitados que reflejan la evolución desde la planificación histórica por lotes hacia el frente continuo canónico:

```
packages/scheduler/
├── src/
│   ├── canonical-frontier.ts   # Motor canónico (Stage 6 / GS): evaluateReadiness y selectFrontier
│   ├── readiness-v2.ts         # Evaluador de readiness transicional V2 sobre LegacyGraphRevisionV2
│   ├── types-v2.ts             # Tipos y razones de bloqueo V2 (ReadinessStateV2, ReadinessReason)
│   ├── wave-selector-v2.ts     # Selector de olas V2 con restricciones de conflicto y leases
│   └── index.ts                # Barrel export y algoritmos legacy (scheduleTasks, scope-aware, human gate)
├── package.json
└── tsconfig.json
```

### Desglose de Archivos

- **`canonical-frontier.ts`**: El núcleo de la arquitectura objetivo. Contiene las funciones puras `evaluateReadiness` y `selectFrontier`, así como las definiciones de `CanonicalReadinessSnapshot`, `CanonicalReadinessExplanation`, `CanonicalReadinessEvaluation`, `CanonicalSelectionPolicy` y `CanonicalFrontierSelection`.
- **`readiness-v2.ts`**: Implementa `explainReadiness` para grafos V2 (`LegacyGraphRevisionV2`), verificando artefactos requeridos, decisiones pendientes, estado de circuit breaker y nodos ancestros detenidos (`hasStoppedAncestor`).
- **`types-v2.ts`**: Define la jerarquía de razones de bloqueo `ReadinessReason` (ej. `missing_artifact`, `stale_contract`, `circuit_breaker_open`, `branch_stopped`) y el snapshot de estado `ReadinessStateV2`.
- **`wave-selector-v2.ts`**: Implementa `selectReadyWaveV2`, que filtra las explicaciones de readiness mediante restricciones de conflicto temporizadas (`ConflictConstraintEvidence`) y bloqueos de recursos (`blocksPair`).
- **`index.ts`**: Re-exporta todos los submódulos y preserva los algoritmos de compatibilidad V1: `scheduleTasks` (planificador estático en lotes `ExecutionBatch`), `selectScopeAwareWave` (detección de solapamiento de globs de rutas y archivos de coordinación) y `applyHumanGateToSchedule` (compuerta determinista de revisión humana).

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Separación Estricta entre Readiness y Selección

La arquitectura impone una frontera conceptual infranqueable entre dos fases:

```
                      CanonicalReadinessSnapshot
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │  evaluateReadiness  │  (Solo Precondiciones Duras e Invariantes)
                       └──────────┬──────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
         ready: Candidate[]                blocked: Candidate[]
                 │                         (missing_artifact, stale_contract,
                 │                          resource_claim_conflict, etc.)
                 ▼
       ┌───────────────────┐
       │   selectFrontier  │ ◄─── CanonicalSelectionPolicy & IntegrationRiskEstimate
       └─────────┬─────────┘      (Capacidad maxParallel, riesgo concurrente)
                 │
        ┌────────┴────────┐
        ▼                 ▼
    selected[]        deferred[]
                     (capacity, risk)
```

1. **`evaluateReadiness`**: Analiza exclusivamente hechos verificables:
   - ¿Están adoptadas las revisiones exactas de los artefactos requeridos? (`missing_artifact`).
   - ¿Coincide el digest del contrato actual con la referencia en el nodo? (`stale_contract`).
   - ¿Hay decisiones humanas pendientes que afecten al nodo? (`unresolved_decision`).
   - ¿Existe colisión de acceso de recursos (`modify` vs `modify` / `read`) con nodos activos? (`resource_claim_conflict`).
   - ¿Hay conflictos con leases de runtime exclusivas? (`runtime_lease_conflict`).
   - ¿El ejecutor requerido está disponible y existe presupuesto? (`executor_unavailable`, `budget_exhausted`).
   - ¿El nodo ya está activo o fue adoptado previamente? (`already_active`, `already_adopted`).

2. **`selectFrontier`**: Toma únicamente el conjunto `ready` y aplica políticas de despacho:
   - Limita la concurrencia a `maxParallel`.
   - Evalúa perezosamente (*lazily*) el estimador de riesgo de integración (`estimateIntegrationRisk`) contra el conjunto ya seleccionado. Si el puntaje excede `maxConcurrentRiskScore`, difiere el nodo con razón `integration_risk_concurrency`.

### 3.2. Modelo de Concurrencia de Recursos (`ResourceClaim` y `RuntimeLeaseClaim`)

En lugar de calcular una matriz cuadrática entre todos los pares posibles de tareas, el scheduler examina claims específicos:

- **`ResourceClaim`**:
  - `access: "read"`: Múltiples lectores pueden coejecutarse sobre el mismo recurso.
  - `access: "modify"`: Un escritor requiere exclusividad sobre el `resourceId`. Si otro nodo activo o seleccionado reclama el mismo recurso para modificación, se emite un conflicto.
- **`RuntimeLeaseClaim`**:
  - `mode: "shared"`: Permite coexistencia (ej. lectura concurrente de workspace).
  - `mode: "exclusive"`: Exige acceso unívoco sobre el par `(provider, resourceKey)` (ej. puerto TCP, base de datos de test, lock físico de compilación).

### 3.3. Detección de Archivos de Coordinación (Heurística de Scopes V1/V2)

En la capa legacy (`selectScopeAwareWave`), para evitar que archivos compartidos ubicuos (como `index.ts`, `package.json` o barrels de exportación) colapsen la concurrencia a 1 sola tarea por lote, el selector aplica un umbral (`COORDINATION_SHARE_THRESHOLD = 3`): si 3 o más candidatos tocan el mismo archivo específico, se clasifica como *coordination file* y se delega su reconciliación a la etapa de integración compuesta en lugar de serializar la ejecución.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Tipos e Interfaces Principales

| Símbolo | Tipo | Módulo | Descripción |
|---|---|---|---|
| `evaluateReadiness` | Función | `canonical-frontier.ts` | Evalúa precondiciones duras sobre un `CanonicalReadinessSnapshot`. |
| `selectFrontier` | Función | `canonical-frontier.ts` | Selecciona la ola óptima de candidatos listos según capacidad y riesgo. |
| `CanonicalReadinessSnapshot` | Interface | `canonical-frontier.ts` | Entrada completa del estado inmutable del grafo y entorno de corrida. |
| `CanonicalReadinessReason` | Union Type | `canonical-frontier.ts` | Discriminante de 10 razones exhaustivas de preparación o bloqueo. |
| `CanonicalReadinessExplanation` | Interface | `canonical-frontier.ts` | Diagnóstico de readiness por nodo (`nodeId`, `ready`, `reasons`). |
| `CanonicalSelectionPolicy` | Interface | `canonical-frontier.ts` | Política de selección (`maxParallel`, `maxConcurrentRiskScore`). |
| `CanonicalFrontierSelection` | Interface | `canonical-frontier.ts` | Resultado de la selección (`selected`, `deferred`). |
| `explainReadiness` | Función | `readiness-v2.ts` | Evaluador de readiness para grafos transicionales V2. |
| `selectReadyWaveV2` | Función | `wave-selector-v2.ts` | Selector de olas V2 con soporte de restricciones de conflicto. |
| `scheduleTasks` | Función | `index.ts` | Planificador batch clásico (legacy V1). |
| `selectScopeAwareWave` | Función | `index.ts` | Selector de olas basado en análisis de globs de paths. |
| `applyHumanGateToSchedule` | Función | `index.ts` | Compuerta de decisión para serializar o revisar tareas riesgosas. |
| `SchedulerPlanSchema` | Zod Schema | `index.ts` | Schema Zod para planes generados por `scheduleTasks`. |
| `HumanGateResultSchema` | Zod Schema | `index.ts` | Schema Zod para resultados procesados por compuertas humanas. |

### 4.2. Ejemplo de Uso: Evaluación Canónica de Readiness y Selección de Frente

```typescript
import {
  evaluateReadiness,
  selectFrontier,
  type CanonicalReadinessSnapshot,
  type CanonicalSelectionPolicy,
  type IntegrationRiskEstimate
} from "@manyhands/scheduler";
import type { GraphRevision } from "@manyhands/task-graph";
import type { TaskContractBundle } from "@manyhands/contracts";

// 1. Definir el snapshot inmutable de la corrida
const snapshot: CanonicalReadinessSnapshot = {
  graph: {
    graphId: "graph-001",
    revision: 1,
    rootNodeId: "root",
    nodes: {
      "task-auth": {
        id: "task-auth",
        kind: "leaf",
        parentId: "root",
        title: "Implement Auth Service",
        contractRef: { id: "contract-auth", revision: 1, digest: "sha256:auth123" }
      },
      "task-billing": {
        id: "task-billing",
        kind: "leaf",
        parentId: "root",
        title: "Implement Billing Service",
        contractRef: { id: "contract-billing", revision: 1, digest: "sha256:bill456" }
      }
    },
    artifactRequirements: [],
    resourceClaims: [
      { nodeId: "task-auth", resourceId: "db:users", access: "modify" },
      { nodeId: "task-billing", resourceId: "db:users", access: "read" }
    ],
    runtimeLeaseClaims: []
  } as unknown as GraphRevision,
  contracts: {
    taskBundles: {
      "task-auth": { task: { id: "contract-auth", revision: "1" } } as unknown as TaskContractBundle,
      "task-billing": { task: { id: "contract-billing", revision: "1" } } as unknown as TaskContractBundle
    }
  },
  adoptedArtifacts: [],
  pendingDecisions: [],
  activeNodeIds: [],
  activeRuntimeLeases: [],
  availableExecutorNodeIds: ["task-auth", "task-billing"],
  adoptedNodeIds: [],
  budgetAvailable: true
};

// 2. Evaluar condiciones duras de disponibilidad
const readinessEvaluation = evaluateReadiness(snapshot);
console.log("Nodos listos:", readinessEvaluation.ready.map((r) => r.nodeId));
console.log("Nodos bloqueados:", readinessEvaluation.blocked.map((b) => ({ id: b.nodeId, reasons: b.reasons })));

// 3. Configurar la política de selección
const policy: CanonicalSelectionPolicy = {
  maxParallel: 2,
  maxConcurrentRiskScore: 40
};

// 4. Seleccionar el frente ejecutable
const selection = selectFrontier({
  ready: readinessEvaluation.ready,
  policy,
  graph: snapshot.graph,
  estimateIntegrationRisk: (candidate, alreadySelected): IntegrationRiskEstimate => {
    // Estimación consultiva lazy
    return { score: 10, evidenceRefs: ["evidence:independent-module"] };
  }
});

console.log("Nodos seleccionados para despacho:", selection.selected.map((s) => s.nodeId));
console.log("Nodos diferidos:", selection.deferred);
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan maestro normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Sección 9.6 y Stage 6 / GS):

| Característica | Estado Actual | Destino Arquitectónico |
|---|---|---|
| **Cómputo de Readiness** | Canónico en `canonical-frontier.ts` | Única ruta autoritativa; `readiness-v2.ts` será eliminado en Stage 11. |
| **Selección de Olas** | Coexisten `selectFrontier` y `selectScopeAwareWave` | `selectFrontier` es la interfaz canónica. Toda selección basada en globs de rutas queda deprecada. |
| **Matriz Pairwise** | Mantenida como fallback en `buildSchedulingSafetyContext` | Retiro total en Stage 11; la selección operará únicamente sobre `ResourceClaim` indexado. |
| **Compuertas Humanas** | `applyHumanGateToSchedule` en `index.ts` | Las decisiones humanas se gestionan mediante eventos canónicos `decision.raised` / `decision.resolved` en `run-coordinator`. |

---

## 6. Comandos de Verificación y Testing

Para compilar y verificar los tipos estáticos de este paquete de forma aislada:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/scheduler typecheck

# Compilación de artefactos de distribución (ESM y CJS con declaraciones DTS)
pnpm --filter @manyhands/scheduler build
```
