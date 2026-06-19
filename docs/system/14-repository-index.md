# Repository-index: Grounding Estructural

**Archivos fuente:** `packages/repository-index/src/index.ts`

---

## Qué Es

El `repository-index` construye un índice estructural del repositorio: archivos,
símbolos, imports y exports usando el compilador de TypeScript. Es conocimiento
determinístico del código existente para que otras capas no dependan solo de
heurísticas de paths.

## Responsabilidad

Responder qué hay en este repo: qué archivos existen y de qué tipo son, qué
símbolos declara/exporta cada uno y qué importa. No interpreta intención ni
predice conflictos por sí mismo; solo describe estructura.

## Cómo Funciona

### `TypeScriptRepositoryIndexer.index`

1. Recorre el repo desde `rootPath`, ignorando directorios de ruido
   (`node_modules`, `.next`, `dist`, `coverage`, etc.).
2. Parsea archivos indexables (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`) con
   `ts.createSourceFile` cuando aplica.
3. Extrae por archivo símbolos declarados/exportados, imports, exports y un
   `kind` (`source`, `test`, `config`, `schema`, `migration`, `unknown`).

### Determinismo y Hash

El índice se ordena de forma estable y puede resumirse
(`summarizeRepositoryIndex`) y hashearse (`computeRepositoryIndexHash`). Esto
permite detectar cambios entre corridas sin persistir el índice completo en
eventos de scheduling.

## Señales Disponibles Hoy

- Archivos repo-relativos y `kind`.
- Símbolos declarados/exportados por archivo.
- Imports con `moduleSpecifier` y símbolos importados.
- Exports por archivo.
- Resumen/hash determinístico.

Con eso `conflict-risk` puede detectar relaciones exportador/importador,
símbolos producer/consumer, schema compartido, fixture compartido y superficie
pública compartida.

## Datos Que No Tiene

No contiene AST completo persistido, call graph, type checker semántico,
runtime usage, owners, historial git, cobertura ni embeddings. Por eso el
predictor de riesgo sigue siendo heurístico y conserva fallbacks por
contrato/scope cuando falta índice o la señal es insuficiente.

## Interfaces

**Recibe:** `rootPath` y, opcionalmente, `repositoryId` / `indexedAt`.

**Produce:** `RepositoryIndex` con `files`, `symbols`, `imports`, `exports`,
`diagnostics` y `metadata`.

## Cómo Encaja

Planning usa el índice para grounding y puede persistir `staticConflictSignals`.
El scheduler no indexa directamente: consume esas señales o un `RepositoryIndex`
recibido por `RunExecutor.run` y deja evidencia compacta en la auditoría de wave.
