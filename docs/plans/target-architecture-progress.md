# Target Architecture Transition — Progress Ledger

> Durable checkpoint for `2026-07-17-target-architecture-transition.md`.
> Update this file after every completed work packet. A packet is `completed`
> only after its required verification passes and its implementation commit is
> recorded here.

## Current checkpoint

| Field | Value |
|---|---|
| Integration branch | `codex/target-architecture-v2` |
| Current packet | `WP-06 — Kernel framework-independent de RunCoordinator` |
| Last completed packet | `WP-05 — Graph Compiler y critics V2` |
| Open gate | G2 — Canonical history |
| Baseline fixture/UI commit | `6cde401` |
| Target docs and plan commit | `bf24862` |
| WP-00 implementation commit | `d381f61` |
| WP-01 implementation commit | `cee0973` |
| WP-02 implementation commit | `a5eac15` |
| WP-03 implementation commit | `15e027b` |
| WP-04 implementation commit | `180ed88` |
| WP-05 implementation commit | `3d39ac4` |
| Last updated | 2026-07-17 |

## Packet ledger

| Packet | Status | Implementation commit | Verification | Notes |
|---|---|---|---|---|
| WP-00 Baseline | completed | `d381f61` | 5/5 narrow tests passed | V1 run fixture, current lifecycle characterization, package boundary guard and frozen `@manyhands/core` allowlist |
| WP-01 Contracts V2 | completed | `cee0973` | 23/23 contract tests, 56/56 direct consumer tests, package typecheck and build passed | Five versioned contracts, bundle invariants and loss-aware V1 adapter with explicit migration issues |
| WP-02 Repository snapshot | completed | `a5eac15` | 14/14 focused tests, package typecheck and build passed | Immutable snapshot identity, content hashing, capabilities and explicit partial/unavailable inspection |
| WP-03 GraphRevision | completed | `15e027b` | 36/36 graph and scheduler tests, package typecheck and build passed | Typed relations, artifact-based readiness, immutable revisions and loss-aware V1 adapter |
| WP-04 WorkBreakdown | completed | `180ed88` | 33/33 focused tests, package typecheck and build passed | Semantic recursive schema, grounded prompt, bounded repair, cache and explicit model failure |
| WP-05 Graph Compiler | completed | `3d39ac4` | 38/38 cross-boundary tests, four package typechecks and decomposer build passed | Deterministic compiler, complete V2 bundles, traceability and eight structured critics; G1 closed |
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
| G1 Contracts executable | closed | WP-01 through WP-05 integrated; schemas, typed relations, semantic breakdown, compiler and critics are green |
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

## WP-02 evidence

### Red-green evidence

Before implementation, the new suites failed because the snapshot builder and
file-content hash did not exist:

```text
Test Files 2 failed (2)
Tests 5 failed (5)
```

After implementation:

```text
Focused repository and consumer suites: 4 files passed, 14 tests passed
@manyhands/repository-index typecheck: passed
@manyhands/repository-index build including declarations: passed
```

Commands:

```bash
pnpm test -- tests/repository-snapshot.test.ts tests/repository-index.test.ts tests/repository-aware-scheduling.test.ts tests/planning-budget.test.ts
pnpm --filter @manyhands/repository-index typecheck
pnpm --filter @manyhands/repository-index build
```

### Implemented snapshot boundary

- Snapshot identity is derived from target fingerprint, base commit, repository
  content hash, inspection disposition and discovered capabilities; capture time
  and local absolute path do not destabilize identity.
- File content contributes to the repository index hash even when the symbol
  topology remains unchanged.
- Package manager, scripts, TypeScript/JavaScript coverage, known stack signals
  and runnable baseline commands are persisted as capabilities with evidence.
- Index failures and unsupported repositories produce explicit `unavailable`
  and `partial` snapshots with diagnostics instead of a silent empty success.

## WP-03 evidence

### Red-green evidence

Before implementation, both new suites failed because no GraphRevision V2 API
existed:

```text
Test Files 2 failed (2)
Tests 10 failed (10)
```

After implementation:

```text
Focused V1/V2 graph suites: 3 files passed, 16 tests passed
Graph plus scheduler consumer suites: 5 files passed, 36 tests passed
@manyhands/task-graph typecheck: passed
@manyhands/task-graph build including declarations: passed
```

Commands:

```bash
pnpm test -- tests/task-graph-v2.test.ts tests/task-graph-v1-compatibility.test.ts tests/task-graph-graft.test.ts tests/scheduler-scope-aware-wave.test.ts tests/execution-core-batch-scheduler.test.ts
pnpm --filter @manyhands/task-graph typecheck
pnpm --filter @manyhands/task-graph build
```

### Implemented graph boundary

- V2 nodes express hierarchy only through `parentId` and contain no dependency
  shortcut requiring synchronization.
- Artifact requirements alone determine execution readiness; seam bindings
  enforce a shared contract revision without imposing order, and conflict
  constraints remain scheduler metadata.
- Hierarchy roles, cycles, relation endpoints, relation identity and root
  integrity are validated independently of V1.
- `reviseGraph` applies typed operations to a clone, enforces optimistic
  revision matching and rejects an invalid next revision without mutating the
  approved predecessor.
- The V1 adapter promotes an ordering edge only when producer output and
  consumer upstream-artifact evidence match. Ambiguous edges become deprecated
  `legacyOrderingConstraints` and force replan; matching interfaces become
  non-ordering seam bindings.

## WP-04 evidence

### Red-green evidence

Before implementation, the WorkBreakdown suite failed because the schema,
planner and prompt API did not exist:

```text
Test Files 1 failed (1)
Tests 10 failed (10)
```

After implementation:

```text
Focused planning and legacy guard suites: 4 files passed, 33 tests passed
@manyhands/decomposer typecheck: passed
@manyhands/decomposer build including declarations: passed
```

Commands:

```bash
pnpm test -- tests/decomposer-work-breakdown.test.ts tests/decomposer-recursive-prompt.test.ts tests/decomposer-policy.test.ts tests/decomposer-llm-guards.test.ts
pnpm --filter @manyhands/decomposer typecheck
pnpm --filter @manyhands/decomposer build
```

### Implemented semantic planning boundary

- Recursive semantic units are cut by cohesion, integration, risk or
  verifiability, without a target depth, child count or layer template.
- A leaf may be a vertical slice spanning UI, API and tests when that is the
  cohesive independently verifiable increment.
- Strict schemas reject worktrees, exact commands, executor profiles and
  generic dependency fields instead of leaking compiler decisions into the
  model output.
- Candidate artifacts and seams carry producer, consumers, purpose and
  repository evidence; uncertainties and consequential human questions retain
  their grounding.
- The V2 planner has a content-addressed cache, bounded schema repair and the
  existing multi-candidate JSON normalization. Exhausted model attempts fail
  explicitly; no synthetic or deterministic fallback is created.

## WP-05 evidence

### Red-green evidence

After the snapshot fixture was made valid, the new suites failed because the
compiler and critic APIs did not exist:

```text
Test Files 2 failed (2)
Tests 7 failed (7)
```

After implementation and the atomic-root review:

```text
Compiler, critics and adjacent architecture suites: 7 files passed, 38 tests passed
Atomic-root and focused planning suites: 5 files passed, 30 tests passed
contracts, repository-index, task-graph and decomposer typechecks: passed
@manyhands/decomposer build including declarations: passed
execution-core seam prompt regression: 34 tests passed
```

Commands used for unambiguous file selection with pnpm 11:

```bash
node node_modules/vitest/vitest.mjs run tests/graph-compiler.test.ts tests/graph-critics-v2.test.ts tests/decomposer-recursive-planning-flow.test.ts tests/decomposer-work-breakdown.test.ts tests/contracts-v2.test.ts tests/task-graph-v2.test.ts tests/repository-snapshot.test.ts
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/repository-index/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/task-graph/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/decomposer/tsconfig.json --noEmit
corepack pnpm --filter @manyhands/decomposer build
```

### Implemented executable compilation boundary

- The pure compiler consumes exactly one validated WorkBreakdown and its
  referenced RepositorySnapshot; identity and clock are injected.
- Every leaf receives a Task, Scope, Artifact, Seam and Validation contract
  bundle with deterministic content revisions and repository-grounded scope.
- Seams across siblings compile to compatible bindings without readiness
  order. Materialized artifacts compile to ArtifactRequirements; logical
  artifacts do not invent a dispatch barrier.
- Scope overlap compiles to an explicit ConflictConstraint. Every compiled
  relation retains a trace to its semantic candidate or repository evidence.
- Completeness, atomicity, contract compatibility, DAG validity, scope
  isolation, artifact coverage, risk uncertainty and validation coverage
  produce structured findings with repair guidance.
- Consequential unresolved questions, ungrounded scopes, missing validation and
  orphan outputs block approval instead of being normalized away.
- A single atomic leaf is a valid root revision; multi-node executable leaves
  still cannot own children.

### Supporting commits and environment repair

- `a0b7909` allows a single atomic root revision before the G1 schema freeze.
- `3066622` resolves the pre-existing pnpm 11 `allowBuilds` placeholder for the
  already-declared `node-pty` production dependency. Installs now complete with
  the repository-pinned pnpm 11.7.0 via Corepack.
- `546335e` corrects a V1 execution test fixture that simultaneously consumed
  and produced the same seam. It now uses distinct producer and consumer leaves
  and the complete 34-test executor suite passes.

## Resume instructions

1. Confirm `git branch --show-current` is `codex/target-architecture-v2`.
2. Confirm `git status --short` is clean.
3. Read the `Current checkpoint` table above.
4. Start only the packet named in `Current packet`.
5. On completion, update its row, evidence, current packet and gate status before
   moving to the next packet.
