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

API actual destacada: `buildRepositoryIndex`, `buildFastRepositorySnapshot`,
`TypeScriptRepositoryIndexer`, `FastRepositoryIndexer` y
`summarizeRepositoryIndex`.

Para grounding de baja latencia, `FastRepositoryIndexer` usa `rg --files` y
persiste envelopes de `RepositoryIndex` por commit en
`.manyhands/cache/index-<sha>.json`. El envelope incluye versión, perfil y
checksum del índice y de las capacidades descubiertas; la caché corrupta se
reconstruye. Este modo ligero limita el análisis estructural a exports de `.ts`,
`.tsx` y `.js`, pero conserva el mismo `RepositoryIndex` canónico.

En un cache miss, el modo productivo materializa el commit exacto mediante un
índice Git temporal antes de ejecutar Ripgrep. Cambios dirty, untracked o reglas
de ignore locales no se guardan bajo la clave del commit.

El presupuesto cold-cache se mide como p95 en el runner Windows de referencia
mediante `MANYHANDS_PERF_GATE=1`. El límite de 750 ms absorbe variación normal
de NTFS y filtros antivirus sin ocultar degradaciones grandes; el cache hit
conserva un gate separado de 25 ms.

Contrato objetivo: [`docs/system/14-repository-index.md`](../../docs/system/14-repository-index.md).
