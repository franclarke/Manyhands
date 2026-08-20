# Guía Arquitectónica: @manyhands/conflict-risk

> **Ubicación en el Monorepo**: `packages/conflict-risk/`  
> **README del Paquete**: [`../../packages/conflict-risk/README.md`](../../packages/conflict-risk/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En arquitecturas multi-agente concurrentes, ejecutar tareas en paralelo sin un análisis de interferencia puede provocar que dos agentes generen cambios incompatibles en los mismos archivos, esquemas o interfaces compartidas, descubriéndose el conflicto recién en la fase de integración.

**`@manyhands/conflict-risk`** es un subsistema transicional de **análisis estático predictivo**. Su propósito es estimar la probabilidad de interferencia entre dos tareas evaluando la superposición de rutas, el consumo/producción de símbolos y las dependencias estáticas indexadas por `@manyhands/repository-index`.

### Problemas Fundamentales que Resuelve

- **Detección Temprana de Colisiones Potenciales**: Cruza los contratos de tareas con el índice de repositorio para detectar intersecciones en archivos (`file_overlap`, `path_overlap`), símbolos (`symbol_overlap`, `producer_consumer`) y dependencias compartidas (`static_shared_schema_dependency`, `static_import_dependency`).
- **Generación de Recomendaciones Operativas**: Para cada par de tareas, calcula un puntaje de riesgo normalizado en $[0, 1]$ y emite una recomendación tipada: `run_parallel`, `serialize`, `add_dependency` o `requires_human_review`.
- **Suministro de Evidencia Explicable**: Cada predicción desglosa las señales ponderadas (`ConflictEvidence`) que justifican por qué dos tareas no deberían ejecutarse concurrentemente.

---

## 2. Arquitectura Interna y Componentes

El paquete posee una estructura compacta en `src/`:

```
packages/conflict-risk/
├── src/
│   ├── index.ts                # Motor de predicción, ponderación de señales, schemas Zod y utilidades
│   └── constraint-evidence.ts  # Interface ConflictConstraintEvidence y factoría con TTL
├── package.json
└── tsconfig.json
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `src/index.ts` | Define la totalidad de los esquemas Zod (`ConflictPredictionSchema`, `ConflictRiskScoreSchema`, `StaticConflictSignalSchema`), implementa `buildTaskPairRiskMatrix`, `buildRepositoryAwareRiskMatrix`, `predictConflict` y extrae señales estáticas estructurales mediante `buildStaticConflictSignals`. |
| `src/constraint-evidence.ts` | Define `ConflictConstraintEvidence` utilizada por selectores transicionales para adjuntar restricciones temporizadas con modo de acción (`advisory`, `serialize`, `resource_lock`) y fecha de expiración (`expiresAt`). |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el flujo de análisis estático entre contratos de tareas y el índice del repositorio:

```
  AgentTaskContract A + AgentTaskContract B       RepositoryIndex (@manyhands/repository-index)
                     │                                         │
                     ├────────────────────┬────────────────────┘
                     ▼                    ▼
          ┌─────────────────────┐   ┌───────────────────────────┐
          │  Superposición de   │   │  buildStaticConflict-     │
          │  Paths y Símbolos   │   │  Signals (AST / Imports)  │
          └──────────┬──────────┘   └─────────────┬─────────────┘
                     │                            │
                     └─────────────┬──────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │     predictConflict     │
                      │  (Ponderación de pesos) │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │    ConflictPrediction   │
                      │ • score in [0.0, 1.0]   │
                      │ • level: low/med/high   │
                      │ • recommendation        │
                      └────────────┬────────────┘
                                   │
                                   ▼
             Consumido como recomendación consultiva en
                   @manyhands/scheduler (selectFrontier)
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Schemas Zod y Tipos Principales

| Schema / Tipo | Tipo Zod | Propósito |
|---|---|---|
| `ConflictRiskLevelSchema` | Zod Union | Niveles de riesgo: `"low"`, `"medium"`, `"high"`, `"blocking"`. |
| `ConflictEvidenceSignalSchema` | Zod Union | 18 tipos de señales de evidencia (textuales, estructurales y estáticas). |
| `ConflictEvidenceSchema` | Zod Object | Entrada de evidencia (`signal`, `detail`, `weight`). |
| `ConflictRiskScoreSchema` | Zod Object | Evaluación de score numérico $[0, 1]$ y nivel entre dos tareas. |
| `ConflictRecommendationSchema` | Zod Union | Acciones recomendadas: `"run_parallel"`, `"serialize"`, `"add_dependency"`, `"requires_human_review"`. |
| `ConflictPredictionSchema` | Zod Object | Predicción completa entre dos tareas con listas de archivos y símbolos compartidos. |
| `TaskPairRiskMatrixSchema` | Zod Array | Matriz de predicciones entre todos los pares evaluados (`ConflictPrediction[]`). |
| `ConflictConstraintEvidence` | Interfaz | Restricción de conflicto con TTL y modo de ejecución. |

### Firmas de Funciones Fundamentales

```typescript
export function buildTaskPairRiskMatrix(
  contracts: Record<string, AgentTaskContract>,
  options?: BuildRiskMatrixOptions
): TaskPairRiskMatrix;

export function buildRepositoryAwareRiskMatrix(
  contracts: Record<string, AgentTaskContract>,
  index: RepositoryIndex,
  options?: BuildRiskMatrixOptions
): TaskPairRiskMatrix;

export function predictConflict(
  taskA: AgentTaskContract,
  taskB: AgentTaskContract,
  staticSignals?: readonly StaticConflictSignal[]
): ConflictPrediction;

export function buildStaticConflictSignals(
  contracts: Record<string, AgentTaskContract>,
  index: RepositoryIndex
): StaticConflictSignal[];
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Composición Ponderada de Señales Heterogéneas
El cálculo del riesgo no utiliza una regla binaria fija, sino la agregación de señales con diferentes pesos:

| Señal | Peso Típico | Categoría | Descripción |
|---|---|---|---|
| `file_overlap` | 0.75 | Textual | Ambas tareas declaran modificar exactamente el mismo archivo. |
| `path_overlap` | 0.30 | Textual | Intersección en los patrones glob de rutas permitidas. |
| `symbol_overlap` | 0.35 | Estructural | Ambas tareas tocan los mismos símbolos exportados o tipos. |
| `producer_consumer` | 0.50 | Dependencia | Una tarea produce símbolos que la otra declara consumir. |
| `critical_path` | 0.50 | Infraestructura | Ambas tareas modifican archivos de configuración o migraciones. |
| `static_import_dependency` | 0.45 | Estática | Un archivo modificado por A importa un archivo modificado por B. |
| `static_shared_schema_dependency` | 0.45 | Arquitectura | Ambas tareas dependen del mismo archivo de esquema. |

El puntaje final se calcula como:
$$\text{score} = \operatorname{clamp}_{0}^{1}\left(\sum \text{weight}_i\right)$$

### 2. Claves Canónicas Simétricas
Para evitar evaluar el par $(A, B)$ y el par $(B, A)$ de forma divergente, se utiliza la función `pairKey(taskAId, taskBId)` (de `@manyhands/shared`), ordenando lexicográficamente los identificadores (`min\0max`).

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Reemplazo por Reclamos de Recursos**: La arquitectura canónica sustituye la obligatoriedad de matrices de riesgo cuadráticas $O(N^2)$ por la comparación directa de `ResourceClaim` en `@manyhands/scheduler` y `@manyhands/task-graph`.
2. **Rol Consultivo**: `@manyhands/conflict-risk` permanece activo exclusivamente como un estimador de riesgo consultivo opcional (`estimateIntegrationRisk`) dentro de `selectFrontier` para desempatar entre nodos listos.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/conflict-risk/README.md`](../../packages/conflict-risk/README.md)
- **Módulos Relacionados**:
  - [`scheduler.md`](./scheduler.md): Consumidor consultivo del estimador de riesgo durante la selección del frente.
  - [`repository-index.md`](./repository-index.md): Proveedor del índice estático para la extracción de dependencias.
  - [`contracts.md`](./contracts.md): Definición de contratos de tareas.
- **Documentación Central**: [`../README.md`](../README.md)
