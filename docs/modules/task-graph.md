# Guía Arquitectónica: @manyhands/task-graph

> **Ubicación en el Monorepo**: `packages/task-graph/`  
> **README del Paquete**: [`../../packages/task-graph/README.md`](../../packages/task-graph/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas convencionales de orquestación de agentes y pipelines de compilación, los grafos de tareas suelen representarse como grafos dirigidos acíclicos (DAG) donde las aristas son simples dependencias booleanas opacas ($A \to B$) o barreras rígidas por "fases". Este enfoque resulta insuficiente en la ingeniería de software multi-agente por tres razones:
1. **Falta de Semántica de Datos**: Una arista booleana no indica *qué artefacto* o *qué interfaz* requiere $B$ de $A$, impidiendo el paralelismo temprano cuando las dependencias reales ya están satisfechas.
2. **Confusión entre Alcance Físico y Autoridad de Modificación**: Permitir que un agente acceda a una carpeta no significa que deba tener autorización para modificar cualquier archivo dentro de ella sin supervisión.
3. **Imposibilidad de Replanificación Local Segura**: Modificar una parte del grafo suele implicar la invalidación total del estado de ejecución.

**`@manyhands/task-graph`** resuelve estos problemas proporcionando el modelo inmutable del grafo de tareas canónico (`GraphRevision`), relaciones tipadas de dominio, verificación estricta de autoridad sobre recursos (`checkResourceAuthority`) y algoritmos de injerto de subárboles (`graftSubtree`).

### Problemas Fundamentales que Resuelve

- **Grafo Semántico Canónico (`GraphRevision`)**: Modela el grafo resultante de la compilación directa de un `SemanticPlan` (en `@manyhands/decomposer`), asociando cada nodo a contratos formales.
- **Autoridad de Modificación de Recursos (`checkResourceAuthority`)**: Desacopla el *scope envolvente* de la *titularidad de edición*. Un nodo solo puede alterar archivos si posee un reclamo explícito `modify` sobre ese recurso.
- **Relaciones Tipadas de Dominio**: Reemplaza aristas opacas por requisitos concretos de artefactos (`ArtifactRequirement`), enlaces de costura (`SeamBinding`) y reclamos de exclusividad (`ResourceClaim`, `RuntimeLeaseClaim`).
- **Scheduling Continuo**: Provee la base estructural para que el scheduler evalúe continuamente la disponibilidad de artefactos sin esperar a que concluya una "capa" completa de nodos.
- **Replanificación por Injerto (`graftSubtree`)**: Permite sustituir una rama o nodo compuesto fallido por una nueva descomposición sin destruir los nodos completados en ramas hermanas.

---

## 2. Arquitectura Interna y Componentes

El paquete está constituido por 10 módulos TypeScript en `src/`:

```
packages/task-graph/src/
├── index.ts                     # Barrel export central de tipos y funciones
├── canonical-graph.ts           # GraphRevisionSchema, CanonicalTaskNode, buildGraphRevision, validadores
├── resource-authority.ts        # checkResourceAuthority y descriptores de violaciones de titularidad
├── topological-level.ts         # computeLegacyGraphRevisionV2TopologicalLevels para layout en canvas
├── graph-reducer.ts             # Reductor funcional de estados de nodo para UI
├── relations.ts                 # Esquemas de ResourceClaim, ArtifactRequirement, SeamBinding
├── compatibility-reader.ts      # Reader polimórfico unificado (lee GraphRevision canónico o V2/V1)
├── legacy-adapter.ts            # Adaptadores para transformación de grafos históricos a V2
├── validate-v2.ts               # Batería de validación de invariantes para LegacyGraphRevisionV2
└── graph-revision.ts            # Definición complementaria de revisiones de grafo
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `canonical-graph.ts` | Define el modelo inmutable del grafo (`CanonicalTaskNode`, `GraphRevisionSchema`), el constructor determinista `buildGraphRevision` y los validadores estructurales (`validateGraphRevision`, `validateGraphRevisionTransition`). |
| `resource-authority.ts` | Implementa `checkResourceAuthority`, verificando que los archivos tocados por un intento correspondan a artefactos vinculados a un reclamo `modify` legítimo. |
| `topological-level.ts` | Provee `computeLegacyGraphRevisionV2TopologicalLevels` para calcular niveles topológicos presentacionales (*longest path*) para el canvas de UI en `apps/web`. |
| `compatibility-reader.ts` | Expone `readGraphRevision` y `readLegacyGraphForCompatibility`, permitiendo que el runtime y la interfaz web consuman modelos modernos o históricos sin duplicar lógica. |
| `relations.ts` | Exporta los esquemas de relaciones tipadas: `ResourceClaimSchema`, `RuntimeLeaseClaimSchema`, `ArtifactRequirementSchema` y `SeamBindingSchema`. |
| `graph-reducer.ts` | Provee funciones puras de reducción y actualización de estados del grafo ante eventos del ciclo de vida. |
| `validate-v2.ts` | Ejecuta validaciones exhaustivas sobre grafos intermedios V2 (detección de ciclos, verificación de interfaces huérfanas, consistencia jerárquica). |
| `index.ts` | Exporta utilidades de readiness (`getLeafReadiness`, `getReadyLeaves`), agregación de estados (`aggregateTaskStatus`) y la función de injerto `graftSubtree`. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama muestra cómo interactúa `@manyhands/task-graph` con el planificador, el motor de ejecución y el scheduler:

```
  @manyhands/decomposer (Direct Plan Compiler)
                     │
                     ▼
          ┌─────────────────────┐
          │ buildGraphRevision  │  (Generación determinista + Digest SHA-256)
          └──────────┬──────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │    GraphRevision    │ ◄─── (Inmutable en memoria / persistida en run-store)
          └──────────┬──────────┘
                     │
         ┌───────────┴───────────────────────┐
         ▼                                   ▼
┌──────────────────┐               ┌──────────────────┐
│ @manyhands/      │               │ @manyhands/      │
│ scheduler        │               │ orchestrator-    │
│ (selectFrontier) │               │ graph (Driver)   │
└────────┬─────────┘               └────────┬─────────┘
         │                                  │
         │  (Nodos Listos para Despacho)    │
         └─────────────────┬────────────────┘
                           │
                           ▼
              ┌──────────────────────────┐
              │  checkResourceAuthority  │  (Verificación de Titularidad antes de Commit)
              └────────────┬─────────────┘
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
           [Sin Violación]      [Violación Detectada]
                 │                   │
                 ▼                   ▼
           Adopción de         Rechazo con
            Artefacto          ownership_violation
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Schemas Zod y Tipos Principales

| Schema Zod | Tipo TypeScript | Propósito |
|---|---|---|
| `CanonicalTaskNodeSchema` | `CanonicalTaskNode` | Nodo inmutable canónico (`id`, `parentId`, `kind`, `title`, `goal`, `contractRef`). |
| `GraphRevisionSchema` | `GraphRevision` | Revisión completa e inmutable del grafo con digest canónico. |
| `ResourceClaimSchema` | `ResourceClaim` | Declaración de acceso (`observe` o `modify`) sobre un recurso del repositorio. |
| `ArtifactRequirementSchema` | `ArtifactRequirement` | Dependencia estricta de artefacto entre nodo productor y consumidor. |
| `SeamBindingSchema` | `SeamBinding` | Vinculación de contrato de interfaz compartida entre nodos. |
| `RuntimeLeaseClaimSchema` | `RuntimeLeaseClaim` | Reclamo de lease temporal de ejecución (exclusivo o compartido). |
| `LegacyGraphRevisionV2Schema` | `LegacyGraphRevisionV2` | Modelo transicional V2 con `topologicalLevel` por nodo para renderizado en canvas. |

### Firmas de Funciones Fundamentales

```typescript
// 1. Construcción y Validación de Revisiones de Grafo
export function buildGraphRevision(
  material: GraphRevisionMaterial,
  hasher: DigestHasher
): GraphRevision;

export function validateGraphRevision(
  input: unknown,
  options?: ValidateGraphRevisionOptions
): GraphRevisionFinding[];

export function validateGraphRevisionTransition(
  previous: GraphRevision,
  next: GraphRevision
): GraphRevisionFinding[];

// 2. Comprobación de Autoridad sobre Recursos
export function checkResourceAuthority(input: {
  readonly nodeId: string;
  readonly resourceClaims: readonly ResourceClaim[];
  readonly artifactContracts: readonly ArtifactPathOwnership[];
  readonly changedPaths: readonly string[];
  readonly composedArtifactIds?: readonly string[];
}): ResourceAuthorityViolation[];

// 3. Reader Polimórfico Unificado
export function readGraphRevision(
  input: unknown,
  hasher: DigestHasher
): GraphRevisionRead;

// 4. Injerto de Subárboles para Replanificación
export function graftSubtree(params: GraftSubtreeParams): GraftSubtreeResult;

// 5. Cálculo Topológico para UI
export function computeLegacyGraphRevisionV2TopologicalLevels(
  graph: LegacyGraphRevisionV2
): Record<string, number>;
```

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Inmutabilidad Estricta de las Revisiones del Grafo (`GraphRevision`)
Un grafo en ManyHands nunca se modifica *in-place*. Cuando ocurre una replanificación o expansión:
- La función `buildGraphRevision(material, hasher)` normaliza arrays, elimina duplicados y genera un `digest` SHA-256 representativo del estado exacto.
- `validateGraphRevisionTransition(previous, next)` verifica que el `graphId` se conserve, que la `revision` aumente estrictamente en $+1$ y que el `digest` cambie reflejando la nueva identidad.

### 2. Separación entre Scope (Envolvente) y Resource Authority (Titularidad)
Existe una distinción crítica de seguridad en ManyHands:
- **`ScopeContract`**: Define el *bounding box* físico de paths donde el proceso sandbox puede operar. Por ejemplo, un nodo composite que integra 3 paquetes tiene un scope que abarca los 3 paquetes.
- **`checkResourceAuthority`**: Define la *titularidad de modificación*. Aunque el scope del composite abarque los archivos de sus hijos, el composite no tiene autoridad para editar directamente el código de un hijo a menos que posea un `ResourceClaim` con `access: "modify"` sobre ese recurso específico.
- Si un intento modifica un archivo reclamado por otro nodo, `checkResourceAuthority` emite una violación `ownership_violation`, impidiendo que un composite sobrescriba trabajo ajeno silenciosamente.

```typescript
export interface ResourceAuthorityViolation {
  readonly kind: "ownership_violation";
  readonly path: string;
  readonly ownedByNodeId: string;
  readonly attemptedByNodeId: string;
}
```

### 3. Relaciones Tipadas de Dominio vs. Aristas Genéricas
En lugar de aristas no tipadas $A \to B$, el grafo descompone las interacciones en 4 tipos de relaciones:
1. **Jerarquía Padre-Hijo (`nodes[id].parentId`)**: Define la estructura de composición (raíz $\to$ composites $\to$ hojas).
2. **Requisitos de Artefactos (`ArtifactRequirement`)**: Especifica qué contrato de artefacto produce un nodo y consume otro, y para qué fase se requiere (`execution` o `integration`).
3. **Enlaces de Costura (`SeamBinding`)**: Conecta los interfaces compartidos (`SeamContract`) y sus correspondientes obligaciones de validación entre productor y consumidor.
4. **Reclamos de Recursos (`ResourceClaim`)**: Registra la intención de lectura (`observe`) o modificación (`modify`) sobre un recurso del catálogo.

### 4. Niveles Topológicos Presentacionales vs. Frente Continuo
Para la visualización en el canvas React Flow (`apps/web`):
- `computeLegacyGraphRevisionV2TopologicalLevels` calcula la distancia en camino más largo (*longest path*) desde la raíz para ubicar los nodos visualmente en columnas o capas.
- **Principio Fundamental**: Este nivel topológico es **únicamente presentacional**. El scheduler no espera a que termine una "capa" completa; evalúa continuamente la disponibilidad de los `ArtifactRequirement`s para desbloquear nodos hoja en cuanto sus dependencias reales de datos están satisfechas.

### 5. Replanificación por Injerto de Subárboles (`graftSubtree`)
Cuando una rama del grafo requiere replanificación:
- `graftSubtree` elimina los descendientes anteriores del nodo objetivo.
- Conserva la identidad externa del nodo (`id`, `parentId`, `title`, `goal`).
- Adopta el nuevo subárbol asignando identificadores con namespace de revisión (`${taskId}-r${revision}-${id}`).
- Reasocia automáticamente los bordes de dependencia que apuntaban a los nodos descartados hacia el nodo objetivo, validando la aciclicidad del grafo resultante antes de retornar.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 1 / G1)**: El modelo canónico `GraphRevision`, las relaciones tipadas y `checkResourceAuthority` están cerrados y verificados con tests deterministas en Stage 1.
2. **Transición desde V2/V1**: Los grafos planos históricos V1 y V2 se mantienen mediante lectores polimórficos (`compatibility-reader.ts`) para reproducibilidad de corridas archivadas.
3. **Ruta Productiva Directa**: El compilador directo (`direct-plan-compiler.ts` en `@manyhands/decomposer`) genera directamente instancias de `GraphRevision` canónicas.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/task-graph/README.md`](../../packages/task-graph/README.md)
- **Módulos Relacionados**:
  - [`contracts.md`](./contracts.md): Schemas inmutables y contratos vinculados al grafo.
  - [`decomposer.md`](./decomposer.md): Compilación directa desde planes semánticos hacia revisiones de grafo.
  - [`scheduler.md`](./scheduler.md): Evaluación continua del frente ejecutable sobre `GraphRevision`.
  - [`orchestrator-graph.md`](./orchestrator-graph.md): Driver de ejecución de olas continuas sobre revisiones de grafo.
- **Documentación Central**: [`../README.md`](../README.md)
