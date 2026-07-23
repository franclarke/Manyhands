# G2 — Resultados de gates (Etapa 2: toolchain y verificación)

> **Fecha:** 2026-07-23 (UTC) · **Commit verificado:** `d552c5d`
> **Toolchain local:** Node v24.16.0 · pnpm 7.29.3 · git 2.40.1.windows.1 · Windows 11 Pro (10.0.26200)
> **Toolchain declarada:** Node 22 (`.nvmrc`, `engines >=22`, CI) · pnpm 7.29.3 (`packageManager`, CI, lockfile 5.4)

## Definición única de toolchain (D-6, adoptada)

| Fuente | Antes | Después |
|---|---|---|
| `package.json` → `packageManager` | `pnpm@11.7.0` | **`pnpm@7.29.3`** |
| `package.json` → `engines` | ausente | **`node >=22`, `pnpm 7.29.3`** |
| `.nvmrc` | ausente | **`22`** |
| CI (`ci.yml`) | pnpm 7.29.3 + Node 22 | igual (ya alineado) + pasos nuevos |
| `pnpm-lock.yaml` | `lockfileVersion 5.4` | igual (contenido intacto) |

**Limitación registrada:** el entorno local ejecuta Node **24.16.0** (Node 22 no
está instalado localmente; nvm local solo tiene 18/19 y no se instalaron
binarios nuevos). Los gates locales corrieron sobre Node 24; CI es la autoridad
de Node 22. `engines.node >= 22` admite ambos.

## Resultados de los gates (repositorio principal, working tree = `d552c5d`)

| # | Comando | Exit | Duración | Resultado |
|---|---|---|---|---|
| 0 | `pnpm install --frozen-lockfile` (tras reparación de entorno) | 0 | 75s (`--force`) | 624 paquetes; lockfile sin cambios de contenido (0 líneas de diff) |
| 1 | `pnpm build` | 0 | 47s | todos los packages compilan (tsup, ESM+CJS+DTS) |
| 2 | `pnpm -r --filter "./packages/*" typecheck` | 0 | 19s | 0 errores TS |
| 3 | `pnpm --filter @manyhands/web exec tsc --noEmit` | 0 | 10s | 0 errores TS |
| 4 | `pnpm test` | 0 | 88s | **181 files · 1072 passed · 2 skipped** |
| 5 | `pnpm web:build` | 0 | 116s | Next.js 15.5.7 build completo (compilación 34s + types) |
| 6 | `git diff --check` | 0 | <1s | sin conflictos de whitespace |

Los 2 tests `skipped` son el kill-test de process-group POSIX que se omite en
Windows por diseño (lo cubre el job `ubuntu-latest` de CI; ver comentario en
`ci.yml`).

## Regresiones encontradas y corregidas (lista cerrada)

1. **Junction huérfana** `node_modules/simple-git` →
   `C:\Users\franc_rgy\...\manyhands-isolated-typecheck\...` (workspace temporal
   de otro perfil, inaccesible). Causa de `EPERM` en cada install. Corrección:
   eliminación de la junction (solo el link). Es exactamente el escenario
   "symlinks hacia un workspace temporal anterior" que el roadmap §8 declara
   inválido como evidencia.
2. **Optional deps de plataforma marcadas `skipped`** en
   `node_modules/.modules.yaml` (`@esbuild/win32-x64@0.27.7`,
   `@img/sharp-win32-x64`, `@tailwindcss/oxide-win32-x64-msvc`, entre 154
   entradas) por un install previo roto → `pnpm build` fallaba con
   "The package @esbuild/win32-x64 could not be found". Corrección:
   `pnpm install --frozen-lockfile --force` re-materializó el virtual store.
3. **`tests/run-canvas-no-auto-fit.test.ts` rojo:** assertaba el wiring del
   componente muerto `RunGraphCanvas` (`minimal-run-graph.tsx`, 0 consumidores).
   Corrección: componente eliminado; test reescrito como guard **repo-wide** del
   invariante A17 (prohíbe `.fitView(`/`.setCenter(`/`.setViewport(`/
   `.fitBounds(`/`.zoomTo(`/`fitView=` en `apps/web/src` y exige
   `defaultViewport` estático + `showFitView={false}` en el canvas productivo).
   El invariante quedó **más estricto**, no debilitado.
4. **`tests/typography-scale.test.ts` rojo (×2):** 21 arbitrarios
   `text-[10px]`/`text-[11px]` y un `px-2.5` en los 5 componentes cockpit nuevos
   (`cockpit-run-graph`, `DecisionQueueDrawer`, `SeamContractInspector`,
   `SideBySideDiffViewer`, `task-node-v2`). Corrección: `text-micro` (piso 11px)
   y `px-2`. Se corrigieron los componentes, no el test.
5. **`package.json` reescrito con CRLF** por pnpm 7 durante el install forzado →
   normalizado a LF (`git diff --check` limpio).

## CI equivalente a los gates locales

`.github/workflows/ci.yml` ahora ejecuta: install `--frozen-lockfile`, lint
(señal no bloqueante, 46 errores preexistentes — no es gate de tesis), `pnpm
build`, **`pnpm -r --filter "./packages/*" typecheck` (nuevo)**, `pnpm
web:typecheck`, gate de performance del indexer (Windows), `pnpm test`, **`pnpm
web:build` (nuevo)**, en matriz ubuntu+windows con pnpm 7.29.3 y Node 22.
No hay `continue-on-error` en ningún gate de tesis (solo en lint, preexistente y
documentado).

## Commits de la etapa

- `0757e55` — `chore(toolchain): pin pnpm 7.29.3 and Node 22 as the single thesis toolchain`
- `d552c5d` — `fix(web): restore UI guard invariants in the cockpit components`

## Veredicto

**G2: PASS.** Los seis comandos mínimos pasan sobre `d552c5d` en el checkout de
trabajo y la reconstrucción desde clon limpio (ver
[`g2-fresh-install.md`](g2-fresh-install.md)) reproduce install, build y suite
sin tocar el lockfile. Limitación: gates locales sobre Node 24 (CI cubre Node 22).
