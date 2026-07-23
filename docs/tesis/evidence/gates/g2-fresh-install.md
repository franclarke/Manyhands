# G2 — Fresh install en checkout aislado

> **Fecha:** 2026-07-23 (UTC) · **Commit:** `d552c5d` · **Toolchain:** pnpm 7.29.3 · Node v24.16.0 (local)

## Procedimiento

```bash
git clone --local <repo> <scratchpad>/fresh-clone   # checkout limpio de d552c5d
cd <scratchpad>/fresh-clone
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

El clon vive fuera del árbol del repositorio (scratchpad de sesión), sin
`node_modules` heredado, sin junctions previas y sin caches del checkout
histórico. pnpm usa su store global content-addressable (comportamiento estándar
de pnpm); la resolución provino exclusivamente del `pnpm-lock.yaml` versionado.

## Resultados

| Paso | Exit | Duración | Observación |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 35s | resolución completa desde lockfile 5.4 |
| lockfile tras install | — | — | **0 líneas de diff de contenido** (`git diff --numstat` vacío; la marca "M" es solo metadata EOL de autocrlf: el archivo quedó LF puro, 7840 líneas) |
| `pnpm build` | 0 | 43s | todos los packages compilan |
| `pnpm test` | 0 | 82s | **181 files · 1072 passed · 2 skipped** — idéntico al checkout principal |

## Criterios del gate

- [x] Fresh install termina sin modificar el contenido del lockfile.
- [x] Build y suite completa pasan en el checkout reconstruido, mismo commit.
- [x] Sin reutilización del `node_modules` histórico ni de junctions previas.

## Limitaciones

- Node local 24.16.0 (≥22); la verificación exacta sobre Node 22 corresponde a
  CI (mismo commit, matriz ubuntu+windows).
- El store global de pnpm estaba caliente (0 descargas de red); la integridad de
  contenido la garantiza el store content-addressable de pnpm. No se validó una
  descarga de red completa desde registro vacío.
