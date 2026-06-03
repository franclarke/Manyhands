# ManyHands — Context for AI Coding Agents

> This file is for AI coding tools working in this repository (Codex, Cursor, and similar).
> It is NOT the context file read by Claude Code — that's `CLAUDE.md`.
> Communication with Francisco: Spanish. Code and technical terms: English.
> For decision rationale: `docs/DECISIONS.md`. For project narrative: `docs/thesis/project-evolution.md`.
> For a walk-through of every system component: `docs/system/`.

---

## What this repository is

ManyHands is an LLM agent orchestration system for software development. It takes a feature in natural language, recursively decomposes it into a hierarchical DAG with explicit inter-agent interface contracts (`sharedInterface`), executes leaf tasks in isolated git worktrees with Gemini CLI (`gemini`, headless), and integrates results bottom-up with cherry-pick.

Academic context: Engineering thesis. The research question's final wording is on hold — the original "granularity as DAG depth" methodology (G3/G6/G9) was abandoned in favour of **decomposition aggressiveness** (`low | medium | high`) which biases the atomicity threshold per node.

**Not:** a coding agent, a RAG system, an IDE plugin, or an organizational memory tool.

---

## System Invariants — Do Not Change Without Discussing

| # | Invariant |
|---|-----------|
| D1 | `graph.dependencies` is canonical. `node.dependencies` is a synced shortcut. Mutation only via `addDependency` / `removeDependency` / `syncNodeDependencies`. |
| D2 | Canonical task intent field is `goal`, never `intent`. Normalize legacy `intent` in parsers; never persist it. |
| D3 | LLM failure → run FAILS with actionable error. No silent fallback. There is no deterministic Lab Mode anymore; planning has one path only (prompt-only, Gemini-required). |
| D4 | **Gemini CLI** (`gemini`, headless, stdin) is the only agent executor and the step-model for the recursive decomposer. No direct subprocess, no other CLIs. Provider-agnostic seam: `AgentExecutor` interface. Binary via `MANYHANDS_GEMINI_BIN` (default: `gemini`). |
| D5 | `git diff HEAD` is the only source of truth for what an agent changed. stdout/stderr are diagnostic only (`stderrTail`/`stdoutTail`). |
| D6 | **The orchestrator commits.** Agents must never commit. If an agent commits unexpectedly, policy: `reject` (default) or `accept`. |
| D7 | Real isolation comes from the git worktree + `ScopeChecker`, not the CLI mode. `--approval-mode yolo` for leaf execution; `--approval-mode plan` for the decomposer. |
| D8 | Integration via cherry-pick + Gemini semantic repair on conflict (max 1 attempt). Repair context: parent goal, canonical `sharedInterface`, each child's intent and diff. |
| D9 | `maxParallel = 6` leaves per batch (configurable via `ExecutionConfig`). |
| D10 | Timeouts: leaf 300 s, integration 600 s (configurable per contract). |

---

## Package Boundaries

Dependency direction: `apps → specific packages → shared`. Never import from `apps` inside packages. `@manyhands/core` is a legacy barrel still consumed by `apps/web` for types and the mock-planning flow — do not add new dependencies to it.

| Package | Purpose | Status |
|---------|---------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation, topo sort | Active |
| `contracts` | AgentTaskContract V1+V2, InterfaceContract | Active |
| `decomposer` | GeminiRecursiveDecomposer (default) + Anthropic baselines | Active |
| `execution-core` | Full real-execution pipeline | Active |
| `scheduler` | sequential_dag, parallel_naive, risk_aware | Active |
| `run-store` | RunSnapshot, patches, JSON persistence | Active |
| `trace-store` | TraceEvent (planning + execution) | Active |
| `conflict-risk` | Pairwise conflict risk prediction | Active |
| `repository-index` | Structural repo index (feeds conflict-risk) | Active |
| `shared` | EntityId, IsoTimestamp, helpers | Active |
| `core` | Legacy barrel; consumed by apps/web only | Legacy |

> `scope-validation`, `worktree-runner`, `evaluator`, and `calculator` were deleted in the Lab Mode cleanup (June 2026). Do not reintroduce them.

---

## Operational Rules

1. Do not re-argue D1–D10. If something seems in tension, flag it and stop — do not change it.
2. Gemini CLI is mandatory for execution and planning. Do not suggest or implement alternatives.
3. Never use agent stdout to determine what changed. Use `git diff HEAD`.
4. Never make the agent (Gemini) commit. The orchestrator commits.
5. No silent fallback on decomposer failure (D3). Return a clear error.
6. Run `pnpm test` before and after changes to core packages (`task-graph`, `contracts`, `decomposer`, `execution-core`).
7. Test suite must always pass (344 passing + 3 skipped as of June 2026). Fix failures in the same session — do not leave them.
8. Do not reintroduce Lab Mode. If something seems to need a deterministic benchmark, replay route, or scenario picker, stop and surface it instead of bringing back `mock-v0`/`conflict-v0`/`/lab`/`/replay`. A new Lab will be designed from scratch later.
9. `@manyhands/core` is legacy. Use specific packages for all new dependencies.

---

## Verification Commands

```bash
pnpm test                           # 344 passing + 3 skipped
pnpm -F @manyhands/execution-core typecheck
pnpm web:typecheck
pnpm build
pnpm web:dev                        # localhost:3000
```

Environment variables:
- `MANYHANDS_GEMINI_BIN` — path to gemini binary (default: `gemini`)
- `MANYHANDS_DECOMPOSER` — `single-pass` | `anthropic-recursive` (opt-in baselines; require `ANTHROPIC_API_KEY`)

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

- [`docs/system/`](docs/system/) — component-by-component walkthrough of how the system works
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — synthesized decisions reference (LLM-first)
- [`docs/thesis/project-evolution.md`](docs/thesis/project-evolution.md) — project narrative and architectural history
- [`docs/design/decomposer-composer-redesign.md`](docs/design/decomposer-composer-redesign.md) — detailed design of the two thesis artifacts
- [`docs/adr/`](docs/adr/) — 29 ADRs with full decision rationale
