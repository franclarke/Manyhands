# Guía Arquitectónica: @manyhands/contracts

> **Ubicación en el Monorepo**: `packages/contracts/`  
> **README del Paquete**: [`../../packages/contracts/README.md`](../../packages/contracts/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas multi-agente para desarrollo e integración de software, uno de los mayores vectores de fallo es la **ambigüedad semántica** en las interfaces de comunicación. Cuando los agentes autónomos coordinan tareas basándose únicamente en texto libre, prompts informales o estructuras JSON mutables e insuficientemente tipadas, se producen alucinaciones sobre las capacidades de los módulos, violaciones de límites en el sistema de archivos, conflictos de modificación concurrentes y falsos positivos en las fases de validación.

**`@manyhands/contracts`** es el subsistema que establece la **frontera de confianza (*trust boundary*)** y la capa de autoridad formal en ManyHands. Define contratos inmutables, esquemas de validación en tiempo de ejecución gobernados por [Zod](https://zod.dev), identidades direccionadas por contenido (*content addressing*) y protocolos de verificación estricta.

### Problemas Fundamentales que Resuelve

1. **Eliminación de la Ambigüedad en la Frontera de Confianza**: Todo intercambio entre el planificador (`@manyhands/decomposer`), el grafo de ejecución (`@manyhands/task-graph`), los motores de ejecución (`@manyhands/execution-core`) y el daemon duradero (`apps/daemon`) está regulado por contratos tipados y versionados.
2. **Identidad Causal Inmutable mediante Digests Criptográficos**: Ninguna entidad de dominio se referencia mediante punteros mutables en memoria. Cada contrato posee un identificador determinista derivado del hash SHA-256 de su serialización canónica (`canonicalJson`).
3. **Delimitación Rigurosa del Sistema de Archivos (`ScopeContract`)**: Fija matemáticamente qué rutas puede observar o modificar cada intento de tarea, previniendo lecturas y escrituras fuera de alcance (*directory traversal* o mutaciones sobre archivos ajenos).
4. **Estrategias de Prueba y Evidencia Vinculada (`GoalContract`, `ValidationContract`, `EvidenceBinding`)**: Formaliza qué criterios de aceptación exige el usuario, qué autoridades de prueba están autorizadas a certificar cada criterio y cómo se enlaza la evidencia de ejecución sin degradación semántica.
5. **Protocolo de Efectos Físicos en Dos Fases (`EffectIntent` vs. `PhysicalEffectReceipt`)**: Impide que el sistema realice mutaciones en el sistema operativo (archivos, subprocesos, llamadas a LLMs) sin declarar previamente una intención inmutable y exigir un recibo criptográfico post-ejecución.

---

## 2. Arquitectura Interna y Componentes

El paquete está organizado en 25 módulos en `src/`, agrupados conceptualmente en torno a la identidad, los contratos de planificación, la ejecución y los efectos físicos:

```
packages/contracts/src/
├── index.ts                     # Barrel export unificado y esquemas transicionales
├── canonical-json.ts            # Serialización canónica determinista y hashing de digests
├── canonical-reference.ts       # Esquemas para referencias canónicas por digest e ID
├── canonical-graph-relations.ts # Requisitos de artefactos y reclamos de recursos en el grafo
├── canonical-validation.ts      # Helpers y definiciones base para obligaciones canónicas
├── relations.ts                 # Esquemas Zod para relaciones tipadas en el grafo
├── goal-contract.ts             # GoalContractSchema, criterios de aceptación y autoridades de prueba
├── semantic-plan.ts             # SemanticPlanSchema, WorkUnitSchema y decisiones de granularidad
├── task-contract.ts             # TaskContractSchema y constructores de tareas
├── contract-bundle.ts           # TaskContractBundleSchema (paquete integral e inmutable por nodo)
├── contract-identity.ts         # Validadores de referencias de contrato e invariantes de identidad
├── scope-contract.ts            # ScopeContractSchema, OutputRootSchema y RepoRelativePathSchema
├── seam-contract.ts             # SeamContractSchema (contratos de costura e interfaces compartidas)
├── artifact-contract.ts         # ArtifactContractSchema y modos de materialización
├── artifact-manifest.ts         # Manifiestos direccionados por contenido (ChangeSet / CandidateTree)
├── validation-contract.ts       # ValidationContractSchema y obligaciones canónicas de validación
├── proof-strategy.ts            # ProofStrategySchema y verificación de cobertura de pruebas
├── evidence-binding.ts          # EvidenceBindingSchema y políticas de frescura de evidencia
├── effect-protocol.ts           # Protocolo de efectos físicos (EffectIntent y PhysicalEffectReceipt)
├── effect-input.ts              # Esquemas para persistencia de inputs de efectos
├── input-fingerprint.ts         # InputFingerprintSchema (identidad causal de un intento)
├── recovery-diagnostic.ts       # RecoveryDiagnosticSchema (taxonomía de fallos y recuperación)
├── planning.ts                  # Esquemas de presupuestos y borradores de decisión
├── source-contract.ts           # SourceContractSchema para orígenes de repositorio
└── legacy-adapter.ts            # Adaptador unidireccional para compatibilidad con AgentTaskContract histórico
```

### Mapa de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-json.ts` | Provee `canonicalJson`, `computeCanonicalDigest` y `verifyCanonicalDigest`. Ordena lexicográficamente las claves y estandariza los arrays. |
| `goal-contract.ts` | Modela el requerimiento raíz del usuario (`GoalContract`), sus criterios de aceptación categorizados (`product`, `quality`, `constraint`) y las autoridades de prueba (`SUPPORTED_PROOF_PAIRS`). |
| `semantic-plan.ts` | Modela el plan semántico completo (`SemanticPlan`), sus unidades (`WorkUnit`), decisiones de granularidad (`GranularityDecision`), intenciones sobre recursos (`PlannedResourceIntent`) y costuras (`PlannedSeam`). |
| `contract-bundle.ts` | Agrupa de forma inmutable todos los contratos que definen un nodo ejecutable (`TaskContractBundle`): tarea, alcance, interfaces consumidas/producidas, artefactos y validación. |
| `scope-contract.ts` | Define el *bounding box* de archivos permitidos y prohibidos (`allowedPaths`, `forbiddenPaths`), validando rutas POSIX normalizadas con `RepoRelativePathSchema`. |
| `seam-contract.ts` | Modela los contratos de interfaz compartidos entre tareas (`SeamContract`), especificando compatibilidad semántica y firmas tipadas. |
| `artifact-manifest.ts` | Define manifiestos de mutación inmutables (`ChangeSetManifest` y `CandidateTreeManifest`) con hash SHA-256 por cada archivo modificado para materialización determinista en Git. |
| `validation-contract.ts` | Formaliza las obligaciones canónicas de validación (`CanonicalValidationObligation`) en niveles (`unit`, `integration`, `system`, `conformance`). |
| `proof-strategy.ts` | Define estrategias formales de prueba (`ProofStrategy`) y verifica que ningún criterio de aceptación quede huérfano sin autoridad de prueba (`validateProofCoverage`). |
| `effect-protocol.ts` | Protocolo bifásico que conecta la declaración de intención (`EffectIntent`) con el recibo de ejecución física emitido por el host (`PhysicalEffectReceipt`). |
| `input-fingerprint.ts` | Calcula el `InputFingerprint`, compuesto por el digest del contrato de tarea, el árbol Git base (`baseTreeSha`), el entorno y el perfil del ejecutor. Identifica unívocamente un intento (*Attempt*). |
| `recovery-diagnostic.ts` | Taxonomía formal de diagnósticos de error categorizados por causa raíz (`infrastructure`, `scope_breach`, `seam_incompatibility`, `validation_failure`, `concurrency_conflict`). |
| `legacy-adapter.ts` | Reader unidireccional que adapta payloads de contratos legacy (`AgentTaskContract`) a la estructura canónica sin contaminar los módulos target. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama ilustra cómo los contratos de `@manyhands/contracts` estructuran el ciclo de vida desde el requerimiento inicial hasta la ejecución física y la validación:

```
                  Usuario / Operador
                          │
                          ▼
                 ┌──────────────────┐
                 │   GoalContract   │  (Criterios de Aceptación + Proof Authorities)
                 └────────┬─────────┘
                          │
                          ▼  (Consumido por @manyhands/decomposer)
                 ┌──────────────────┐
                 │   SemanticPlan   │  (WorkUnits + GranularityDecisions + PlannedSeams)
                 └────────┬─────────┘
                          │
                          ▼  (Compilado por direct-plan-compiler)
             ┌────────────┴────────────┐
             ▼                         ▼
   ┌────────────────────┐    ┌───────────────────────────────────┐
   │   GraphRevision    │    │        TaskContractBundle         │
   │ (@manyhands/       │    │ ├── TaskContract                  │
   │  task-graph)       │    │ ├── ScopeContract                 │
   └─────────┬──────────┘    │ ├── SeamContract (consumed/prod)  │
             │               │ ├── ArtifactContract              │
             │               │ └── ValidationContract            │
             │               └─────────────────┬─────────────────┘
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                     ┌──────────────────┐
                     │ InputFingerprint │  (SHA-256 de Contrato + BaseTree + Inputs)
                     └────────┬─────────┘
                              │
                              ▼  (Despachado por @manyhands/run-engine)
                     ┌──────────────────┐
                     │   EffectIntent   │  (Declaración de Intención en Outbox)
                     └────────┬─────────┘
                              │  Ejecución en @manyhands/execution-core
                              ▼
                 ┌──────────────────────────┐
                 │  PhysicalEffectReceipt   │  (Validación de Binding Causal)
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │     ArtifactManifest     │  (ChangeSet con Blobs SHA-256)
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │     EvidenceBinding      │  (Matriz de Evidencia contra Criterios)
                 └──────────────────────────┘
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Schemas Zod y Tipos TypeScript Principales

| Schema Zod | Tipo TypeScript | Propósito |
|---|---|---|
| `GoalContractSchema` | `GoalContract` | Requerimiento de usuario con criterios de aceptación tipados y target de repositorio. |
| `SemanticPlanSchema` | `SemanticPlan` | Plan semántico integral con unidades jerárquicas, seams y decisiones. |
| `WorkUnitSchema` | `WorkUnit` | Unidad de trabajo semántica (hoja o compuesta) con intenciones de recursos. |
| `TaskContractBundleSchema` | `TaskContractBundle` | Contenedor inmutable que agrupa todos los contratos necesarios para ejecutar un nodo. |
| `ScopeContractSchema` | `ScopeContract` | Delimitación estricta de rutas de lectura/escritura y raíces de salida. |
| `RepoRelativePathSchema` | `string` | Validador de rutas relativas seguras (sin `..`, `/`, `C:`, o caracteres de control). |
| `SeamContractSchema` | `SeamContract` | Contrato de interfaz compartida entre tareas productoras y consumidoras. |
| `ArtifactManifestSchema` | `ArtifactManifest` | Manifiesto de cambios indexado por contenido (`ChangeSet` o `CandidateTree`). |
| `ValidationContractSchema`| `ValidationContract` | Colección de obligaciones canónicas de validación para un nodo. |
| `ProofStrategySchema` | `ProofStrategy` | Estrategia formal de prueba (tests unitarios, comprobaciones deterministas, etc.). |
| `EffectIntentSchema` | `EffectIntent` | Declaración previa de intención de efecto físico en el workspace. |
| `PhysicalEffectReceiptSchema` | `PhysicalEffectReceipt` | Recibo de ejecución física validable criptográficamente. |
| `InputFingerprintSchema` | `InputFingerprint` | Huella inmutable de las entradas de un intento de ejecución. |
| `RecoveryDiagnosticSchema` | `RecoveryDiagnostic` | Diagnóstico estructurado de causa raíz de fallo con estrategia de reparación. |

### Firmas de Funciones Fundamentales

```typescript
// 1. Serialización e Identidad Canónica
export function canonicalJson(value: unknown): string;
export function computeCanonicalDigest(value: unknown, hasher: DigestHasher): string;
export function verifyCanonicalDigest(value: Record<string, unknown>, digestField: string, hasher: DigestHasher): boolean;

// 2. Construcción y Validación de Objetivos
export function buildGoalContract(material: GoalContractMaterial, hasher: DigestHasher): GoalContract;
export function validateGoalContract(contract: GoalContract): GoalContractValidationResult;

// 3. Validación de Cobertura de Pruebas
export function validateProofCoverage(goal: GoalContract, plan: SemanticPlan): ProofCoverageValidationResult;

// 4. Validación de Rutas Seguras
export function unsafeRepoRelativePathReason(path: string): string | null;

// 5. Verificación de Vínculo de Efectos Físicos
export function validatePhysicalEffectReceiptBinding(
  receipt: PhysicalEffectReceipt,
  intent: EffectIntent,
  hasher: DigestHasher
): boolean;
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Inmutabilidad y Serialización Canónica Determinista (`canonical-json.ts`)
Para garantizar que dos objetos con las mismas propiedades pero en diferente orden de inserción generen el mismo hash SHA-256:
- **Ordenamiento recursivo de claves**: Las claves de cada objeto se ordenan lexicográficamente mediante `localeCompare`.
- **Preservación de orden en listas**: Los arrays mantienen su orden explícito a menos que el dominio declare un conjunto de valores únicos, en cuyo caso se aplica `sortedUniqueStrings`.
- **Valores primitivos normalizados**: Los valores `undefined` son omitidos uniformemente y los números se serializan según la especificación ECMAScript JSON.

### 2. Validación Estricta con Zod y Refinamientos de Invariantes (`.strict()` y `.superRefine`)
Todos los esquemas de `@manyhands/contracts` utilizan `.strict()`, impidiendo que campos no tipados contaminen el estado o pasen inadvertidos. Los refinamientos validan reglas de dominio complejas:
- En `GranularityDecisionSchema`: Si la decisión es `"split"`, se exige al menos una razón en `splitReasons`, referencias de evidencia válidas y un `integrationObligationId`. Si es `"leaf"`, se valida que la responsabilidad sea atómica y no posponga decisiones arquitectónicas.
- En `SemanticPlanMaterialSchema`: Se comprueba la consistencia referencial cruzada (que el `rootUnitId` exista en el diccionario de unidades y que cada `parentId` referenciado sea válido).

### 3. Seguridad Fail-Closed en el Sistema de Archivos (`RepoRelativePathSchema`)
Para evitar ataques de path traversal y escapes de workspace, `RepoRelativePathSchema` rechaza en tiempo de parseo:
- Rutas absolutas (`/` o `\\`).
- Prefijos de unidad de disco en Windows (`C:`, `D:`).
- Referencias al home de usuario (`~`).
- Segmentos de retroceso de directorio (`..`).
- Caracteres de control ASCII (código <= 0x1f).

### 4. Identidad Causal del Intento (`InputFingerprint`)
En ManyHands, un intento (*Attempt*) es inmutable. Si una tarea falla y requiere nueva ejecución, no se muta el intento anterior; se genera un nuevo intento cuyo `InputFingerprint` refleja la nueva combinación de entradas:
$$\text{InputFingerprint} = \text{SHA-256}(\text{baseTreeSha} \parallel \text{contractDigest} \parallel \text{consumedArtifactDigests} \parallel \text{executorProfileDigest})$$

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 1 / G1)**: El kernel de contratos canónicos está completamente implementado y verificado con 122 tests específicos en Stage 1 (`docs/audits/stage-1/`).
2. **Eliminación de la Compatibilidad Bidireccional**: La ruta productiva compila directamente `SemanticPlan -> GraphRevision + TaskContractBundle`. No existe traducción de regreso `SemanticPlan -> WorkBreakdown -> SemanticPlan`.
3. **Adaptadores Transicionales (`legacy-adapter.ts`)**: Mantiene exclusivamente funciones de lectura unidireccionales para permitir la carga y replay de runs históricos generados con versiones anteriores del sistema (`AgentTaskContract`).

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/contracts/README.md`](../../packages/contracts/README.md)
- **Módulos Relacionados**:
  - [`task-graph.md`](./task-graph.md): Modelo del grafo ejecutable y verificación de autoridad sobre recursos.
  - [`decomposer.md`](./decomposer.md): Planificación progresiva y compilación directa a contratos.
  - [`execution-core.md`](./execution-core.md): Materialización física de manifiestos y ejecución en sandboxes.
  - [`run-coordinator.md`](./run-coordinator.md): Catálogo de eventos canónicos y reductor de estado.
- **Documentación Central**: [`../README.md`](../README.md)
