# Guía Arquitectónica: @manyhands/scheduler

> **Ubicación en el Monorepo**: `packages/scheduler/`  
> **README del Paquete**: [`../../packages/scheduler/README.md`](../../packages/scheduler/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de ejecución multi-agente, la coordinación suele sufrir de dos extremos indeseables:
1. **Serialización Innecesaria**: Esperar a que concluya una "fase" u "ola" monolítica completa antes de desbloquear cualquier tarea posterior, desperdiciando capacidad de cómputo paralela.
2. **Colisiones por Falta de Restricciones**: Despachar tareas concurrentes que modifican los mismos archivos o interfieren entre sí, provocando conflictos de integración tardíos.

**`@manyhands/scheduler`** es el motor puro responsable de evaluar en todo momento el **frente continuo de ejecución (*continuous execution frontier*)**. Responde a dos preguntas fundamentales:
- **¿Qué nodos cumplen rigurosamente todas sus precondiciones duras?** (*Readiness Evaluation*).
- **De los nodos listos, ¿cuáles deben despacharse de inmediato considerando la capacidad del sistema, los reclamos de recursos y el riesgo de integración?** (*Frontier Selection*).

### Problemas Fundamentales que Resuelve

- **Desacoplamiento entre Corrección y Heurística**: Las restricciones duras (falta de artefacto previo, contrato obsoleto, decisiones pendientes, colisiones de escritura) determinan si un nodo *puede* ejecutarse. El riesgo de integración es puramente consultivo y solo interviene para priorizar entre candidatos ya verificados como listos.
- **Frente Continuo sin Barreras Monolíticas**: Tan pronto como un intento adopta un artefacto en el journal duradero, el frente se reevalúa inmediatamente, desbloqueando a los consumidores sin esperar a nodos hermanos no relacionados.
- **Indexación Directa de Recursos vs. Matrices $O(N^2)$**: Reemplaza el cómputo de matrices de riesgo par a par por la comparación directa de reclamos de recursos (`ResourceClaim`) y leases (`RuntimeLeaseClaim`).
- **Explicabilidad Total y Determinismo Puro**: El scheduler es una función matemática pura sin efectos secundarios ni llamadas de I/O. Para cada nodo evaluado, produce razones estructuradas (`CanonicalReadinessReason`) que justifican por qué fue admitido o diferido.

---

## 2. Arquitectura Interna y Componentes

El paquete en `src/` se organiza en submódulos que reflejan la evolución desde el despacho batch histórico hacia el frente continuo canónico:

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

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-frontier.ts` | Núcleo canónico. Contiene las funciones puras `evaluateReadiness` y `selectFrontier`, así como las estructuras `CanonicalReadinessSnapshot`, `CanonicalReadinessExplanation`, `CanonicalSelectionPolicy` y `CanonicalFrontierSelection`. |
| `readiness-v2.ts` | Implementa `explainReadiness` para grafos V2 (`LegacyGraphRevisionV2`), verificando artefactos requeridos, decisiones pendientes y ramas detenidas. |
| `types-v2.ts` | Define la jerarquía de razones de bloqueo `ReadinessReason` (ej. `missing_artifact`, `stale_contract`, `circuit_breaker_open`, `branch_stopped`). |
| `wave-selector-v2.ts` | Implementa `selectReadyWaveV2`, que filtra las explicaciones de readiness mediante restricciones de conflicto temporizadas (`ConflictConstraintEvidence`) y bloqueos de recursos. |
| `index.ts` | Re-exporta submódulos y algoritmos de compatibilidad V1 (`scheduleTasks`, `selectScopeAwareWave`, `applyHumanGateToSchedule`). |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra la separación estricta entre la evaluación de precondiciones duras y la política de selección del frente:

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

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Tipos e Interfaces Principales (`canonical-frontier.ts`)

```typescript
export interface CanonicalReadinessSnapshot {
  readonly graph: GraphRevision;
  readonly taskContracts: Readonly<Record<string, TaskContractBundle>>;
  readonly adoptedArtifacts: readonly AdoptedArtifactRef[];
  readonly pendingDecisions: readonly DecisionRef[];
  readonly activeAttempts: readonly ActiveAttemptRef[];
  readonly activeLeases: readonly ActiveRuntimeLeaseRef[];
  readonly executorCapabilities: readonly ExecutorCapabilityRef[];
  readonly budgetState: BudgetStateSnapshot;
}

export type CanonicalReadinessReason =
  | { readonly kind: "ready" }
  | { readonly kind: "missing_artifact"; readonly artifactContractId: string }
  | { readonly kind: "stale_contract"; readonly expectedDigest: string; readonly actualDigest: string }
  | { readonly kind: "unresolved_decision"; readonly decisionId: string }
  | { readonly kind: "resource_claim_conflict"; readonly resourceId: string; readonly conflictingNodeId: string }
  | { readonly kind: "runtime_lease_conflict"; readonly leaseKey: string; readonly conflictingNodeId: string }
  | { readonly kind: "executor_unavailable"; readonly reason: string }
  | { readonly kind: "budget_exhausted"; readonly dimension: string }
  | { readonly kind: "already_active"; readonly attemptId: string }
  | { readonly kind: "already_adopted"; readonly artifactDigest: string };

export interface CanonicalSelectionPolicy {
  readonly maxParallel: number;
  readonly maxConcurrentRiskScore?: number;
}
```

### Firmas de Funciones Principales

| Función | Firma | Propósito |
|---|---|---|
| `evaluateReadiness` | `(snapshot: CanonicalReadinessSnapshot) => CanonicalReadinessEvaluation` | Evalúa precondiciones duras sobre el snapshot de la corrida sin efectos colaterales. |
| `selectFrontier` | `(evaluation: CanonicalReadinessEvaluation, policy: CanonicalSelectionPolicy, estimateRisk?: RiskEstimator) => CanonicalFrontierSelection` | Selecciona la ola óptima de candidatos listos según capacidad y riesgo consultivo. |
| `explainReadiness` | `(graph: LegacyGraphRevisionV2, state: ReadinessStateV2) => Record<string, NodeReadinessExplanationV2>` | Evaluador de readiness para grafos transicionales V2. |
| `selectReadyWaveV2` | `(explanations: Record<string, NodeReadinessExplanationV2>, options: WaveSelectorOptionsV2) => ReadyWaveV2` | Selector de olas V2 con soporte de restricciones de conflicto temporizadas. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Separación Estricta entre Readiness y Selección
La arquitectura impone una frontera conceptual infranqueable entre dos fases:
1. **`evaluateReadiness`**: Analiza exclusivamente hechos verificables de dominio:
   - ¿Están adoptadas las revisiones exactas de los artefactos requeridos? (`missing_artifact`).
   - ¿Coincide el digest del contrato actual con la referencia en el nodo? (`stale_contract`).
   - ¿Hay decisiones humanas pendientes que afecten al nodo? (`unresolved_decision`).
   - ¿Existe colisión de acceso de recursos (`modify` vs `modify` / `read`) con nodos activos? (`resource_claim_conflict`).
   - ¿Hay conflictos con leases de runtime exclusivas? (`runtime_lease_conflict`).
   - ¿El ejecutor requerido está disponible y existe presupuesto? (`executor_unavailable`, `budget_exhausted`).
   - ¿El nodo ya está activo o fue adoptado previamente? (`already_active`, `already_adopted`).

2. **`selectFrontier`**: Toma únicamente el conjunto `ready` y aplica políticas operativas:
   - Limita la concurrencia a `maxParallel`.
   - Evalúa perezosamente (*lazily*) el estimador de riesgo de integración (`estimateIntegrationRisk`) contra el conjunto ya seleccionado. Si el puntaje acumulado excede `maxConcurrentRiskScore`, difiere el nodo con razón explicativa.

### 2. Modelo de Concurrencia de Recursos (`ResourceClaim` y `RuntimeLeaseClaim`)
En lugar de calcular matrices cuadráticas $O(N^2)$ entre todas las tareas posibles, el scheduler examina claims específicos:
- **`ResourceClaim`**:
  - `access: "read"`: Múltiples lectores pueden coejecutarse sobre el mismo recurso.
  - `access: "modify"`: Un escritor exige exclusividad sobre el `resourceId`. Si otro nodo activo o seleccionado reclama el mismo recurso, se emite un conflicto.
- **`RuntimeLeaseClaim`**:
  - `mode: "shared"`: Permite coexistencia (ej. lectura de workspace).
  - `mode: "exclusive"`: Exige acceso unívoco sobre el par `(provider, resourceKey)` (ej. puerto TCP, base de datos de test, lock de compilación).

### 3. Detección de Archivos de Coordinación en la Capa Legacy
En la capa legacy (`selectScopeAwareWave`), para evitar que archivos compartidos ubicuos (como `index.ts` o `package.json`) colapsen la concurrencia a 1 sola tarea por lote, el selector aplica un umbral (`COORDINATION_SHARE_THRESHOLD = 3`): si 3 o más candidatos tocan el mismo archivo, se clasifica como *coordination file* y se delega su reconciliación a la etapa de integración compuesta.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 6 / GS)**: El motor canónico de frente continuo (`canonical-frontier.ts`) y la evaluación estricta de precondiciones duras están completados y certificados en `docs/audits/stage-6/`.
2. **Retiro de Matrices de Riesgo Cuadráticas**: El cálculo de matrices $O(N^2)$ de `@manyhands/conflict-risk` ha quedado relegado a una función consultiva opcional dentro de `selectFrontier`.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/scheduler/README.md`](../../packages/scheduler/README.md)
- **Módulos Relacionados**:
  - [`task-graph.md`](./task-graph.md): Modelo del grafo `GraphRevision` y verificación de titularidad sobre recursos.
  - [`contracts.md`](./contracts.md): Contratos de tareas (`TaskContractBundle`) y reclamos de recursos.
  - [`conflict-risk.md`](./conflict-risk.md): Estimación consultiva de riesgo de integración.
  - [`orchestrator-graph.md`](./orchestrator-graph.md): Conducción iterativa de olas seleccionadas por el scheduler.
- **Documentación Central**: [`../README.md`](../README.md)
