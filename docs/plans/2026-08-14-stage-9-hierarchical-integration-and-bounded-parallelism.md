# Stage 9 Hierarchical Integration and Bounded Parallelism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the repository's TDD and
> plan-execution workflow to implement this plan one task at a time. Steps use
> checkbox (`- [ ]`) syntax for tracking. Read
> [`the redesign plan`](2026-08-12-correctness-first-system-redesign.md) Stage 9
> and [`the approved design`](../superpowers/specs/2026-08-14-stage-9-hierarchical-integration-design.md)
> in full before changing production code.

**Goal:** Integrate children through exact child artifacts under parent-owned
resources, route repair to the lowest authority that can fix a failure, and
execute ready leaves with real bounded parallelism.

**Architecture:** Keep Stage 6's canonical route and Stage 7's Git-native
transport. The scheduler stays pure. `CanonicalExecutionDriver` gains bounded
concurrency with a single serialized journal-append point. `CanonicalNodeExecutor`
executes composite attempts over exact child change-set manifests under the same
scope enforcer as a leaf. `run-coordinator` owns repair routing; the executor
only classifies causes. Concurrency lives inside the supervised worker, not the
daemon: per-attempt durable process effects are Stage 10 work.

**Tech Stack:** TypeScript, Zod, pnpm workspace, Vitest, Git CLI through
GitRunner, JSONL journal and stores, tsup.

## Global Constraints

- Stage 9 is **not authorized to start** until Stage 8 / GLeaf passes. GLeaf is
  `in_review` pending one live R0 re-run under the corrected capability record.
- The host's global `pnpm` is 7.29.3 and incompatible with the repository's
  pinned 11.21.0. Every command in this plan uses `corepack pnpm`.
- Tests never call a model, never use the network, never open a browser. Use
  fixtures, stubs, replay, real temporary Git and controlled processes.
- `core.autocrlf=false`. For each modified file compare against
  `git show HEAD:<path>` and keep its line-ending convention. Inspect
  `git diff --numstat` before committing; a whole-file add/remove count means an
  accidental EOL conversion.
- No new dependency may be added to `@manyhands/core`.
- Commits are local. Do not push.
- No stage closes without `corepack pnpm test` in full on the exact handoff tree,
  not on the previous commit.

---

## Entry state and scope

- Stage 7 / GA passed; Stage 8 / GLeaf is `in_review` with the Codex-only scope
  amendment applied and one deferred live re-run.
- Already present and **not** to be rebuilt: `ResourceClaim` in
  `packages/contracts/src/canonical-graph-relations.ts`; readiness against active
  claims in `packages/scheduler/src/canonical-frontier.ts`; bounded selection in
  `packages/scheduler/src/wave-selector-v2.ts`; leaf/integration attempt split
  and `integration.started` in
  `packages/orchestrator-graph/src/canonical-execution-driver.ts`; the
  integration request/result manifests in
  `packages/execution-core/src/integration/manifest.ts`; the durable
  `IntegrationOperationJournal`; Stage 7 change-set manifests and exact
  materialization.
- Out of scope: delivery publication, the Stage 10 restart matrix, per-attempt
  process effects, any live model run, the longitudinal study, thesis work.

## Invariants

1. A composite is a node with children, not a node with privileges. The same
   `ScopeChecker` and scope policy apply to leaf and composite attempts.
2. A composite may write only resources it claims. Touching a child-owned
   resource is `ownership_violation` and routes to a plan amendment, never to a
   repair.
3. Integration consumes exact child change-set manifests. No cherry-pick, no
   commit ancestry traversal, no text patch, no commit-as-transport.
4. Two nodes with no ordering between them never hold `modify` claims on the
   same resource. Readiness enforces it; selection asserts it again.
5. A failing attempt fails only itself. Siblings continue.
6. Every journal append passes through one serialized point. The
   `expectedSequence` single-writer contract is unchanged by concurrency.
7. Repair goes to the lowest authority that can fix the failure. A new candidate
   makes downstream evidence stale.
8. Soft integration risk is a recorded observation with no authority over
   selection. Learned weights stay disabled while unattributed.

## TDD execution tasks

### Task 1: Pin the Stage 9 productive boundary

**Files:**

- Create `tests/stage9-productive-boundary.test.ts`.

**Interfaces:**

- Consumes: `CanonicalExecutionDriver` from `@manyhands/orchestrator-graph`,
  `CanonicalNodeExecutor` from `@manyhands/execution-core`.
- Produces: the characterization fixtures later tasks reuse — a two-leaf
  composite graph builder exported from the test file as
  `buildCompositeGraphFixture()`.

**Steps:**

- [ ] **Step 1: Read the productive path.** Trace
  `canonical-execution-driver.ts` `run()`, `createAttempt()`, `recordOutcome()`;
  `v2/node-executor.ts` integration block; `scope/checker.ts`;
  `integration/operation-journal.ts`.
- [ ] **Step 2: Write the failing tests.** Three RED tests, each failing for the
  reason named:
  - `"executes a ready wave concurrently"` — a graph with two independent ready
    leaves and `maxParallel: 2`, with an `execute` stub that records enter/exit
    timestamps. Assert the two intervals overlap. Fails today because the wave
    loop is serial.
  - `"refuses a composite manifest that writes a child-owned resource"` — a
    composite whose produced change-set touches a path covered by a child's
    `modify` `ResourceClaim`. Assert the attempt fails with cause
    `ownership_violation`. Fails today because nothing checks it.
  - `"never reaches a cherry-pick integration state"` — assert the durable
    `IntegrationOperation` written by a canonical composite attempt never takes
    state `cherry_pick_started` and never records
    `application: "cherry_picked"`.
- [ ] **Step 3: Verify RED.**

```bash
corepack pnpm vitest run tests/stage9-productive-boundary.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

  Expected: 3 failed, each with the stated reason. A test that fails on a
  missing import is not yet red for the right reason — fix the fixture first.
- [ ] **Step 4: Commit.**

```bash
git add tests/stage9-productive-boundary.test.ts
git commit -m "test: pin Stage 9 hierarchical integration boundary"
```

### Task 2: Parent-owned resources for composite attempts

**Files:**

- Modify `packages/execution-core/src/v2/node-executor.ts` (integration block,
  from the `createIntegrationRequestManifest` call to candidate adoption).
- Modify `packages/execution-core/src/scope/checker.ts` only if
  `ScopeCheckParams` cannot already express a claim-derived owned path set.
- Create `packages/execution-core/src/integration/resource-authority.ts`.
- Extend `tests/stage9-productive-boundary.test.ts`; create
  `tests/stage9-parent-authority.test.ts`.

**Interfaces:**

- Produces:

```ts
export type IntegrationAuthorityViolation = {
  kind: "ownership_violation";
  path: string;
  ownedByNodeId: string;
  attemptedByNodeId: string;
};

export function checkParentResourceAuthority(input: {
  compositeNodeId: string;
  claims: readonly ResourceClaim[];
  changedPaths: readonly string[];
}): IntegrationAuthorityViolation[];
```

**Steps:**

- [ ] **Step 1: Write the failing test** in
  `tests/stage9-parent-authority.test.ts`: a composite claiming `src/app/**` and
  a child claiming `src/lib/db.ts` with `access: "modify"`. A composite result
  touching `src/lib/db.ts` yields exactly one violation naming the child node;
  a composite result touching only `src/app/wire.ts` yields none. Include the
  boundary case where composite and child claim the *same* path — that is still
  a violation, because the child's `modify` claim is the authority.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run tests/stage9-parent-authority.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

  Expected: FAIL, `checkParentResourceAuthority is not a function`.
- [ ] **Step 3: Implement** `resource-authority.ts` as a pure function over the
  graph's `resourceClaims`, and call it from the composite path in
  `node-executor.ts` after the integration result manifest is produced and
  before the candidate is adopted. On violation return
  `{ kind: "failure", reason: "ownership_violation: ..." }` with the violating
  path and owner in the reason.
- [ ] **Step 4: Apply the leaf scope enforcer to composites.** In the same
  block, run `ScopeChecker.check` with the composite's `contract.scope` and
  `config.scopePolicy`, exactly as the leaf path does.
- [ ] **Step 5: Verify GREEN.**

```bash
corepack pnpm vitest run tests/stage9-parent-authority.test.ts tests/stage9-productive-boundary.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

  Expected: the parent-authority tests and the composite boundary test pass. The
  concurrency and cherry-pick tests still fail; they belong to Tasks 3 and 5.
- [ ] **Step 6: Commit.**

```bash
git add packages/execution-core/src tests/stage9-parent-authority.test.ts
git commit -m "feat(stage9): enforce parent-owned resources on composite attempts"
```

### Task 3: Exact child artifacts only

**Files:**

- Modify `packages/execution-core/src/integration/operation-journal.ts`
  (`IntegrationOperationState`, `IntegrationOperationChild.application`).
- Modify `packages/execution-core/src/v2/node-executor.ts`
  `repairIntegration`, removing commit-as-transport reasoning.
- Modify `packages/execution-core/src/integration/manifest.ts` if it accepts a
  commit-shaped child artifact.
- Extend `tests/stage9-productive-boundary.test.ts`; create
  `tests/stage9-exact-child-artifacts.test.ts`.

**Interfaces:**

- Produces: `IntegrationOperationChild.application` narrowed to
  `"already_satisfied" | "manifest_materialized" | "repaired"`.
  `IntegrationOperationState` loses `cherry_pick_started`.

**Steps:**

- [ ] **Step 1: Write the failing test.** A canonical composite attempt over two
  child change-set manifests records `application: "manifest_materialized"` for
  each child; feeding it a commit-kind artifact is rejected before any Git side
  effect, with no worktree mutation. Assert the rejection happens before the
  integration operation reaches `validation_started`.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run tests/stage9-exact-child-artifacts.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Implement.** Narrow the union types, delete the cherry-pick
  branch from the canonical route, and make the commit-artifact rejection an
  explicit typed failure rather than a downstream Git error.
- [ ] **Step 4: Migration check.** Historical journals may contain
  `cherry_pick_started` and `cherry_picked`. Add a read-side tolerance that
  accepts them when replaying an existing operation and a test proving a
  historical fixture still loads. Never write them again.
- [ ] **Step 5: Verify GREEN.**

```bash
corepack pnpm vitest run tests/stage9-exact-child-artifacts.test.ts tests/stage9-productive-boundary.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 6: Commit.**

```bash
git add packages/execution-core/src tests/stage9-exact-child-artifacts.test.ts
git commit -m "feat(stage9): integrate only exact child artifacts"
```

### Task 4: Repair routing to the lowest authority

**Files:**

- Create `packages/run-coordinator/src/domain/repair-routing.ts`.
- Modify `packages/orchestrator-graph/src/canonical-execution-driver.ts`
  `recordOutcome`/`decisionFact` to use the route instead of always raising
  `resolve_conflict`.
- Create `tests/stage9-repair-routing.test.ts`.

**Interfaces:**

- Produces:

```ts
export type RepairRoute =
  | { kind: "retry_node"; nodeId: string }
  | { kind: "amend_plan"; reason: string }
  | { kind: "effect_policy"; reason: string };

export function routeRepair(input: {
  failedNodeId: string;
  failureReason: string;
  graph: GraphRevision;
  consumedArtifactNodeIds: readonly string[];
}): RepairRoute;
```

**Steps:**

- [ ] **Step 1: Write the failing test** with one case per row of the design's
  routing table: a child defect indicting one consumed artifact routes
  `retry_node` to that child, not to the composite; a seam mismatch routes
  `retry_node` to the boundary owner named by the seam binding; an
  `ownership_violation` routes `amend_plan`; a `SANDBOX_UNAVAILABLE` or other
  environment cause routes `effect_policy` and creates no attempt. Add the
  ambiguity case: a cause that indicts two children routes `amend_plan`, because
  no single lowest authority exists.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run tests/stage9-repair-routing.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Implement** `routeRepair` as a pure function, and use it in the
  driver. `amend_plan` raises a decision of the existing kind
  `approve_amendment`; `effect_policy` raises no attempt.
- [ ] **Step 4: Verify GREEN**, then run the driver suite for regressions.

```bash
corepack pnpm vitest run tests/stage9-repair-routing.test.ts tests/stage6-canonical-execution-driver.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 5: Commit.**

```bash
git add packages/run-coordinator/src packages/orchestrator-graph/src tests/stage9-repair-routing.test.ts
git commit -m "feat(stage9): route repair to the lowest authority"
```

### Task 5: Bounded concurrent wave execution

**Files:**

- Modify `packages/orchestrator-graph/src/canonical-execution-driver.ts`, the
  wave loop and `recordOutcome`.
- Create `tests/stage9-bounded-parallel-execution.test.ts`.

**Interfaces:**

- Consumes: `run.effectiveConfig.maxParallel`.
- Produces: no new public type. `CanonicalExecutionDriverOptions.execute` keeps
  its signature and may now be invoked concurrently — document that in its
  doc comment, because it is a contract change for every implementer.

**Steps:**

- [ ] **Step 1: Write the failing tests.** Beyond the overlap test from Task 1:
  concurrency never exceeds `maxParallel`; one attempt failing does not cancel
  its siblings and their outcomes are still recorded; an abort signal reaches
  every in-flight attempt; and journal appends stay strictly sequenced under
  concurrency, asserted by a coordinator stub that throws when it observes an
  out-of-order `expectedSequence`.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run tests/stage9-bounded-parallel-execution.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Implement.** Replace

```ts
for (const attempt of attempts) {
  const outcome = await this.options.execute(attempt.input);
  state = await this.recordOutcome(run, attempt, outcome);
  if (state.lifecycle !== "running") return state;
}
```

  with a bounded worker pool over `attempts` capped at
  `run.effectiveConfig.maxParallel`, where `this.options.execute` runs
  concurrently and every `recordOutcome` is awaited through one serialized
  append point held for the whole wave. Settle all in-flight attempts before
  returning on a lifecycle change, so no outcome is silently dropped.
- [ ] **Step 4: Verify GREEN**, including the Stage 6 and Stage 8 driver suites.

```bash
corepack pnpm vitest run tests/stage9-bounded-parallel-execution.test.ts tests/stage9-productive-boundary.test.ts tests/stage6-canonical-execution-driver.test.ts tests/stage8-retry-dispatch.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 5: Commit.**

```bash
git add packages/orchestrator-graph/src tests/stage9-bounded-parallel-execution.test.ts
git commit -m "feat(stage9): execute a ready wave with bounded parallelism"
```

### Task 6: Defensive resource-conflict assertion at selection

**Files:**

- Modify `packages/orchestrator-graph/src/canonical-execution-driver.ts`
  `select`.
- Create `tests/stage9-selection-resource-invariant.test.ts`.

**Steps:**

- [ ] **Step 1: Write the failing test.** Hand the driver a graph whose
  readiness would wrongly admit two unordered nodes with `modify` claims on the
  same resource. Assert selection throws with a message naming both nodes and
  the resource, rather than executing them. This is a bug-detector, not a
  feature: a readiness defect must fail loudly instead of corrupting a tree.
- [ ] **Step 2: Verify RED**, then implement the assertion over
  `run.graph.resourceClaims` for the selected node set, then verify GREEN.

```bash
corepack pnpm vitest run tests/stage9-selection-resource-invariant.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Commit.**

```bash
git add packages/orchestrator-graph/src tests/stage9-selection-resource-invariant.test.ts
git commit -m "feat(stage9): assert the resource invariant at selection"
```

### Task 7: Soft risk stays advisory

**Files:**

- Modify `apps/daemon/src/transitional-unsafe-worker.ts` `integrationRisk` and
  any learned-weight surface it reaches.
- Create `tests/stage9-soft-risk-advisory.test.ts`.

**Steps:**

- [ ] **Step 1: Write the failing test.** Two runs over the same graph with
  wildly different recorded risk scores select the same node set in the same
  order. Assert the risk value is journaled and that no learned weight can be
  enabled without an attributed-evidence flag that does not exist yet.
- [ ] **Step 2: Verify RED**, implement, verify GREEN.

```bash
corepack pnpm vitest run tests/stage9-soft-risk-advisory.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Commit.**

```bash
git add apps/daemon/src tests/stage9-soft-risk-advisory.test.ts
git commit -m "feat(stage9): keep integration risk advisory and unlearned"
```

### Task 8: Required adverse cells

**Files:**

- Create `tests/stage9-adverse-cells.test.ts`.

**Steps:**

- [ ] **Step 1: R1 — cross-package seam.** Two leaves in different packages
  bound by a typed seam; the composite's evidence cites the seam's validation
  obligations. Assert the parent integration evidence names both children.
- [ ] **Step 2: R2 — independent leaves.** Two leaves with disjoint claims run
  concurrently and both adopt artifacts, with no shared resource and no
  serialization between them.
- [ ] **Step 3: R3 — sequential rewrite.** Two leaves where the second consumes
  the first's artifact. Assert an explicit artifact/version chain and that the
  second's input fingerprint includes the first's digest.
- [ ] **Step 4: R11 — integration defect.** A composite failure indicting one
  child produces a new attempt on that child, leaves the composite attempt
  immutably failed, and marks downstream evidence stale.
- [ ] **Step 5: R16 — daemon crash during composite integration.** Kill the
  worker mid-integration with a real controlled process, restart, and assert
  exactly one reconciled integration attempt and one outcome, using the durable
  `IntegrationOperationJournal`.
- [ ] **Step 6: Convergence property.** The same graph executed with
  `maxParallel: 1` and `maxParallel: 4` reaches the same adopted artifact
  digests.
- [ ] **Step 7: Verify GREEN and commit.**

```bash
corepack pnpm vitest run tests/stage9-adverse-cells.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

```bash
git add tests/stage9-adverse-cells.test.ts
git commit -m "test(stage9): cover R1, R2, R3, R11, R16 and convergence"
```

### Task 9: Retire the legacy integration agent

**Files:**

- Delete or reduce `packages/execution-core/src/integration/agent.ts`.
- Modify `packages/execution-core/src/index.ts` exports.
- Modify any remaining caller found by the search below.

**Steps:**

- [ ] **Step 1: Find every caller.**

```bash
grep -rn "IntegrationAgent\|integration/agent" packages apps tests --include=*.ts
```

- [ ] **Step 2: Decide per caller.** A productive caller must move to the
  canonical composite path. A historical replay caller may keep read-only
  access, and then this file must state that consumer by name and its Stage 11
  retirement. No caller means delete the file.
- [ ] **Step 3: Verify** the full suite and typechecks, then commit.

```bash
corepack pnpm test
```

```bash
git add -A packages/execution-core apps tests
git commit -m "refactor(stage9): retire the universal integration agent"
```

### Task 10: Close the gate

**Files:**

- Create `docs/audits/stage-9/README.md`.
- Modify `docs/plans/2026-08-12-correctness-first-system-redesign.md` status
  table and `docs/README.md`.
- Modify `tests/documentation-current.test.ts` in the same commit as the table.

**Steps:**

- [ ] **Step 1: Run the full handoff verification on the exact tree.**

```bash
corepack pnpm test
corepack pnpm -r --filter "./packages/*" typecheck
corepack pnpm --filter @manyhands/web exec tsc --noEmit
corepack pnpm -r --filter "./packages/*" build
corepack pnpm --filter @manyhands/web build
git -c core.whitespace=cr-at-eol diff --check
```

- [ ] **Step 2: Write the audit record** with the exact candidate commit and
  tree, the per-cell evidence, and every limitation that remains. State what was
  *not* proven as plainly as what was.
- [ ] **Step 3: Bounded independent gate review.** A reviewer who did not
  implement Stage 9 checks the claims against the retained evidence and records
  a verdict in `docs/audits/stage-9/evidence/review-gate.md`. A capability or
  invariant the evidence refutes fails the gate even when the run succeeded.
- [ ] **Step 4: Update the status table and its contract test together**, then
  commit.

## Self-review notes

- Every design section maps to a task: ownership to 2, exact artifacts to 3,
  routing to 4, concurrency to 5 and 6, soft risk to 7, adverse cells to 8,
  retirement to 9.
- `checkParentResourceAuthority` and `routeRepair` keep the same names and
  signatures wherever they appear.
- The `ownership_violation` cause is introduced in Task 2 and consumed in
  Task 4; Task 2 must land first.
