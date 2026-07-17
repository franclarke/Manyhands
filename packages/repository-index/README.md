# @manyhands/repository-index

Índice estructural actual para repositorios TypeScript/JavaScript, basado en la
API del compilador de TypeScript.

## Dirección objetivo

Producir un `RepositoryModel` versionado por target, commit/tree y schema con:

- packages, archivos, símbolos e imports/exports;
- APIs, schemas, migrations y entrypoints;
- tests, scripts y convenciones;
- boundaries inferidos con evidencia;
- coverage, confidence y warnings.

Planner, Graph Compiler, Context Packer, conflict-risk y Validator consumen el
mismo snapshot. Un cache por path sin commit no es válido.

La prioridad continúa siendo TypeScript/JavaScript. Fallbacks para otros
lenguajes deben declarar menor coverage.

API actual destacada: `buildRepositoryIndex`, `TypeScriptRepositoryIndexer` y
`summarizeRepositoryIndex`.

Contrato objetivo: [`docs/system/14-repository-index.md`](../../docs/system/14-repository-index.md).
