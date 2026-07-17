# Target Architecture Transition — Progress Ledger

> Durable checkpoint for `2026-07-17-target-architecture-transition.md`.
> Update this file after every completed work packet. A packet is `completed`
> only after its required verification passes and its implementation commit is
> recorded here.

## Current checkpoint

| Field | Value |
|---|---|
| Integration branch | `codex/target-architecture-v2` |
| Current packet | `WP-02 — RepositorySnapshot inmutable y baseline` |
| Last completed packet | `WP-01 — Contratos V2 versionados` |
| Open gate | Pre-G1 |
| Baseline fixture/UI commit | `6cde401` |
| Target docs and plan commit | `bf24862` |
| WP-00 implementation commit | `d381f61` |
| WP-01 implementation commit | `cee0973` |
| Last updated | 2026-07-17 |

## Packet ledger

| Packet | Status | Implementation commit | Verification | Notes |
|---|---|---|---|---|
| WP-00 Baseline | completed | `d381f61` | 5/5 narrow tests passed | V1 run fixture, current lifecycle characterization, package boundary guard and frozen `@manyhands/core` allowlist |
| WP-01 Contracts V2 | completed | `cee0973` | 23/23 contract tests, 56/56 direct consumer tests, package typecheck and build passed | Five versioned contracts, bundle invariants and loss-aware V1 adapter with explicit migration issues |
| WP-02 Repository snapshot | queued | — | — | Next packet |
| WP-03 GraphRevision | queued | — | — | — |
| WP-04 WorkBreakdown | queued | — | — | — |
| WP-05 Graph Compiler | queued | — | — | — |
| WP-06 RunCoordinator kernel | queued | — | — | — |
| WP-07 Event store | queued | — | — | — |
| WP-08 Planning V2 slice | queued | — | — | — |
| WP-09 Artifacts and fingerprints | queued | — | — | — |
| WP-10 Scheduler readiness V2 | queued | — | — | — |
| WP-11 ExecutionBaseBuilder | queued | — | — | — |
| WP-12 Execution coordination | queued | — | — | — |
| WP-13 Failure recovery | queued | — | — | — |
| WP-14 EvidenceMatrix | queued | — | — | — |
| WP-15 Integration manifests | queued | — | — | — |
| WP-16 Final candidate and delivery | queued | — | — | — |
| WP-17 Workspace web V2 | queued | — | — | — |
| WP-18 Legacy retirement | queued | — | — | Split into WP-18A through WP-18D during execution |
| WP-19 Migration and E2E | queued | — | — | — |

## WP-00 evidence

### Baseline preparation

- Created integration branch `codex/target-architecture-v2` from `b02e907`.
- Separated existing work into:
  - `6cde401 feat(proto): add presentation fixtures and playback controls`;
  - `bf24862 docs: define target architecture and migration plan`.
- Confirmed a clean worktree before starting WP-00.

### Red-green evidence

The initial narrow run failed only because the representative V1 fixture did
not exist:

```text
ENOENT: tests/fixtures/current-run-record-v1.json
Test Files 1 failed | 1 passed
Tests 1 failed | 4 passed
```

After adding the fixture:

```text
Test Files 2 passed (2)
Tests 5 passed (5)
```

Command:

```bash
pnpm test -- tests/architecture-baseline.test.ts tests/run-current-flow-characterization.test.ts
```

### Baseline verification before WP-00

```text
Focused fixture/DAG suites: 7 files passed, 332 tests passed
Package typechecks: 12 workspace packages passed
Web TypeScript check: passed
```

### Known baseline limitation

`pnpm typecheck` at the repository root is not a green gate before this
migration: it typechecks the complete historical test tree and currently reports
pre-existing errors, primarily V1 fixtures missing the inferred defaulted
`planRevision`, older run-event names and several unrelated strict typing
issues. Package typechecks and the web typecheck are green. These errors were
not introduced or broadened by WP-00 and must not be represented as a passing
baseline until a later packet owns their migration.

## Gate status

| Gate | Status | Evidence required to close |
|---|---|---|
| G1 Contracts executable | open | WP-01, WP-03, WP-04 and WP-05 integrated and reviewed |
| G2 Canonical history | not_started | WP-07 and WP-08 |
| G3 Exact adoption | not_started | WP-09 through WP-11 |
| G4 Honest verification | not_started | WP-14 |
| G5 Real delivery | not_started | WP-16 |
| G6 Single architecture | not_started | WP-18 |

## WP-01 evidence

### Red-green evidence

Before implementation, both new suites failed because the V2 schemas and
adapter did not exist:

```text
Test Files 2 failed (2)
Tests 9 failed (9)
```

After implementation:

```text
Contract suites: 4 files passed, 23 tests passed
Direct consumer suites: 3 files passed, 56 tests passed
@manyhands/contracts typecheck: passed
@manyhands/contracts build including declarations: passed
```

Commands:

```bash
pnpm test -- tests/contracts-v2.test.ts tests/contracts-v1-compatibility.test.ts tests/contract-boundary-validation.test.ts tests/contracts-interface-contract.test.ts
pnpm test -- tests/decomposer-recursive.test.ts tests/execution-core-types.test.ts tests/task-graph-graft.test.ts
pnpm --filter @manyhands/contracts typecheck
pnpm --filter @manyhands/contracts build
```

### Implemented contract

- Added versioned `TaskContract`, `ScopeContract`, `SeamContract`,
  `ArtifactContract` and `ValidationContract` schemas.
- Added strict bundle validation for references, revisions, task ownership and
  acceptance-criterion coverage.
- Rejected unsafe repo paths and structurally impossible self-consumption.
- Added deterministic content-derived legacy revisions.
- V1 dependencies, commands and incomplete seams are emitted as explicit
  `migrationIssues`; the adapter does not invent V2 evidence or relations.

## Resume instructions

1. Confirm `git branch --show-current` is `codex/target-architecture-v2`.
2. Confirm `git status --short` is clean.
3. Read the `Current checkpoint` table above.
4. Start only the packet named in `Current packet`.
5. On completion, update its row, evidence, current packet and gate status before
   moving to the next packet.
