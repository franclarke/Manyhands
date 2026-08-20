# Guía Arquitectónica: @manyhands/repository-index

> **Ubicación en el Monorepo**: `packages/repository-index/`  
> **README del Paquete**: [`../../packages/repository-index/README.md`](../../packages/repository-index/README.md)  
> **Índice de Módulos Central**: [`../README.md`](../README.md)  
> **Plan Normativo de Referencia**: [`../plans/2026-08-12-correctness-first-system-redesign.md`](../plans/2026-08-12-correctness-first-system-redesign.md)

---

## 1. Visión General y Propósito del Subsistema

En sistemas de desarrollo de software asistido por inteligencia artificial, los modelos suelen cometer errores críticos cuando se les expone el código de tres maneras defectuosas:
1. **Volcados Masivos no Estructurados**: Enviar árboles completos de archivos desborda el contexto y diluye la atención del modelo en detalles irrelevantes.
2. **Lectura Volátil del Disco**: Leer directamente del sistema de archivos durante ejecuciones concurrentes introduce carreras con archivos intermedios o temporales del *working tree*.
3. **Falsa Seguridad Epistémica**: Tratar la ausencia de información como prueba de que no existen riesgos de conflicto.

**`@manyhands/repository-index`** resuelve estos problemas constituyendo el subsistema de **fundamentación (*grounding*)** canónico de ManyHands. Transforma un snapshot exacto de Git en un modelo semántico estructurado (`RepositoryModel`), gestiona pilas inmutables de mutaciones sobre el código (`RepositoryView`), resuelve la contención y solapamiento de recursos (`ResourceCatalog`) y expone una interfaz de consulta acotada por presupuesto (`RepositoryQuery`) que reporta honestamente su grado de certeza epistémica.

### Problemas Fundamentales que Resuelve

- **Verdad Física Anclada en Objetos Git**: Lee directamente los blobs y árboles de Git (`ls-tree`, `cat-file`), garantizando un estado inmutable e inmune a archivos sucios en el workspace.
- **Catálogo Jerárquico de Recursos (`ResourceCatalog`)**: Mapea localizadores canónicos (`path:`, `package:`, `symbol:`, `module:`), resuelve aliases (renombrados, symlinks, re-exportaciones) y determina determinísticamente si dos unidades de trabajo se solapan (`overlaps`).
- **Composición Inmutable de Vistas (`RepositoryView`)**: Permite simular y proyectar parches y artefactos adoptados aplicando capas (`RepositoryOverlay`) sin mutar el modelo base.
- **Consultas Presupuestadas con Degradación Epistémica Honesta (`RepositoryQuery`)**: Acota resultados por bytes, cantidad y profundidad, marcando formalmente como `partial` cualquier respuesta truncada para evitar que el planificador asuma falsas independencias.
- **Indexación Acelerada por Streaming con Ripgrep (`FastRepositoryIndexer`)**: Aprovecha el binario nativo de Ripgrep para indexar repositorios grandes en milisegundos con caché por commit.

---

## 2. Arquitectura Interna y Componentes

El paquete está compuesto por 10 módulos TypeScript en `src/`:

```
packages/repository-index/src/
├── index.ts                 # Barrel export central, schemas Zod y TypeScriptRepositoryIndexer
├── repository-model.ts      # RepositoryModel exacto, inspección de blobs Git y AST TypeScript
├── resource-catalog.ts      # Catálogo de recursos, resolución de aliases, contención y solapamiento
├── repository-view.ts       # Composición inmutable de vistas con pilas de overlays de Git
├── repository-query.ts      # Interfaz de consulta presupuestada (search, neighborhood, tests, excerpts)
├── snapshot.ts              # RepositorySnapshotRecord, schemas de snapshot y capacidades
├── fast-indexer.ts          # Indexador rápido basado en streaming con Ripgrep nativo y cache por commit
├── capabilities.ts          # Detección de stacks, scripts de validación, lenguajes y package managers
├── source-parser.ts         # Parser de código fuente TypeScript/JavaScript (símbolos, imports, exports)
└── identity.ts              # Generación determinista de IDs de hechos y hashing de digests
```

### Desglose de Responsabilidades por Módulo

| Módulo | Responsabilidad Principal |
|---|---|
| `repository-model.ts` | Construye el modelo semántico inmutable `RepositoryModel` leyendo directamente los objetos blob de Git. Extrae límites de paquetes (`PackageBoundary`), módulos (`ModuleBoundary`), símbolos (`RepositorySymbolRecord`), imports resueltos (`ImportRelationship`), firmas públicas vía TypeScript Compiler API (`PublicInterfaceRecord`), relaciones de tests y reportes de cobertura. |
| `resource-catalog.ts` | Implementa la clase `ResourceCatalog`. Mapea localizadores a `CatalogResource`, resuelve aliases (renombrados, symlinks, re-exportaciones) y computa `overlaps(left, right)` de forma determinista. Permite recursos declarados (`origin: "declared"`) para archivos planificados aún no creados. |
| `repository-view.ts` | Implementa `composeRepositoryView`. Aplica una secuencia ordenada de capas de mutación (`RepositoryOverlay`) sobre un modelo base, verificando preimágenes (`oldOid`) y comprobando el hash resultante (`resultTreeSha`). |
| `repository-query.ts` | Provee la interfaz `RepositoryQuery` (`createRepositoryQuery`). Ejecuta consultas acotadas (`searchGoalTerms`, `inspectBoundary`, `dependencyNeighborhood`, `relatedSymbols`, `relatedTests`, `validationCapabilities`, `readExcerpts`) bajo un presupuesto estricto (`RepositoryQueryBudget`). |
| `snapshot.ts` | Define `RepositorySnapshotRecord` y el validador estricto `createRepositorySnapshotSchema`, asociando el hash del índice y diagnósticos a un identificador inmutable con prefijo `sha256:`. |
| `fast-indexer.ts` | Implementa `FastRepositoryIndexer`, que invoca el binario nativo de Ripgrep (`--files --hidden --null`) para enumeración ultra-rápida con caché por commit invalidado por perfil. |
| `capabilities.ts` | Inspecciona el repositorio para descubrir herramientas disponibles: lenguajes, gestores de paquetes y scripts de validación (`test`, `typecheck`, `lint`, `build`). |
| `source-parser.ts` | Analiza el AST de archivos TypeScript/JavaScript utilizando `typescript.createSourceFile` para extraer símbolos exportados, tipos declarados e imports. |

---

## 3. Flujos de Control y Datos

El siguiente diagrama ilustra la construcción del modelo desde Git y su exposición al motor de planificación:

```
                    Git Object Database (treeSha / commitSha)
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │   inspectRepositoryModel  │
                         │  (git ls-tree / cat-file) │
                         └─────────────┬─────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │      RepositoryModel      │  (Inmutable)
                         └─────────────┬─────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
      ┌───────────────────────────┐         ┌───────────────────────────┐
      │      ResourceCatalog      │         │   composeRepositoryView   │
      │ • Localizadores canónicos │         │ • Aplica RepositoryOverlay│
      │ • Resolución de Aliases   │         │ • Valida preimágenes OID  │
      │ • overlaps(left, right)   │         └─────────────┬─────────────┘
      └─────────────┬─────────────┘                       │
                    │                                     ▼
                    │                       ┌───────────────────────────┐
                    │                       │      RepositoryView       │
                    │                       └─────────────┬─────────────┘
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       ▼
                         ┌───────────────────────────┐
                         │    createRepositoryQuery  │
                         │  (Budget-Constrained API) │
                         └─────────────┬─────────────┘
                                       │
                        Consultas Presupuestadas con
                        Degradación Epistémica Honesta
                                       │
                                       ▼
                            @manyhands/decomposer
                              (PlanningEngine)
```

---

## 4. Interfaces Públicas, Schemas y Tipos Clave

### Estructura de Consultas y Presupuesto

```typescript
export interface RepositoryQueryBudget {
  readonly maxResults: number;  // Máximo de elementos a retornar
  readonly maxBytes: number;    // Máximo acumulado de bytes en la respuesta
  readonly maxDepth: number;    // Profundidad de búsqueda en el grafo de dependencias
}

export interface RepositoryQueryAnswer<T> {
  readonly data: T;
  readonly assessment: EpistemicAssessment; // "known" | "partial" | "unknown" | "conflicting"
  readonly bytesUsed: number;
  readonly budgetExhausted: boolean;
}
```

### Catálogo de Funciones Principales

| Función / Clase | Firma | Propósito |
|---|---|---|
| `inspectRepositoryModel` | `(input: InspectRepositoryModelInput) => Promise<RepositoryModel>` | Inspecciona un snapshot Git y construye el modelo semántico completo. |
| `inspectRepositoryModelWithSnapshot` | `(input: InspectRepositoryModelInput) => Promise<RepositoryModelInspection>` | Retorna conjuntamente el `RepositorySnapshot` y el `RepositoryModel`. |
| `composeRepositoryView` | `(input: ComposeRepositoryViewInput) => Promise<RepositoryView>` | Compone vistas inmutables aplicando capas de `RepositoryOverlay` sobre un modelo. |
| `createRepositoryQuery` | `(input: { rootPath, view, gitPath? }) => RepositoryQuery` | Fábrica de la interfaz de consulta presupuestada para el planificador. |
| `ResourceCatalog` | `class ResourceCatalog` | Catálogo de recursos con resolución de nombres, vecindarios y solapamiento (`overlaps`). |
| `buildResourceCatalog` | `(input: BuildResourceCatalogInput) => ResourceCatalog` | Constructor canónico del catálogo a partir de un `RepositoryModel`. |
| `FastRepositoryIndexer` | `class FastRepositoryIndexer implements RepositoryIndexer` | Indexador de alto rendimiento basado en Ripgrep nativo y caché por commit. |

---

## 5. Patrones de Diseño y Estrategias Técnicas

### 1. Inmutabilidad Basada en el Git Object Store
A diferencia de los indexadores que leen el sistema de archivos mediante `fs.readFile`, `RepositoryModel` opera directamente sobre los hashes SHA de objetos Git (`oid`, `treeSha`):
- Los archivos se leen vía `git cat-file -p <oid>` a través de un pool de concurrencia controlado (`mapWithConcurrency`).
- Esto garantiza que el modelo represente un estado histórico exacto e inmutable, totalmente aislado de modificaciones concurrentes en el *working tree*.

### 2. Catálogo de Recursos y Detección de Solapamiento (`ResourceCatalog`)
El `ResourceCatalog` es el árbitro fundamental para la seguridad del scheduler y la prevención de colisiones:
- **Indexación Jerárquica**: Cada entidad posee un localizador canónico (`path:src/auth/jwt.ts`, `package:packages/contracts`, `symbol:src/user.ts#UserRecord`).
- **Rastreo de Aliases**: Registra alias originados por renombrados de archivos (`rename`), enlaces simbólicos (`symlink`) y re-exportaciones de paquetes (`package_export`).
- **Directorios Declarados (`origin: "declared"`)**: Si un plan prevé crear un archivo en un directorio nuevo que aún no existe en el árbol Git, el catálogo genera un recurso de tipo `declared`. Esto otorga autoridad sobre el nuevo path sin bloquear a otros módulos que operen en directorios disjuntos.
- **Operación `overlaps(left, right)`**: Retorna `"yes"`, `"no"` o `"unknown"`. Si el solapamiento no puede probarse con certeza, retorna `"unknown"`, forzando al planificador y al scheduler a actuar en modo cerrado (*fail-closed*).

### 3. Pilas Inmutables de Mutaciones (`RepositoryView` y `RepositoryOverlay`)
Cuando el planificador o el ejecutor simula o proyecta cambios, no muta el modelo original. Aplica una lista ordenada de `RepositoryOverlay`:
- La función `composeRepositoryView` verifica que la preimagen de cada archivo modificado (`oldOid`, `oldMode`) coincida exactamente con el estado actual de la vista.
- Verifica que la aplicación de las entradas produzca un árbol idéntico a `resultTreeSha`.

### 4. Consultas Presupuestadas y Principio de Honestidad Epistémica
El `PlanningEngine` nunca recibe un volcado completo del repositorio. Realiza preguntas específicas mediante `RepositoryQuery` bajo un presupuesto estricto (`RepositoryQueryBudget`).
- **Principio de Honestidad Epistémica**: Si una consulta alcanza el límite de bytes o resultados, el sistema **nunca** oculta el truncamiento ni asume que "no hay más dependencias". La respuesta se marca formalmente con `assessment.state = "partial"`, informando al planificador de la limitación para evitar falsas asunciones de bajo riesgo.

---

## 6. Estado de Transición y Relación con el Rediseño Normativo

Según el plan normativo (`docs/plans/2026-08-12-correctness-first-system-redesign.md`):

1. **Estado de Cierre (Stage 4 / GRepo)**: El modelo determinista `RepositoryModel`, las vistas inmutables `RepositoryView`, el catálogo `ResourceCatalog` y la interfaz `RepositoryQuery` están cerrados y verificados con tests sobre repositorios reales en `docs/audits/stage-4/`.
2. **Coexistencia de Indexadores**: `FastRepositoryIndexer` se utiliza para búsquedas y métricas rápidas de archivos/exports en la política de granularidad, mientras que `inspectRepositoryModel` se utiliza para la extracción exhaustiva de símbolos AST y límites de paquetes.

---

## 7. Navegación y Referencias

- **README del Paquete**: [`../../packages/repository-index/README.md`](../../packages/repository-index/README.md)
- **Módulos Relacionados**:
  - [`decomposer.md`](./decomposer.md): Consumidor de consultas presupuestadas durante la planificación.
  - [`contracts.md`](./contracts.md): Definición de `GoalContract`, target de repositorio y `ResourceReference`.
  - [`task-graph.md`](./task-graph.md): Validación de autoridad sobre recursos del catálogo (`checkResourceAuthority`).
  - [`scheduler.md`](./scheduler.md): Evaluación de exclusión mutua de recursos basada en `ResourceCatalog`.
- **Documentación Central**: [`../README.md`](../README.md)
