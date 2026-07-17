# Target Architecture Transition — Progress Ledger

> Durable checkpoint for `2026-07-17-target-architecture-transition.md`.
> Update this file after every completed work packet. A packet is `completed`
> only after its required verification passes and its implementation commit is
> recorded here.

## Current checkpoint

| Field | Value |
|---|---|
| Integration branch | `codex/target-architecture-v2` |
| Current packet | `WP-14 — ValidationRecipe and EvidenceMatrix` |
| Last completed packet | `WP-13 — Failure recovery and amendments V2` |
| Open gate | G4 — Honest verification |
| Baseline fixture/UI commit | `6cde401` |
| Target docs and plan commit | `bf24862` |
| WP-00 implementation commit | `d381f61` |
| WP-01 implementation commit | `cee0973` |
| WP-02 implementation commit | `a5eac15` |
| WP-03 implementation commit | `15e027b` |
| WP-04 implementation commit | `180ed88` |
| WP-05 implementation commit | `3d39ac4` |
| WP-06 implementation commit | `9de4893` |
| WP-07 implementation commit | `f1c0428` |
| WP-08 implementation commit | `9c08157` |
| WP-09 implementation commit | `b0c0fb0` |
| WP-09 contract-identity correction | `a697974` |
| WP-10 implementation commit | `1623025` |
| WP-11 implementation commit | `824332d` |
| WP-12 implementation commit | `4e8ad12` |
| WP-13 implementation commit | `9b074cc` |
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
| WP-06 RunCoordinator kernel | completed | `9de4893` | 9/9 packet tests, 12/12 with baseline, package typecheck/build and full package build passed | Framework-independent event-folded lifecycle, explicit outcomes and decisions, guarded commands, cancellation fencing and receipt-backed completion |
| WP-07 Event store | completed | `f1c0428` | 19/19 packet, durability and baseline tests; run-store/core typechecks and builds passed | Canonical JSONL events with CAS, idempotency and durable fencing; discardable snapshots; audited legacy importer; V1 snapshot isolated in core |
| WP-08 Planning V2 slice | completed | `9c08157` | 33/33 packet and adjacent tests; coordinator, orchestrator and web typechecks; three package builds passed | Opt-in productive inspector-to-approval path, selected CLI with bounded retries/timeouts, canonical facts, revision CAS and compatible RunRecord projection; G2 closed |
| WP-09 Artifacts and fingerprints | completed | `b0c0fb0` | 12/12 packet and legacy journal tests; coordinator/store typechecks and builds passed | Canonical full-input fingerprint, immutable artifact/attempt registries and one exact adoption gate with explicit stale event |
| WP-10 Scheduler readiness V2 | completed | `1623025` | 26/26 packet and scheduling regressions; scheduler/conflict-risk typechecks and builds passed | Pure per-node readiness reasons, artifact/decision scoped blocking, required effective maxParallel and evidenced conflict constraints with unknown risk |
| WP-11 ExecutionBaseBuilder | completed | `824332d` | 56/56 packet and execution regressions; execution-core/web typechecks and execution-core build passed | Exact declared artifact materialization, structured pre-dispatch conflicts, reproducible base manifests and reserved-attempt fingerprint validation |
| WP-12 Execution coordination | completed | `4e8ad12` | 28/28 packet and StateGraph/audit regressions; coordinator/orchestrator/web typechecks and package builds passed | Command-driven readiness, local decisions, durable wave-before-dispatch boundary and fenced web V2 host adapter |
| WP-13 Failure recovery | completed | `9b074cc` | 28/28 packet and legacy replan regressions; coordinator/execution-core/web typechecks and package builds passed | Cause-specific recovery policy, evidenced immutable graph amendments and exact fingerprint invalidation with V1 closure retained only as compatibility behavior |
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
| G2 Canonical history | closed | WP-07 canonical event persistence and WP-08 productive planning slice use the same fenced event history; RunRecord is compatibility projection only |
| G3 Exact adoption | closed | WP-09 through WP-11 provide canonical fingerprints, immutable adoption, exact artifact readiness and reproducible physical execution bases |
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

## WP-06 evidence

### Red-green evidence

The first focused run proved that neither the package nor its public boundary
existed: the lifecycle suite could not resolve `@manyhands/run-coordinator` and
both package-boundary assertions failed.

After implementing and hardening the kernel:

```text
WP-06 lifecycle and boundary suites: 2 files passed, 9 tests passed
WP-06 plus architecture baseline: 3 files passed, 12 tests passed
run-coordinator typecheck: passed
@manyhands/run-coordinator build: passed
all workspace package builds: passed
```

### Implemented run kernel

- Lifecycle and execution, artifact and delivery outcomes are separate domain
  concepts; `completed` requires a verified final candidate and its matching
  confirmed delivery receipt.
- Run state is folded from ordered domain facts. Invalid sequences, duplicate
  event identifiers, mismatched runs and illegal lifecycle transitions fail
  explicitly.
- Decisions carry kind, options, affected nodes, evidence and impact. A pending
  decision only derives `waiting_for_input` when no independent node remains
  ready.
- Commands are previewed through the reducer before append, preventing an
  invalid fact from corrupting canonical history.
- Cancellation invalidates authority before requesting process termination and
  only records interruption after every owned process is confirmed dead.
- The package has no dependency on web frameworks, persistence, Git,
  `execution-core`, `orchestrator-graph` or `run-store`.

## WP-07 evidence

### Red-green evidence

All five initial persistence scenarios failed because the V2 event-store API
did not exist. After the implementation and concurrency hardening:

```text
WP-07 own suites: 3 files passed, 8 tests passed
WP-07 plus legacy durability and architecture baseline: 6 files passed, 19 tests passed
run-store and core typechecks: passed
@manyhands/run-store and @manyhands/core builds: passed
```

### Implemented canonical persistence

- `JsonlRunEventStore` assigns sequences under expected-sequence CAS,
  deduplicates exact retries by stable `eventId` and rejects mixed or divergent
  retries.
- Every append and snapshot requires the current operation id and monotonic
  fencing token. An atomic filesystem lock serializes writers across package
  instances and processes; a superseded owner cannot publish events, delivery
  receipts or cache state.
- JSONL records are checksummed and schema-versioned. A final incomplete line
  preserves the valid prefix and is replaced on the next append; middle,
  checksum or domain-history corruption fails explicitly.
- `RunSnapshotStore` treats projections as disposable cache entries. Corrupt,
  stale-sequence or stale-authority snapshots are rebuilt by folding canonical
  events.
- `LegacyRunRecordImporter` requires an approving actor and an explicit lossy
  mapping, returning source hash, warnings and import metadata instead of
  projecting legacy records as fictitious observed facts.
- The productive `run-store` package now depends only on `run-coordinator`,
  `shared` and schema support. The V1 snapshot surface remains available from
  the already-legacy `core` package until WP-18.

## WP-08 evidence

### Red-green evidence

The two V2 planning suites initially failed at module resolution because no V2
web host existed. After the slice and approval path were implemented:

```text
WP-08 named suites plus coordinator/store regressions: 7 files passed, 33 tests passed
Broader run-create compatibility sample: 8 files passed, 38 tests passed
run-coordinator, orchestrator-graph and web typechecks: passed
run-coordinator, run-store and orchestrator-graph builds: passed
```

### Implemented planning slice

- Runs explicitly created with `architectureVersion.planning=v2` require an
  immutable captured local Git target and are dispatched to the V2 host. Runs
  without that opt-in remain V1 until execution and integration V2 exist.
- The productive host claims the existing durable operation lease, mirrors its
  fencing token into `run-store`, renews heartbeat during model work and uses
  only the selected Claude Code or Codex CLI. Attempts have explicit timeout,
  supervised process termination and schema-repair feedback; there is no
  deterministic fallback.
- One pipeline records `run.created`, the complete repository snapshot,
  WorkBreakdown, compiled graph/contracts/trace, one event for every critic,
  the graph proposal and its revision-specific approval decision.
- Model or compilation failure records `planning.failed` and folds to `failed`
  without substituting another planner.
- Approval resolves the exact decision and graph revision under sequence CAS.
  A semantic edit must preserve graph identity, increment revision exactly
  once, makes the prior approval inapplicable and raises a new decision.
- The legacy LangGraph planning StateGraph is now explicitly the V1 adapter;
  V2 lifecycle and facts come only from RunCoordinator events. Existing API
  readers receive a compatibility RunRecord projection, not a second semantic
  write model.

## WP-09 evidence

### Red-green evidence

All five initial identity and registry tests failed because fingerprint,
artifact and attempt APIs did not exist. The completed packet produced:

```text
WP-09 plus legacy task-attempt journal: 4 files passed, 12 tests passed
run-coordinator and run-store typechecks: passed
run-coordinator and run-store builds: passed
```

### Implemented exact adoption identity

- `InputFingerprint` hashes graph and node identity, every relevant contract
  revision, base commit, consumed artifact ids and digests, repository context,
  executor profile revision and validation contract revision. Set-like inputs
  are uniqueness-checked and canonically sorted.
- Attempts are immutable records. A retry gets a new identity and points to its
  predecessor; prior evidence remains in the append-only registry.
- Adopted artifacts are immutable and include content digest, producer attempt,
  producing node, contract revision, kind, location and adoption time. Exact
  retries are idempotent; divergent reuse of an id fails.
- `adoptAttemptResult` is the single productive eligibility gate. A finished
  attempt with a mismatched fingerprint returns `attempt.stale` and never calls
  the artifact registry; an exact match records the artifact and emits
  `artifact.adopted`.

Supporting correction `a697974` aligns artifact, validation, executor-profile
and contract revisions with the repository's content-identity string contract;
only graph revisions remain monotonic integers.

## WP-10 evidence

### Red-green evidence

All five initial scheduler/constraint cases failed because the V2 APIs did not
exist. The final verification produced:

```text
WP-10 and adjacent scheduling suites: 4 files passed, 26 tests passed
scheduler and conflict-risk typechecks: passed
scheduler and conflict-risk builds: passed
```

### Implemented explainable readiness

- `explainReadiness` is pure and returns every applicable reason: exact missing
  artifact revision, stale contract, affected unresolved decision,
  unmaterializable base, active resource constraint, exhausted budget,
  unavailable executor or already-adopted node.
- Seam compatibility never creates readiness order. An artifact requirement
  blocks only its declared consumer, and a decision blocks only its affected
  node set.
- `selectReadyWaveV2` consumes the persisted effective `maxParallel`; missing
  or invalid values fail instead of being defaulted inside the scheduler.
- Conflict constraints retain signals, confidence, observation and expiry.
  Missing evidence yields `unknown`, never fabricated `low`; unknown, high and
  blocking pairs are not co-scheduled.

## WP-11 evidence

### Red-green evidence

The five initial exact-base and attempt-identity cases failed because no base
builder existed, the legacy attempt adapter discarded `inputFingerprint`, and
the executor had no exact-base seam. The final verification produced:

```text
WP-11 and execution regressions: 6 files passed, 56 tests passed
execution-core typecheck: passed
web TypeScript check: passed
execution-core build including declarations: passed
git diff --check: passed
```

### Implemented exact execution bases

- `ExecutionBaseBuilder` starts from the declared repository commit and
  materializes only the ordered artifacts named by the request. It never scans
  siblings or pulls transitive commits from graph ancestry.
- Commit artifacts are cherry-picked through the existing Git seam. Conflict,
  empty application, Git error and unsupported artifact kinds produce typed,
  structured evidence; a failed build aborts the cherry-pick and cleans its
  managed worktree before an executor can be invoked.
- `ExecutionBaseManifest` records repository base, contract baseline, each
  artifact id/digest/contract revision, every pre/post materialization SHA,
  resulting SHA, exact input fingerprint and creation time.
- The worktree handed to result recording uses the fully materialized SHA as
  its diff baseline. Dependency changes therefore cannot be misattributed to
  the executing agent.
- `RunExecutor.runNode` exposes an opt-in V2 exact-base seam and checks the
  attempt's reserved fingerprint both before materialization and after agent
  execution. Legacy execution remains explicit by omitting this input until
  WP-12/WP-14 migrate the productive coordinator path.
- The temporary web attempt journal now durably preserves a canonical
  `inputFingerprint` while retaining backward compatibility for V1 attempts.

## WP-12 evidence

### Red-green evidence

The initial coordination tests failed because no execution cursor, local
decision predicate or durable V2 wave event existed. The final verification
produced:

```text
WP-12 packet and StateGraph/audit regressions: 4 files passed, 28 tests passed
run-coordinator typecheck: passed
orchestrator-graph typecheck: passed
web TypeScript check: passed
run-coordinator and orchestrator-graph builds: passed
git diff --check: passed
```

### Implemented local-decision execution

- `RunExecutionCoordinator` recomputes readiness from canonical facts, records
  that observation, validates the selected subset against persisted
  `maxParallel`, records `wave.selected`, and only then permits parallel
  dispatch. A failed append or stale fence therefore dispatches nothing.
- Pending decisions block only their `affectedNodeIds`. Independent ready work
  keeps the lifecycle `running`; `waiting_for_input` is derived only when no
  ready nodes remain and at least one decision is pending.
- Resolution records `decision.resolved` and recomputes readiness. It does not
  assign node statuses or edit a checkpoint imperatively.
- Selected waves are durable projection facts with stable ids and effective
  parallelism. Invalid, duplicate, oversized or non-ready selections fail in
  the coordinator reducer before persistence.
- The web V2 host binds this cursor to the fenced JSONL event journal. The
  existing LangGraph execution graph is explicitly documented as a V1
  compatibility branch-cursor adapter, not the V2 lifecycle authority.

## WP-13 evidence

### Red-green evidence

All twelve initial classifier, amendment and invalidation cases failed because
the recovery domain did not exist. The completed packet produced:

```text
WP-13 and legacy replan regressions: 5 files passed, 28 tests passed
run-coordinator typecheck: passed
execution-core typecheck: passed
web TypeScript check: passed
run-coordinator and execution-core builds: passed
git diff --check: passed
```

The expected stderr from legacy replan-question fixtures was preserved: those
tests intentionally launch background recovery against incomplete fixture
repositories and assert the resulting durable failure or resumable gate.

### Implemented cause-specific recovery

- Failures are classified as transient, environment/auth/executor, code/test,
  contract/decomposition, undeclared artifact, scope/unexpected commit,
  integration or shared infrastructure. Classification compiles to an explicit
  action set, automatic retry budget and mandatory candidate-discard rule.
- Scope violations and unexpected agent commits always discard the candidate;
  no policy can auto-adopt them. Environment and shared-infrastructure causes
  do not consume blind code-retry loops.
- `failure.classified` persists the observation, class, allowed actions, retry
  budget and disposition. `graph.amendment.proposed` persists rationale,
  evidence and operations before approval.
- A discovered artifact dependency becomes an evidenced proposal over the
  current graph identity. Approval applies operations through `reviseGraph`,
  producing a new immutable revision and rejecting stale proposals.
- V2 invalidation compares each attempt's complete old and current input
  fingerprint. Only mismatches become stale; unchanged independent work is
  retained even when graph ancestry or another branch changes.
- The legacy closure-based amendments engine remains available for V1 recovery
  while exposing exact fingerprint invalidation for the V2 migration. Its
  existing replan and question-gate suites remain green.

## Resume instructions

1. Confirm `git branch --show-current` is `codex/target-architecture-v2`.
2. Confirm `git status --short` is clean.
3. Read the `Current checkpoint` table above.
4. Start only the packet named in `Current packet`.
5. On completion, update its row, evidence, current packet and gate status before
   moving to the next packet.
