# Repository Index

## Purpose

Phase 5 introduces a deterministic repository index so conflict prediction can use signals from a TypeScript repository, not only declared task metadata.

The first fixture repository is:

```txt
examples/repos/aprobado-lite
```

It is intentionally small and exists for indexing, not for running a real application.

## Package

The implementation lives in `@manyhands/repository-index`.

It exports:

- `RepositoryIndex`;
- `RepositoryFileIndex`;
- `RepositorySymbolIndex`;
- `RepositoryImportIndex`;
- `RepositoryExportIndex`;
- `RepositoryIndexer`;
- `TypeScriptRepositoryIndexer`;
- `buildRepositoryIndex`;
- `summarizeRepositoryIndex`;
- `computeRepositoryIndexHash`.

## Indexer V0

`TypeScriptRepositoryIndexer` uses the TypeScript Compiler API to parse files with `ts.createSourceFile`. It does not create a `Program`, run a typechecker, execute tests, compile the target repo or resolve package aliases.

It extracts:

- file kind: source, test, config, schema, migration or unknown;
- imports and module specifiers;
- named exports;
- declarations for functions, classes, interfaces, type aliases, consts and simple TSX components;
- deterministic counts and hash.

## Limits

This is a structural index, not a semantic analyzer. It does not prove runtime behavior, type compatibility, alias resolution, re-export correctness or integration quality.
