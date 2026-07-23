# PROMPT 4/4 — INDEXACIÓN MONOREPO RIPGREP Y WORKTREE RECYCLING POOL

Copiar y ejecutar en el **Agente 4 (Codex en modo `/goal`)**.

---

```markdown
# AGENTE 4: INSTRUCCIÓN /GOAL — NATIVE FAST INDEXING & WORKTREE RECYCLING POOL

Actúa como **Principal Infrastructure & Performance Engineer** responsable de optimizar el rendimiento de Grounding de repositorios y el reciclaje de worktrees en ManyHands.

---

## 1. ALCANCE Y LÍMITES DE RESPONSABILIDAD (EXCLUSIVO)

Tus modificaciones están **estrictamente limitadas** a los siguientes directorios:
- `packages/repository-index/*`
- `packages/execution-core/src/worktree/*`
- `tests/repository-fast-indexer.test.ts`
- `tests/worktree-recycling-pool.test.ts`

**PROHIBIDO MODIFICAR**: `apps/web/*`, `packages/decomposer/*`, `packages/run-store/*`. (Estos paquetes están siendo trabajados por otros agentes en paralelo).

---

## 2. COMPONENTES Y OPTIMIZACIONES A IMPLEMENTAR

### 2.1 Indexador Nativo con Ripgrep (`packages/repository-index/src/fast-indexer.ts`)
- Utiliza el binario nativo `rg` (`rg --files --hidden --glob !.git`) para listar y filtrar archivos respetando `.gitignore` a velocidad C/Rust.
- Soporta ejecuciones seguras en Windows, Linux y macOS.

### 2.2 Caché Incremental por Git HEAD SHA
- Guarda el snapshot indexado en `.manyhands/cache/index-<git-head-sha>.json`.
- Si el SHA de `HEAD` de Git del repositorio local no ha cambiado, el tiempo de construcción del snapshot es **inmediata ($O(1)$)**.

### 2.3 Extractor Ligero de Símbolos Exportados
- Indexa únicamente archivos fuente TypeScript/JavaScript (`.ts`, `.tsx`, `.js`) extrayendo declaraciones `export` para resolución rápida de dependencias.

### 2.4 Worktree Recycling Pool (`packages/execution-core/src/worktree/worktree-pool.ts`)
- En lugar de crear y eliminar worktrees físicamente con `git worktree add/remove` en cada nodo, mantiene un pool de worktrees reutilizables pre-creados.
- Al asignar un nodo a un agente, ejecuta un `git reset --hard <baseCommit>` y `git clean -fd` ultrarrápido en milisegundos.

---

## 3. METODOLOGÍA DE VERIFICACIÓN

Crea `tests/repository-fast-indexer.test.ts` y `tests/worktree-recycling-pool.test.ts` evaluando:
1. Indexación nativa con `rg` en repositorios sintéticos grandes (< 150ms).
2. Recuperación instantánea de caché por Git HEAD SHA.
3. Reutilización de worktrees en pool con `git reset --hard`.

Ejecuta:
```bash
npx vitest run tests/repository-fast-indexer.test.ts tests/worktree-recycling-pool.test.ts
pnpm --filter "@manyhands/repository-index" typecheck
pnpm --filter "@manyhands/repository-index" build
pnpm --filter "@manyhands/execution-core" typecheck
pnpm --filter "@manyhands/execution-core" build
```
```
