# @manyhands/repository-index

Subsistema de fundamentación (*grounding*), modelado semántico exacto basado en objetos Git, catálogo de recursos con resolución de solapamientos e interfaz de consulta presupuestada con degradación epistémica en ManyHands.

---

## Propósito y Responsabilidad en ManyHands

En entornos de codificación asistida por inteligencia artificial, los modelos suelen cometer errores catastróficos cuando se les proporciona el código de tres maneras defectuosas:
1. **Volcados masivos no estructurados**: Enviar directorios enteros desborda la ventana de contexto y diluye la atención del modelo en detalles irrelevantes.
2. **Lectura volátil del sistema de archivos**: Leer directamente del disco durante una ejecución concurrente introduce condiciones de carrera y mezclas con archivos intermedios o sucios del *working tree*.
3. **Falsa sensación de seguridad epistémica**: Asumir que la falta de información o un archivo no encontrado equivale a "no existe riesgo de conflicto".

**`@manyhands/repository-index`** resuelve estos problemas constituyendo el subsistema de fundamentación (*grounding*) canónico de ManyHands. Transforma un snapshot exacto de Git en un modelo semántico estructurado (`RepositoryModel`), gestiona pilas inmutables de mutaciones sobre el código (`RepositoryView`), resuelve la contención y solapamiento de recursos (`ResourceCatalog`) y expone una interfaz de consulta acotada por presupuesto (`RepositoryQuery`) que reporta honestamente su grado de certeza epistémica.

---

## Arquitectura Modular Interna

El paquete está compuesto por 10 módulos TypeScript en `src/`:

```
packages/repository-index/src/
├── index.ts                 # Barrel export central, schemas Zod de indexación y TypeScriptRepositoryIndexer
├── repository-model.ts      # RepositoryModel exacto, inspección de blobs Git y AST TypeScript
├── resource-catalog.ts      # Catálogo de recursos, resolución de aliases, contención y solapamiento
├── repository-view.ts       # Composición inmutable de vistas con pilas de overlays de Git
├── repository-query.ts      # Interfaz de consulta presupuestada (search, neighborhood, tests, excerpts)
├── snapshot.ts              # RepositorySnapshotRecord, schemas de snapshot y detección de capacidades
├── fast-indexer.ts          # Indexador rápido basado en streaming con Ripgrep nativo y cache por commit
├── capabilities.ts          # Detección de stacks, scripts de validación, lenguajes y package managers
├── source-parser.ts         # Parser de código fuente TypeScript/JavaScript (símbolos, imports, exports)
└── identity.ts              # Generación determinista de IDs de hechos y hashing de digests
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `repository-model.ts` | Construye el modelo semántico inmutable `RepositoryModel` leyendo directamente los objetos blob de Git (`ls-tree`, `cat-file`). Extrae límites de paquetes (`PackageBoundary`), módulos (`ModuleBoundary`), símbolos (`RepositorySymbolRecord`), imports resueltos (`ImportRelationship`), firmas públicas vía TypeScript Compiler API (`PublicInterfaceRecord`), relaciones de tests (`TestRelationship`), comandos (`RepositoryCommandRecord`) y reportes de cobertura (`RepositoryCoverageReport`). |
| `resource-catalog.ts` | Implementa la clase `ResourceCatalog`. Mapea localizadores canónicos (`path:`, `package:`, `symbol:`, `module:`) a `CatalogResource`, resuelve aliases (renombrados, symlinks, re-exportaciones) y determina determinísticamente si dos unidades de trabajo se solapan (`overlaps: "yes" \| "no" \| "unknown"`). Permite directorios declarados (`origin: "declared"`) para archivos aún no creados. |
| `repository-view.ts` | Implementa la composición inmutable `composeRepositoryView`. Aplica una secuencia ordenada de capas de mutación (`RepositoryOverlay`) sobre un modelo base, validando preimágenes (`oldOid`, `oldMode`) y verificando que el árbol resultante coincida exactamente con `resultTreeSha`. |
| `repository-query.ts` | Provee la interfaz `RepositoryQuery` (`createRepositoryQuery`). Ejecuta consultas acotadas (`searchGoalTerms`, `inspectBoundary`, `dependencyNeighborhood`, `relatedSymbols`, `relatedTests`, `validationCapabilities`, `readExcerpts`) bajo límites estrictos de resultados, bytes y profundidad (`RepositoryQueryBudget`), degradando honestamente el estado epistémico ante truncamientos. |
| `snapshot.ts` | Define `RepositorySnapshotRecord` y el validador estricto `createRepositorySnapshotSchema`. Agrupa el hash del índice, capacidades del proyecto y diagnósticos bajo un identificador inmutable con prefijo `sha256:`. |
| `fast-indexer.ts` | Implementa `FastRepositoryIndexer`, que aprovecha el binario nativo de Ripgrep (`--files --hidden --null`) para enumeración ultra-rápida y mantiene un caché estructurado por commit Git invalidado por perfil (`INDEXER_PROFILE`). |
| `capabilities.ts` | Inspecciona el repositorio para descubrir herramientas disponibles: lenguajes (TypeScript, JavaScript), gestores de paquetes (pnpm, npm, yarn), frameworks y scripts de validación (test, typecheck, lint, build). |
| `source-parser.ts` | Analiza el AST de archivos TypeScript y JavaScript utilizando `typescript.createSourceFile` para extraer símbolos exportados, tipos declarados, imports y especificaciones de módulo. |
| `identity.ts` | Genera hashes deterministas (`repositoryDigest`) sobre JSON canónico y construye IDs universales para hechos del repositorio (`repositoryFactId`). |

---

## Patrones de Diseño y Estrategias Técnicas

### 1. Verdad Física Anclada en el Git Object Store

A diferencia de los indexadores convencionales que leen archivos del disco mediante `fs.readFile`, `RepositoryModel` opera directamente sobre los hashes SHA de objetos Git (`oid`, `treeSha`):
- Los archivos se leen vía `git cat-file -p <oid>` a través de un pool de concurrencia controlado (`mapWithConcurrency`).
- Esto garantiza que el modelo represente un estado histórico exacto e inmutable, totalmente inmune a modificaciones concurrentes en el *working tree* del usuario o de otros agentes.

```typescript
export interface RepositoryGitEntry {
  path: string;
  oid: string;
  mode: string;
  kind: "file" | "executable" | "symlink" | "gitlink";
}
```

### 2. Catálogo de Recursos y Resolución de Solapamientos (`ResourceCatalog`)

El `ResourceCatalog` es el árbitro fundamental para la seguridad del scheduler y la prevención de conflictos de concurrencia:
- **Indexación Jerárquica de Recursos**: Cada entidad posee un localizador canónico (`path:src/auth/service.ts`, `package:packages/core`, `symbol:src/user.ts#UserRecord`).
- **Rastreo de Aliases**: Registra alias originados por renombrados de archivos (`rename`), enlaces simbólicos (`symlink`) y re-exportaciones de paquetes (`package_export`).
- **Directorios Declarados (`origin: "declared"`)**: Si un plan prevé crear un archivo en un directorio nuevo que aún no existe en el árbol Git (`ls-tree`), el catálogo genera un recurso de tipo `declared`. Esto otorga autoridad sobre el nuevo path sin bloquear a otros módulos que operen en directorios disjuntos.
- **Operación `overlaps(left, right)`**: Retorna `"yes"`, `"no"` o `"unknown"`. Si el solapamiento no puede probarse con certeza (por ejemplo, si involucra un `gitlink` no inspeccionado o metadata corrupta), retorna `"unknown"`, lo que fuerza al planificador y al scheduler a actuar de forma conservadora (*fail-closed*).

### 3. Pilas Inmutables de Modificaciones (`RepositoryView` y `RepositoryOverlay`)

Cuando el planificador o el ejecutor simula o proyecta cambios, no muta el modelo original. Aplica una lista de `RepositoryOverlay`:

```typescript
export interface RepositoryOverlay {
  manifestDigest: string;
  baseTreeSha: string;
  resultTreeSha: string;
  entries: RepositoryOverlayEntry[]; // "add" | "modify" | "delete" | "type_change"
}
```

La función `composeRepositoryView` verifica que:
1. La preimagen de cada archivo modificado (`oldOid`, `oldMode`) coincida exactamente con el estado actual de la vista.
2. La aplicación de las entradas produzca un árbol idéntico a `resultTreeSha`.
3. Se generen alias automáticos para archivos renombrados y symlinks detectados.

### 4. Consultas Presupuestadas y Degradación Epistémica Honesta (`RepositoryQuery`)

El `PlanningEngine` nunca recibe un volcado completo del repositorio. Realiza preguntas específicas mediante `RepositoryQuery` suministrando un presupuesto estricto:

```typescript
export interface RepositoryQueryBudget {
  maxResults: number;  // Máximo de elementos a retornar
  maxBytes: number;    // Máximo de bytes acumulados en la respuesta
  maxDepth: number;    // Profundidad de búsqueda en el grafo de dependencias
}
```

#### Modelo Epistémico Formal (`EpistemicAssessment`)
Cada respuesta `RepositoryQueryAnswer` incluye una evaluación epistémica:
- **`known`**: Información completa y verificada con alta confianza.
- **`partial`**: La consulta fue truncada porque alcanzó `maxResults` o `maxBytes`, o porque el modelo base tiene cobertura parcial de parsers.
- **`unknown`**: No se halló evidencia o la referencia cae fuera del ámbito inspeccionado.
- **`conflicting`**: Existen múltiples recursos contradictorios para el mismo localizador.

**Principio de Honestidad Epistémica**: El sistema nunca oculta un truncamiento de resultados ni lo interpreta como "no hay más dependencias"; la respuesta se marca formalmente como `partial`, informando al planificador de la limitación para evitar asunciones de bajo riesgo erróneas.

### 5. Indexación Acelerada por Streaming con Ripgrep (`FastRepositoryIndexer`)

Para proyectos grandes con decenas de miles de archivos, `FastRepositoryIndexer` utiliza Ripgrep nativo invocando `rg --files --hidden --glob !.git --null`.
- El resultado se analiza extrayendo únicamente las firmas exportadas y métricas de tamaño (`byteSize`, `lineCount`), necesarias para la política de granularidad.
- Los resultados se almacenan en un caché atómico en disco invalidado por el hash del commit Git y la constante `INDEXER_PROFILE = "exports-only-v2-size-metrics-baseline-without-pm"`.

---

## Puntos de Entrada, Interfaces y Schemas Clave

### Catálogo de Interfaces y Funciones Principales

| Símbolo | Tipo / Firma | Propósito |
|---|---|---|
| `inspectRepositoryModel` | `(input: InspectRepositoryModelInput) => Promise<RepositoryModel>` | Inspecciona un snapshot Git y construye el modelo semántico completo. |
| `inspectRepositoryModelWithSnapshot` | `(input: InspectRepositoryModelInput) => Promise<RepositoryModelInspection>` | Retorna conjuntamente el `RepositorySnapshot` y el `RepositoryModel`. |
| `composeRepositoryView` | `(input: ComposeRepositoryViewInput) => Promise<RepositoryView>` | Compone vistas inmutables aplicando capas de `RepositoryOverlay` sobre un modelo. |
| `createRepositoryQuery` | `(input: { rootPath, view, gitPath? }) => RepositoryQuery` | Fábrica de la interfaz de consulta presupuestada para el planificador. |
| `ResourceCatalog` | `class ResourceCatalog` | Catálogo de recursos con resolución de nombres, vecindarios y solapamiento (`overlaps`). |
| `buildResourceCatalog` | `(input: { model: RepositoryModel; repositoryContentDigest: string; aliases?: readonly ResourceAliasInput[] }) => ResourceCatalog` | Constructor canónico del catálogo a partir de un `RepositoryModel`. |
| `FastRepositoryIndexer` | `class FastRepositoryIndexer implements RepositoryIndexer` | Indexador de alto rendimiento basado en Ripgrep nativo y caché por commit. |
| `TypeScriptRepositoryIndexer`| `class TypeScriptRepositoryIndexer implements RepositoryIndexer` | Indexador estructurado basado en recorrido del sistema de archivos y parsing AST. |
| `RepositoryIndexSchema` | `ZodSchema<RepositoryIndex>` | Schema Zod del índice serializado (archivos, símbolos, imports, exports). |
| `RepositorySnapshotSchema`| `ZodSchema<RepositorySnapshotRecord>` | Schema Zod del registro inmutable de snapshot del repositorio. |

---

### Ejemplos de Uso

#### 1. Inspección de Repositorio y Construcción del `RepositoryModel`

```typescript
import {
  inspectRepositoryModelWithSnapshot,
  type InspectRepositoryModelInput,
  type RepositoryModelInspection
} from "@manyhands/repository-index";

const input: InspectRepositoryModelInput = {
  rootPath: "/path/to/project",
  repositoryId: "my-service",
  targetFingerprint: "target:my-service@v1.0.0",
  baseCommit: "a1b2c3d4e5f678901234567890abcdef12345678"
};

const { snapshot, model }: RepositoryModelInspection = await inspectRepositoryModelWithSnapshot(input);

console.log("Snapshot ID:", snapshot.snapshotId);
console.log("Tree SHA:", model.treeSha);
console.log("Paquetes detectados:", model.packages.map((pkg) => pkg.name));
console.log("Módulos indexados:", model.modules.length);
console.log("Símbolos públicos extraídos:", model.publicInterfaces.length);
console.log("Comandos de validación:", model.commands.map((cmd) => cmd.name));
```

#### 2. Composición de Vistas Inmutables con Overlays (`composeRepositoryView`)

```typescript
import {
  composeRepositoryView,
  type RepositoryOverlay,
  type RepositoryView
} from "@manyhands/repository-index";

// Definir una mutación proyectada sobre el árbol
const overlay: RepositoryOverlay = {
  manifestDigest: "sha256:manifest-change-auth",
  baseTreeSha: model.treeSha,
  resultTreeSha: "b2c3d4e5f6a78901234567890abcdef123456789",
  entries: [
    {
      operation: "add",
      newPath: "src/auth/token.ts",
      newOid: "c3d4e5f6a7b8901234567890abcdef1234567890",
      newMode: "100644"
    }
  ]
};

const view: RepositoryView = await composeRepositoryView({
  rootPath: "/path/to/project",
  inspection: { snapshot, model },
  overlays: [overlay]
});

console.log("View Digest:", view.digest);
console.log("Nuevo Tree SHA:", view.treeSha);
console.log("Manifiestos aplicados:", view.appliedManifestDigests);
```

#### 3. Consultas Presupuestadas al Repositorio (`RepositoryQuery`)

```typescript
import {
  createRepositoryQuery,
  type RepositoryQuery,
  type RepositoryQueryBudget
} from "@manyhands/repository-index";

const query: RepositoryQuery = createRepositoryQuery({
  rootPath: "/path/to/project",
  view
});

const budget: RepositoryQueryBudget = {
  maxResults: 5,
  maxBytes: 2048,
  maxDepth: 2
};

// Búsqueda orientada por términos del objetivo
const searchResult = query.searchGoalTerms(["auth", "login", "jwt"], budget);
console.log("Elementos encontrados:", searchResult.items.map((i) => i.locator));
console.log("¿Respuesta truncada?:", searchResult.truncated);
console.log("Estado epistémico:", searchResult.epistemic.state); // "known" | "partial"

// Vecindario de dependencias
const dependencies = query.dependencyNeighborhood("module:src/auth/service.ts", budget);
console.log("Módulos vinculados:", dependencies.items.map((i) => i.locator));

// Lectura acotada de código fuente exacto desde Git
const excerpts = await query.readExcerpts(["path:src/auth/service.ts"], {
  maxResults: 1,
  maxBytes: 1024,
  maxDepth: 0
});
console.log("Texto del fragmento:\n", excerpts.items[0]?.text);
```

#### 4. Determinación de Solapamiento de Recursos en el Catálogo

```typescript
import { type ResourceCatalog, type ResourceOverlap } from "@manyhands/repository-index";

const catalog: ResourceCatalog = view.catalog;

// Consultar si dos rutas o símbolos se solapan
const overlap1: ResourceOverlap = catalog.overlaps("path:src/auth/model.ts", "path:src/auth/model.ts");
console.log(overlap1); // "yes" (mismo recurso)

const overlap2: ResourceOverlap = catalog.overlaps("path:src/auth/model.ts", "path:src/payment/gateway.ts");
console.log(overlap2); // "no" (paths disjuntos)

const overlap3: ResourceOverlap = catalog.overlaps("path:src/auth/model.ts", "path:submodule/repo");
console.log(overlap3); // "unknown" si involucra un gitlink no inspeccionado
```

---

## Estado de Transición y Brechas Arquitectónicas

En concordancia con el plan normativo [`docs/plans/2026-08-12-correctness-first-system-redesign.md`](../../docs/plans/2026-08-12-correctness-first-system-redesign.md) (Etapa 4 / GRepo):

| Componente | Estado Canónico (Target) | Estado Actual en el Código | Observaciones de Transición |
|---|---|---|---|
| **Modelo de Repositorio** (`RepositoryModel`) | Modelo semántico exacto anclado a hashes de objetos Git. | **Completo (100%)** | Implementado en `src/repository-model.ts`. Cubierto por `tests/repository-model-view.test.ts`. |
| **Catálogo de Recursos** (`ResourceCatalog`) | Resolución de solapamientos (`overlaps`), aliases y contención. | **Completo (100%)** | Implementado en `src/resource-catalog.ts`. Cubierto por `tests/repository-resource-catalog.test.ts`. |
| **Vistas y Overlays** (`RepositoryView`) | Composición inmutable de capas de mutación con validación de preimagen. | **Completo (100%)** | Implementado en `src/repository-view.ts`. |
| **Consultas Presupuestadas** (`RepositoryQuery`) | Búsqueda acotada con degradación epistémica honesta (`EpistemicAssessment`). | **Completo (100%)** | Implementado en `src/repository-query.ts`. Cubierto por `tests/repository-query.test.ts`. |
| **Indexadores de Compatibilidad** | `TypeScriptRepositoryIndexer` y `FastRepositoryIndexer` | **Operativos al 100%** | Coexisten para alimentar los snapshots rápidos del runtime y el tooling de visualización. |

---

## Comandos de Verificación y Testing

Para compilar, validar tipos y ejecutar la suite de pruebas de `@manyhands/repository-index`:

```bash
# Verificación estática de tipos TypeScript
pnpm --filter @manyhands/repository-index typecheck

# Compilación del paquete con tsup
pnpm --filter @manyhands/repository-index build

# Ejecución de la suite completa de Stage 4 (Model, View, Catalog y Query)
pnpm test tests/repository-query.test.ts tests/repository-model-view.test.ts tests/repository-resource-catalog.test.ts tests/repository-fast-indexer.test.ts tests/repository-snapshot.test.ts
```
