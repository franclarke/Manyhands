# ARQUITECTURA DEL MOTOR DE DESCOMPOSICIÓN ADAPTATIVA DE GRANULARIDAD (DECOMPOSER V3)

Este documento especifica la arquitectura detallada para el nuevo motor de descomposición de **ManyHands**, diseñado en `packages/decomposer`. Su objetivo principal es resolver dinámicamente el nivel de **granularidad óptima** para cualquier tarea de ingeniería de software, respondiendo a la hipótesis central de investigación del sistema.

---

## 1. PROBLEMA ARQUITECTÓNICO Y MOTIVACIÓN

En la orquestación multiagente de código, la descomposición rígida (fijar siempre una profundidad de árbol o dividir todas las tareas en un número arbitrario de sub-hijos) presenta fallas fundamentales:

- **Under-splitting (Granularidad excesivamente gruesa)**: Asignar un objetivo complejo a un solo agente consumidor desborda la ventana de contexto, incrementa la tasa de fallos de compilación/validación e incurre en desviaciones de alcance (*scope creep*).
- **Over-splitting (Granularidad excesivamente fina)**: Dividir una modificación trivial (ej. corregir una firma o exportar un tipo) en 4 sub-nodos genera sobrecostos masivos de coordinación, latencia en la cola de ejecución y fricción en los contratos de interfaz (*SeamBindings*).

**Objetivo de ManyHands V3**: Para cada tarea, resolver mediante evaluación semántica y determinista el nivel de descomposición ideal, minimizando el costo total y maximizando la tasa de éxito de los agentes.

---

## 2. ARQUITECTURA EN DOS FASES: ARCHITECT PASS + GRAPH COMPILER

El proceso de descomposición se separa estrictamente en dos fases: una **fase semántica (Architect)** y una **fase determinista (Compiler + Critics)**.

```mermaid
flowchart TD
    TaskInput[Objetivo & Snapshot del Repo] --> ArchPass[Fase 1: Architect Pass\n(Evaluación Semántica de Complejidad)]
    ArchPass --> ComplexityScore[C_task: Score 1..10]
    ComplexityScore --> ThresholdCheck{C_task <= Umbral_Hoja?}
    
    ThresholdCheck -->|Sí| LeafNode[Declara Leaf Node Cohesivo\n(Detiene Descomposición)]
    ThresholdCheck -->|No| BranchingFactor[Calcula Factor de Ramificación Óptimo k*]
    
    BranchingFactor --> ProposedUnits[Propuesta de Sub-Objetivos]
    ProposedUnits --> GranularityCritic[Fase 2: Granularity & Scope Critics]
    
    GranularityCritic -->|Fusión de sub-tareas triviales| Coalesce[Coalescencia / Merge]
    GranularityCritic -->|Sub-tarea demasiado amplia| ReSplit[Sub-división Forzada]
    
    Coalesce & ReSplit & LeafNode --> GraphCompiler[Graph Compiler\n(Generación de Contratos Zod & Relaciones)]
    GraphCompiler --> FinalRevision[GraphRevision v3 Validado]
```

---

## 3. MODELO DE EVALUACIÓN DE COMPLEJIDAD INTRÍNSECA ($C_{task}$)

Antes de decidir si una tarea debe dividirse, el motor calcula el **Índice de Complejidad Intrínseca** ($C_{task}$) evaluando 4 dimensiones estructurales:

$$C_{task} = w_1 \cdot S_r + w_2 \cdot I_i + w_3 \cdot V_s + w_4 \cdot T_m$$

### Dimensiones de Evaluación:
1. **Scope Radius ($S_r$)**: Cantidad de archivos, módulos o paquetes afectados o creados.
2. **Interface Impact ($I_i$)**: Grado de impacto en firmas exported, contratos de interfaz o API pública (alto $I_i$) vs. refactorización interna (bajo $I_i$).
3. **Validation Surface ($V_s$)**: Cantidad de obligaciones de validación y suites de prueba que deben pasar para verificar la corrección.
4. **Context Token Mass ($T_m$)**: Masa estimada de tokens de código/contexto necesarios para completar el trabajo.

### Criterio de Decisión:
- **$C_{task} \le 3.5$**: Declara **Leaf Node Cohesivo**. Se prohíbe la sub-división.
- **$C_{task} > 3.5$**: Declara **Composite Node** y calcula el factor de ramificación ideal ($k^* \in [2, 5]$).

---

## 4. FASE 1: ARCHITECT PASS (LLM AGENT)

El agente de planificación (Claude Code o Codex CLI) evalúa la complejidad y emite una propuesta estructurada:

```typescript
export interface GranularityAssessment {
  nodeId: string;
  complexityScore: number; // 1.0 a 10.0
  isLeaf: boolean;
  rationale: string;
  recommendedBranchingFactor?: number;
  proposedUnits?: Array<{
    title: string;
    goal: string;
    targetScopePaths: string[];
    expectedDependencies: string[];
  }>;
}
```

---

## 5. FASE 2: GRAPH COMPILER & GRANULARITY CRITICS

El compilador de TypeScript recibe la propuesta del Architect y ejecuta dos críticas deterministas:

### 5.1 Over-splitting Critic (Coalescencia / Fusión)
Si dos sub-unidades propuestas modifican el mismo archivo o directorio pequeño y no poseen dependencias encontradas, el critic las **fusiona** en un solo `LeafNode` para reducir la latencia de despacho.

### 5.2 Under-splitting Critic (Re-división Forzada)
Si el Architect declara `isLeaf: true` pero el `ScopeRadius` abarca más de 3 módulos independientes, el critic rechaza la hoja y exige una división en 2 sub-composites.

---

## 6. MÉTRICAS CIENTÍFICAS PARA LA HIPÓTESIS DE TESIS

Para registrar la efectividad del modelo de granularidad adaptativa, ManyHands persiste las siguientes métricas en cada run:

- **Granularity Efficiency Index ($GEI$)**:
  $$\text{GEI} = \frac{\text{Tasa de Éxito de Intentos de Agentes (\%)}}{\text{Tiempo Total de Ejecución (s)} \times \text{Coste de Tokens}}$$
- **Métricas Registradas por Run**:
  - `max_graph_depth`: Profundidad máxima alcanzada en el DAG.
  - `total_leaf_count`: Cantidad total de hojas ejecutables.
  - `average_branching_factor`: Factor de ramificación promedio.
  - `coalesced_units_count`: Cantidad de sub-tareas fusionadas por el critic.
  - `attempt_success_rate_by_complexity`: Matriz de éxito agrupada por score de complejidad $C_{task}$.

---

## 7. UBICACIÓN DE CÓDIGO Y ESTRUCTURA DE PAQUETE

- `packages/decomposer/src/granularity/complexity-evaluator.ts`: Calculador de $C_{task}$.
- `packages/decomposer/src/granularity/coalescing-critic.ts`: Evaluador de fusión de sub-tareas.
- `packages/decomposer/src/granularity/thesis-metrics.ts`: Colector de métricas $GEI$.
- `packages/decomposer/src/llm/architect-pass.ts`: Ejecutor de la Fase 1 con Claude/Codex.
- `packages/decomposer/src/compiler/graph-compiler-v3.ts`: Compilador del DAG V3.
- `tests/decomposer-adaptive-granularity.test.ts`: Test suite con casos de prueba para tareas triviales, complejas y fusionadas.
