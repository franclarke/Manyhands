# Spec — Migración Gemini CLI → Claude Code + Codex

- **Fecha:** 2026-06-16
- **Estado:** Aprobado (diseño). Pendiente plan de implementación.
- **Motivación:** Gemini CLI deja de servir tier gratuito el 2026-06-18. El
  sucesor (Antigravity CLI / `agy`) **no es viable** para ManyHands hoy: su modo
  headless `--print` descarta stdout en contextos sin TTY/subprocess
  ([Issue #76](https://github.com/google-antigravity/antigravity-cli/issues/76)),
  no expone envelope JSON limpio ni usage confiable. Se decide migrar a backends
  ya implementados y headless-limpios: **Claude Code** (default) y **Codex**.

## Objetivo

Remover Gemini CLI de ManyHands por completo y dejar:

- **Ejecución (leaf + repair):** `claude-code-cli` (default) y `codex-cli`
  (seleccionable). Ambos ya existen y son headless-limpios.
- **Planning (decomposer):** nuevo `ClaudeCodeRecursiveDecomposer` backed por el
  CLI de Claude Code (local-first, sin `ANTHROPIC_API_KEY`).

No cambia el modelo de orquestación (worktrees, `ScopeChecker`, event log,
StateGraphs). Solo el seam de executor/decomposer, que ya es provider-agnostic.

## Decisiones tomadas

1. **Reemplazo total** de Gemini (no coexistencia).
2. **Default de ejecución:** `claude-code-cli` / `sonnet`. Codex seleccionable.
3. **Planning default:** `ClaudeCodeRecursiveDecomposer` (CLI). Las rutas
   Anthropic-API (`single-pass`, `anthropic-recursive`) quedan como baselines
   opt-in por env. Mock fallback intacto.
4. **Codex es execution-only** (sin decomposer): YAGNI, no tiene envelope JSON y
   el planning estructurado sería más frágil.

## Componente nuevo: `ClaudeCodeRecursiveDecomposer`

Ubicación: `packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts`.
Espejo de `gemini-recursive-decomposer.ts`. Implementa `AnthropicLike`
envolviendo el CLI de Claude Code; el `RecursiveDecomposer` mantiene recursión,
validación y retries.

- **Args:** `["-p", "<directive>", "--model", model, "--output-format", "json", "--permission-mode", "plan"]`.
  - `--permission-mode plan` = read-only (no escribe ni ejecuta), análogo
    superior a `--approval-mode plan` de Gemini.
  - Se mantiene el guard de prompt ("no llames tools; todo el contexto está en el
    prompt").
- **Transporte del prompt:** completo por **stdin** (sin límite de args), igual
  que hoy.
- **Parseo:** el envelope de Claude Code es
  `{ type:"result", result:"…", usage, total_cost_usd }`. Se toma `.result`
  (texto del modelo) y el `RecursiveDecomposer` extrae el JSON del step con
  `parseJsonObjectCandidates`. Manejo de error: `is_error === true` → error
  accionable (sin fallback silencioso, invariante D3).
- **Binario:** configurable vía `MANYHANDS_CLAUDE_BIN` (ya en el registry),
  default `claude`. `useShell` en win32. Teardown del árbol de proceso en
  timeout/abort (reusar el patrón existente).

## Cambios en componentes existentes

### `packages/execution-core/src/executor/registry.ts`
- Eliminar `GEMINI_EXECUTOR_ID`, su descriptor, `GEMINI_CAPABILITIES` y la
  entrada en `EXECUTOR_IDS`.
- `DEFAULT_EXECUTOR_SELECTION` → `{ executorId: CLAUDE_CODE_EXECUTOR_ID, model: "sonnet" }`.
- `normalizeExecutorSelection` / `resolveLegacyModelSelection`: el fallback
  legacy deja de apuntar a Gemini → apunta a Claude Code.

### `packages/execution-core/src/executor/factory.ts`
- Quitar `GEMINI_PROFILE` de `CLI_PROFILES`.

### `packages/decomposer/src/llm/recursive/` y barrels
- Borrar `gemini-recursive-decomposer.ts`; agregar el nuevo.
- Actualizar exports en `packages/decomposer/src/index.ts` y el barrel
  `@manyhands/core` (`GeminiRecursiveDecomposer` → `ClaudeCodeRecursiveDecomposer`).

### `apps/web/src/lib/decomposer-policy.ts`
- Rama default: `GeminiRecursiveDecomposer`/`provider:"gemini"` →
  `ClaudeCodeRecursiveDecomposer`/`provider:"claude-code"`.
- Mantener ramas Anthropic-API como baselines env-gated; mock fallback intacto.
- Actualizar el union de `provider` en `DecomposerSelection`.

### Pricing / UI de modelos
- Quitar modelos Gemini de `apps/web/src/lib/models.ts`, `model-pricing.ts`,
  `live-graph.ts` y demás selectores; default de UI → Claude Code.
- Remover la derivación de costo específica de Gemini (`costForModel` ya no la
  usa ese path).

### Readiness / preflight
- `apps/web/src/lib/server/providers/readiness.ts` y
  `apps/web/src/lib/server/runs/preflight.ts`: chequear binarios `claude` /
  `codex` en vez de `gemini`. Quitar `MANYHANDS_GEMINI_BIN`.

## Remociones

- `packages/execution-core/src/executor/profiles/gemini.ts`
- `packages/decomposer/src/llm/recursive/gemini-recursive-decomposer.ts`
- Cualquier `gemini-cli.ts` legacy referenciado por el ADR-0029.
- `MANYHANDS_GEMINI_BIN` y referencias.
- Tests: `tests/execution-core-gemini-cli.test.ts`,
  `tests/decomposer-gemini-recursive.test.ts`.

## Testing (TDD, test-first)

Cada cambio rojo → verde → refactor. Diffs chicos alineados al patrón existente.

- **Nuevo:** `tests/decomposer-claude-code-recursive.test.ts` — espejo del de
  Gemini, con `spawn` inyectado (sin proceso real): argv correcto, prompt por
  stdin, parseo de `.result`, propagación de error en `is_error`, timeout.
- **Actualizar** los que afirman el default Gemini:
  `tests/execution-core-executor-registry.test.ts`,
  `tests/model-registry.test.ts`, `tests/decomposer-policy.test.ts`,
  `tests/preflight.test.ts`, `tests/run-runner.test.ts` y cualquier otro que
  rompa.
- **Verificación:** `pnpm test`, `pnpm web:typecheck`,
  `pnpm -F @manyhands/execution-core typecheck`, `pnpm -F @manyhands/decomposer typecheck`.
- **Smoke de cierre (manual, run real):** confirmar que `claude -p
  --output-format json --permission-mode plan` devuelve el JSON del step en
  `.result` durante un decompose real.

## Docs

- ADR nuevo `docs/adr/0031-claude-code-and-codex-executors.md` que supersede
  `0029-gemini-cli-executor.md`.
- Actualizar `docs/system/06-gemini-executor.md` (renombrar/rescribir a Claude
  Code + Codex), `docs/DECISIONS.md` (D4), `docs/development/architecture.md`,
  READMEs afectados y las menciones a Gemini-como-executor en `CLAUDE.md` /
  `AGENTS.md`.

## Riesgos y mitigaciones

- **Contrato runtime de Claude Code:** ya está codificado y testeado en
  `claude-code.ts` profile → riesgo bajo. El decomposer nuevo reusa el mismo
  contrato CLI.
- **Entrelazado con working tree sucia:** se trabaja en rama
  `feat/migrate-executors-claude-codex`, staging selectivo (no arrastrar cambios
  previos no relacionados).
- **No-silent-failure (D3):** errores de CLI/parseo deben fallar el run con
  error accionable; ningún path nuevo introduce fallback silencioso.

## Fuera de alcance

- Decomposer de Codex.
- Integración de Antigravity CLI (revisitar cuando se arregle el Issue #76 y
  exista `--output-format json` headless estable).
- Cambios en orquestación, worktrees, ScopeChecker o event log.
