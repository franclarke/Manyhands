# @manyhands/decomposer

Motor de planificación semántica progresiva, verificación estricta de invariantes de descomposición y compilación directa a grafos ejecutables (`GraphRevision`) en ManyHands.

---

## Propósito y Responsabilidad en ManyHands

En sistemas multi-agente autónomos para ingeniería de software, descomponer un requerimiento complejo en unidades ejecutables suele ser el punto más crítico de falla: los modelos de lenguaje tienden a generar planes superficiales, alucinar estructuras de archivos inexistentes, omitir interfaces compartidas o planificar modificaciones concurrentes sobre los mismos recursos que terminan en conflictos insolubles durante la integración.

**`@manyhands/decomposer`** es el subsistema encargado de transformar un objetivo de alto nivel (`GoalContract`) en un grafo ejecutable determinista (`GraphRevision`) y un conjunto inmutable de paquetes de contratos (`TaskContractBundle`s), fundamentándose (*grounding*) en la evidencia física del repositorio provista por `@manyhands/repository-index`.

### Problemas Fundamentales que Resuelve

1. **Planificación Multi-Turno Presupuestada (`PlanningBudget`)**: Sustituye la generación de planes en un único paso (*one-shot*) por un proceso interactivo y progresivo (`PlanningEngine`). Controla estrictamente los recursos consumidos (llamadas a modelos, consultas al repositorio, bytes transferidos, revisiones y reparaciones), evitando explosión de costos o ejecuciones descontroladas.
2. **Terminación Garantizada y Prevención de Bucles Causales (`no_progress`)**: Rastrea el linaje causal de cada revisión de plan (`planningCausalStateDigest`). Si una propuesta repite un estado anterior sin aportar nueva evidencia o alterar los hallazgos deterministas, el motor aborta inmediatamente con `no_progress` en lugar de reintentar indefinidamente.
3. **Política de Granularidad Categórica 4.0 (`GranularityPolicy`)**: Elimina fórmulas heurísticas opacas y ponderaciones numéricas adimensionales. La decisión de dividir una unidad se basa exclusivamente en tres razones categóricas explicables en lenguaje natural: `doesNotFit` (excede el contexto/paths de un intento), `runsInParallel` (compra tiempo de reloj por ejecución concurrente) y `verifiableApart` (cada hijo posee criterios de prueba disjuntos).
4. **Verificación Estática Exhaustiva (`verifyPlan`)**: Antes de compilar cualquier plan a un grafo, somete el `SemanticPlan` a una batería determinista de 8 categorías de invariantes (aciclicidad, cobertura probatoria, disyunción de escritores, compatibilidad de costuras, integridad de alcance).
5. **Compilación Directa (`compilePlan`)**: Transforma el `SemanticPlan` verificado directamente en una `GraphRevision` y sus contratos asociados sin pasar por representaciones intermedias ambiguas (`WorkBreakdown`), garantizando la preservación exacta de la semántica planificada.

---

## Arquitectura Modular Interna

El paquete consta de 40 archivos TypeScript estructurados en módulos de compilación, políticas de granularidad, motor de planificación, evaluadores críticos y adaptadores LLM:

```
packages/decomposer/src/
├── index.ts                               # Barrel export central, schemas legacy y mock decomposers
├── planning-engine/
│   └── planning-engine.ts                 # Motor de planificación progresiva multi-turno con control de presupuesto
├── compiler/
│   ├── direct-plan-compiler.ts            # Compilador canónico: SemanticPlan -> GraphRevision + CompiledPlanContracts
│   ├── json-extractor.ts                  # Extractor resiliente de JSON multi-fase (thinking tags, fences, balanceo de llaves)
│   ├── plan-verifier.ts                   # Verificador determinista de 8 invariantes de plan
│   ├── graph-compiler.ts                  # Compilador legacy (WorkBreakdown -> LegacyGraphRevisionV2)
│   ├── contract-compiler.ts               # Compilador legacy de TaskContractBundles
│   ├── acceptance-allocation.ts           # Asignación LCA de criterios de aceptación en el árbol
│   └── validation-obligations.ts          # Asignación y compilación de obligaciones de validación
├── granularity/
│   ├── granularity-policy.ts              # Política de granularidad 4.0 (3 razones categóricas, límites de viabilidad)
│   ├── strategy-selector.ts               # Selector de estrategia de granularidad (Condiciones A y C)
│   ├── planning-brief.ts                  # Generador de briefs estructurados para prompts de planificación
│   ├── repository-context-profile.ts      # Estimación de tokens y perfiles de contexto de código
│   └── apply-granularity-selection.ts     # Aplicación de podas y colapsos en árboles candidatos
├── critics/
│   └── review.ts                          # 8 críticos formales de revisión de planes compilados
├── planner/
│   ├── candidate-plan.ts                  # Estructuras de datos para árboles candidatos en descomposición
│   ├── recursive-planner.ts               # Planificador top-down recursivo
│   ├── cut-feasibility-critic.ts          # Evaluación de viabilidad de particiones
│   ├── derived-relations.ts               # Inferencia de dependencias y relaciones derivadas
│   ├── planning-errors.ts                 # Taxonomía de errores del planificador
│   ├── planning-module.ts                 # Módulo de orquestación de planificación CLI
│   ├── repository-snapshot-id.ts          # Identificadores de snapshot para planes
│   ├── schema.ts                          # WorkBreakdownSchema y schemas legacy de planificación
│   ├── semantic-plan.ts                   # Schemas y tipos del plan semántico interno
│   └── semantic-plan-projection.ts        # Proyección de SemanticPlan hacia estructuras legacy
├── evaluation/
│   └── planning-evaluation.ts             # Evaluación offline y métricas de calidad de planes
├── llm/
│   ├── anthropic-decomposer.ts            # Decomposer Anthropic single-pass (legacy)
│   ├── prompt-template.ts                 # Generador de templates de prompts tipados
│   ├── errors.ts                          # Taxonomía de errores y excepciones LLM
│   ├── guards.ts                          # Validadores y guardas de respuestas LLM
│   ├── normalize.ts                       # Normalización de payloads JSON provenientes de LLMs
│   ├── output-schema.ts                   # Schema Zod para respuestas estructuradas de LLM
│   └── recursive/
│       ├── recursive-decomposer.ts        # Decomposer recursivo guiado por contratos
│       ├── claude-code-recursive-decomposer.ts # Adaptador recursivo para Claude Code CLI
│       ├── codex-recursive-decomposer.ts  # Adaptador recursivo para OpenAI Codex
│       ├── step-prompt.ts                 # Prompting local para cada nodo del árbol
│       ├── step-schema.ts                 # Schema Zod de salida por paso recursivo
│       └── json.ts                        # Extracción segura de JSON en respuestas de texto
├── mocks/
│   └── mock-decomposer.ts                 # Implementaciones mock deterministas para testing
├── context-compressor.ts                  # Compresión de contexto y extracción de firmas de interfaz
└── scope.ts                               # Conversión y utilidades de scope de ejecución
```

### Desglose de Responsabilidades por Subsistema

| Subsistema / Módulo | Responsabilidad Principal |
|---|---|
| `planning-engine/planning-engine.ts` | Orquesta el ciclo de vida de la planificación (`plan`, `expand`, `amend`, `continue`). Ejecuta consultas presupuestadas a `PlanningRepositoryReader`, evalúa propuestas con `PlanningModel`, rastrea `PlanningRevision` y aplica reparación de esquemas. |
| `compiler/direct-plan-compiler.ts` | Punto de entrada canónico de compilación (`compilePlan`). Recibe un `SemanticPlan` verificado, deriva los contratos versionados (`TaskContractBundle`, `ArtifactContract`, `SeamContract`, `CanonicalValidationObligation`) y construye la `GraphRevision` ejecutable. |
| `compiler/plan-verifier.ts` | Motor estático de verificación (`verifyPlan`). Comprueba determinísticamente 8 categorías de invariantes de grafo, datos, recursos y evidencias antes de autorizar la compilación. |
| `granularity/granularity-policy.ts` | Define `GranularityPolicyConfig` (v4.0.0) y las 3 razones categóricas (`doesNotFit`, `runsInParallel`, `verifiableApart`), reemplazando las puntuaciones numéricas anteriores. |
| `granularity/strategy-selector.ts` | Evalúa si un requerimiento debe resolverse como tarea única (Condición A) o si requiere análisis categórico recursivo (Condición C). |
| `critics/review.ts` | Implementa 8 críticos de revisión para planes compilados (`completeness`, `atomicity`, `contract_compatibility`, `dag_validity`, `scope_isolation`, `artifact_coverage`, `risk_uncertainty`, `validation_coverage`). |
| `context-compressor.ts` | Resume árboles de módulos por ámbito de alcance, extrae firmas de tipos TypeScript y calcula huellas de entrada (`InputFingerprint`). |
| `llm/recursive/` | Infraestructura de descomposición guiada por LLM que evalúa recursivamente cada nodo para decidir si es una hoja atómica o si debe particionarse en sub-tareas con interfaces formales. |

---

## Patrones de Diseño y Estrategias Técnicas

### 1. Motor de Planificación Progresivo con Presupuesto Unificado (`PlanningEngine`)

El `PlanningEngine` ejecuta la planificación a través de una máquina de estados determinista. Todo requerimiento (`PlanningRequest`, `ExpansionRequest`, `AmendmentPlanningRequest`, `ContinuationPlanningRequest`) suministra un presupuesto inmutable `PlanningBudget`:

```typescript
export interface PlanningBudget {
  modelCalls: number;         // Límite de llamadas a modelos LLM
  repositoryQueries: number;  // Límite de consultas al índice del repositorio
  queryBytes: number;         // Límite acumulado de bytes leídos en consultas
  revisions: number;          // Cantidad máxima de revisiones formales emitidas
  repairs: number;            // Reintentos automáticos permitidos ante fallas de esquema
  expansions: number;         // Expansiones permitidas de nodos frontera
}
```

Cada paso del engine descuenta el consumo en `PlanningBudgetUsage`. Si el presupuesto se agota en cualquier dimensión, la planificación finaliza de forma controlada retornando `rejected` con el código del presupuesto excedido, sin provocar llamadas colgantes ni reintentos implícitos.

### 2. Prevención de Bucles y Estado Causal Invariante (`no_progress`)

Para evitar que el motor caiga en ciclos infinitos de reparación (donde el modelo sugiere alternativamente la misma corrección errónea), se calcula un digest del estado causal:

$$\text{causalDigest} = \text{computeCanonicalDigest}(\text{proposalDigest}, \text{requestDigest}, \text{queryReceipts}, \text{findings})$$

Si el `causalDigest` ya fue observado en el conjunto `seenCausalStates` de la traza de revisiones, el motor aborta la rama inmediatamente y emite un hallazgo con código `"no_progress"`.

### 3. Taxonomía Explícita de Resultados de Planificación (`PlanningResult`)

El resultado de la planificación no es un booleano ni un plan con estados parciales ambiguos. Es una unión discriminada estricta:

```typescript
export type PlanningResult =
  | { kind: "ready"; plan: SemanticPlan; trace: PlanningTrace }
  | { kind: "needs_input"; decisions: readonly DecisionDraft[]; continuation: PlanningContinuation; trace: PlanningTrace }
  | { kind: "ambiguous"; decisions: readonly DecisionDraft[]; alternatives: readonly PlanningAlternativeRef[]; trace: PlanningTrace }
  | { kind: "unsupported"; findings: readonly PlanningFinding[]; missingCapabilities: readonly string[]; trace: PlanningTrace }
  | { kind: "rejected"; findings: readonly PlanningFinding[]; trace: PlanningTrace };
```

- **`ready`**: El plan cumple el 100% de los invariantes y es directamente compilable.
- **`needs_input`**: Requiere una decisión humana acotada (`DecisionDraft`) para desambiguar la intención; genera un registro determinista `PlanningContinuation` (`requestDigest`, `revisionDigest`, `decisionSetDigest`) para reanudar.
- **`ambiguous`**: Existen múltiples alternativas semánticas viables pero mutuamente incompatibles.
- **`unsupported`**: El repositorio o el stack tecnológico carece de capacidades requeridas por el planificador.
- **`rejected`**: El plan viola invariantes deterministas no reparables o agotó su presupuesto.

### 4. Política de Granularidad Categórica 4.0 (`GranularityPolicy`)

La versión `granularity/4.0.0` prescinde de fórmulas de puntuación multidimensional. Una unidad sólo se divide (`disposition: "split"`) si se satisface al menos una de las **tres razones categóricas**:

1. **`doesNotFit` (No cabe)**: La unidad excede lo que un intento aislado puede procesar o generar según los límites de viabilidad:
   - `maxLeafContextTokens: 24_000` (tokens de contexto estimados).
   - `maxLeafScopePaths: 40` (archivos existentes tocados).
   - `maxLeafPlannedPaths: 12` (archivos nuevos que el intento creará).
2. **`runsInParallel` (Ejecución paralela)**: Al menos dos unidades hijas no tienen dependencias entre sí y pueden ejecutarse concurrentemente en el scheduler, reduciendo el tiempo de reloj (*wall-clock*).
3. **`verifiableApart` (Verificable por separado)**: Cada unidad hija posee al menos un criterio de aceptación exclusivo que ningún hermano comparte, garantizando que el fallo de una unidad no invalide la evidencia de las demás.

Si ninguna de las tres razones se cumple, la partición se colapsa a una única hoja (`disposition: "leaf"`).

### 5. Verificación Determinista de Planes (`verifyPlan` — 8 Categorías de Invariantes)

La función `verifyPlan(input: VerifyPlanInput)` ejecuta las siguientes comprobaciones formales:

1. **Jerarquía y Aciclicidad (`verifyHierarchy`)**: Árbol estrictamente acíclico, exactamente una raíz sin padre (`parentId === undefined`), y todas las demás unidades con un padre válido.
2. **Refinamiento de Criterios del Objetivo (`verifyCriteria`)**: Todo criterio requerido del `GoalContract` debe tener una obligación raíz y descender válidamente por la jerarquía. Ninguna unidad puede inventar criterios sin ancestro formal.
3. **Coherencia de Unidades y Validación (`verifyUnits`)**: Las hojas deben declarar viabilidad completa (`leafFeasible`), tener al menos una obligación de validación y no poseer contratos de integración de compuestos. Los compuestos expandidos deben tener al menos dos hijos directos.
4. **Flujo de Artefactos y Aciclicidad (`verifyArtifacts`)**: El grafo de dependencias de artefactos (`produces` $\rightarrow$ `consumes`) debe ser acíclico. Todo artefacto debe pertenecer a la superficie de escritura autorizada de su productor y ningún productor puede auto-consumirse.
5. **Compatibilidad de Costuras (`verifySeams`)**: Cada `SeamContract` debe vincular a un productor y consumidores válidos, poseer hechos semánticos y reglas de compatibilidad, y estar referenciado por las obligaciones de validación correspondientes.
6. **Protección y Normalización de Rutas (`verifyPaths`)**: Todas las rutas deben ser POSIX relativas válidas, sin escapes `..` ni paths absolutos. Queda prohibida la mutación sobre rutas protegidas del sistema.
7. **Disyunción de Escritores y Autoridad de Recursos (`verifyResources`)**: Detección estricta de conflictos de doble escritura (*double-writer*). Dos unidades independientes no pueden reclamar acceso `modify` sobre recursos que se solapan según el `ResourceCatalog`, a menos que estén estrictamente ordenadas por versiones de artefactos predecesores.
8. **Cobertura Probatoria y Evidencia (`verifyEvidence` / `validateProofCoverage`)**: Cada criterio obligatorio debe contar con una estrategia de prueba (`ProofStrategy`) formalmente vinculada.

---

## Puntos de Entrada, Interfaces y Schemas Clave

### Catálogo de Interfaces y Clases Principales

| Símbolo | Tipo / Firma | Propósito |
|---|---|---|
| `PlanningEngine` | `class PlanningEngine` | Motor multi-turno para `plan`, `expand`, `amend` y `continue`. |
| `compilePlan` | `(input: CompilePlanInput) => CompilePlanResult` | Compila un `SemanticPlan` verificado a `GraphRevision` y bundles de contratos. |
| `verifyPlan` | `(input: VerifyPlanInput) => PlanVerificationResult` | Verificador estático de las 8 categorías de invariantes del plan. |
| `selectGranularityStrategy` | `(input: SelectGranularityStrategyInput) => GranularityStrategyResult` | Evalúa condiciones A y C para aplicar la política de granularidad. |
| `describeDecision` | `(selected, reasons, splitViable) => string` | Genera la explicación en lenguaje natural de la decisión de granularidad. |
| `reviewCompiledPlan` | `(input: CompiledPlanReviewInput) => PlanReview` | Ejecuta los 8 críticos sobre un plan compilado en modelo legacy V2. |
| `DEFAULT_GRANULARITY_POLICY` | `Readonly<GranularityPolicyConfig>` | Configuración por defecto: 24k tokens, 40 scope paths, 12 planned paths. |

---

### Ejemplos de Uso

#### 1. Planificación Progresiva con `PlanningEngine`

```typescript
import {
  PlanningEngine,
  type PlanningBudget,
  type PlanningModel,
  type PlanningRepositoryReader,
  type PlanningRequest
} from "@manyhands/decomposer";
import { type DigestHasher, type GoalContract, type ProofStrategy } from "@manyhands/contracts";
import type { RepositoryView } from "@manyhands/repository-index";
import { createHash } from "node:crypto";

const sha256Hasher: DigestHasher = (json: string) =>
  createHash("sha256").update(json).digest("hex");

const budget: PlanningBudget = {
  modelCalls: 5,
  repositoryQueries: 10,
  queryBytes: 50_000,
  revisions: 4,
  repairs: 2,
  expansions: 2
};

const engine = new PlanningEngine({
  model: myPlanningModel,          // Implementa PlanningModel
  repository: myRepositoryReader,  // Implementa PlanningRepositoryReader
  hasher: sha256Hasher
});

const planningRequest: PlanningRequest = {
  goal: goalContract,              // GoalContract validado
  repositoryView: repoView,        // RepositoryView inmutable
  proofStrategies: proofList,      // Array de ProofStrategy
  budget
};

const result = await engine.plan(planningRequest, new AbortController().signal);

if (result.kind === "ready") {
  console.log("Plan semántico verificado:", result.plan.digest);
  console.log("Consumo de presupuesto:", result.trace.consumed);
} else if (result.kind === "needs_input") {
  console.log("Se requiere clarificación humana:", result.decisions);
  console.log("Digest de continuación:", result.continuation.revisionDigest);
} else {
  console.error("Planificación no completada:", result.kind, result.findings);
}
```

#### 2. Verificación Estática y Compilación Directa (`compilePlan`)

```typescript
import {
  compilePlan,
  verifyPlan,
  type CompilePlanInput
} from "@manyhands/decomposer";

const compileInput: CompilePlanInput = {
  plan: semanticPlan,              // SemanticPlan generado
  goal: goalContract,
  proofStrategies: proofList,
  repositoryView: repoView,
  hasher: sha256Hasher,
  idFactory: (kind, parts) => `${kind}:${parts.join(":")}`
};

// 1. Verificación previa
const verification = verifyPlan(compileInput);
if (!verification.ok) {
  console.error("Invariantes violados en el plan:", verification.findings);
} else {
  // 2. Compilación directa a GraphRevision y contratos
  const compilation = compilePlan(compileInput);
  if (compilation.ok) {
    const { graph, contracts } = compilation;
    console.log("GraphRevision ID:", graph.graphId, "Revision:", graph.revision);
    console.log("Bundles de tareas compilados:", Object.keys(contracts.taskBundles));
    console.log("Costuras (Seams) compiladas:", Object.keys(contracts.seams));
    console.log("Artefactos compilados:", Object.keys(contracts.artifacts));
  }
}
```

#### 3. Evaluación de Política de Granularidad Categórica

```typescript
import {
  DEFAULT_GRANULARITY_POLICY,
  describeDecision,
  type GranularitySplitReasons
} from "@manyhands/decomposer";

const reasons: GranularitySplitReasons = {
  doesNotFit: true,          // Supera los 24_000 tokens de contexto
  runsInParallel: true,      // Dos módulos pueden implementarse en paralelo
  verifiableApart: true      // Cada módulo cuenta con su suite de tests aislada
};

const rationale = describeDecision("split", reasons, true);
console.log(rationale);
// Output: "Split because the unit exceeds one attempt; two children can start at the same time; every child owns a criterion no sibling owns."
```

---

## Estado de Transición y Brechas Arquitectónicas

En concordancia con el plan normativo [`docs/plans/2026-08-12-correctness-first-system-redesign.md`](../../docs/plans/2026-08-12-correctness-first-system-redesign.md) (Etapas 2, 5 y 6):

| Componente | Estado Canónico (Target) | Estado Actual en el Código | Observaciones de Transición |
|---|---|---|---|
| **Pipeline Canónico** | `PlanningEngine` $\rightarrow$ `SemanticPlan` $\rightarrow$ `verifyPlan` $\rightarrow$ `direct-plan-compiler.ts` | **Implementado y validado al 100%** | Es la ruta arquitectónica definitiva. Cubierta por `tests/stage5-planning-engine.test.ts` y `tests/stage5-plan-verifier.test.ts`. |
| **Política de Granularidad** | Versión 4.0 categórica (`doesNotFit`, `runsInParallel`, `verifiableApart`) | **Implementado al 100%** | Retiró las fórmulas numéricas dimensionales anteriores. |
| **Compiladores Legacy** | `graph-compiler.ts` y `contract-compiler.ts` | **Mantenidos para compatibilidad** | Procesan el formato histórico `WorkBreakdown` para runs antiguos y tests de regresión V2. |
| **Decomposers Recursivos LLM** | `RecursiveDecomposer` (`src/llm/recursive/`) | **Operativo como adaptador** | Actúa como proveedor de propuestas (`PlanningModel`) para alimentar al `PlanningEngine`. |
| **Decomposers Single-Pass** | `AnthropicDecomposer` | **Transicional / Deprecado** | Se mantiene para pruebas de humo de baja complejidad pero no es la ruta de producción. |

---

## Comandos de Verificación y Testing

Para compilar, validar tipos y ejecutar la suite de pruebas unitarias y de integración de `@manyhands/decomposer`:

```bash
# Verificación estática de tipos TypeScript
pnpm --filter @manyhands/decomposer typecheck

# Compilación del paquete con tsup
pnpm --filter @manyhands/decomposer build

# Ejecución de la suite focalizada de Stage 5 (PlanningEngine, Verifier y Compilador)
pnpm test tests/stage5-planning-engine.test.ts tests/stage5-plan-verifier.test.ts tests/stage5-planning-contracts.test.ts

# Ejecución de tests de granularidad y descompositor recursivo
pnpm test tests/granularity-planning-brief.test.ts tests/decomposer-recursive.test.ts
```
