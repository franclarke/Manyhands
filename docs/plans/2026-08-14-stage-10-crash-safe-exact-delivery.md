# Stage 10 Crash-Safe Exact Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the repository's TDD and
> plan-execution workflow to implement this plan one task at a time. Steps use
> checkbox (`- [ ]`) syntax for tracking. Read
> [`the redesign plan`](2026-08-12-correctness-first-system-redesign.md) Stage 10
> and [`the approved design`](../superpowers/specs/2026-08-14-stage-10-exact-delivery-design.md)
> in full before changing production code.

**Goal:** Make publication a compare-and-swap transaction with an immutable
receipt for the exact delivered tree, so that a crash around delivery can
produce neither a false success nor a duplicate publication.

**Architecture:** Keep the existing `TransactionalDeliveryPublisher` sequence —
claim, recover, inspect, publish, complete. Replace the adapter's check-then-act
`merge --ff-only` with the conditional ref update `GitRunner` already provides,
extend recovery to the diverged case, and give failures a typed diagnostic
instead of a string. Reconciliation stays at run level; per-attempt process
effects are deliberately out of scope.

**Tech Stack:** TypeScript, Zod, pnpm workspace, Vitest, Git CLI through
GitRunner, JSONL journal and stores, tsup.

## Global Constraints

- Stage 10 is **not authorized to start** until Stage 8 / GLeaf and Stage 9 / GI
  pass. Both are `in_review`.
- The host's global `pnpm` is 7.29.3 and incompatible with the pinned 11.21.0.
  Every command uses `corepack pnpm`.
- Tests never call a model, never use the network, never open a browser.
- **This checkout has ~77 files that are CRLF on disk while their blob is LF,
  and `git status` reports them clean.** Derive each file's convention from
  `git show HEAD:<path>`, not from disk, and normalize the whole file to it
  before writing. Inspect `git diff --numstat` before committing: a whole-file
  add/remove count is an accidental conversion.
- No new dependency may be added to `@manyhands/core`.
- Commits are local. Do not push.
- No stage closes without `corepack pnpm test` in full on the exact handoff
  tree, not on the previous commit — and update
  `tests/documentation-current.test.ts` in the same commit as any status table.

---

## Entry state and scope

Verified by reading the code, not assumed. Do not rebuild any of it:

- `packages/execution-core/src/delivery/publisher.ts` — the transaction
  sequence, the idempotency claim and the receipt assertion.
- `packages/execution-core/src/delivery/target-cleanliness.ts` — the
  `.manyhands`-aware cleanliness rule.
- `packages/execution-core/src/git/runner.ts:195` —
  `updateRef({ cwd, ref, target, expectedOldOid })`. **The compare-and-swap
  primitive already exists and delivery does not use it.**
- `apps/daemon/src/current-lifecycle-adapters.ts:374` —
  `createCurrentDeliveryPort`, which today inspects then runs
  `git merge --ff-only`.
- `packages/run-coordinator/src/reducer.ts:657` — a `delivery.started` whose
  approval does not match the current verified final candidate is already
  refused.
- `tests/run-engine-effect-crash-matrix.test.ts` — five crash positions per
  effect kind.

Out of scope: per-attempt process effects, Stage 11 legacy deletion, any live
model run, the longitudinal study, thesis work.

## Invariants

1. Publication is one conditional ref update. A target that no longer holds the
   approved old OID fails closed, including when its new head is an ancestor of
   the final SHA.
2. A crash anywhere around publication converges to exactly one receipt and one
   target state.
3. A receipt records the exact delivered tree, ref and cleanliness policy, and
   is immutable.
4. A delivery approval is invalid once the candidate it approved has changed.
5. Every recovery failure carries a typed diagnostic, never only a string.
6. A dirty or diverged target fails closed and publishes nothing.
7. A clean clone of the delivered ref reproduces the exact tree.

## TDD execution tasks

### Task 1: Pin the delivery boundary

**Files:**

- Create `tests/stage10-delivery-boundary.test.ts`.

**Interfaces:**

- Consumes `createCurrentDeliveryPort` from `apps/daemon/src/current-lifecycle-adapters.ts`
  and a real temporary Git repository.
- Produces `buildDeliveryTargetFixture()`, exported from the test file, which
  later tasks reuse: a real repo with a branch, a candidate commit that
  fast-forwards, and a second commit that also fast-forwards but is not the
  approved head.

**Steps:**

- [ ] **Step 1: Read the productive path.** Trace `publisher.ts`,
  `createCurrentDeliveryPort`, the `publish_delivery` branch of
  `coordinator.ts`, and the delivery cases in `reducer.ts`.
- [ ] **Step 2: Write the failing tests.** Three RED tests, each with its reason:
  - `"refuses a target that advanced to another ancestor of the final SHA"` —
    approve at head `A`, then advance the branch to `A'` where `A'` is an
    ancestor of the final SHA. Assert nothing is published and the failure names
    a target divergence. Fails today because `--ff-only` accepts it.
  - `"records the exact delivered tree in the receipt"` — assert the receipt
    carries the delivered commit's tree OID. Fails today: the schema has no
    field for it.
  - `"reports a typed diagnostic when the target diverged"` — assert the
    delivery failure carries `{ kind: "target_divergence", ... }`. Fails today:
    failures are strings.
- [ ] **Step 3: Verify RED.**

```bash
corepack pnpm vitest run tests/stage10-delivery-boundary.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

  Expected: 3 failed, each for the stated reason. A test that fails on fixture
  construction is not yet red for the right reason.
- [ ] **Step 4: Commit.**

```bash
git add tests/stage10-delivery-boundary.test.ts
git commit -m "test: pin Stage 10 delivery transaction boundary"
```

### Task 2: Typed recovery diagnostics

**Files:**

- Create `packages/contracts/src/recovery-diagnostic.ts`.
- Modify `packages/contracts/src/index.ts`.
- Create `tests/stage10-recovery-diagnostics.test.ts`.

**Interfaces:**

- Produces:

```ts
export const RecoveryDiagnosticSchema: z.ZodType<RecoveryDiagnostic>;

export type RecoveryDiagnostic =
  | { kind: "corrupt_journal"; runId: string; sequence: number; detail: string }
  | { kind: "missing_object"; oid: string; expectedBy: string }
  | { kind: "unresolved_process"; processId: string; lastReceiptId: string }
  | { kind: "stale_decision"; decisionId: string; raisedAtGraphRevision: number; currentGraphRevision: number }
  | { kind: "target_divergence"; ref: string; expectedOid: string; actualOid: string }
  | { kind: "unrecoverable_external_effect"; effectId: string; detail: string };

export function describeRecoveryDiagnostic(diagnostic: RecoveryDiagnostic): string;
```

**Steps:**

- [ ] **Step 1: Write the failing test.** One case per member: the schema
  accepts a well-formed value, rejects an unknown `kind`, rejects a member
  missing its evidence field, and `describeRecoveryDiagnostic` produces a single
  line naming the acting evidence. Include the case that matters most: a
  `target_divergence` whose message contains both the expected and the actual
  OID, because an operator cannot act on "the target changed".
- [ ] **Step 2: Verify RED**, implement, verify GREEN.

```bash
corepack pnpm vitest run tests/stage10-recovery-diagnostics.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Commit.**

```bash
git add packages/contracts/src tests/stage10-recovery-diagnostics.test.ts
git commit -m "feat(stage10): add typed recovery diagnostics"
```

### Task 3: Compare-and-swap publication

**Files:**

- Modify `apps/daemon/src/current-lifecycle-adapters.ts`, the `publish` and
  `recover` members of `createCurrentDeliveryPort`.
- Extend `tests/stage10-delivery-boundary.test.ts`.

**Interfaces:**

- Consumes `GitRunner.updateRef({ cwd, ref, target, expectedOldOid })`, which
  already exists. Do not add a new primitive.
- Produces no new public type.

**Steps:**

- [ ] **Step 1: Replace the write.** Swap `git merge --ff-only` for
  `updateRef({ ref: \`refs/heads/${branch}\`, target: finalSha, expectedOldOid: targetHead })`.
  Keep the pre-flight inspection: it produces the operator-facing diagnostic,
  while the CAS is what makes the refusal sound.
- [ ] **Step 2: Reconcile the working tree.** The target is a checked-out
  branch, so after the ref moves the index and working tree must be brought to
  the delivered commit. A failure here is an ambiguous outcome, not a success:
  return it as such rather than reporting delivery.
- [ ] **Step 3: Extend recovery to the diverged case.** Today `recover` returns
  `undefined` for anything that is not "already delivered", which falls through
  to a fresh publish attempt. Give it three outcomes: ref equals the final SHA
  means complete the receipt; ref equals the approved old OID means retry from
  inspection; anything else fails closed with `target_divergence`.
- [ ] **Step 4: Verify GREEN**, including the existing delivery suites.

```bash
corepack pnpm vitest run tests/stage10-delivery-boundary.test.ts tests/delivery-state-machine.test.ts tests/delivery-target-cleanliness.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 5: Commit.**

```bash
git add apps/daemon/src tests/stage10-delivery-boundary.test.ts
git commit -m "feat(stage10): publish through a conditional ref update"
```

### Task 4: The receipt binds the exact delivered tree

**Files:**

- Modify `packages/run-coordinator/src/domain/outcomes.ts`
  (`DeliveryReceiptSchema`, `DeliveryApprovalSchema`).
- Modify `packages/execution-core/src/delivery/publisher.ts`
  (`TransactionalDeliveryReceipt`, `assertReceipt`).
- Modify `apps/daemon/src/current-lifecycle-adapters.ts` (`deliveryReceipt`).
- Modify `packages/run-coordinator/src/reducer.ts` delivery cases.
- Create `tests/stage10-delivery-receipt.test.ts`.

**Interfaces:**

- Produces: `DeliveryReceipt` gains `deliveredTreeSha` and
  `cleanlinessPolicyId`; `DeliveryApproval` gains `cleanlinessPolicyId`.

**Steps:**

- [ ] **Step 1: Write the failing test.** The receipt's `deliveredTreeSha`
  equals `git rev-parse <finalSha>^{tree}` in a real temporary repository; a
  receipt whose tree does not match the delivered commit is refused by the
  reducer; and the approval's cleanliness policy is carried into the receipt so
  a reader can tell which rule judged it.
- [ ] **Step 2: Verify RED**, implement, verify GREEN. Add the field as
  optional in the schema first if historical journals contain receipts without
  it, and add a test that one such journal still loads.
- [ ] **Step 3: Commit.**

```bash
git add packages/run-coordinator/src packages/execution-core/src apps/daemon/src tests/stage10-delivery-receipt.test.ts
git commit -m "feat(stage10): bind the delivered tree and cleanliness policy to the receipt"
```

### Task 5: R13 — a changed candidate invalidates its approval

**Files:**

- Modify `packages/run-coordinator/src/reducer.ts`.
- Create `tests/stage10-stale-approval.test.ts`.

**Steps:**

- [ ] **Step 1: Probe first.** `reducer.ts:657` already refuses a
  `delivery.started` whose approval does not match the current final candidate.
  Write the test that tries to defeat it: verify a candidate, approve delivery,
  verify a *newer* final candidate, then attempt to publish under the first
  approval. If it is already refused, keep the test as a regression guard and
  say so in the commit message rather than inventing a change.
- [ ] **Step 2: Cover the decision path too.** A resolved `approve_delivery`
  decision raised against an older graph revision must not authorize a delivery
  after the candidate changed. Assert the decision is expired rather than
  silently applied.
- [ ] **Step 3: Verify and commit.**

```bash
corepack pnpm vitest run tests/stage10-stale-approval.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

```bash
git add packages/run-coordinator/src tests/stage10-stale-approval.test.ts
git commit -m "test(stage10): a changed candidate invalidates its delivery approval"
```

### Task 6: The delivery restart matrix

**Files:**

- Create `tests/stage10-delivery-restart-matrix.test.ts`.

**Steps:**

- [ ] **Step 1: Crash before the CAS.** The ref is untouched and a fresh
  delivery publishes exactly once.
- [ ] **Step 2: Crash after the CAS, before the receipt.** Recovery finds the
  ref at the final SHA, completes one receipt, and publishes nothing further.
- [ ] **Step 3: Crash during working-tree reconciliation.** The ref moved but
  the tree did not; recovery completes the delivery rather than reporting
  failure, and the tree ends at the delivered commit.
- [ ] **Step 4: Crash during recovery itself.** Re-entering twice still yields
  one receipt.
- [ ] **Step 5: Cleanup crash.** A crash during worktree cleanup leaves no
  orphan worktree and no unjournaled candidate. Reuse the Stage 8 supervised
  process harness rather than inventing a second one.
- [ ] **Step 6: Verify and commit.**

```bash
corepack pnpm vitest run tests/stage10-delivery-restart-matrix.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

```bash
git add tests/stage10-delivery-restart-matrix.test.ts
git commit -m "test(stage10): cover the delivery restart matrix"
```

### Task 7: R12 — divergence and dirtiness fail closed

**Files:**

- Create `tests/stage10-adverse-delivery-cells.test.ts`.

**Steps:**

- [ ] **Step 1: Diverged target.** The branch moved to an unrelated commit.
  Nothing is published; the failure carries `target_divergence` with both OIDs.
- [ ] **Step 2: Unexpectedly advanced target.** The branch moved to another
  ancestor of the final SHA. This is the case `--ff-only` accepted, so assert it
  explicitly and separately from the unrelated-commit case.
- [ ] **Step 3: Dirty target.** A real user modification blocks delivery, while
  a file under `.manyhands/` does not.
- [ ] **Step 4: Verify and commit.**

```bash
corepack pnpm vitest run tests/stage10-adverse-delivery-cells.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

```bash
git add tests/stage10-adverse-delivery-cells.test.ts
git commit -m "test(stage10): cover R12 divergence, advancement and dirtiness"
```

### Task 8: Clean clone reproduces the claim

**Files:**

- Create `tests/stage10-clean-clone-reproduction.test.ts`.

**Steps:**

- [ ] **Step 1: Write the test.** After a successful delivery, clone the target
  repository into a fresh temporary directory, check out the delivered ref, and
  assert the clone's tree OID equals the receipt's `deliveredTreeSha`.
- [ ] **Step 2: Run the recorded validation recipe in the clone** and assert it
  passes. Use a minimal Node target so the recipe is a real command rather than
  a stub, and no network install is required.
- [ ] **Step 3: Verify and commit.**

```bash
corepack pnpm vitest run tests/stage10-clean-clone-reproduction.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

```bash
git add tests/stage10-clean-clone-reproduction.test.ts
git commit -m "test(stage10): a clean clone reproduces the delivered claim"
```

### Task 9: Retire delivery without intent, CAS and reconciliation

**Files:**

- Modify or delete any remaining caller found by the search below.
- Create `tests/stage10-legacy-delivery-retirement.test.ts`.

**Steps:**

- [ ] **Step 1: Find every publisher.**

```bash
grep -rn "merge --ff-only\|publishDelivery\|DeliveryPublisherPort" packages apps tests --include=*.ts
```

- [ ] **Step 2: Decide per caller.** A productive caller moves to the CAS path.
  A historical replay caller keeps read-only access and must be named here with
  its retirement stage. No caller means delete it.
- [ ] **Step 3: Add the reachability guard**, in the shape of
  `tests/stage9-legacy-integration-retirement.test.ts`: no productive source
  reaches a delivery write that is not the conditional ref update.
- [ ] **Step 4: Verify the full suite and commit.**

```bash
corepack pnpm test
```

```bash
git add -A packages apps tests
git commit -m "refactor(stage10): retire delivery without intent, CAS and reconciliation"
```

### Task 10: Close the gate

**Files:**

- Create `docs/audits/stage-10/README.md`.
- Modify `docs/plans/2026-08-12-correctness-first-system-redesign.md` and
  `docs/README.md`.
- Modify `tests/documentation-current.test.ts` in the same commit as the table.

**Steps:**

- [ ] **Step 1: Full handoff verification on the exact tree.**

```bash
corepack pnpm test
corepack pnpm -r --filter "./packages/*" typecheck
corepack pnpm --filter @manyhands/web exec tsc --noEmit
corepack pnpm -r --filter "./packages/*" build
corepack pnpm --filter @manyhands/web build
git -c core.whitespace=cr-at-eol diff --check
```

- [ ] **Step 2: Write the audit** with the exact candidate and tree, per-cell
  evidence, every deviation from this plan and why, and every limitation that
  remains. State what was not proven as plainly as what was.
- [ ] **Step 3: Bounded independent gate review** by a reviewer that did not
  implement Stage 10, recorded in
  `docs/audits/stage-10/evidence/review-gate.md`. A capability the evidence
  refutes fails the gate even when the run succeeded.
- [ ] **Step 4: Update the status table and its contract test together**, then
  commit.

## Self-review notes

- Every design section maps to a task: CAS → 3, ambiguous outcomes → 3 and 6,
  receipt → 4, diagnostics → 2, restart matrix → 6, R12 → 7, R13 → 5, clean
  clone → 8, retirement → 9.
- `RecoveryDiagnostic` is defined in Task 2 and consumed in Tasks 3, 6 and 7;
  Task 2 must land first.
- Task 5 is written to be falsifiable: it may find the invariant already holds,
  and says to record that rather than manufacture a change.
- The plan names `updateRef` as existing rather than asking for a new
  primitive, because it was read at `git/runner.ts:195`.
