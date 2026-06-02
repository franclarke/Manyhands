# ManyHands — Context for AI Coding Agents

> This file is for AI coding tools working in this repository (Codex, Cursor, and similar).
> It is NOT the context file read by Claude Code — that's `CLAUDE.md`.
> Communication with Francisco: Spanish. Code and technical terms: English.
> For decision rationale: `docs/DECISIONS.md`. For project narrative: `docs/thesis/project-evolution.md`.

---

## What this repository is

ManyHands is an LLM agent orchestration system for software development. It takes a feature in natural language, recursively decomposes it into a hierarchical DAG with explicit inter-agent interface contracts (`sharedInterface`), executes leaf tasks in isolated git worktrees with Gemini CLI (`gemini`, headless), and integrates results bottom-up with cherry-pick.

Academic context: Engineering thesis. Research question: does an optimal decomposition granularity exist that maximizes the quality of parallel LLM agent output?

**Not:** a coding agent, a RAG system, an IDE plugin, or an organizational memory tool.

---

## System Invariants — Do Not Change Without Discussing

| # | Invariant |
|---|-----------|
| D1 | `graph.dependencies` is canonical. `node.dependencies` is a synced shortcut. Mutation only via `addDependency` / `removeDependency` / `syncNodeDependencies`. |
| D2 | Canonical task intent field is `goal`, never `intent`. Normalize legacy `intent` in parsers; never persist it. |
| D3 | No `scenarioId` + LLM failure → run FAILS with actionable error. No silent fallback. `MetadataDrivenMockDecomposer` only when `scenarioId` is present (Lab Mode). |
| D4 | **Gemini CLI** (`gemini`, headless, stdin) is the only agent executor and the step-model for the recursive decomposer. No direct subprocess, no other CLIs. Provider-agnostic seam: `AgentExecutor` interface. Binary via `MANYHANDS_GEMINI_BIN` (default: `gemini`). |
| D5 | `git diff HEAD` is the only source of truth for what an agent changed. stdout/stderr are diagnostic only (`stderrTail`/`stdoutTail`). |
| D6 | **The orchestrator commits.** Agents must never commit. If an agent commits unexpectedly, policy: `reject` (default) or `accept`. |
| D7 | Real isolation comes from the git worktree + `ScopeChecker`, not the CLI mode. `--approval-mode yolo` for leaf execution; `--approval-mode plan` for the decomposer. |
| D8 | Integration via cherry-pick + Gemini semantic repair on conflict (max 1 attempt). Repair context: parent goal, canonical `sharedInterface`, each child's intent and diff. |
| D9 | `maxParallel = 3` leaves per batch (configurable via `ExecutionConfig`). |
| D10 | Timeouts: leaf 300 s, integration 600 s (configurable per contract). |

---

## Package Boundaries

Dependency direction: `apps → specific packages → shared`. Never import from `apps` inside packages. Never add new dependencies to `@manyhands/core` (deprecated barrel).

| Package | Purpose | Status |
|---------|---------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation, topo sort | Active |
| `contracts` | AgentTaskContract V1+V2, InterfaceContract | Active |
| `decomposer` | GeminiRecursiveDecomposer (default) + Anthropic baselines | Active |
| `execution-core` | Full real-execution pipeline | Active |
| `scheduler` | sequential_dag, parallel_naive, risk_aware | Active |
| `run-store` | RunSnapshot, patches, JSON persistence | Active |
| `trace-store` | TraceEvent union (50+ types) | Active |
| `shared` | EntityId, IsoTimestamp, shared helpers | Active |
| `conflict-risk` | Conflict risk prediction | Deferred |
| `scope-validation` | Legacy, replaced by ScopeChecker in execution-core | Deferred |
| `worktree-runner` | Legacy mock runner | Deferred (reference only) |
| `repository-index` | Structural repo index | Deferred |
| `evaluator` | Lab Mode evaluation and reports | Deferred |
| `core` | Compatibility barrel | Deprecated — do not use |

---

## Operational Rules

1. Do not re-argue D1–D10. If something seems in tension, flag it and stop — do not change it.
2. Gemini CLI is mandatory for execution and planning. Do not suggest or implement alternatives.
3. Never use agent stdout to determine what changed. Use `git diff HEAD`.
4. Never make the agent (Gemini) commit. The orchestrator commits.
5. No silent fallback on decomposer failure (D3). Return a clear error.
6. Run `pnpm test` before and after changes to core packages (`task-graph`, `contracts`, `decomposer`, `execution-core`).
7. Test suite must always pass (455 passing + 3 skipped). Fix failures in the same session — do not leave them.
8. Lab Mode is secondary. Deterministic scenarios are thesis infrastructure, not the main product flow.
9. `@manyhands/core` is deprecated. Use specific packages for all new dependencies.

---

## Verification Commands

```bash
pnpm test                           # 455 passing + 3 skipped
pnpm -F @manyhands/execution-core typecheck
pnpm web:typecheck
pnpm build
pnpm web:dev                        # localhost:3000
```

Environment variables:
- `MANYHANDS_GEMINI_BIN` — path to gemini binary (default: `gemini`)
- `MANYHANDS_DECOMPOSER` — `single-pass` | `anthropic-recursive` (opt-in baselines; require `ANTHROPIC_API_KEY`)
- `MANYHANDS_FORCE_FALLBACK=1` — force `MetadataDrivenMockDecomposer` (Lab Mode)

---

## Key Files

| File | Description |
|------|-------------|
| `packages/task-graph/src/index.ts` | TaskNode, TaskGraph, topo sort |
| `packages/contracts/src/index.ts` | AgentTaskContract + InterfaceContract |
| `packages/decomposer/src/llm/recursive/` | GeminiRecursiveDecomposer |
| `packages/execution-core/src/run/executor.ts` | RunExecutor — top-level orchestrator |
| `packages/execution-core/src/executor/gemini-cli.ts` | GeminiCliExecutor |
| `packages/execution-core/src/integration/agent.ts` | IntegrationAgent / Composer |
| `packages/execution-core/src/types.ts` | Zod schemas for execution domain |
| `packages/execution-core/src/errors.ts` | Typed error hierarchy |
| `apps/web/src/lib/server/runs/runner.ts` | Planning + execution pipeline (real engine) |
| `apps/web/src/lib/decomposer-policy.ts` | `pickDecomposer()` |
| `apps/web/src/lib/server/runs/schema.ts` | RunRecord schema (Zod) |
| `benchmarks/expression-calculator/` | Interface seams fixture (thesis Artifact 1) |
| `benchmarks/task-manager-api/` | REST API benchmark fixture |

---

## Reference Documentation

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — synthesized decisions reference (LLM-first)
- [`docs/thesis/project-evolution.md`](docs/thesis/project-evolution.md) — project narrative and architectural history
- [`docs/design/decomposer-composer-redesign.md`](docs/design/decomposer-composer-redesign.md) — detailed design of the two thesis artifacts
- [`docs/adr/`](docs/adr/) — 29 ADRs with full decision rationale
