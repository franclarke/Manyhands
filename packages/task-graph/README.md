# @manyhands/task-graph

Modelo inmutable del grafo ejecutable, relaciones tipadas de dominio, verificación de autoridad sobre recursos y análisis topológico en ManyHands.

---

## Propósito y Responsabilidad en ManyHands

En ManyHands, la ejecución de proyectos de software complejos se modela mediante un grafo dirigido acíclico (DAG) enriquecido. A diferencia de los orquestadores tradicionales donde las dependencias son flechas booleanas opacas o barreras por "oleadas" fijas, **`@manyhands/task-graph`** implementa un modelo de grafo semántico y versionado (`GraphRevision`).

### ¿Por qué existe este paquete?
1. **Representar el Grafo Ejecutable Canónico**: Es la estructura de datos que resulta directamente de compilar un plan semántico (`SemanticPlan` en `@manyhands/decomposer`).
2. **Reemplazar Conflictos Heurísticos por Reclamos de Recursos**: En lugar de calcular riesgos de conflicto mediante comparaciones heurísticas por pares (*pairwise*), cada nodo declara formalmente sus accesos a recursos (`ResourceClaim`) de tipo lectura (`observe`) o modificación (`modify`).
3. **Imponer la Autoridad de Modificación sobre Recursos (`checkResourceAuthority`)**: Garantiza que ningún agente escriba en un archivo o recurso sobre el cual no posea un título formal de mutación, separando el concepto de *envolvente de scope* del *título de propiedad del recurso*.
4. **Habilitar Scheduling Continuo**: Las dependencias de ejecución no son barreras arbitrarias de fase, sino flujos concretos de artefactos (`ArtifactRequirement`) y enlaces de interfaces (`SeamBinding`).
5. **Replanificación Selectiva por Injerto de Subárboles (`graftSubtree`)**: Permite replanificar un nodo compuesto que falló o requirió refinamiento sin descartar el progreso del resto del grafo.

---

## Arquitectura Modular Interna

El paquete consta de 10 módulos TypeScript en `src/`:

```
packages/task-graph/src/
├── index.ts                     # Export central de APIs canónicas y legacy
├── canonical-graph.ts           # GraphRevisionSchema, CanonicalTaskNode, buildGraphRevision, validadores
├── resource-authority.ts        # checkResourceAuthority y descriptores de violación de titularidad
├── topological-level.ts         # computeLegacyGraphRevisionV2TopologicalLevels para layout en canvas
├── graph-reducer.ts             # Reductor funcional de estados de nodo y agregación para UI
├── relations.ts                 # Schemas para ResourceClaim, ArtifactRequirement, SeamBinding
├── compatibility-reader.ts      # Reader polimórfico (lee GraphRevision canónico o V2/V1 legacy)
├── legacy-adapter.ts            # Adaptadores para transformación de grafos históricos a V2
├── validate-v2.ts               # Batería de validación de invariantes para LegacyGraphRevisionV2
└── graph-revision.ts            # Definición complementaria de revisiones de grafo
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-graph.ts` | Define el modelo canónico del grafo (`CanonicalTaskNode`, `GraphRevisionSchema`), el constructor determinista `buildGraphRevision`, y los validadores de invariantes estructurales (`validateGraphRevision`, `validateGraphRevisionTransition`). |
| `resource-authority.ts` | Implementa `checkResourceAuthority`, verificando que los archivos modificados por un intento correspondan a artefactos vinculados a un reclamo `modify` legítimo. |
| `topological-level.ts` | Provee `computeLegacyGraphRevisionV2TopologicalLevels` para calcular niveles topológicos presentacionales (*longest path*) sobre grafos V2 para el canvas web. |
| `compatibility-reader.ts` | Expone `readGraphRevision` y `readLegacyGraphForCompatibility`, permitiendo que el runtime y la UI consuman tanto revisiones canónicas modernas como grafos legacy sin duplicar lógica. |
| `relations.ts` | Exporta los esquemas de relaciones tipadas: `ResourceClaimSchema`, `RuntimeLeaseClaimSchema`, `ArtifactRequirementSchema` y `SeamBindingSchema`. |
| `graph-reducer.ts` | Provee funciones puras de reducción y actualización de estados del grafo ante eventos del ciclo de vida. |
| `validate-v2.ts` | Ejecuta validaciones exhaustivas sobre grafos intermedios V2 (detección de ciclos, verificación de interfaces huérfanas, consistencia padre-hijo). |
| `index.ts` | Exporta los esquemas legacy (`TaskGraphSchema`, `LegacyTaskNodeSchema`), utilidades de readiness (`getLeafReadiness`, `getReadyLeaves`), agregación de estados (`aggregateTaskStatus`) y la función de injerto `graftSubtree`. |

---

## Patrones de Diseño y Estrategias Técnicas

### 1. Inmutabilidad y Transiciones de Revisión de Grafo (`GraphRevision`)
Un grafo en ManyHands nunca se muta in-place. Toda modificación estructural (como la expansión de un composite en nodos hoja o una replanificación) genera una nueva instancia de `GraphRevision`:
- La función `buildGraphRevision(material, hasher)` normaliza colecciones, elimina duplicados, ordena identificadores y genera un `digest` canónico.
- La función `validateGraphRevisionTransition(previous, next)` valida que la transición preserve el `graphId`, incremente la `revision` exactamente en +1 y garantice que el digest cambie reflejando la nueva identidad de contenido.

### 2. Separación entre Scope y Autoridad de Recursos (`checkResourceAuthority`)
Existe una distinción crítica entre dos mecanismos de seguridad en ManyHands:
- **Scope Contract (`ScopeContract`)**: Define la *envolvente de paths* (bounding box) donde el proceso sandbox puede operar físicamente. Por ejemplo, un nodo composite que integra 3 paquetes tiene un scope que abarca los 3 paquetes.
- **Resource Authority (`checkResourceAuthority`)**: Define la *titularidad de modificación*. Aunque el scope del composite abarque los archivos de sus hijos, el composite no tiene autoridad para editar directamente el código de un hijo a menos que posea un `ResourceClaim` con `access: "modify"` sobre ese recurso específico.
- Si un intento modifica un archivo reclamado por otro nodo, `checkResourceAuthority` emite una violación `ownership_violation`, impidiendo que un composite o tarea hermana sobrescriba trabajo ajeno.

```typescript
export interface ResourceAuthorityViolation {
  readonly kind: "ownership_violation";
  readonly path: string;
  readonly ownedByNodeId: string;
  readonly attemptedByNodeId: string;
}

export function checkResourceAuthority(input: {
  readonly nodeId: string;
  readonly resourceClaims: readonly ResourceClaim[];
  readonly artifactContracts: readonly ArtifactPathOwnership[];
  readonly changedPaths: readonly string[];
  readonly composedArtifactIds?: readonly string[];
}): ResourceAuthorityViolation[];
```

### 3. Relaciones Tipadas de Dominio
En lugar de aristas genéricas `A -> B`, el grafo canónico descompone las dependencias en relaciones semánticas formales:
1. **Jerarquía Padre-Hijo (`nodes[id].parentId`)**: Define la estructura de composición (raíz -> composites -> hojas/integradores).
2. **Requisitos de Artefactos (`ArtifactRequirement`)**: Especifica qué contrato de artefacto (`artifactContract`) produce un nodo y consume otro, y para qué fase se requiere (`execution` o `integration`).
3. **Enlaces de Costura (`SeamBinding`)**: Conecta los interfaces compartidos (`SeamContract`) y sus correspondientes obligaciones de validación entre productor y consumidor.
4. **Reclamos de Recursos (`ResourceClaim`)**: Registra la intención de lectura u ordenamiento causal de escritura sobre un recurso del repositorio.
5. **Leases de Ejecución (`RuntimeLeaseClaim`)**: Solicita exclusividad temporal durante la ejecución de un intento.

### 4. Niveles Topológicos vs Scheduling Continuo
Para la visualización en el canvas React Flow (`apps/web`):
- `computeLegacyGraphRevisionV2TopologicalLevels` calcula la distancia topológica en camino más largo desde la raíz hacia cada nodo en grafos `LegacyGraphRevisionV2`.
- **Importante**: Este nivel topológico es **únicamente presentacional**. El planificador de ejecución (`@manyhands/scheduler`) no espera a que termine una "capa" completa para iniciar la siguiente; evalúa continuamente la disponibilidad de los `ArtifactRequirement`s para desbloquear nodos hoja en cuanto sus dependencias reales de datos están satisfechas.

### 5. Replanificación Selectiva por Injerto (`graftSubtree`)
Cuando una rama del grafo requiere replanificación:
- `graftSubtree` elimina los descendientes anteriores del nodo objetivo.
- Conserva la identidad externa del nodo (`id`, `parentId`, `title`, `goal`).
- Adopta el nuevo subárbol asignando identificadores con namespace de revisión (`${taskId}-r${revision}-${id}`).
- Reasocia automáticamente los bordes de dependencia que apuntaban a los nodos descartados hacia el nodo objetivo, validando la aciclicidad del grafo resultante antes de retornar.

---

## Puntos de Entrada, Interfaces y Schemas Clave

### Catálogo de Schemas y Tipos Principales

| Schema Zod | Tipo TypeScript | Propósito |
|---|---|---|
| `CanonicalTaskNodeSchema` | `CanonicalTaskNode` | Nodo inmutable canónico (`id`, `parentId`, `kind`, `title`, `goal`, `contractRef`). |
| `GraphRevisionSchema` | `GraphRevision` | Revisión completa e inmutable del grafo con digest canónico. |
| `GraphRevisionMaterialSchema` | `GraphRevisionMaterial` | Contenido base antes de calcular el digest de la revisión. |
| `ResourceClaimSchema` | `ResourceClaim` | Declaración de acceso (`observe` o `modify`) sobre un recurso. |
| `ArtifactRequirementSchema` | `ArtifactRequirement` | Dependencia estricta de artefacto entre productor y consumidor. |
| `SeamBindingSchema` | `SeamBinding` | Vinculación de contrato de interfaz entre nodos. |
| `RuntimeLeaseClaimSchema` | `RuntimeLeaseClaim` | Reclamo de lease temporal de ejecución. |
| `LegacyGraphRevisionV2Schema` | `LegacyGraphRevisionV2` | Modelo transicional V2 con `topologicalLevel` por nodo. |
| `TaskGraphSchema` | `TaskGraph` | Modelo V1 histórico para reproducibilidad de runs antiguos. |

---

### Funciones Principales

| Función | Firma / Parámetros | Propósito |
|---|---|---|
| `buildGraphRevision` | `(material: GraphRevisionMaterial, hasher: DigestHasher): GraphRevision` | Construye una revisión inmutable con normalización y digest SHA-256. |
| `validateGraphRevision` | `(input: unknown, options?: ValidateGraphRevisionOptions): GraphRevisionFinding[]` | Valida aciclicidad, consistencia jerárquica, flujo de artefactos y no colisión de escritores. |
| `validateGraphRevisionTransition` | `(previous: GraphRevision, next: GraphRevision): GraphRevisionFinding[]` | Verifica evolución monotónica e identidad diferenciada entre revisiones. |
| `checkResourceAuthority` | `(input: CheckResourceAuthorityInput): ResourceAuthorityViolation[]` | Valida que las rutas modificadas estén respaldadas por reclamos `modify` válidos. |
| `computeLegacyGraphRevisionV2TopologicalLevels` | `(graph: LegacyGraphRevisionV2): Record<string, number>` | Calcula niveles topológicos presentacionales (longest path) para grafos V2. |
| `readGraphRevision` | `(input: unknown, hasher: DigestHasher): GraphRevisionRead` | Reader polimórfico unificado capaz de parsear modelos canónicos o legacy. |
| `graftSubtree` | `(params: GraftSubtreeParams): GraftSubtreeResult` | Injerta un subárbol replanificado preservando bordes externos. |

---

### Ejemplos de Uso

#### 1. Construcción y Validación de una `GraphRevision` Canónica

```typescript
import {
  buildGraphRevision,
  validateGraphRevision,
  type GraphRevisionMaterial
} from "@manyhands/task-graph";
import { createHash } from "node:crypto";

const hasher = (json: string) => createHash("sha256").update(json).digest("hex");

const material: GraphRevisionMaterial = {
  graphId: "graph-run-101",
  revision: 1,
  semanticPlan: {
    id: "plan-auth-101",
    revision: 1,
    digest: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0"
  },
  repositoryView: {
    digest: "view-snap-1",
    treeSha: "7d793037a076ec159700504dc712d96cf6717a0c",
    resourceCatalogDigest: "cat-digest-1"
  },
  rootId: "node-root",
  nodes: {
    "node-root": {
      id: "node-root",
      parentId: null,
      kind: "root",
      title: "Auth Subsystem",
      goal: "Build authentication and token verification",
      contractRef: { id: "contract-root", revision: 1, digest: "d1..." }
    },
    "node-leaf-1": {
      id: "node-leaf-1",
      parentId: "node-root",
      kind: "leaf",
      title: "JWT Core",
      goal: "Implement JWT signing",
      contractRef: { id: "contract-jwt", revision: 1, digest: "d2..." }
    }
  },
  artifactRequirements: [],
  seamBindings: [],
  resourceClaims: [
    {
      id: "claim-jwt-write",
      nodeId: "node-leaf-1",
      resourceId: "packages/auth/src/jwt.ts",
      source: "compiler",
      access: "modify",
      ownerPhase: "implementation",
      inputVersion: { kind: "repository_view", digest: "view-snap-1" },
      outputArtifact: { id: "artifact-jwt-code", revision: 1, digest: "d3..." },
      evidenceRefs: [],
      epistemic: { state: "known", confidence: "high", evidenceRefs: ["ev-1"] }
    }
  ],
  runtimeLeaseClaims: [],
  contractRefs: [
    { id: "contract-root", revision: 1, digest: "d1..." },
    { id: "contract-jwt", revision: 1, digest: "d2..." },
    { id: "artifact-jwt-code", revision: 1, digest: "d3..." }
  ]
};

// Construye la revisión canónica
const graphRevision = buildGraphRevision(material, hasher);

// Ejecuta la validación exhaustiva de invariantes
const findings = validateGraphRevision(graphRevision, { hasher });
if (findings.length === 0) {
  console.log("GraphRevision válida. Digest:", graphRevision.digest);
} else {
  console.error("Hallazgos de validación:", findings);
}
```

#### 2. Verificación de Autoridad sobre Recursos en un Intento

```typescript
import {
  checkResourceAuthority,
  describeResourceAuthorityViolations
} from "@manyhands/task-graph";

const violations = checkResourceAuthority({
  nodeId: "node-leaf-1",
  resourceClaims: [
    {
      id: "claim-1",
      nodeId: "node-leaf-2", // Reclamado por leaf-2, NO por leaf-1
      resourceId: "packages/auth/src/session.ts",
      access: "modify",
      inputVersion: { kind: "snapshot_base" },
      outputArtifact: { id: "art-session", revision: 1, digest: "abc" },
      evidenceRefs: [],
      epistemic: { state: "known", confidence: "high", evidenceRefs: ["ev-1"] }
    }
  ],
  artifactContracts: [
    {
      id: "art-session",
      producerNodeId: "node-leaf-2",
      expectedPaths: ["packages/auth/src/session.ts"]
    }
  ],
  changedPaths: [
    "packages/auth/src/jwt.ts",
    "packages/auth/src/session.ts" // Mutación no autorizada para leaf-1
  ]
});

if (violations.length > 0) {
  console.error(describeResourceAuthorityViolations(violations));
  // Imprime: ownership_violation: node-leaf-1 wrote resources it does not claim: packages/auth/src/session.ts is owned by node-leaf-2...
}
```

---

## Estado de Transición y Brechas Arquitectónicas

De acuerdo con el plan canónico de rediseño (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Modelo Target Canónico (`canonical-graph.ts`, `relations.ts`, `resource-authority.ts`)**:
   - Representa la arquitectura definitiva: inmutable, basada en `GraphRevision`, con relaciones tipadas y verificación de autoridad.
2. **Modelo Transicional V2 (`validate-v2.ts`, `topological-level.ts`)**:
   - `LegacyGraphRevisionV2Schema` se mantiene temporalmente para interoperar con clientes UI y reductores que esperan `topologicalLevel` embedeado en los nodos.
3. **Reader Polimórfico de Compatibilidad (`compatibility-reader.ts`)**:
   - `readGraphRevision` detecta automáticamente si la entrada es un `GraphRevision` canónico, un `LegacyGraphRevisionV2` o un `TaskGraph` plano V1, proveyendo una interfaz de lectura unificada (`GraphRevisionRead`).
   - Esto permite migrar los componentes consumidores progresivamente sin requerir migraciones destructivas de la base de datos de runs históricos.

---

## Comandos de Verificación y Testing

Para verificar el tipado estricto y compilar el paquete:

```bash
# Verificación de tipos TypeScript
pnpm --filter @manyhands/task-graph typecheck

# Compilación y generación de bundles (.js, .cjs, .d.ts) con tsup
pnpm --filter @manyhands/task-graph build

# Ejecución de tests unitarios del paquete
pnpm test packages/task-graph
```
