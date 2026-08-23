# Informe de Auditoría y Relevamiento Técnico de Paquetes Base (Explorer 1)

**Fecha**: 2026-08-18  
**Autor**: Explorer 1 (Subagente de Documentación & Auditoría Técnica)  
**Alcance**: `packages/contracts`, `packages/task-graph`, `packages/shared`, `packages/decomposer`, `packages/repository-index`  
**Referencia Normativa**: `docs/plans/2026-08-12-correctness-first-system-redesign.md`, `PRODUCT.md`, `AGENTS.md`

---

## 1. Resumen Ejecutivo y Metodología

El presente informe constituye la auditoría técnica y relevamiento exhaustivo de código de los cinco paquetes fundamentales del repositorio ManyHands asignados al Explorer 1:
1. `@manyhands/contracts` (`packages/contracts`)
2. `@manyhands/task-graph` (`packages/task-graph`)
3. `@manyhands/shared` (`packages/shared`)
4. `@manyhands/decomposer` (`packages/decomposer`)
5. `@manyhands/repository-index` (`packages/repository-index`)

### Metodología de Inspección
- **Análisis estático exhaustivo de código**: Lectura completa de todos los archivos fuente (`src/**/*.ts`), archivos de configuración (`package.json`, `tsconfig.json`) y READMEs existentes.
- **Mapeo de interfaces y tipos**: Extracción de todos los schemas Zod, interfaces TypeScript, funciones de validación, algoritmos deterministas y adapters de compatibilidad legacy.
- **Contraste con la Arquitectura Target (`2026-08-12-correctness-first-system-redesign.md`)**: Identificación precisa de las capacidades canónicas implementadas (fases 1 a 4 del rediseño) frente a puentes de transición o código legacy que aún convive en el monorepo.
- **Evaluación del estado documental**: Diagnóstico de los READMEs actuales y recomendaciones de documentación operativa.

---

## 2. Auditoría Detallada: `@manyhands/contracts` (`packages/contracts`)

### 2.1 Propósito y Rol en el Sistema
`@manyhands/contracts` es la capa de verdad única para todas las obligaciones de dominio versionadas entre límites de confianza (*trust boundaries*). Define cómo se formaliza un objetivo de software (`GoalContract`), el plan semántico de descomposición (`SemanticPlan`), los paquetes de contratos ejecutables (`TaskContractBundle`), las superficies de scope (`ScopeContract`), los interfaces compartidos (`SeamContract`), los artefactos de mutación e integración (`ArtifactContract`, `ArtifactManifest`), las obligaciones de validación y estrategias de prueba (`ValidationContract`, `ProofStrategy`, `EvidenceBinding`), la identidad causal (`InputFingerprint`) y el diagnóstico de recuperación (`RecoveryDiagnostic`).

### 2.2 Arquitectura Modular y Estructura de Archivos
El paquete consta de 25 módulos TypeScript con exports granulares organizados funcionalmente:

```
packages/contracts/src/
├── index.ts                     # Barrel export central
├── goal-contract.ts             # GoalContractSchema, criterios y validación
├── semantic-plan.ts             # SemanticPlanSchema, WorkUnitSchema, decisiones de granularidad
├── task-contract.ts             # TaskContractSchema, TaskContractBundleSchema
├── scope-contract.ts            # ScopeContractSchema, OutputRootSchema, paths relativos
├── seam-contract.ts             # SeamContractSchema, CompatibilityRuleSchema
├── artifact-contract.ts         # ArtifactContractSchema, Manifests (ChangeSet / CandidateTree)
├── validation-contract.ts       # ValidationContractSchema, CanonicalValidationObligationSchema
├── proof-strategy.ts            # ProofStrategySchema, EvidenceBindingSchema, ProofCoverage
├── effect-intent.ts             # EffectIntentSchema, PhysicalEffectReceiptSchema, EffectInput
├── fingerprint.ts               # InputFingerprintSchema, canonical digest calculation
├── recovery-diagnostic.ts       # RecoveryDiagnosticSchema, taxonomía de fallos
├── identity.ts                  # computeCanonicalDigest, verifyCanonicalDigest, DigestHasher
├── types.ts                     # Definiciones de tipos utilitarios y contratos
├── legacy/                      # Capa de compatibilidad transicional
│   ├── agent-task-contract.ts   # Adaptador de contratos legacy a V2
│   ├── interface-contract.ts    # InterfaceContract histórico
│   ├── context-pack.ts          # ContextPack y ValidationCommand legacy
│   └── execution-scope.ts       # ExecutionScope legacy
```

### 2.3 Schemas Zod, Tipos y Símbolos Exportados

#### Contratos de Objetivo y Planificación Semántica
- `GoalContractSchema` / `type GoalContract`: Formaliza el objetivo principal del run (`id`, `revision`, `title`, `description`, `successCriteria`, `constraints`, `authorityRef`, `evidenceRefs`, `digest`).
- `validateGoalContract(goal, hasher)`: Valida la integridad del digest y coherencia de criterios.
- `SemanticPlanSchema` / `type SemanticPlan`: Representación pura del plan antes de la compilación al grafo (`units`, `seams`, `artifacts`, `integrations`, `repositoryView`, `digest`).
- `WorkUnitSchema` / `type WorkUnit`: Unidad de trabajo semántica (`leaf`, `composite`, `frontier`) con intenciones de aceptación y superficies de recursos.
- `GranularityDecisionSchema`: Decisión de granularidad categórica (`leaf`, `split`, `frontier`, `semantic_replan`).

#### Contratos de Ejecución y Fronteras de Scope
- `TaskContractBundleSchema` / `type TaskContractBundle`: Contenedor inmutable que agrupa `task`, `scope`, `seams`, `artifacts` y `validation` para un nodo.
- `ScopeContractSchema` / `type ScopeContract`: Delimita los paths permitidos (`allowedPaths`), prohibidos (`forbiddenPaths`), de coordinación (`coordinationPaths`) y raíces de salida (`outputRoots`).
- `OutputRootSchema` / `type OutputRoot`: Directorio derivado donde un nodo tiene autoridad para crear nuevos archivos.
- `RepoRelativePathSchema`: Validador de paths POSIX normalizados sin escapes `..` ni rutas absolutas.

#### Interfaces (Seams) y Artefactos
- `SeamContractSchema` / `type SeamContract`: Contrato de interfaz entre módulos (`producerNodeId`, `consumerNodeIds`, `semanticFacts`, `compatibility`).
- `ArtifactContractSchema` / `type ArtifactContract`: Contrato formal de artefactos producidos y consumidos (`materialization: "commit" | "manifest" | "logical"`).
- `ArtifactManifestSchema` (unión de `ChangeSetManifestSchema` y `CandidateTreeManifestSchema`): Manifiestos direccionados por contenido que identifican exactamente los cambios introducidos.
- `validateManifestIdentity(manifest, hasher)`: Valida que el digest del manifiesto corresponda a su contenido canónico.

#### Validación, Estrategias de Prueba y Efectos Físicos
- `ValidationContractSchema` / `type ValidationContract`: Colección de obligaciones canónicas asignadas a una unidad.
- `CanonicalValidationObligationSchema`: Obligación de validación con su estrategia de prueba vinculada.
- `ProofStrategySchema` / `type ProofStrategy`: Estrategia declarada (`deterministic_check`, `isolated_test`, `integration_test`, `human_advisory`).
- `EvidenceBindingSchema` / `type EvidenceBinding`: Vinculación inmutable entre un criterio y las observaciones de prueba (`focused_command`, `shared_command`, `manual_attestation`).
- `EffectIntentSchema` / `PhysicalEffectReceiptSchema`: Registro de efectos físicos en el workspace (mutaciones de disco, procesos ejecutados).
- `validatePhysicalEffectReceiptBinding(receipt, intent, hasher)`: Verifica la concordancia de efectos físicos con la intención aprobada.
- `validateProofStrategy(strategy, hasher)` / `validateProofCoverage(obligations, criteria)`: Verificación formal de cobertura probatoria.

#### Identidad Causal y Diagnóstico de Recuperación
- `InputFingerprintSchema` / `type InputFingerprint`: Hash SHA-256 de todas las entradas inmutables de un intento (`taskContractDigest`, `baseTreeSha`, `environmentDigest`, `toolsetDigest`).
- `RecoveryDiagnosticSchema` / `type RecoveryDiagnostic`: Diagnóstico estructurado de fallos categorizados por causa raíz (`infrastructure`, `scope_breach`, `seam_incompatibility`, `validation_failure`, `concurrency_conflict`).
- `computeCanonicalDigest(value, hasher)` / `verifyCanonicalDigest(value, field, hasher)`: Motor determinista de hashing canónico que normaliza y ordena claves de objetos y arrays.

### 2.4 Patrones de Diseño Implementados
- **Inmutabilidad y Content Addressing**: Toda estructura de datos genera un `digest` canónico mediante `computeCanonicalDigest`. Ningún contrato se modifica in-place; las revisiones generan nuevos IDs con punteros a versiones anteriores.
- **Single Source of Truth**: Los contratos no confían en la memoria de los procesos ni en strings informales; todas las restricciones están tipadas y validadas con Zod.
- **Fail-Closed Validation**: Si un contrato carece de evidencias o tiene discrepancias de digest, los métodos de validación lanzan excepciones de diagnóstico explícitas.
- **Separación entre Intención y Efecto Físico**: `EffectIntent` precede a la acción; `PhysicalEffectReceipt` atestigua lo ocurrido en el sistema host.

### 2.5 Brechas de Transición vs Arquitectura Target
- **Presencia de adaptadores legacy**: Conviven `AgentTaskContract`, `ContextPack`, `ValidationCommand` e `InterfaceContract` históricos en `src/legacy/` para mantener compatibilidad con executors no migrados y tests antiguos.
- **Estado**: Las estructuras canónicas de la arquitectura target (Stage 1 a 4) están completadas y testeadas; el subsistema de contratos es el más avanzado del monorepo.

### 2.6 Estado del README
- **Estado actual**: 12 líneas, stub mínimo que sólo contiene el título y un enlace al plan de rediseño.
- **Deficiencias**: No documenta los schemas exportados, los contratos de validación, la normalización canónica ni los helpers de hashing.

---

## 3. Auditoría Detallada: `@manyhands/task-graph` (`packages/task-graph`)

### 3.1 Propósito y Rol en el Sistema
`@manyhands/task-graph` implementa el modelo de grafo ejecutable, las relaciones tipadas canónicas (jerarquía padre-hijo, `ArtifactRequirement`, `SeamBinding`), los reclamos de recursos (`ResourceClaim`, `RuntimeLeaseClaim`), las revisiones inmutables del grafo (`GraphRevision`), el análisis topológico y la validación formal de consistencia y autoridad sobre recursos.

### 3.2 Arquitectura Modular y Estructura de Archivos
El paquete consta de 10 módulos TypeScript:

```
packages/task-graph/src/
├── index.ts                     # Export central de APIs canónicas y legacy
├── graph-revision.ts            # Canonical GraphRevisionSchema, buildGraphRevision, transiciones
├── resource-authority.ts        # checkResourceAuthority, verificación de títulos de mutación
├── topological-levels.ts        # computeGraphRevisionTopologicalLevels, niveles DAG para UI
├── cycle-detection.ts           # Detección de ciclos en relaciones tipadas y jerárquicas
├── graph-revision-read.ts       # Reader unificado (lee GraphRevision canónico o V2 legacy)
├── legacy/                      # Modelos legacy y V2 transicionales
│   ├── graph-v2.ts              # LegacyGraphRevisionV2Schema, LegacyTaskNodeV2Schema
│   ├── task-graph-schema.ts     # TaskGraphSchema (V1 plano histórico)
│   ├── graph-validation.ts      # Validadores de grafos legacy
│   └── readiness.ts             # getLeafReadiness, aggregateTaskStatus legacy
```

### 3.3 Schemas Zod, Tipos y Símbolos Exportados

#### Modelo de Grafo Canónico (Target Architecture)
- `TaskNodeSchema` (`CanonicalTaskNode`): Nodo inmutable en el grafo (`id`, `parentId`, `kind: "root" | "composite" | "leaf"`, `title`, `goal`, `contractRef`, `resourceClaims`).
- `ResourceClaimSchema` / `type ResourceClaim`: Declaración formal de acceso a recursos (`resourceId`, `access: "read" | "modify"`, `rationale`).
- `RuntimeLeaseClaimSchema` / `type RuntimeLeaseClaim`: Reclamo de exclusividad temporal durante la ejecución.
- `ArtifactRequirementSchema` / `type ArtifactRequirement`: Dependencia estricta de datos tipada (`artifactContractRef`, `producerNodeId`, `consumerNodeId`, `requiredFor: "execution" | "integration"`).
- `SeamBindingSchema` / `type SeamBinding`: Vinculación de interfaz entre nodos (`seamContractRef`, `producerNodeId`, `consumerNodeId`).
- `GraphRevisionSchema` / `type GraphRevision`: Grafo completo inmutable (`graphId`, `revision`, `rootId`, `baseTreeSha`, `nodes`, `artifactRequirements`, `seamBindings`, `resourceClaims`, `digest`).
- `buildGraphRevision(material, hasher)`: Constructor canónico con cálculo determinista de digest.
- `validateGraphRevision(revision)`: Validación de invariantes fundamentales (árbol acíclico, productor/consumidor válidos, requisitos de artefacto no cíclicos, coherencia de raíz).
- `validateGraphRevisionTransition(base, next)`: Valida la evolución inmutable entre revisiones de grafo.

#### Verificación de Autoridad sobre Recursos (`resource-authority.ts`)
- `checkResourceAuthority(node, catalog, manifest)`: Regla fundamental de seguridad: un nodo sólo puede escribir archivos para los cuales posee un `ResourceClaim` de tipo `modify`. La envolvente de scope (`ScopeContract`) delimita lectura/escritura, pero no concede título de mutación sin reclamo explícito.
- `describeResourceAuthorityViolations(violations)`: Formateador estructurado de violaciones de autoridad sobre recursos.

#### Modelo de Transición V2 y Compatibilidad (`legacy/graph-v2.ts`)
- `LegacyGraphRevisionV2Schema` / `type LegacyGraphRevisionV2`: Modelo transicional utilizado en etapas intermedias del rediseño.
- `LegacyTaskNodeV2Schema`: Nodo V2 con `topologicalLevel` derivado.
- `LegacyArtifactRequirementV2Schema`, `LegacySeamBindingV2Schema`, `ConflictConstraintSchema`.
- `computeLegacyGraphRevisionV2TopologicalLevels(graph)`: Calcula la distancia en camino más largo (longest path) para la visualización en canvas sin alterar la semántica de scheduling continuo.
- `readGraphRevision(input)` / `readLegacyGraphForCompatibility(input)`: Reader polimórfico capaz de instanciar un `GraphRevisionRead` tanto desde el modelo canónico como desde V2 o V1.

### 3.4 Patrones de Diseño Implementados
- **Desacoplamiento entre Representación Visual y Programación Runtime**: `topologicalLevel` es una propiedad puramente presentacional (para el layout del canvas); el scheduler no se bloquea por "ondas", sino por disponibilidad real de artefactos (`ArtifactRequirement`).
- **Separación de Scope y Autoridad de Modificación**: Bounding box vs Titularidad de recurso.
- **Grafo Inmutable como Transición de Estado**: Cada cambio en el grafo (ej. expansión de un composite a hojas) es una nueva `GraphRevision` con digest criptográfico verificable.

### 3.5 Brechas de Transición vs Arquitectura Target
- **Uso continuo de `LegacyGraphRevisionV2` en partes del runtime**: Algunos componentes de coordinación y UI aún leen `LegacyGraphRevisionV2` a través de los adaptadores de compatibilidad.
- **Retiro pendiente del esquema V1 plano**: `TaskGraphSchema` histórico aún existe en `src/legacy/` para reproducibilidad de runs antiguos.

### 3.6 Estado del README
- **Estado actual**: 11 líneas, stub mínimo con referencia al plan de rediseño.
- **Deficiencias**: Carece de diagramas de relaciones tipadas, documentación de `ResourceClaim`, APIs de validación y explicaciones del reader de compatibilidad.

---

## 4. Auditoría Detallada: `@manyhands/shared` (`packages/shared`)

### 4.1 Propósito y Rol en el Sistema
`@manyhands/shared` es la capa cero del monorepo: no tiene dependencias de otros paquetes de ManyHands. Provee primitivas fundamentales validadas con Zod, funciones matemáticas deterministas para conjuntos e intervalos, el registro centralizado de ejecutores de IA y niveles de esfuerzo de razonamiento, y utilidades de bajo nivel para invocación segura de procesos CLI y terminación en árbol en Windows.

### 4.2 Arquitectura Modular y Estructura de Archivos
El paquete cuenta con 3 módulos bien diferenciados:

```
packages/shared/src/
├── index.ts                 # Schemas básicos, timestamps ISO, utilidades de conjuntos
├── executor-registry.ts     # Registro canónico de LLM executors y reasoning effort
└── node-cli-process.ts      # Manejo robusto de procesos Node/CLI y limpieza en Windows
```

### 4.3 Schemas Zod, Tipos y Símbolos Exportados

#### Primitivas de Dominio y Validación (`src/index.ts`)
- `ReasoningEffortSchema` (`"none" | "low" | "medium" | "high"`): Niveles normalizados de esfuerzo de razonamiento cognitivo.
- `NonEmptyStringSchema`: Validador de strings no vacíos (elimina espacios residuales).
- `IsoTimestampSchema`: Timestamp UTC estricto en formato ISO 8601.
- `EntityIdSchema`: Identificador alfanumérico seguro para entidades del sistema.
- `EpistemicAssessmentSchema` / `type EpistemicAssessment`: Modelo epistémico formal (`state: "known" | "partial" | "unknown" | "conflicting"`, `confidence: "high" | "medium" | "low"`, `evidenceRefs`).
- `ResourceReferenceSchema`: Localizador canónico de recursos.
- `GranularityPolicyManifestSchema`: Manifiesto de configuración de políticas de partición.
- `FinalArtifactManifestSchema`: Registro de entrega de artefactos finales.
- `ValidationEvidenceKindSchema`, `CriterionEvidenceObservationSchema`.
- `nowIso()`: Generador determinista/controlado de timestamps ISO.
- `uniqueValues<T>(values)`, `intersectValues<T>(a, b)`: Operaciones puras sobre arrays.
- `clamp01(value)`: Acotador de valores reales en el intervalo [0.0, 1.0].
- `pairKey(left, right)`: Generador de claves de pares canónicos ordenados lexicográficamente.

#### Registro de Ejecutores y Modelos (`src/executor-registry.ts`)
- Constantes de ejecutores: `CLAUDE_CODE_EXECUTOR_ID` (`"claude-code"`), `CODEX_EXECUTOR_ID` (`"codex"`), `OPENCODE_EXECUTOR_ID` (`"opencode"`).
- `EXECUTOR_DESCRIPTORS`: Catálogo exhaustivo de ejecutores soportados, indicando familia (`claude-code`, `codex`, `opencode`), modelos disponibles (`claude-3-7-sonnet`, `claude-3-5-sonnet`, `o3-mini`, `gpt-4o`, `deepseek-r1`, etc.), binarios CLI asociados, variables de entorno requeridas y soporte de reasoning effort.
- `DEFAULT_EXECUTOR_SELECTION`: Configuración por defecto del sistema.
- `getExecutorDescriptor(id)` / `findExecutorDescriptor(id)`: Búsqueda segura en el registro.
- `normalizeExecutorSelection(selection)` / `resolveLegacyModelSelection(legacyModel)`: Normalización robusta que traduce selecciones antiguas a tuplas `(executorId, modelId, effort)`.
- `effortsForSelection(selection)` / `supportsEffortForSelection(selection, effort)`: Consultas de capacidades de reasoning.
- `assertValidExecutorRegistry()`: Auto-test estático del registro.

#### Invocación y Aislamiento de Procesos CLI (`src/node-cli-process.ts`)
- Exportado como subpath `./node-cli-process`.
- `resolveCliBinaryPath(binaryName, options)`: Localización multiplataforma de binarios ejecutables respetando PATH y extensiones Windows (`.cmd`, `.exe`, `.bat`).
- `cliPathRequiresShell(binaryPath)`: Detección de wrappers batch/cmd que requieren ejecución indirecta.
- `resolveCliProcessInvocation(options)`: Generador seguro de argumentos para `spawn` que previene vulnerabilidades de inyección de argumentos en Windows (mitigación DEP0190) mediante wrappers controlados de `ComSpec`.
- `killCliProcessTree(pid, options)`: Terminación garantizada de árboles de procesos en Windows usando `taskkill.exe /F /T /PID` con barreras de sincronización y fallback Unix (`SIGTERM`/`SIGKILL`).
- `runWindowsTaskkill(pid, options)`: Wrapper directo para ejecución de taskkill en Windows PowerShell / CMD.

### 4.4 Patrones de Diseño Implementados
- **Zero-Dependency Core**: Independencia total de frameworks externos (sólo Zod y runtime nativo de Node.js).
- **Single Source of Truth para Capacidades LLM**: Ningún paquete infiere soporte de modelos o reasoning por su cuenta; todos consultan `executor-registry.ts`.
- **Defensive Process Isolation**: Control explícito del ciclo de vida de subprocesos y mitigaciones específicas para Windows (evitando fugas de procesos zombies).

### 4.5 Brechas de Transición vs Arquitectura Target
- Ninguna brecha crítica. El paquete está completamente alineado con la especificación canónica y provee soporte a todos los demás paquetes del monorepo.

### 4.6 Estado del README
- **Estado actual**: 16 líneas, resumen muy breve.
- **Deficiencias**: No explica la API de `node-cli-process`, ni cómo registrar nuevos modelos en `executor-registry`, ni el uso del modelo epistémico `EpistemicAssessment`.

---

## 5. Auditoría Detallada: `@manyhands/decomposer` (`packages/decomposer`)

### 5.1 Propósito y Rol en el Sistema
`@manyhands/decomposer` es el motor de planificación semántica y compilación de grafos. Es responsable de transformar un objetivo de alto nivel (`GoalContract`) en un plan semántico verificado (`SemanticPlan`) mediante consultas presupuestadas al repositorio (`RepositoryQuery`), refinar iterativamente las unidades mediante políticas de granularidad categóricas (`GranularityPolicy`), verificar exhaustivamente los invariantes del plan (`plan-verifier.ts`), y compilar el plan directamente a un `GraphRevision` ejecutable y sus `TaskContractBundle`s (`direct-plan-compiler.ts`).

### 5.2 Arquitectura Modular y Estructura de Archivos
El paquete cuenta con 31 módulos TypeScript organizados en subdirectorios temáticos:

```
packages/decomposer/src/
├── index.ts                             # APIs públicas, schemas y decomposers mock
├── planning-engine/
│   └── planning-engine.ts               # Motor de planificación interactivo y presupuestado
├── compiler/
│   ├── direct-plan-compiler.ts          # Compilador canónico SemanticPlan -> GraphRevision
│   ├── plan-verifier.ts                 # Verificador determinista de invariantes de plan
│   ├── graph-compiler.ts                # Compilador de grafo transicional (WorkBreakdown -> V2)
│   ├── contract-compiler.ts             # Compilador de bundles de contratos
│   ├── acceptance-allocation.ts         # Asignación LCA de criterios de aceptación
│   └── validation-obligations.ts        # Compilación de obligaciones de validación
├── granularity/
│   ├── granularity-policy.ts            # Política de granularidad 4.0 (3 razones categóricas)
│   ├── strategy-selector.ts             # Selector de estrategia (Condiciones A y C)
│   ├── planning-brief.ts                # Generador del brief de planificación
│   ├── repository-context-profile.ts    # Perfiles de contexto y conteo de tokens
│   └── apply-granularity-selection.ts   # Aplicación de podas y colapsos
├── planner/
│   ├── candidate-plan.ts                # Representación de planes candidatos
│   ├── recursive-planner.ts             # Planificador recursivo top-down
│   ├── cut-feasibility-critic.ts        # Evaluación de factibilidad de cortes
│   ├── semantic-plan.ts                 # Esquemas del plan semántico interno
│   ├── semantic-plan-projection.ts      # Proyección para compiladores legacy
│   └── schema.ts                        # WorkBreakdownSchema y tipos asociados
├── critics/
│   └── review.ts                        # 8 evaluadores de calidad del plan compilado
├── context-compressor.ts                # Compresión de contexto y extracción de interfaces
└── llm/
    ├── anthropic-decomposer.ts          # Decomposer Anthropic de un solo paso (legacy)
    ├── prompt-template.ts               # Plantillas de prompt estructuradas
    ├── errors.ts                        # Taxonomía de errores LLM
    └── recursive/
        ├── recursive-decomposer.ts      # Decomposer recursivo guiado por interfaces
        ├── step-prompt.ts               # Prompting por nodo local
        └── step-schema.ts               # Schema de salida de cada paso recursivo
```

### 5.3 Schemas Zod, Tipos y Símbolos Exportados

#### Motor de Planificación Progresivo (`src/planning-engine/planning-engine.ts`)
- `PlanningEngine`: Clase principal del motor de planificación. Ejecuta operaciones `plan`, `expand`, `amend` y `continue`.
- `PlanningRequest`, `ExpansionRequest`, `AmendmentPlanningRequest`, `ContinuationPlanningRequest`.
- `PlanningBudget` y `PlanningBudgetUsage`: Control estricto de consumo de recursos (`modelCalls`, `repositoryQueries`, `queryBytes`, `revisions`, `repairs`, `expansions`).
- Invariant Causal State: Si una propuesta repite un estado causal previo sin progreso (`no_progress`), el planificador rechaza la rama para evitar loops infinitos.
- Soporte de Decisiones Humanas (`DecisionDraft`): Permite pausar la planificación para requerir clarificaciones (`kind: "needs_input"` o `"ambiguous"`) generando un token inmutable de continuación.

#### Verificador Canónico de Planes (`src/compiler/plan-verifier.ts`)
- `verifyPlan(input)`: Ejecuta una batería exhaustiva de verificaciones deterministas sobre el `SemanticPlan`:
  1. **Jerarquía y Estructura**: Árbol estrictamente acíclico, exactamente una raíz, parentIds válidos.
  2. **Cobertura de Criterios del Objetivo**: Cada criterio del `GoalContract` es refinado por al menos una unidad de trabajo.
  3. **Cobertura Probatoria**: Todo criterio requerido posee al menos una estrategia de prueba válida asignada.
  4. **Factibilidad de GranularityDecision**: Las hojas cumplen con los presupuestos de contexto y paths planificados.
  5. **Flujo de Artefactos y Aciclicidad**: Los artefactos requeridos tienen productores válidos y no forman ciclos de dependencia.
  6. **Compatibilidad de Seams**: Los interfaces compartidos tienen compatibilidad exacta y participantes válidos.
  7. **Disyunción de Recursos de Escritura**: Detección estricta de doble escritura (*double-writer conflict*); dos ramas independientes no pueden declarar reclamos de modificación sobre el mismo recurso.
  8. **Protección de Paths**: Impide que una unidad reclame paths protegidos del sistema.

#### Compilador Directo de Planes (`src/compiler/direct-plan-compiler.ts`)
- `compilePlan(input)`: Transforma directamente un `SemanticPlan` verificado en una `GraphRevision` y sus correspondientes `CompiledPlanContracts` (`TaskContractBundle`s, artefactos, seams, validaciones).
- Elimina intermediarios legacy (`WorkBreakdown` o proyecciones heurísticas), conectando directamente la salida de la planificación formal con el grafo ejecutable.

#### Política de Granularidad Categórica (`src/granularity/granularity-policy.ts`)
- **Versión**: `granularity/4.0.0` (eliminó las fórmulas de ponderación numérica dimensional).
- **Tres Razones Categóricas para Dividir (`GranularitySplitReasons`)**:
  1. `doesNotFit`: La unidad excede lo que un intento puede abarcar en tokens o paths de salida (`maxLeafContextTokens: 24_000`, `maxLeafScopePaths: 40`, `maxLeafPlannedPaths: 12`).
  2. `runsInParallel`: Al menos dos unidades hijas pueden comenzar en paralelo (la topología de dependencias es más plana que el número de hijos).
  3. `verifiableApart`: Cada hijo posee al menos un criterio de aceptación exclusivo que ningún hermano comparte.
- `selectGranularityStrategy(input)`: Evalúa las condiciones `A` (colapsar a unidad única por instrucción) y `C` (aplicar política categórica).

#### Críticos de Revisión de Planes (`src/critics/review.ts`)
- `reviewCompiledPlan(input)` / `assertPlanReview(review)`: Ejecuta 8 críticos formales: `completeness`, `atomicity`, `contract_compatibility`, `dag_validity`, `scope_isolation`, `artifact_coverage`, `risk_uncertainty`, `validation_coverage`.

#### Capa de Descomposición Recursiva por LLM (`src/llm/recursive/`)
- `RecursiveDecomposer`: Decomposer que recorre el árbol top-down preguntando al LLM en cada nodo si es atómico o si debe descomponerse, definiendo interfaces (`sharedInterfaces`) y cableando `consumes`/`produces`.

### 5.4 Patrones de Diseño Implementados
- **Arquitectura de Compilación Tipo Compilador Tradicional**: Frontend (Planning Engine + LLM) -> AST Semántico (`SemanticPlan`) -> Type Checking & Static Analysis (`plan-verifier.ts`) -> Code Generation (`direct-plan-compiler.ts`) -> Target Bytecode (`GraphRevision` + `TaskContractBundle`s).
- **Políticas Sin Parámetros Libres**: Reemplazo de umbrales numéricos opacos por propiedades categóricas explicables en lenguaje natural.
- **Tolerancia a Fallos y Reanudación**: `stepCache` y tokens de continuación basados en digest criptográfico.

### 5.5 Brechas de Transición vs Arquitectura Target
- **Presencia de la ruta de compilación legacy**: `graph-compiler.ts` y `contract-compiler.ts` aún existen para procesar `WorkBreakdown` históricos.
- **Ruta productiva activa**: La ruta target `PlanningEngine` -> `SemanticPlan` -> `direct-plan-compiler.ts` está completamente implementada y probada en `tests/direct-plan-compiler.test.ts`.

### 5.6 Estado del README
- **Estado actual**: 16 líneas, stub mínimo.
- **Deficiencias**: No documenta el pipeline canónico de compilación directa, el funcionamiento de `PlanningEngine`, las 3 razones categóricas de granularidad ni los críticos de revisión.

---

## 6. Auditoría Detallada: `@manyhands/repository-index` (`packages/repository-index`)

### 6.1 Propósito y Rol en el Sistema
`@manyhands/repository-index` es el subsistema de fundamentación (*grounding*) del sistema. Provee la inspección exacta de repositorios versionados en Git, la construcción del modelo semántico del código (`RepositoryModel`), la composición inmutable de vistas con overlays de cambios (`RepositoryView`), el catálogo canónico de recursos y resolución de solapamientos (`ResourceCatalog`), y la interfaz de consulta presupuestada (`RepositoryQuery`) para el motor de planificación.

### 6.2 Arquitectura Modular y Estructura de Archivos
El paquete consta de 10 módulos TypeScript:

```
packages/repository-index/src/
├── index.ts                 # Barrel export, esquemas de índice y TypeScriptRepositoryIndexer
├── repository-model.ts      # RepositoryModel exacto, inspección de blobs Git y AST TypeScript
├── repository-query.ts      # Interfaz de consulta presupuestada (search, neighborhood, tests)
├── repository-view.ts       # Composición inmutable de vistas con overlays Git
├── resource-catalog.ts      # Catálogo de recursos, resolución de aliases y contención
├── snapshot.ts              # RepositorySnapshotRecord y gestión de snapshots
├── fast-indexer.ts          # Indexador rápido basado en Ripgrep y Git HEAD
├── capabilities.ts          # Detección de stacks, scripts y herramientas del proyecto
├── source-parser.ts         # Parser de AST TypeScript para símbolos e imports
└── identity.ts              # Generación determinista de IDs de hechos y digests
```

### 6.3 Schemas Zod, Tipos y Símbolos Exportados

#### Modelo de Repositorio Exacto (`src/repository-model.ts`)
- `RepositoryModel`: Modelo inmutable completo del repositorio basado en el árbol Git (`snapshot`, `repositoryId`, `baseCommit`, `treeSha`, `packages`, `modules`, `symbols`, `relationships`, `publicInterfaces`, `tests`, `commands`, `resources`, `conventions`, `diagnostics`, `coverage`, `gitEntries`, `digest`).
- `PackageBoundary`: Límites de paquetes (`package.json`, entrypoints, exportTargets, workspaces, scripts).
- `ModuleBoundary`: Módulos de código fuente (`path`, `oid`, `mode`, `exportedSymbols`, `importedSpecifiers`).
- `RepositorySymbolRecord`: Símbolos declarados y exportados (funciones, clases, interfaces, tipos).
- `ImportRelationship`: Relaciones de importación estáticas resueltas con paths exactos.
- `PublicInterfaceRecord`: Firmas tipadas públicas normalizadas extraídas vía TypeScript Compiler API.
- `TestRelationship`: Asociación comprobada entre archivos de test y módulos de código fuente cubiertos.
- `inspectRepositoryModel(input)` / `inspectRepositoryModelWithSnapshot(input)`: Constructor principal que lee objetos blob directamente de Git.

#### Catálogo de Recursos y Detección de Solapamientos (`src/resource-catalog.ts`)
- `ResourceCatalog`: Catálogo consultable que indexa todos los recursos del proyecto (`path`, `package`, `module`, `symbol`, `schema`, `integration_surface`).
- `CatalogResource`: Recurso unificado con evaluación de origen (`indexed` vs `declared`) y disposición de archivos generados (`generatedFileDisposition`).
- `resolve(reference)`: Resuelve referencias con estados epistémicos (`known`, `conflicting`, `unknown`). Soporta directorios declarados que aún no existen en el árbol Git.
- `overlaps(leftRef, rightRef)`: Determinación estricta de solapamiento (`yes`, `no`, `unknown`) evaluando contención jerárquica y disyunción de paths.
- `neighborhood(reference, depth)`: Expande el vecindario de contención y dependencias alrededor de un recurso.

#### Vista de Repositorio y Overlays de Mutación (`src/repository-view.ts`)
- `RepositoryView`: Vista inmutable compuesta a partir de un `RepositoryModel` base y una secuencia ordenada de `RepositoryOverlay`s.
- `RepositoryOverlay`: Modificaciones del árbol Git (`add`, `modify`, `delete`, `type_change`) con validación estricta de preimágenes (`oldOid`, `oldMode`) y verificación de árbol resultante (`resultTreeSha`).
- `composeRepositoryView(input)`: Compone overlays de forma determinista, rastreando renombrados (`renameAliases`) y symlinks.

#### Consulta Presupuestada (`src/repository-query.ts`)
- `createRepositoryQuery(input)`: Fábrica de la interfaz de consulta que previene que el planner reciba volcados masivos del repositorio.
- Métodos presupuestados:
  - `searchGoalTerms(terms, budget)`: Búsqueda ponderada de términos en packages, módulos, símbolos y comandos.
  - `inspectBoundary(reference, budget)`: Inspección de vecindario en el catálogo de recursos.
  - `dependencyNeighborhood(reference, budget)`: Grafo de dependencias entrantes y salientes.
  - `relatedSymbols(reference, budget)`: Símbolos relacionados en el vecindario.
  - `relatedTests(reference, budget)`: Tests que cubren los módulos referenciados.
  - `validationCapabilities(budget)`: Comandos de validación y verificación disponibles (`test`, `typecheck`, `lint`, `build`).
  - `readExcerpts(references, budget)`: Lectura acotada de fragmentos exactos de código fuente.
- Control de Presupuesto (`RepositoryQueryBudget`): Límite de resultados (`maxResults`), bytes (`maxBytes`) y profundidad (`maxDepth`). Todo truncamiento degrada honestamente la evaluación epistémica a `partial`.

#### Indexación y Snapshot (`src/index.ts`, `src/fast-indexer.ts`, `src/snapshot.ts`)
- `FastRepositoryIndexer`: Indexador optimizado que utiliza Ripgrep para escaneo acelerado y lecturas Git en streaming.
- `TypeScriptRepositoryIndexer`: Indexador basado en sistema de archivos y parsing AST.
- `RepositorySnapshotSchema` / `buildRepositorySnapshot`: Snapshot inmutable cacheable por commit Git.

### 6.4 Patrones de Diseño Implementados
- **Git Object Store Grounding**: La verdad física del código reside en los hashes de objetos Git (`oid`, `treeSha`), no en timestamps volátiles del sistema de archivos.
- **Budgeted Information Disclosure**: El planificador no recibe dumps completos; sólo consume fragmentos acotados mediante `RepositoryQuery` con seguimiento explícito de costos.
- **Honestidad Epistémica**: La ausencia de datos o el truncamiento de respuestas se etiqueta formalmente como `partial` o `unknown`, impidiendo que el planificador interprete falta de información como bajo riesgo.

### 6.5 Brechas de Transición vs Arquitectura Target
- **Estado**: Las capacidades de la Stage 4 del rediseño (`RepositoryModel`, `RepositoryView`, `ResourceCatalog`, `RepositoryQuery`) están completamente implementadas y validadas con tests unitarios.

### 6.6 Estado del README
- **Estado actual**: 11 líneas, stub mínimo.
- **Deficiencias**: No documenta el modelo `RepositoryModel`, los métodos de `RepositoryQuery`, los overlays en `RepositoryView` ni la semántica del `ResourceCatalog`.

---

## 7. Análisis Comparativo y Matriz de Brechas de Transición

La siguiente tabla sintetiza el estado de implementación de cada paquete auditado frente a la especificación canónica (`2026-08-12-correctness-first-system-redesign.md`):

| Paquete | Rol Canónico (Target) | Estado de Implementación | Brecha de Transición / Código Legacy Conviviente |
|---|---|---|---|
| **`@manyhands/contracts`** | Obligaciones de dominio inmutables y versionadas en trust boundaries. | **Completo (100%)** | Conviven adaptadores en `src/legacy/` (`AgentTaskContract`, `ContextPack`, `InterfaceContract`) para soportar executors no migrados. |
| **`@manyhands/task-graph`** | Grafo inmutable (`GraphRevision`), relaciones tipadas, autoridad de recursos. | **Completo (95%)** | Convive `LegacyGraphRevisionV2` y `TaskGraphSchema` (V1) en `src/legacy/`. `readGraphRevision` provee lectura polimórfica. |
| **`@manyhands/shared`** | Capa base zero-dependency, primitivas Zod, registro central de modelos y CLI process. | **Completo (100%)** | Ninguna brecha estructural. Mantiene helpers de compatibilidad para resolución de modelos antiguos. |
| **`@manyhands/decomposer`** | `PlanningEngine` progresivo, `plan-verifier.ts`, `direct-plan-compiler.ts`, políticas 4.0. | **Completo (90%)** | Convivencia de compiladores legacy (`graph-compiler.ts`, `contract-compiler.ts`) y `WorkBreakdownSchema` junto al nuevo pipeline `SemanticPlan`. |
| **`@manyhands/repository-index`** | `RepositoryModel` exacto desde Git, `RepositoryView`, `ResourceCatalog`, `RepositoryQuery`. | **Completo (100%)** | Totalmente alineado con Stage 4. Mantiene `TypeScriptRepositoryIndexer` junto a `FastRepositoryIndexer`. |

---

## 8. Diagnóstico de READMEs Existentes y Recomendaciones de Documentación

Todos los paquetes auditados presentan actualmente archivos `README.md` embrionarios o stubs mínimos (de entre 11 y 16 líneas) creados durante las fases iniciales del rediseño.

### Diagnóstico Individual:
1. `packages/contracts/README.md` (12 líneas): Falta tabla completa de contratos exportados, explicación del motor de digests canónicos y detalle de invariantes de validación.
2. `packages/task-graph/README.md` (11 líneas): Falta explicación del modelo de grafo `GraphRevision`, diferenciación entre Scope y Resource Authority, y tabla de relaciones tipadas.
3. `packages/shared/README.md` (16 líneas): Falta documentación del registro de ejecutores (`executor-registry.ts`), invocación segura multiplataforma (`node-cli-process.ts`) y primitivas epistémicas.
4. `packages/decomposer/README.md` (16 líneas): Falta diagrama del pipeline de compilación directa, especificación del `PlanningEngine`, política de granularidad 4.0 y lista de críticos de verificación.
5. `packages/repository-index/README.md` (11 líneas): Falta explicación del `RepositoryModel` basado en Git, catálogo de recursos `ResourceCatalog` y guía de uso de `RepositoryQuery`.

### Recomendaciones de Actualización Documental:
- **Estructura Estándar para los Nuevos READMEs de Paquetes**:
  1. *Header & Package Purpose*: Rol y responsabilidades dentro del monorepo.
  2. *Architecture & Component Diagram*: Diagrama textual de flujo de datos y dependencias.
  3. *Key Exports & API Reference*: Tablas con schemas Zod, tipos TypeScript y funciones de validación.
  4. *Invariants & Security Rules*: Reglas de inmutabilidad, content-addressing y autoridad sobre recursos.
  5. *Transition Notes*: Estado de migración frente a módulos legacy.

---

## 9. Catálogo Maestro de Símbolos y Tipos Exportados

### `@manyhands/contracts`
- **Goal & Planning**: `GoalContractSchema`, `GoalContract`, `SemanticPlanSchema`, `SemanticPlan`, `WorkUnitSchema`, `WorkUnit`, `GranularityDecisionSchema`, `GranularityDecision`, `validateGoalContract`.
- **Task & Scope**: `TaskContractBundleSchema`, `TaskContractBundle`, `TaskContractSchema`, `TaskContract`, `ScopeContractSchema`, `ScopeContract`, `OutputRootSchema`, `OutputRoot`, `RepoRelativePathSchema`.
- **Interfaces & Artifacts**: `SeamContractSchema`, `SeamContract`, `ArtifactContractSchema`, `ArtifactContract`, `ArtifactManifestSchema`, `ChangeSetManifestSchema`, `CandidateTreeManifestSchema`, `validateManifestIdentity`.
- **Validation & Proofs**: `ValidationContractSchema`, `ValidationContract`, `CanonicalValidationObligationSchema`, `CanonicalValidationObligation`, `ProofStrategySchema`, `ProofStrategy`, `EvidenceBindingSchema`, `EvidenceBinding`, `validateProofStrategy`, `validateProofCoverage`, `validateEvidenceFreshness`.
- **Effects & Fingerprints**: `EffectIntentSchema`, `EffectIntent`, `PhysicalEffectReceiptSchema`, `PhysicalEffectReceipt`, `EffectInputSchema`, `InputFingerprintSchema`, `InputFingerprint`, `validateEffectIntentIdentity`, `validatePhysicalEffectReceiptBinding`.
- **Diagnostics & Hashing**: `RecoveryDiagnosticSchema`, `RecoveryDiagnostic`, `computeCanonicalDigest`, `verifyCanonicalDigest`, `DigestHasher`.
- **Legacy Adapters**: `AgentTaskContractSchema`, `InterfaceContractSchema`, `ContextPackSchema`, `ValidationCommandSchema`, `adaptLegacyAgentTaskContract`.

### `@manyhands/task-graph`
- **Canonical Graph**: `TaskNodeSchema`, `CanonicalTaskNode`, `GraphRevisionSchema`, `GraphRevision`, `GraphRevisionMaterialSchema`, `ResourceClaimSchema`, `ResourceClaim`, `RuntimeLeaseClaimSchema`, `ArtifactRequirementSchema`, `ArtifactRequirement`, `SeamBindingSchema`, `SeamBinding`, `buildGraphRevision`, `validateGraphRevision`, `validateGraphRevisionTransition`.
- **Resource Authority**: `checkResourceAuthority`, `describeResourceAuthorityViolations`.
- **Topological Analysis**: `computeGraphRevisionTopologicalLevels`, `computeLegacyGraphRevisionV2TopologicalLevels`.
- **Polymorphic Readers**: `readGraphRevision`, `readLegacyGraphForCompatibility`, `GraphRevisionRead`.
- **Legacy Graph V2 & V1**: `LegacyGraphRevisionV2Schema`, `LegacyTaskNodeV2Schema`, `LegacyArtifactRequirementV2Schema`, `LegacySeamBindingV2Schema`, `ConflictConstraintSchema`, `TaskGraphSchema`, `validateTaskGraph`, `validateLegacyGraphRevisionV2`, `getLeafReadiness`.

### `@manyhands/shared`
- **Primitives & Metrics**: `ReasoningEffortSchema`, `ReasoningEffort`, `NonEmptyStringSchema`, `IsoTimestampSchema`, `EntityIdSchema`, `EpistemicAssessmentSchema`, `EpistemicAssessment`, `ResourceReferenceSchema`, `GranularityPolicyManifestSchema`, `FinalArtifactManifestSchema`, `ValidationEvidenceKindSchema`, `CriterionEvidenceObservationSchema`, `nowIso`, `uniqueValues`, `intersectValues`, `clamp01`, `pairKey`.
- **Executor Registry**: `CLAUDE_CODE_EXECUTOR_ID`, `CODEX_EXECUTOR_ID`, `OPENCODE_EXECUTOR_ID`, `EFFORT_LEVELS`, `EXECUTOR_DESCRIPTORS`, `DEFAULT_EXECUTOR_SELECTION`, `getExecutorDescriptor`, `findExecutorDescriptor`, `findExecutorModel`, `normalizeExecutorSelection`, `resolveLegacyModelSelection`, `effortsForSelection`, `supportsEffortForSelection`, `assertValidExecutorRegistry`.
- **Process Isolation (`./node-cli-process`)**: `resolveCliBinaryPath`, `cliPathRequiresShell`, `resolveCliProcessInvocation`, `killCliProcessTree`, `runWindowsTaskkill`.

### `@manyhands/decomposer`
- **Planning Engine**: `PlanningEngine`, `PlanningRequest`, `ExpansionRequest`, `AmendmentPlanningRequest`, `ContinuationPlanningRequest`, `PlanningBudget`, `PlanningBudgetUsage`, `PlanningModel`, `PlanningRepositoryReader`, `ModelPlanCritic`.
- **Direct Plan Compiler**: `compilePlan`, `CompilePlanInput`, `CompilePlanResult`, `CompiledPlanContracts`.
- **Plan Verifier**: `verifyPlan`, `PlanVerificationInput`, `PlanVerificationResult`.
- **Granularity Policy**: `GRANULARITY_POLICY_VERSION`, `DEFAULT_GRANULARITY_POLICY`, `GranularityPolicyConfig`, `GranularitySplitReasons`, `GranularityAssessment`, `describeDecision`, `selectGranularityStrategy`, `resolveGranularityCondition`.
- **Critics**: `PLAN_CRITIC_KINDS`, `PlanCriticKind`, `PlanFinding`, `PlanReview`, `reviewCompiledPlan`, `assertPlanReview`.
- **Context Compressor**: `compressContext`, `summarizeTreeByScope`, `extractInterfaceSignatures`, `computeInputFingerprint`.
- **LLM Decomposers**: `RecursiveDecomposer`, `AnthropicDecomposer`, `MockDecomposer`, `SingleTaskDecomposer`.
- **Legacy Compilers**: `compileGraphRevision`, `compileContractBundles`, `WorkBreakdownSchema`.

### `@manyhands/repository-index`
- **Repository Model**: `RepositoryModel`, `PackageBoundary`, `ModuleBoundary`, `RepositorySymbolRecord`, `RepositorySymbolKind`, `ImportRelationship`, `PublicInterfaceRecord`, `TestRelationship`, `RepositoryCommandRecord`, `RepositoryResourceRecord`, `RepositoryConventionRecord`, `RepositoryCoverageReport`, `RepositoryGitEntry`, `inspectRepositoryModel`, `inspectRepositoryModelWithSnapshot`, `buildRepositoryModelFromTree`, `listGitTree`, `readBlob`.
- **Resource Catalog**: `ResourceCatalog`, `CatalogResource`, `GeneratedFileDisposition`, `CatalogContainment`, `CatalogAlias`, `ResourceResolution`, `ResourceOverlap`, `buildResourceCatalog`.
- **Repository View & Overlays**: `RepositoryView`, `RepositoryOverlay`, `RepositoryOverlayEntry`, `composeRepositoryView`.
- **Budgeted Query**: `createRepositoryQuery`, `RepositoryQuery`, `RepositoryQueryBudget`, `RepositoryQueryCost`, `RepositoryQueryAnswer`, `RepositoryExcerptItem`.
- **Indexers & Snapshots**: `FastRepositoryIndexer`, `TypeScriptRepositoryIndexer`, `buildFastRepositorySnapshot`, `buildRepositorySnapshot`, `RepositorySnapshotSchema`, `RepositorySnapshot`, `RepositoryIndexSchema`, `RepositoryIndex`, `summarizeRepositoryIndex`, `computeRepositoryIndexHash`.
