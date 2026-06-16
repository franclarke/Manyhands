# 0031 · Claude Code + Codex as agent executors

## Status

Accepted (2026-06-16). Supersedes ADR-0029 (Gemini CLI executor).

## Context

Gemini CLI dejó de servir el tier gratuito / Google One el 2026-06-18. Su sucesor,
Antigravity CLI (`agy`), **no es viable** hoy para ManyHands: su modo headless
`--print` descarta stdout en contextos sin TTY/subprocess
([Issue #76](https://github.com/google-antigravity/antigravity-cli/issues/76)),
no expone un envelope JSON limpio ni usage confiable. ManyHands invoca todos sus
CLIs como subprocess con stdout en pipe, así que `agy` produciría fallas
silenciosas (exit 0, salida vacía), violando D3.

El seam `AgentExecutor` ya era provider-agnostic y el registry de executors es
data-driven (un profile + un descriptor por CLI), así que la migración no
reestructura la orquestación.

## Decision

- **Ejecución (leaf + repair):** Claude Code CLI (`claude-code-cli`, default) y
  Codex CLI (`codex-cli`, seleccionable). Ambos ya eran headless-limpios.
  - Claude Code: `claude -p <directive> --model <m> --output-format json
    [--permission-mode acceptEdits | --dangerously-skip-permissions]`. El
    envelope `{ type:"result", result, usage, total_cost_usd }` da usage y costo
    reportados.
  - Codex: `codex exec --model <m> [--sandbox workspace-write |
    --dangerously-bypass-approvals-and-sandbox] --skip-git-repo-check -` (prompt
    por stdin). Sin envelope → `usageSource: "unavailable"`.
- **Default del sistema:** `claude-code-cli` / `sonnet`
  (`DEFAULT_EXECUTOR_SELECTION`). El fallback legacy de strings sueltos también
  resuelve a Claude Code.
- **Planning (decomposer):** nuevo `ClaudeCodeRecursiveDecomposer` backed por el
  CLI de Claude Code (`claude -p --output-format json --permission-mode plan`),
  espejo del anterior de Gemini. Local-first, sin `ANTHROPIC_API_KEY`. Las rutas
  Anthropic-API (`single-pass`, `anthropic-recursive`) quedan como baselines
  opt-in por env.
- **Codex es execution-only:** no hay decomposer de Codex (sin envelope JSON, el
  planning estructurado sería más frágil).
- **Antigravity CLI:** descartado por ahora; revisitar cuando se arregle el
  Issue #76 y exista `--output-format json` headless estable.

## Consequences

Positivas:
- Claude Code reporta usage y costo exactos (`usageSource: "reported"`).
- `--permission-mode plan` da al decomposer acceso read-only para grounding sin
  efectos colaterales — análogo superior al `--approval-mode plan` de Gemini.
- El seam provider-agnostic mantiene la pipeline desacoplada del CLI concreto.

Negativas / aceptadas:
- Codex no reporta tokens/costo (`usageSource: "unavailable"`).
- Se requiere Claude Code (`claude`) y/o Codex (`codex`) instalados y autenticados
  (o `MANYHANDS_CLAUDE_BIN` / `MANYHANDS_CODEX_BIN`). Binario faltante → error de
  executor accionable.

## Migración desde Gemini CLI

| Gemini CLI | Claude Code / Codex |
|------------|---------------------|
| `gemini -p <prompt>` (stdin) | `claude -p <directive>` (stdin) / `codex exec - ` |
| `--approval-mode yolo` | `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` |
| `--approval-mode plan` (decomposer) | `--permission-mode plan` (decomposer) |
| `-o json` envelope `{response, stats}` | `--output-format json` envelope `{type:"result", result, usage}` |
| `GeminiRecursiveDecomposer` (default) | `ClaudeCodeRecursiveDecomposer` (default) |
| `MANYHANDS_GEMINI_BIN` | `MANYHANDS_CLAUDE_BIN` / `MANYHANDS_CODEX_BIN` |
| `gemini-2.5-pro` / `gemini-2.5-flash` | `sonnet` / `haiku` / `opus`, `gpt-5-codex` |

`RunDecompositionMetadata` retiene los literales `"gemini"`/`"codex"` y el tipo
`ExecutorId` retiene `"gemini-cli"` solo para cargar RunRecords históricos.

## References

- Spec: `docs/superpowers/specs/2026-06-16-migracion-gemini-a-claude-codex-design.md`
- `packages/execution-core/src/executor/profiles/claude-code.ts`, `codex.ts`
- `packages/decomposer/src/llm/recursive/claude-code-recursive-decomposer.ts`
- Supersedes: ADR-0029
