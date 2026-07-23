# PILAR 1 — MOTOR DE DESCOMPOSICIÓN ADAPTATIVA DE GRANULARIDAD (DECOMPOSER V3)

> **Ubicación del código**: `packages/decomposer`  
> **Responsabilidad**: Transformar objetivos de software en un DAG jerárquico inmutable resolviendo dinámicamente el nivel de granularidad óptima.

---

## 1. EL PARADOJA DE LA GRANULARIDAD Y PROPÓSITO

En la orquestación multiagente de código, la división arbitraria de tareas genera dos patologías graves:
- **Under-splitting (Granularidad gruesa)**: Un objetivo complejo se asigna como hoja única a un agente. El agente desborda su ventana de contexto, comete errores de compilación y sufre desviación de alcance (*scope creep*).
- **Over-splitting (Granularidad fina)**: Una tarea simple (ej. exportar un tipo en un archivo) se divide artificialmente en 4 sub-nodos. Genera latencia excesiva, sobrecosto de orquestación y fricción en los contratos de interfaz (*SeamBindings*).

**Solución de ManyHands V3**: Para cada tarea, calcular el **Índice de Complejidad Intrínseca ($C_{task}$)** y aplicar un umbral adaptativo que decide si la tarea se declara hoja ejecutable (*Leaf*) o nodo composite con factor de ramificación óptimo ($k^*$).

---

## 2. ARQUITECTURA EN DOS FASES: ARCHITECT PASS + GRAPH COMPILER

```mermaid
flowchart TD
    TaskInput[Objetivo & Snapshot del Repo] --> ArchPass[Fase 1: Architect Pass\n(Evaluación Semántica de Complejidad LLM)]
    ArchPass --> ComplexityScore[C_task: Score 1.0 a 10.0]
    ComplexityScore --> ThresholdCheck{C_task <= Umbral_Hoja?}
    
    ThresholdCheck -->|Sí (C_task <= 3.5)| LeafNode[Declara Leaf Node Cohesivo\n(Detiene Descomposición)]
    ThresholdCheck -->|No (C_task > 3.5)| BranchingFactor[Calcula Factor de Ramificación Óptimo k*]
    
    BranchingFactor --> ProposedUnits[Propuesta de Sub-Objetivos]
    ProposedUnits --> GranularityCritic[Fase 2: Granularity & Scope Critics]
    
    GranularityCritic -->|Fusión de sub-tareas triviales| Coalesce[Coalescencia / Merge]
    GranularityCritic -->|Sub-tarea demasiado amplia| ReSplit[Sub-división Forzada]
    
    Coalesce & ReSplit & LeafNode --> GraphCompiler[Graph Compiler\n(Generación de Contratos Zod & Relaciones)]
    GraphCompiler --> FinalRevision[GraphRevision v3 Validado]
```

---

## 3. MODELO DE EVALUACIÓN DE COMPLEJIDAD INTRÍNSECA ($C_{task}$)

$$C_{task} = w_1 \cdot S_r + w_2 \cdot I_i + w_3 \cdot V_s + w_4 \cdot T_m$$

### Dimensiones de Evaluación:
1. **Scope Radius ($S_r$)**: Cantidad de archivos, módulos o paquetes afectados o creados.
2. **Interface Impact ($I_i$)**: Grado de modificación de firmas exported, contratos de interfaz o API pública (alto $I_i$) vs. refactorización interna (bajo $I_i$).
3. **Validation Surface ($V_s$)**: Cantidad de obligaciones de validación y suites de prueba que deben pasar para verificar la corrección.
4. **Context Token Mass ($T_m$)**: Masa estimada de tokens de código/contexto necesarios para completar el trabajo.

### Regla de Decisión:
- **$C_{task} \le 3.5$**: Declara **Leaf Node Cohesivo**. Se prohíbe la sub-división.
- **$C_{task} > 3.5$**: Declara **Composite Node** y calcula el factor de ramificación ideal ($k^* \in [2, 5]$).

---

## 4. CRITICS Y COMPRESIÓN DE CONTEXTO

- **Over-splitting Critic (Coalescencia)**: Si dos sub-unidades propuestas modifican el mismo archivo o módulo pequeño sin dependencias cruzadas, el critic las **fusiona** en una sola hoja.
- **Under-splitting Critic (Re-división)**: Si el Architect declara `isLeaf: true` pero el `ScopeRadius` abarca más de 3 módulos independientes, el critic rechaza la hoja y exige una división en 2 sub-composites.
- **Compresor de Contexto (`context-compressor.ts`)**:
  - **Scope Tree Summarizer**: Envía al agente únicamente el sub-árbol de archivos declarado en su `ScopeContract`.
  - **Interface Signature Extractor**: Extrae solo tipos e interfaces (`type`, `interface`, `function`), suprimiendo código interno.
  - **System-Prompt Channeling**: Inyecta instrucciones en el parámetro `system` oficial de Claude/Codex.
  - **Input Fingerprint**: Reutiliza la caché inmutable si las entradas no cambian.

---

## 5. MÉTRICAS CIENTÍFICAS PARA LA HIPÓTESIS DE TESIS ($GEI$)

$$\text{GEI} = \frac{\text{Tasa de Éxito de Intentos de Agentes (\%)}}{\text{Tiempo Total de Ejecución (s)} \times \text{Coste de Tokens}}$$

Persiste en cada corrida: `max_graph_depth`, `total_leaf_count`, `average_branching_factor`, `coalesced_units_count`, y la matriz de éxito por score de complejidad.
