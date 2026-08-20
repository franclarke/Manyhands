# @manyhands/contracts

Schemas versionados, contratos inmutables y primitivas de identidad canónica en la frontera de confianza (*trust boundary*) de ManyHands.

---

## Propósito y Responsabilidad en ManyHands

En arquitecturas multi-agente para ingeniería de software, la coordinación suele degradarse cuando los agentes se comunican mediante lenguaje natural informal o payloads JSON sin tipado estricto. **`@manyhands/contracts`** constituye la capa de verdad única e inmutable para todas las obligaciones formales del sistema.

### ¿Por qué existe este paquete?
1. **Eliminar la ambigüedad en los límites de confianza**: Cada interacción entre el usuario, el motor de planificación (`@manyhands/decomposer`), el grafo de tareas (`@manyhands/task-graph`), los motores de ejecución (`@manyhands/execution-core`) y el runtime daemon (`@manyhands/run-engine`) está regulada por contratos versionados.
2. **Garantizar la identidad causal y el direccionamiento por contenido (*content addressing*)**: Ninguna entidad de dominio se identifica por referencias mutables en memoria; cada contrato genera un hash criptográfico determinista (`digest`) sobre su representación JSON canónica.
3. **Formalizar la frontera de seguridad del workspace**: Delimita con precisión matemática qué paths puede leer, modificar o crear cada agente (`ScopeContract`), evitando colisiones y violaciones de alcance.
4. **Verificación y Recuperación Basada en Causas**: Define cómo se estructuran las estrategias de prueba (`ValidationContract`, `ProofStrategy`, `EvidenceBinding`), cómo se registran los efectos físicos en el sistema host (`EffectIntent`, `PhysicalEffectReceipt`), y cómo se diagnostican las fallas (`RecoveryDiagnostic`) para reaccionar según la causa raíz en vez de aplicar reintentos ciegos.

---

## Arquitectura Modular Interna

El paquete está compuesto por 25 módulos TypeScript en `src/`, organizados funcionalmente:

```
packages/contracts/src/
├── index.ts                     # Barrel export central y schemas transicionales/legacy
├── canonical-json.ts            # Serialización canónica determinista y hashing de digests
├── canonical-reference.ts       # Schemas para referencias canónicas por digest e ID
├── canonical-graph-relations.ts # Reclamos de recursos y requisitos de artefactos en el grafo
├── canonical-validation.ts      # Helpers y definiciones base para obligaciones canónicas
├── relations.ts                 # Schemas para relaciones tipadas canónicas
├── goal-contract.ts             # GoalContractSchema, criterios de aceptación y políticas de prueba
├── semantic-plan.ts             # SemanticPlanSchema, WorkUnitSchema, decisiones de granularidad
├── task-contract.ts             # TaskContractSchema y constructor canónico de tareas
├── contract-bundle.ts           # TaskContractBundleSchema (agrupación integral inmutable por nodo)
├── contract-identity.ts         # Validación de referencias de contrato e invariantes de identidad
├── scope-contract.ts            # ScopeContractSchema, OutputRootSchema y RepoRelativePathSchema
├── seam-contract.ts             # SeamContractSchema (interfaces y contratos de costura entre tareas)
├── artifact-contract.ts         # ArtifactContractSchema y modos de materialización
├── artifact-manifest.ts         # Manifiestos direccionados por contenido (ChangeSet / CandidateTree)
├── validation-contract.ts       # ValidationContractSchema y obligaciones canónicas de validación
├── proof-strategy.ts            # ProofStrategySchema y verificación de cobertura probatoria
├── evidence-binding.ts          # EvidenceBindingSchema y políticas de frescura de evidencia
├── effect-protocol.ts           # Protocolo de efectos físicos (EffectIntentSchema, PhysicalEffectReceiptSchema)
├── effect-input.ts              # Schemas e interfaces para almacenamiento durable de inputs de efectos
├── input-fingerprint.ts         # InputFingerprintSchema (identidad causal de un intento de ejecución)
├── recovery-diagnostic.ts       # RecoveryDiagnosticSchema (taxonomía de fallos y acciones de recuperación)
├── planning.ts                  # Schemas auxiliares de presupuesto y borradores de decisión
├── source-contract.ts           # SourceContractSchema para orígenes de repositorio
└── legacy-adapter.ts            # Adaptador unidireccional para compatibilidad con AgentTaskContract histórico
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-json.ts` | Provee `canonicalJson`, `computeCanonicalDigest` y `verifyCanonicalDigest`. Normaliza objetos ordenando claves lexicográficamente preservando el orden en arrays declarativos. |
| `goal-contract.ts` | Modela el objetivo raíz del usuario (`GoalContract`), sus criterios de aceptación categorizados (`product`, `quality`, `constraint`), y las autoridades de prueba admitidas (`SUPPORTED_PROOF_PAIRS`). |
| `semantic-plan.ts` | Modela el plan semántico completo (`SemanticPlan`), sus unidades de trabajo (`WorkUnit`), decisiones de granularidad (`GranularityDecision`), intenciones sobre recursos (`PlannedResourceIntent`) y costuras (`PlannedSeam`). |
| `contract-bundle.ts` | Agrupa de forma inmutable todos los contratos asociados a un nodo ejecutable (`TaskContractBundle`): tarea, alcance, interfaces consumidas/producidas, artefactos y validación. |
| `scope-contract.ts` | Define el *bounding box* del sistema de archivos (`allowedPaths`, `forbiddenPaths`, `outputRoots`) y valida paths POSIX normalizados con `RepoRelativePathSchema`. |
| `seam-contract.ts` | Define los contratos de interfaz compartidos entre nodos (`SeamContract`), incluyendo reglas de compatibilidad semántica y firmas tipadas. |
| `artifact-manifest.ts` | Manifiestos inmutables de mutación (`ChangeSetManifest` y `CandidateTreeManifest`) con hash SHA-256 por archivo para materialización determinista en Git. |
| `validation-contract.ts` | Formaliza las obligaciones de validación (`CanonicalValidationObligation`) en capas (`unit`, `integration`, `system`, `conformance`). |
| `proof-strategy.ts` | Define estrategias formales de prueba (`ProofStrategy`) y verifica que cada criterio del objetivo posea cobertura probatoria verificable (`validateProofCoverage`). |
| `effect-protocol.ts` | Protocolo bifásico: primero se declara la intención de mutación física (`EffectIntent`) y luego se valida el recibo de ejecución emitido por el host (`PhysicalEffectReceipt`). |
| `input-fingerprint.ts` | Calcula el `InputFingerprint`, compuesto por el hash del contrato de tarea, el árbol Git base (`baseTreeSha`), el entorno y el conjunto de herramientas. Identifica unívocamente un intento de ejecución (*Attempt*). |
| `recovery-diagnostic.ts` | Taxonomía estructurada de diagnósticos de error (`RecoveryDiagnostic`) categorizados por causa raíz (`infrastructure`, `scope_breach`, `seam_incompatibility`, `validation_failure`, `concurrency_conflict`). |
| `legacy-adapter.ts` | Reader unidireccional que adapta payloads de contratos legacy (`AgentTaskContract`) a la estructura canónica sin contaminar los módulos target. |

---

## Patrones de Diseño y Estrategias Técnicas

### 1. Inmutabilidad y Hashing Canónico (`canonical-json.ts`)
Para evitar que diferencias accidentales en el ordenamiento de claves JSON generen identificadores distintos, `@manyhands/contracts` utiliza un serializador canónico determinista:
- **Ordenamiento recursivo de claves**: Las claves de los objetos se ordenan lexicográficamente con `localeCompare`.
- **Preservación del orden de arrays**: Los arrays mantienen su orden explícito a menos que el dominio declare que se trata de un conjunto, en cuyo caso se aplica `sortedUniqueStrings`.
- **Hashing determinista**: La función `computeCanonicalDigest(value, hasher)` aplica una función hash (típicamente SHA-256) sobre la cadena canónica resultante.

```typescript
export function canonicalJson(value: unknown): string;
export function computeCanonicalDigest(value: unknown, hasher: DigestHasher): string;
export function verifyCanonicalDigest(value: Record<string, unknown>, digestField: string, hasher: DigestHasher): boolean;
```

### 2. Validación de Esquemas en Runtime con Zod y Refinamientos Estrictos
Todos los contratos utilizan Zod en modo estricto (`.strict()`), lo que prohíbe propiedades desconocidas que pudieran filtrar estado mutable o no rastreado. Además, se aplican refinamientos avanzados (`.superRefine`) para verificar invariantes de dominio:
- En `GranularityDecisionSchema`: Si la disposición es `"split"`, se exige al menos una razón en `splitReasons`, referencias de evidencia y un `integrationObligationId`. Si es `"leaf"`, se valida que la responsabilidad sea coherente y no contenga decisiones arquitectónicas sin resolver.
- En `SemanticPlanMaterialSchema`: Se comprueba la consistencia referencial cruzada (que el `rootUnitId` exista en el diccionario de unidades y que cada `parentId` referenciado sea válido).

### 3. Seguridad Fail-Closed en Rutas de Archivos (`RepoRelativePathSchema`)
La seguridad del workspace comienza en la sintaxis de las rutas. `RepoRelativePathSchema` y `unsafeRepoRelativePathReason` rechazan de forma preventiva:
- Rutas absolutas (que comiencen con `/` o `\\`).
- Prefijos de unidad en Windows (ej. `C:`).
- Rutas dirigidas al home del usuario (`~`).
- Segmentos de escape de directorio (`..` traversal).
- Caracteres de control ASCII (código <= 0x1f).

### 4. Protocolo Bifásico de Efectos Físicos (`EffectIntent` vs `PhysicalEffectReceipt`)
Para mantener el control sobre las mutaciones del sistema de archivos y la ejecución de comandos:
1. El agente o planificador emite un `EffectIntent` que describe exactamente qué mutación o comando se propone realizar.
2. El entorno de ejecución o sandbox ejecuta la acción y genera un `PhysicalEffectReceipt`.
3. La función `validatePhysicalEffectReceiptBinding(receipt, intent, hasher)` valida criptográficamente que el recibo corresponda a la intención previamente aprobada.

### 5. Identidad Causal del Intento (`InputFingerprint`)
En ManyHands, un intento (*Attempt*) es inmutable. Si un intento falla o se cancela, no se "reintenta" modificando el mismo registro; se genera un nuevo intento con un nuevo `InputFingerprint`. El fingerprint se calcula determinísticamente mediante SHA-256 sobre `InputFingerprintMaterial`:
- `executionBase`: `repositoryViewDigest` y `treeSha` base de Git.
- `consumedArtifactDigests`: lista ordenada de digests de artefactos consumidos.
- `nodeContractDigest`: digest del contrato del nodo.
- `resourceClaimDigest`: digest de los reclamos de recursos.
- `contextDigest`: digest del contexto de ejecución.
- `executorProfileDigest`: digest del perfil del ejecutor.
- `sandboxCapabilityDigest`: digest de las capacidades del sandbox.

---

## Puntos de Entrada, Interfaces y Schemas Clave

### Catálogo de Schemas y Tipos Principales

| Schema Zod | Tipo TypeScript | Propósito |
|---|---|---|
| `GoalContractSchema` | `GoalContract` | Contrato de objetivo raíz con criterios de aceptación y target de repositorio. |
| `SemanticPlanSchema` | `SemanticPlan` | Plan semántico completo con unidades, seams, artefactos y decisiones. |
| `WorkUnitSchema` | `WorkUnit` | Unidad de trabajo semántica (hoja o compuesta) con intenciones de recursos. |
| `TaskContractBundleSchema` | `TaskContractBundle` | Contenedor inmutable que agrupa todos los contratos de un nodo. |
| `ScopeContractSchema` | `ScopeContract` | Delimitación estricta de paths permitidos, prohibidos y raíces de salida. |
| `SeamContractSchema` | `SeamContract` | Contrato de interfaz compartida entre unidades productoras y consumidoras. |
| `ArtifactManifestSchema` | `ArtifactManifest` | Manifiesto de cambios indexado por contenido (`ChangeSet` o `CandidateTree`). |
| `ValidationContractSchema` | `ValidationContract` | Colección de obligaciones de validación canónicas para una unidad. |
| `ProofStrategySchema` | `ProofStrategy` | Estrategia de prueba declarada (check determinista, test aislado, etc.). |
| `EffectIntentSchema` | `EffectIntent` | Declaración previa de intención de efecto físico en el workspace. |
| `PhysicalEffectReceiptSchema`| `PhysicalEffectReceipt` | Recibo comprobable de ejecución física en el host/sandbox. |
| `InputFingerprintSchema` | `InputFingerprint` | Hash SHA-256 de todas las entradas inmutables de un intento. |
| `RecoveryDiagnosticSchema` | `RecoveryDiagnostic` | Diagnóstico estructurado de causas raíz de fallo y acciones correctivas. |

---

### Ejemplos de Uso

#### 1. Creación y Validación de un `GoalContract`

```typescript
import { buildGoalContract, validateGoalContract, type GoalContractMaterial } from "@manyhands/contracts";
import { createHash } from "node:crypto";

const sha256Hasher = (json: string) => createHash("sha256").update(json).digest("hex");

const goalMaterial: GoalContractMaterial = {
  id: "goal-auth-service",
  revision: 1,
  goal: "Implement JWT authentication service with refresh token rotation",
  acceptanceCriteria: [
    {
      id: "crit-jwt-verify",
      statement: "verifyToken validates signature and expiration",
      required: true,
      level: "product",
      protectedReferences: ["src/auth/jwt.ts"],
      verification: {
        allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }],
        independence: "independent_required"
      }
    }
  ],
  constraints: ["No external OAuth providers", "Must use Node.js crypto module"],
  qualityAttributes: [
    { kind: "security", statement: "Tokens must use RS256 algorithm" }
  ],
  target: {
    repositoryId: "repo-manyhands",
    baseCommit: "a1b2c3d4e5f67890123456789abcdef012345678",
    treeSha: "b2c3d4e5f67890123456789abcdef0123456789a"
  }
};

// Construye el contrato canonicalizando strings y calculando su digest determinista
const goalContract = buildGoalContract(goalMaterial, sha256Hasher);
console.log("Goal Contract Digest:", goalContract.digest);

// Valida la coherencia de invariantes y pares de prueba soportados
const validation = validateGoalContract(goalContract);
if (!validation.ok) {
  console.error("Errores en GoalContract:", validation.issues);
}
```

#### 2. Definición de un `ScopeContract` Seguro

```typescript
import { ScopeContractSchema } from "@manyhands/contracts";

const scopeData = {
  schemaVersion: 2,
  id: "scope-jwt-1",
  revision: "1",
  provenance: "authored" as const,
  nodeId: "node-leaf-auth-1",
  allowedPaths: ["packages/auth/src/**"],
  forbiddenPaths: ["packages/core/**", "apps/**"],
  coordinationPaths: ["packages/auth/src/index.ts"],
  outputRoots: ["packages/auth/src/tokens"]
};

const validScope = ScopeContractSchema.parse(scopeData);
```

#### 3. Cálculo de `InputFingerprint` para un Intento de Ejecución

```typescript
import {
  buildInputFingerprint,
  computeCanonicalDigest,
  type InputFingerprintMaterial
} from "@manyhands/contracts";
import { createHash } from "node:crypto";

const sha256Hasher = (json: string) => createHash("sha256").update(json).digest("hex");

const material: InputFingerprintMaterial = {
  executionBase: {
    repositoryViewDigest: "d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8",
    treeSha: "a1b2c3d4e5f67890123456789abcdef012345678"
  },
  consumedArtifactDigests: ["art-digest-1"],
  nodeContractDigest: "node-contract-digest-1",
  resourceClaimDigest: "claim-digest-1",
  contextDigest: "ctx-digest-1",
  executorProfileDigest: "profile-digest-1",
  sandboxCapabilityDigest: "sandbox-digest-1"
};

const fingerprintHash = buildInputFingerprint(material, sha256Hasher);
console.log(`InputFingerprint: ${fingerprintHash}`);
```

---

## Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan canónico de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado Target (Stages 1 a 4)**:
   - Los módulos canónicos (`goal-contract.ts`, `semantic-plan.ts`, `task-contract.ts`, `contract-bundle.ts`, `artifact-manifest.ts`, `validation-contract.ts`, etc.) representan el 100% de la especificación target y son utilizados activamente por el nuevo pipeline del compilador de planes (`direct-plan-compiler.ts`).
2. **Capa de Compatibilidad Legacy (`legacy-adapter.ts` y exports transicionales en `index.ts`)**:
   - Para soportar ejecutores y tests históricos sin romper el monorepo, aún conviven esquemas como `AgentTaskContractSchema`, `ContextPackSchema`, `ValidationCommandSchema` e `InterfaceContractSchema`.
   - La función `adaptLegacyAgentTaskContract` provee una transformación unidireccional desde `AgentTaskContract` hacia las estructuras canónicas V2.
   - **Regla de transición**: Nuevos componentes deben escribir y consumir únicamente los contratos canónicos (`TaskContractBundle`, `ScopeContract`, `SeamContract`, `ArtifactContract`).

---

## Comandos de Verificación y Testing

Para verificar el tipado estricto y construir el paquete:

```bash
# Verificación de tipos TypeScript
pnpm --filter @manyhands/contracts typecheck

# Compilación y generación de bundles (.js, .cjs, .d.ts) con tsup
pnpm --filter @manyhands/contracts build

# Ejecución de tests unitarios del paquete
pnpm test packages/contracts
```
