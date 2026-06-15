# 0027 · Repo provisioning (fixture-only)

> Partially superseded note (June 2026): fixture provisioning still exists as a
> generic/testing mechanism, but the benchmark-fixture strategy and the
> `benchmarks/` directory are no longer active product/evaluation assumptions.

## Status

Accepted. Implemented in `apps/web/src/lib/server/runs/repo-provisioner.ts` (Etapa 2A — Real Execution Readiness).

## Context

The Execution Core (`@manyhands/execution-core`) runs `git worktree add … <baseCommit>` against a real repo, but until Etapa 2A nothing connected "user creates a run in the web app" to "an executable git repo with a valid base commit". The decomposer fills the graph with mock values (`repo: "mock-target-repository"`, `baseCommit: "mock-base-commit"`), so the default execution engine failed immediately for any run (the ref does not exist). This was the C17 deferral and the single blocker for real execution and granularity experiments.

## Decision

Introduce a minimal `RepoProvisioner` that prepares an executable repo for a run. In Etapa 2A only **one source** is supported:

- `RepoSpec = { kind: "fixture"; fixtureId: string }` — a versioned, executable benchmark directory under `benchmarks/` (e.g. `task-manager-api`).

`createFixtureRepoProvisioner({ benchmarksRoot?, workRoot? })` returns a `RepoProvisioner` that, per run:

1. Validates the fixture exists; otherwise throws `RepoProvisionError`.
2. Copies `benchmarks/<fixtureId>` into an isolated per-run dir (`.manyhands/work/<runId>/repo`), excluding `node_modules`, `dist`, `.git`.
3. Bootstraps git: `git init -b main`, repo-level identity + `commit.gpgsign false` (Windows-safe), `git add -A`, one deterministic commit, `git rev-parse HEAD`.
4. Returns `ProvisionedRepo { repoRoot, baseBranch, baseCommit, cleanup }` with a **real** 40-hex base commit.

The provisioner lives in the **web server layer**, not in `execution-core`. The Execution Core is a pure pipeline (git via the `GitRunner` interface, no opinion on where a repo comes from); fixture copying + git bootstrap are app concerns that already belong next to `resolveRepoRoot`, `resolveManyhandsPath`, the benchmarks path, and the `ExecutionEngine` seam. The provisioner shells out via `execFile` (mirroring the proven `execFileSync` pattern in `tests/execution-core-e2e.test.ts`) rather than widening `GitRunner` for one caller.

The pipeline provisions and persists; the engine stays a pure executor. `runExecutionPipeline` provisions when `run.repoSpec` is set, persists the result on the `RunRecord` (`provisioned`), and threads it into the engine. With the default engine and no `repoSpec`, it throws `RepoNotConfiguredError` (D3: no silent mock execution).

## Consequences

Positive:
- Real execution against `task-manager-api` is now reachable from web/API.
- The provisioned repo is persisted as a run artifact (auditable, inspectable).
- `execution-core` is untouched — all existing tests stay green on mocks.
- The provisioner is a small, single-responsibility module testable with deterministic git, no network.

Negative / accepted:
- No `localPath`, no remote clone, no `npm install`/`npm test` in 2A. Deferred to later stages.
- `.manyhands/work/<runId>` accumulates; `cleanup()` is best-effort and not auto-invoked by the pipeline (lets users inspect results). Acceptable for 2A.

## Alternatives considered

- **Provisioner in `execution-core`** — rejected: injects app concerns (benchmarks path, `.manyhands`) into a pure domain package.
- **New tiny package** — rejected: premature for a single consumer.
- **Auto-derive `repoSpec` from `scenario.benchmarkId`** — rejected: scenario `benchmarkId`s (`mock-v0`, `conflict-v0`) name decomposition manifests, not executable repos. `repoSpec` is explicit, which also honors D3 (clear error over silent fallback).
