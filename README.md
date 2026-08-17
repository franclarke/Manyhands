<div align="center">
  <img src=".github/assets/logo.svg" alt="ManyHands" width="380" />
  <p><strong>Coordinar agentes para convertir un objetivo de software en una entrega verificable.</strong></p>
</div>

---

ManyHands is a local control room for software development with multiple agents.
The product goal is not to produce the largest possible task graph. It is to
identify defensible software boundaries, execute exact attempts in isolation,
integrate their declared artifacts and deliver the exact result supported by
evidence.

## Current status

The repository is in a correctness-first redesign. Existing code includes useful
foundations—typed graphs, event journals, exact-candidate validation, worktrees
and continuous scheduling—but the productive planning, artifact transport,
integration ownership, process topology and sandboxing do not yet satisfy the
new architecture.

Do not run large model benchmarks to infer progress. The canonical plan defines
offline gates and a staged return to controlled live evaluation.

## Documentation

- [`PRODUCT.md`](PRODUCT.md) — stable product purpose and principles.
- [`docs/plans/2026-08-12-correctness-first-system-redesign.md`](docs/plans/2026-08-12-correctness-first-system-redesign.md)
  — complete target design, findings and implementation plan.
- [`docs/agents/`](docs/agents/) — local implementation workflow.
- [`docs/tesis/`](docs/tesis/) — academic material and attributable historical
  evidence, not current architecture.

## Current package map

| Responsibility | Current location |
|---|---|
| Web workspace and current composition root | `apps/web` |
| Run commands, events, reducer and recovery policy | `packages/run-coordinator` |
| Graph revisions | `packages/task-graph` |
| Versioned contracts | `packages/contracts` |
| Current planning and compiler | `packages/decomposer` |
| Current execution driver | `packages/orchestrator-graph` |
| Workspaces, agents, validation and integration | `packages/execution-core` |
| Scheduling and current conflict analysis | `packages/scheduler`, `packages/conflict-risk` |
| Repository indexing | `packages/repository-index` |
| Events, attempts, artifacts and traces | `packages/run-store`, `packages/trace-store` |

The redesign will add `packages/run-engine` and `apps/daemon`, then retire
superseded productive paths. The source remains authoritative for what currently
runs; the plan is authoritative for what should be implemented.

## Current executor adapters

The transitional implementation uses **Claude Code CLI** as its default local
executor and exposes **Codex CLI** as an alternative for planning, execution and
repair. These are replaceable edge adapters; neither CLI defines the domain or
the target orchestration architecture.

## Development

Requirements: Node.js 22 or newer. The pnpm version is pinned by
`packageManager` in `package.json`, so it is not something to install by hand —
`engines.pnpm` rejects any other version with `ERR_PNPM_UNSUPPORTED_ENGINE`.

```bash
corepack pnpm install
corepack pnpm web:dev
```

`corepack pnpm` resolves the pinned version whatever else is on PATH. The
prefix is not enough on its own, though: scripts such as `build:packages` invoke
`pnpm` again, and that nested call is resolved from PATH. A stale pnpm installed
under `%LOCALAPPDATA%\pnpm` or `%APPDATA%
pm` shadows the corepack shims and
fails the engine check from inside a command that was started correctly.

Remove those installs once and the whole workspace, nested scripts included,
resolves to the pinned version:

```bash
npm uninstall -g pnpm
corepack enable
pnpm --version   # 11.21.0
```

## Verification

```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
```

For documentation-only changes, verify links, obsolete references and the final
diff instead of running product builds.
