# Repository-index: Grounding Estructural

**Archivos fuente:** `packages/repository-index/src/index.ts`

---

## Qué Es

El `repository-index` construye un **índice estructural** del repositorio —archivos,
símbolos, imports y exports— usando el compilador de TypeScript. Es el conocimiento
real del código existente con el que las otras capas dejan de adivinar.

## Responsabilidad

Responder, de forma determinística, "qué hay en este repo": qué archivos existen y
de qué tipo son, qué símbolos declara/exporta cada uno y qué importa. No interpreta
intención ni predice nada — solo describe la estructura.

## Cómo Funciona

### `TypeScriptRepositoryIndexer.index`

1. Recorre el repo desde `rootPath`, ignorando directorios de ruido
   (`node_modules`, `.next`, `dist`, `coverage`, …).
2. Parsea cada archivo indexable (`.ts` / `.tsx` / `.js` / `.jsx`) con
   `ts.createSourceFile`.
3. Extrae, por archivo: **símbolos declarados y exportados** (función, clase,
   interface, type, const, componente), **imports** (módulo + símbolos) y un
   **`kind`** de archivo (`source` / `test` / `config` / `schema` / `migration`).

### Determinismo y hash

El índice se ordena de forma estable y puede resumirse
(`summarizeRepositoryIndex`) y hashearse (`sha256`), de modo que dos corridas sobre
el mismo árbol producen el mismo hash. Esto permite detectar cambios en el repo
entre planning y ejecución.

## Interfaces

**Recibe:** un `rootPath` (y, opcionalmente, `repositoryId` / `indexedAt`).

**Produce:** un `RepositoryIndex` con `files`, `symbols`, `imports`, `exports` y
`metadata`.

## Cómo Encaja

Es la base de grounding del sistema: lo consume [`conflict-risk`](13-conflict-risk.md)
para sus señales estáticas, y alimenta el grounding de contratos en la preparación
de la ejecución.
