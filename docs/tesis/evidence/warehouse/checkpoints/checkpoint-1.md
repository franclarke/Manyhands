# Checkpoint 1 — C core

> **Fecha:** 2026-07-24 · **Tasks:** 1–4 · **Estado:** PASS.

## Entregables

| Task | Commit | Resultado |
|---|---|---|
| 1 | `74f001f` | ADR 0012, target C, ledger y separación pilot/final |
| 2 | `950dd18` | bytes/líneas exactos en ambos indexadores y cache profile nuevo |
| 3 | `e94b4b8` | perfiles de contexto medidos y estimator versionado |
| 4 | `d9e5b41` | selector bottom-up A/B/C y remapeo de relaciones |

## Evidencia TDD

1. Las regresiones de índice fallaron inicialmente porque `byteSize` y
   `lineCount` no existían en los outputs canónico y rápido.
2. Los cuatro tests de perfil fallaron inicialmente con
   `buildRepositoryContextProfiles is not a function`.
3. Los ocho tests de estrategia fallaron inicialmente con
   `selectGranularityStrategy is not a function`.
4. Después de la implementación, la corrida combinada quedó verde.

## Verificación de cierre

```powershell
pnpm vitest run tests/repository-index.test.ts tests/repository-fast-indexer.test.ts tests/repository-snapshot.test.ts tests/granularity-context-profile.test.ts tests/granularity-utility-policy.test.ts tests/decomposer-adaptive-planning.test.ts tests/granularity-policy-conditions.test.ts
pnpm --filter @manyhands/repository-index typecheck
pnpm --filter @manyhands/decomposer typecheck
git diff --check
```

Resultado:

- 7 test files PASS;
- 45 tests PASS;
- 1 performance test SKIP porque sólo se habilita con
  `MANYHANDS_PERF_GATE=1` sobre Windows;
- ambos typechecks PASS;
- `git diff --check` PASS.

## Invariantes demostrados

- un target pequeño puede permanecer como hoja;
- un corte independiente puede expandirse por beneficio neto;
- overlap, seams y duplicación penalizan la división;
- una propuesta unaria no cuenta como split;
- una hoja inviable sin corte pide `semantic_replan`;
- C puede expandir una rama y conservar otra;
- A conserva la raíz y B usa la frontera semántica más fina;
- no se crean keys ni paths que el Planner no propuso;
- input idéntico produce assessment y candidate hash idénticos;
- C1 y sus condiciones históricas siguen pasando sus regresiones.

## Límite del checkpoint

C es todavía un componente puro. No se declara productivo ni se usa como
evidencia de tesis hasta cerrar el siguiente bloque: replan, ownership de
aceptación, eventos/replay y configuración por run.
