# @manyhands/repository-index

> Un índice estructural del repositorio —archivos, símbolos, imports/exports— construido con el compilador de TypeScript.

## Rol en el pipeline

Grounding. Da a las otras capas conocimiento real del código existente, en vez de adivinar.

## Conceptos clave

- **`TypeScriptRepositoryIndexer`.** Recorre el repo y, usando la API del compilador de TypeScript, extrae por archivo: símbolos declarados/exportados, imports y `kind` (`source` / `test` / `config` / `schema` / `migration`).
- **Determinístico y hasheable.** El índice se ordena de forma estable y se puede resumir + hashear (`summarizeRepositoryIndex`) para detectar cambios entre corridas.
- **Consumidores.** Lo usa `conflict-risk` para las señales estáticas y el grounding de los contratos de tarea.

## API pública

`buildRepositoryIndex` · `TypeScriptRepositoryIndexer` · `summarizeRepositoryIndex` · `RepositoryIndex` · `RepositorySymbolIndex`

## Dependencias

`@manyhands/shared`, `typescript`.
