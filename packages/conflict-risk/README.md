# @manyhands/conflict-risk

Módulo transicional de predicción estática de conflictos par a par (*pairwise*) entre contratos de tareas para ManyHands.

---

## 1. Propósito y Responsabilidad en ManyHands

En el ecosistema de ManyHands, `@manyhands/conflict-risk` fue diseñado como un motor de análisis estático predictivo encargado de estimar la probabilidad de interferencia o colisión entre dos tareas que pretenden ejecutarse en paralelo.

### ¿Por qué existe y qué problemas resuelve?

- **Detección Temprana de Colisiones**: Antes de despachar tareas a los agentes ejecutores, el módulo analiza los contratos de tareas (`AgentTaskContract`) y los cruza con el índice del repositorio (`RepositoryIndex`) para predecir si dos tareas colisionarán en:
  - Archivos o patrones de ruta idénticos (`file_overlap`, `path_overlap`).
  - Símbolos exportados y consumidos (`producer_consumer`, `symbol_overlap`).
  - Dependencias de módulos o esquemas compartidos (`static_shared_schema_dependency`, `static_import_dependency`).
  - Fixtures de pruebas compartidas o rutas críticas de configuración (`critical_path`, `shared_test_fixture`).
- **Generación de Recomendaciones Operativas**: Para cada par de tareas, computa un puntaje de riesgo acotado $[0, 1]$ y emite una recomendación determinista: `run_parallel`, `serialize`, `add_dependency` o `requires_human_review`.
- **Suministro de Evidencia Explicable**: Cada predicción contiene una lista detallada de evidencias ponderadas (`ConflictEvidence`) que justifican ante el planificador o el usuario por qué un par de tareas no debería coejecutarse.

---

## 2. Arquitectura Modular Interna

El paquete posee una estructura compacta y autocontenida:

```
packages/conflict-risk/
├── src/
│   ├── index.ts                # Motor de predicción, ponderación de señales, schemas Zod y utilidades
│   └── constraint-evidence.ts  # Interface ConflictConstraintEvidence y factoría con TTL
├── package.json
└── tsconfig.json
```

### Desglose de Archivos

- **`src/index.ts`**:
  - Define la totalidad de los esquemas Zod (`ConflictPredictionSchema`, `ConflictRiskScoreSchema`, `StaticConflictSignalSchema`, etc.) y sus tipos inferidos.
  - Implementa `buildTaskPairRiskMatrix` y `buildRepositoryAwareRiskMatrix` para generar la matriz $O(N^2)$ de predicciones.
  - Implementa `predictConflict`, que evalúa las superposiciones directas entre dos `AgentTaskContract` y fusiona las señales estáticas precomputadas.
  - Implementa `buildStaticConflictSignals`, que inspecciona el `RepositoryIndex` buscando 10 tipos de señales estáticas estructurales.
  - Expone funciones auxiliares de búsqueda y ordenamiento como `findRiskPrediction`.
- **`src/constraint-evidence.ts`**:
  - Define la interface `ConflictConstraintEvidence` utilizada por los selectores de olas transicionales para adjuntar restricciones temporizadas con modo de acción (`advisory`, `serialize`, `resource_lock`) y fecha de caducidad (`expiresAt`).
  - Expone la función factory `createConflictConstraintEvidence`.

---

## 3. Patrones de Diseño y Estrategias Técnicas

### 3.1. Composición Ponderada de Señales (*Weighted Signal Composition*)

El cálculo del riesgo entre dos tareas no se basa en una heurística binaria, sino en la acumulación de señales de evidencia heterogéneas. Cada señal posee un peso normalizado:

| Señal de Evidencia | Peso Típico | Categoría de Conflicto | Descripción |
|---|---|---|---|
| `file_overlap` | 0.75 | Textual | Ambas tareas declaran modificar exactamente el mismo archivo en `expectedOutput.changedFiles`. |
| `path_overlap` | 0.30 | Textual | Intersección en los globs de rutas permitidas (`allowed.paths`). |
| `symbol_overlap` | 0.35 | Estructural | Ambas tareas referencian los mismos símbolos exportados o tipos. |
| `producer_consumer` | 0.50 | Dependencia | Una tarea produce símbolos concretos que la otra declara consumir. |
| `critical_path` | 0.50 | Infraestructura | Ambas tareas modifican archivos de configuración, schemas o migraciones. |
| `shared_test_fixture` | 0.20 | Validación | Ambas tareas modifican el mismo archivo o suite de pruebas. |
| `static_same_declared_symbol_file` | 0.45 (high) | Estructural | El índice estático prueba que los símbolos están en el mismo archivo físico. |
| `static_import_dependency` | 0.45 (high) | Dependencia | Un archivo modificado por la tarea A importa un archivo modificado por la tarea B. |
| `static_shared_schema_dependency` | 0.45 (high) | Arquitectura | Ambas tareas dependen del mismo archivo de esquema (`schema`). |

El puntaje final se consolida mediante:
$$\text{score} = \operatorname{clamp}_{0}^{1}\left(\sum \text{weight}_i\right)$$

### 3.2. Clasificación Categórica y Claves Canónicas Simétricas

1. **Mapeo de Puntaje a Nivel**:
   - `score >= 0.75` o presencia de señales bloqueantes $\rightarrow$ `"high"` o `"blocking"`.
   - `score >= 0.30` $\rightarrow$ `"medium"`.
   - `score < 0.30` $\rightarrow$ `"low"`.
2. **Determinación de la Recomendación**:
   - Nivel `"blocking"` $\rightarrow$ `"requires_human_review"`.
   - Evidencia de productor-consumidor $\rightarrow$ `"add_dependency"` (con sugerencia explícita de `fromTaskId` a `toTaskId`).
   - Nivel `"high"` o `"medium"` $\rightarrow$ `"serialize"`.
   - Nivel `"low"` $\rightarrow$ `"run_parallel"`.
3. **Pares Canónicos Simétricos**: Emplea la función `pairKey(taskAId, taskBId)` (provista por `@manyhands/shared`), la cual ordena léxicamente los identificadores (`min\0max`) para garantizar que la relación entre `taskA` y `taskB` sea simétrica e independiente del orden de evaluación.

---

## 4. Puntos de Entrada, Interfaces y Schemas Clave

### 4.1. Catálogo de Schemas y Tipos Principales

| Símbolo | Tipo | Descripción |
|---|---|---|
| `ConflictRiskLevelSchema` | Zod Union | Niveles de riesgo: `"low"`, `"medium"`, `"high"`, `"blocking"`. |
| `ConflictEvidenceSignalSchema` | Zod Union | 18 tipos de señales de evidencia (textuales, estructurales y estáticas). |
| `ConflictEvidenceSchema` | Zod Object | Entrada de evidencia (`signal`, `detail`, `weight`). |
| `ConflictRiskScoreSchema` | Zod Object | Evaluación de score numérico y nivel entre dos tareas. |
| `ConflictRecommendationSchema` | Zod Union | Acciones recomendadas: `"run_parallel"`, `"serialize"`, `"add_dependency"`, `"requires_human_review"`. |
| `ConflictPredictionSchema` | Zod Object | Predicción completa entre `taskAId` y `taskBId`, con archivos/símbolos compartidos y recomendación. |
| `TaskPairRiskMatrixSchema` | Zod Array | Matriz de predicciones de conflictos (`ConflictPrediction[]`). |
| `StaticConflictSignalSchema` | Zod Object | Señal estática extraída del `RepositoryIndex`. |
| `ConflictConstraintEvidence` | Interface | Restricción de conflicto con TTL y modo de ejecución (`advisory`, `serialize`, `resource_lock`). |
| `buildTaskPairRiskMatrix` | Función | Construye la matriz de riesgo entre todas las combinaciones de contratos. |
| `buildRepositoryAwareRiskMatrix` | Función | Construye la matriz integrando señales estáticas del `RepositoryIndex`. |
| `predictConflict` | Función | Computa la predicción de conflicto para un único par de contratos. |
| `buildStaticConflictSignals` | Función | Analiza el `RepositoryIndex` y extrae señales estáticas para los contratos. |
| `createConflictConstraintEvidence` | Función | Factory para instancias válidas de `ConflictConstraintEvidence`. |

### 4.2. Ejemplo de Uso: Generación de Matriz de Riesgos con Señales Estáticas

```typescript
import {
  buildRepositoryAwareRiskMatrix,
  predictConflict,
  type TaskPairRiskMatrix
} from "@manyhands/conflict-risk";
import type { AgentTaskContract } from "@manyhands/contracts";
import type { RepositoryIndex } from "@manyhands/repository-index";

// 1. Definición de contratos de tareas
const contracts: Record<string, AgentTaskContract> = {
  "task-user-service": {
    taskId: "task-user-service",
    allowed: { paths: ["src/users/**"] },
    expectedOutput: {
      changedFiles: ["src/users/service.ts", "src/shared/types.ts"],
      producedSymbols: ["UserService", "UserProfile"],
      consumedSymbols: ["DatabaseConnection"]
    },
    relevantSymbols: ["UserProfile"],
    producedInterfaces: [],
    consumedInterfaces: []
  } as unknown as AgentTaskContract,
  "task-auth-service": {
    taskId: "task-auth-service",
    allowed: { paths: ["src/auth/**", "src/shared/**"] },
    expectedOutput: {
      changedFiles: ["src/auth/auth.ts", "src/shared/types.ts"],
      producedSymbols: ["AuthToken"],
      consumedSymbols: ["UserProfile"]
    },
    relevantSymbols: ["UserProfile"],
    producedInterfaces: [],
    consumedInterfaces: []
  } as unknown as AgentTaskContract
};

// 2. Mock del índice de repositorio
const repositoryIndex: RepositoryIndex = {
  version: 1,
  files: [
    { path: "src/shared/types.ts", kind: "schema", sizeBytes: 1024, hash: "sha256:111" },
    { path: "src/users/service.ts", kind: "source", sizeBytes: 2048, hash: "sha256:222" },
    { path: "src/auth/auth.ts", kind: "source", sizeBytes: 2048, hash: "sha256:333" }
  ],
  symbols: [
    { name: "UserProfile", filePath: "src/shared/types.ts", kind: "interface", exported: true },
    { name: "DatabaseConnection", filePath: "src/shared/db.ts", kind: "class", exported: true }
  ],
  imports: [
    { filePath: "src/auth/auth.ts", moduleSpecifier: "../shared/types.js" },
    { filePath: "src/users/service.ts", moduleSpecifier: "../shared/types.js" }
  ],
  schemaDependencies: []
} as unknown as RepositoryIndex;

// 3. Generar la matriz de riesgo
const matrix: TaskPairRiskMatrix = buildRepositoryAwareRiskMatrix({
  contracts,
  repositoryIndex
});

console.log(`Predicciones generadas: ${matrix.length}`);
for (const prediction of matrix) {
  console.log(`Par: ${prediction.taskAId} <-> ${prediction.taskBId}`);
  console.log(`  Nivel de riesgo: ${prediction.level} (Score: ${prediction.score})`);
  console.log(`  Recomendación: ${prediction.recommendation}`);
  console.log(`  Archivos compartidos: ${prediction.sharedFiles.join(", ")}`);
  console.log(`  Explicación: ${prediction.explanation}`);
}
```

---

## 5. Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan maestro de rediseño normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`, Sección 9.5 y Stage 6 / Stage 11):

- **Estado**: **Transicional / En camino de retiro**.
- **Justificación del Reemplazo**:
  1. El cálculo $O(N^2)$ no escala para grafos con decenas o cientos de nodos.
  2. Una matriz global heurística no ofrece garantías formales de corrección ni previene colisiones reales en runtime.
  3. En la arquitectura objetivo, la seguridad de concurrencia se delega formalmente a `ResourceClaim` indexado por recurso dentro de `packages/task-graph` y se valida en `packages/scheduler` (`evaluateReadiness`).
- **Plan de Retiro**:
  - **Stage 6 (GS)**: Retiró la autoridad efectiva de selección de este módulo. La salida de `conflict-risk` se convirtió en una señal consultiva secundaria (`IntegrationRiskEstimate`) dentro de `selectFrontier`.
  - **Stage 11 (GArch / GProd)**: Una vez que se complete la migración de todos los consumidores (`orchestrator-graph`, adaptadores legacy en `web` y `scheduler`), y las pruebas de análisis de alcance (*reachability*) confirmen que no existen invocaciones activas, el paquete `@manyhands/conflict-risk` será eliminado formalmente del monorepo.

---

## 6. Comandos de Verificación y Testing

Para compilar y verificar los tipos estáticos de este paquete:

```bash
# Verificación de tipos estáticos TypeScript
pnpm --filter @manyhands/conflict-risk typecheck

# Compilación de artefactos de distribución (ESM y CJS con declaraciones DTS)
pnpm --filter @manyhands/conflict-risk build
```
