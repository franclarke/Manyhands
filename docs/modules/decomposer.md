# Guía Arquitectónica: @manyhands/decomposer

> **Ubicación en el Monorepo**: `packages/decomposer/`  
> **README del Paquete**: [`../../packages/decomposer/README.md`](../../packages/decomposer/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de ingeniería de software basados en inteligencia artificial, la fase de descomposición y planificación es el punto más vulnerable al fracaso: los modelos de lenguaje tienden a generar planes superficiales, omitir interfaces y contratos compartidos, ignorar la estructura real del repositorio o planificar ediciones concurrentes sobre los mismos archivos que conducen a conflictos insolubles durante la integración.

**`@manyhands/decomposer`** es el subsistema encargado de transformar un objetivo formal de alto nivel (`GoalContract`) en un grafo ejecutable determinista (`GraphRevision`) y un conjunto inmutable de contratos de tareas (`TaskContractBundle`s), fundamentándose (*grounding*) en la evidencia física del repositorio provista por `@manyhands/repository-index`.

### Problemas Fundamentales que Resuelve

1. **Planificación Multi-Turno Presupuestada (`PlanningBudget`)**: Reemplaza la generación en un solo paso (*one-shot*) por un proceso interactivo y progresivo (`PlanningEngine`). Controla rígidamente las llamadas a LLMs, consultas al repositorio, bytes transferidos, revisiones y reparaciones, evitando ejecuciones descontroladas o desbordamiento de contexto.
2. **Terminación Garantizada y Detección de Falta de Progreso (`no_progress`)**: Rastrea el linaje causal de cada revisión de plan (`planningCausalStateDigest`). Si una propuesta repite un estado anterior sin aportar nueva evidencia o alterar los hallazgos, el motor aborta inmediatamente con `no_progress` en lugar de caer en bucles infinitos.
3. **Política de Granularidad Categórica 4.0 (`GranularityPolicy`)**: Elimina fórmulas heurísticas opacas y puntuaciones numéricas adimensionales. La decisión de dividir una unidad se basa exclusivamente en tres razones categóricas auditables: `doesNotFit` (excede el presupuesto de un intento), `runsInParallel` (habilita concurrencia real) y `verifiableApart` (criterios de prueba disjuntos).
4. **Verificación Estática Exhaustiva (`verifyPlan`)**: Antes de compilar cualquier plan, somete el `SemanticPlan` a una batería determinista de 8 categorías de invariantes (aciclicidad, cobertura probatoria, disyunción de escritores, compatibilidad de costuras, integridad de alcance).
5. **Compilación Directa (`compilePlan`)**: Transforma el `SemanticPlan` verificado directamente en una `GraphRevision` y sus contratos asociados sin pasar por representaciones intermedias ambiguas (`WorkBreakdown`).

---

## 2. Arquitectura Interna y Componentes

El paquete comprende 40 archivos TypeScript estructurados en módulos de motor, compilador, políticas de granularidad, críticos y adaptadores LLM:

```
packages/decomposer/src/
├── index.ts                               # Barrel export central, schemas y mocks
├── planning-engine/
│   └── planning-engine.ts                 # Motor de planificación progresiva multi-turno con presupuesto
├── compiler/
│   ├── direct-plan-compiler.ts            # Compilador canónico: SemanticPlan -> GraphRevision + TaskContractBundles
│   ├── json-extractor.ts                  # Extractor resiliente de JSON multi-fase (thinking tags, fences, balanceo de llaves)
│   ├── plan-verifier.ts                   # Verificador determinista de 8 invariantes de plan
│   ├── graph-compiler.ts                  # Compilador legacy (WorkBreakdown -> LegacyGraphRevisionV2)
│   ├── contract-compiler.ts               # Compilador legacy de TaskContractBundles
│   ├── acceptance-allocation.ts           # Asignación LCA de criterios de aceptación en el árbol
│   └── validation-obligations.ts          # Asignación y compilación de obligaciones de validación
├── granularity/
│   ├── granularity-policy.ts              # Política de granularidad 4.0 (3 razones categóricas y límites)
│   ├── strategy-selector.ts               # Selector de estrategia de granularidad (Condiciones A y C)
│   ├── planning-brief.ts                  # Generador de briefs estructurados para prompts
│   ├── repository-context-profile.ts      # Estimación de tokens y perfiles de contexto de código
│   └── apply-granularity-selection.ts     # Aplicación de podas y colapsos en árboles candidatos
├── critics/
│   └── review.ts                          # 8 críticos formales de revisión de planes compilados
├── planner/
│   ├── candidate-plan.ts                  # Estructuras de datos para árboles candidatos
│   ├── recursive-planner.ts               # Planificador top-down recursivo
│   ├── cut-feasibility-critic.ts          # Evaluación de viabilidad de particiones
│   ├── derived-relations.ts               # Inferencia de dependencias y relaciones derivadas
│   ├── planning-errors.ts                 # Taxonomía de errores del planificador
│   ├── planning-module.ts                 # Módulo de orquestación de planificación CLI
│   ├── repository-snapshot-id.ts          # Identificadores de snapshot para planes
│   ├── schema.ts                          # WorkBreakdownSchema y schemas legacy
│   ├── semantic-plan.ts                   # Schemas y tipos del plan semántico interno
│   └── semantic-plan-projection.ts        # Proyección de SemanticPlan hacia estructuras legacy
├── evaluation/
│   └── planning-evaluation.ts             # Evaluación offline y métricas de calidad de planes
├── llm/
│   ├── anthropic-decomposer.ts            # Decomposer Anthropic single-pass (legacy)
│   ├── prompt-template.ts                 # Generador de templates de prompts tipados
│   ├── errors.ts                          # Taxonomía de errores LLM
│   ├── guards.ts                          # Validadores y guardas de respuestas LLM
│   ├── normalize.ts                       # Normalización de payloads JSON
│   ├── output-schema.ts                   # Schema Zod para respuestas estructuradas
│   └── recursive/                         # Descomposición recursiva guiada por contratos
│       ├── recursive-decomposer.ts        # Decomposer recursivo
│       ├── claude-code-recursive-decomposer.ts # Adaptador para Claude Code CLI
│       ├── codex-recursive-decomposer.ts  # Adaptador para OpenAI Codex
│       ├── step-prompt.ts                 # Prompting local por nodo
│       ├── step-schema.ts                 # Schema Zod de salida por paso
│       └── json.ts                        # Extracción segura de JSON
├── mocks/
│   └── mock-decomposer.ts                 # Implementaciones mock deterministas para tests
├── context-compressor.ts                  # Extracción de firmas de tipos TypeScript
└── scope.ts                               # Conversión y utilidades de scope de ejecución
```

### Desglose de Responsabilidades por Subsistema

| Subsistema | Responsabilidad Principal |
|---|---|
| `planning-engine/` | Orquesta el ciclo de vida de la planificación (`plan`, `expand`, `amend`, `continue`). Ejecuta consultas presupuestadas a `PlanningRepositoryReader`, evalúa propuestas con `PlanningModel`, rastrea `PlanningRevision` y aplica reparación de esquemas. |
| `compiler/direct-plan-compiler.ts` | Punto de entrada canónico de compilación (`compilePlan`). Recibe un `SemanticPlan` verificado, deriva los contratos versionados (`TaskContractBundle`, `ArtifactContract`, `SeamContract`, `CanonicalValidationObligation`) y construye la `GraphRevision` ejecutable. |
| `compiler/plan-verifier.ts` | Motor estático de verificación (`verifyPlan`). Comprueba determinísticamente 8 categorías de invariantes antes de autorizar la compilación. |
| `granularity/` | Implementa la política de granularidad 4.0 (`granularity/4.0.0`), evaluando las 3 razones categóricas (`doesNotFit`, `runsInParallel`, `verifiableApart`) y los límites de viabilidad de contexto y rutas. |
| `critics/` | Aplica 8 evaluadores de calidad sobre el plan compilado (`completeness`, `atomicity`, `contract_compatibility`, `dag_validity`, `scope_isolation`, `artifact_coverage`, `risk_uncertainty`, `validation_coverage`). |
| `llm/recursive/` | Infraestructura de prompts y validación para interactuar con agentes LLM (Claude Code, OpenAI Codex) en cada paso de descomposición. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra el flujo integral de planificación, verificación y compilación directa:

```
                  GoalContract + PlanningBudget
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       PlanningEngine                        │
│                                                             │
│   1. Consulta Repositorio ──► RepositoryQuery (Presupuestada)│
│   2. Prompt a LLM         ──► PlanningModel.proposePlan()   │
│   3. Valida Esquema       ──► SemanticPlanSchema.parse()    │
│   4. Control Causal       ──► Check causalDigest != seen    │
│   5. Aplica Granularidad  ──► GranularityPolicy (3 razones) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         verifyPlan                          │
│                                                             │
│   [8 Invariantes Estáticas de Verificación]:                 │
│   • Aciclicidad del DAG       • Disyunción de Escritores    │
│   • Cobertura de Criterios    • Bounding Boxes de Scope     │
│   • Integridad de Seams       • Viabilidad de Hojas         │
│   • Validación Asignada       • Referencias de Evidencia    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       [Invariantes Superadas]       [Violación Detectada]
                │                             │
                ▼                             ▼
   ┌──────────────────────────┐    ┌──────────────────────────┐
   │       compilePlan        │    │    PlanningResult:       │
   │ (direct-plan-compiler)   │    │  rejected / needs_input  │
   └────────────┬─────────────┘    └──────────────────────────┘
                │
        ┌───────┴─────────────────────────┐
        ▼                                 ▼
┌───────────────┐        ┌───────────────────────────────────┐
│ GraphRevision │        │       CompiledPlanContracts       │
│ (@manyhands/  │        │ • TaskContractBundles (por nodo)  │
│  task-graph)  │        │ • ArtifactContracts               │
└───────────────┘        │ • SeamContracts                   │
                         │ • CanonicalValidationObligations  │
                         └───────────────────────────────────┘
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Estructura de Presupuesto y Resultados de Planificación

```typescript
export interface PlanningBudget {
  readonly modelCalls: number;         // Límite de llamadas a LLMs
  readonly repositoryQueries: number;  // Límite de consultas al índice
  readonly queryBytes: number;         // Límite acumulado de bytes leídos
  readonly revisions: number;          // Cantidad máxima de revisiones
  readonly repairs: number;            // Reintentos permitidos ante fallas de esquema
  readonly expansions: number;         // Expansiones permitidas de nodos frontera
}

export type PlanningResult =
  | { kind: "ready"; plan: SemanticPlan; trace: PlanningTrace }
  | { kind: "needs_input"; decisions: readonly DecisionDraft[]; continuation: PlanningContinuation; trace: PlanningTrace }
  | { kind: "ambiguous"; decisions: readonly DecisionDraft[]; alternatives: readonly PlanningAlternativeRef[]; trace: PlanningTrace }
  | { kind: "unsupported"; findings: readonly PlanningFinding[]; missingCapabilities: readonly string[]; trace: PlanningTrace }
  | { kind: "rejected"; findings: readonly PlanningFinding[]; trace: PlanningTrace };
```

### Funciones Principales de Verificación y Compilación

| Función | Firma | Propósito |
|---|---|---|
| `verifyPlan` | `(plan: SemanticPlan, options: PlanVerifierOptions) => PlanVerificationResult` | Evalúa determinísticamente las 8 categorías de invariantes sobre el plan. |
| `compilePlan` | `(input: DirectPlanCompilerInput) => CompiledPlanResult` | Compila directamente un `SemanticPlan` verificado a `GraphRevision` y paquetes de contratos. |
| `evaluateGranularity` | `(candidate: GranularityCandidate, config?: GranularityPolicyConfig) => GranularityDecision` | Evalúa si una unidad debe ser dividida (`split`) o es una hoja atómica (`leaf`) según las 3 razones. |
| `selectGranularityStrategy` | `(input: StrategySelectorInput) => GranularityStrategy` | Evalúa si un requerimiento cumple la Condición A (tarea única) o Condición C (descomposición recursiva). |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Control Causal y Prevención de Bucles Infinitos (`no_progress`)
Para evitar que el motor de planificación caiga en bucles donde el modelo propone iterativamente la misma corrección errónea, el motor calcula un digest causal:
$$\text{causalDigest} = \text{computeCanonicalDigest}(\text{proposalDigest}, \text{requestDigest}, \text{queryReceipts}, \text{findings})$$
Si el `causalDigest` ya fue observado en el conjunto `seenCausalStates` de la traza de revisiones, el motor aborta la rama inmediatamente y emite un hallazgo con código `"no_progress"`.

### 2. Política de Granularidad Categórica 4.0 (`GranularityPolicy`)
La versión `granularity/4.0.0` prescinde de fórmulas de puntuación multidimensional. Una unidad sólo se divide (`disposition: "split"`) si se satisface al menos una de las **tres razones categóricas**:
1. **`doesNotFit` (No cabe)**: La unidad excede lo que un intento aislado puede procesar o generar según los límites de viabilidad:
   - `maxLeafContextTokens: 24_000` (tokens de contexto estimados).
   - `maxLeafScopePaths: 40` (archivos existentes tocados).
   - `maxLeafPlannedPaths: 12` (archivos nuevos que el intento creará).
2. **`runsInParallel` (Ejecución paralela)**: Al menos dos unidades hijas no tienen dependencias entre sí y pueden ejecutarse concurrentemente en el scheduler, reduciendo el tiempo de reloj (*wall-clock*).
3. **`verifiableApart` (Verificable por separado)**: Cada unidad hija posee al menos un criterio de aceptación exclusivo que ningún hermano comparte, garantizando que el fallo de una unidad no invalide la evidencia de las demás.

### 3. Las 8 Invariantes Estáticas de `verifyPlan`
Antes de compilar a grafo, `verifyPlan` comprueba:
1. **Aciclicidad**: El árbol de unidades y las dependencias de datos forman un DAG estricto.
2. **Disyunción de Escritores**: Dos hojas no pueden tener reclamos `modify` sobre el mismo recurso a menos que medie un contrato de artefacto con orden causal explícito.
3. **Cobertura de Criterios**: Todo criterio de aceptación del `GoalContract` está asignado a al menos una hoja o composito mediante Lowest Common Ancestor (LCA).
4. **Integridad de Seams**: Todo `PlannedSeam` cuenta con productor, consumidor y especificación de interfaz válida.
5. **Bounding Boxes de Scope**: Los paths declarados en `allowedPaths` de cada unidad no violan los límites prohibidos (`forbiddenPaths`).
6. **Viabilidad de Hojas**: Ninguna unidad marcada como `leaf` excede los umbrales de viabilidad de contexto o paths.
7. **Obligaciones de Validación**: Cada unidad posee al menos una obligación de validación congruente con su nivel de responsabilidad.
8. **Referencias de Evidencia**: Todas las afirmaciones sobre el repositorio citan identificadores de hechos válidos (`repositoryFactId`).

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 5 / GP0+GP1)**: El planificador semántico, el verificador de 8 invariantes y el compilador directo están completados y certificados con 97 tests deterministas y evidencia en `docs/audits/stage-5/`.
2. **Eliminación de la Descomposición Legacy**: La descomposición heurística single-pass en un solo turno ha sido retirada de la ruta productiva.
3. **Compilación Directa**: Se eliminó la proyección intermedia `SemanticPlan -> WorkBreakdown -> SemanticPlan`; la compilación actual produce directamente `GraphRevision` y `TaskContractBundle`s.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/decomposer/README.md`](../../packages/decomposer/README.md)
- **Módulos Relacionados**:
  - [`repository-index.md`](./repository-index.md): Fundamentación física y consultas presupuestadas para el planificador.
  - [`contracts.md`](./contracts.md): Definición de `GoalContract`, `SemanticPlan` y `TaskContractBundle`.
  - [`task-graph.md`](./task-graph.md): Modelo del grafo ejecutable `GraphRevision` generado por la compilación.
  - [`scheduler.md`](./scheduler.md): Planificación y despacho de tareas compiladas.
- **Documentación Central**: [`../README.md`](../README.md)
