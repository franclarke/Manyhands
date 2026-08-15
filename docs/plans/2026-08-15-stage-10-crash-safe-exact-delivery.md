# Stage 10 Crash-Safe Exact Delivery Implementation Plan (revised)

> Supersedes [`2026-08-14-stage-10-crash-safe-exact-delivery.md`](2026-08-14-stage-10-crash-safe-exact-delivery.md),
> which was written before delivery had ever run. Read
> [`the redesign plan`](2026-08-12-correctness-first-system-redesign.md) Stage 10
> and [`the approved design`](../superpowers/specs/2026-08-14-stage-10-exact-delivery-design.md)
> before changing production code. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make publication a compare-and-swap transaction with an immutable
receipt for the exact delivered tree, so that a crash around delivery can
produce neither a false success nor a duplicate publication.

**Architecture:** Keep the `TransactionalDeliveryPublisher` sequence — claim,
recover, inspect, publish, complete. Replace the adapter's check-then-act
`merge --ff-only` with the conditional ref update `GitRunner` already provides,
extend recovery to the diverged case, and give failures a typed diagnostic
instead of a string. Reconciliation stays at run level; per-attempt process
effects remain out of scope.

**Tech Stack:** TypeScript, Zod, pnpm workspace, Vitest, Git CLI through
GitRunner, JSONL journal and stores, tsup.

## What changed since the first draft

Run `run:e57c0076…` planned, executed, integrated, verified and **delivered** on
2026-08-15: `main` of the target moved `00273f0 → 3b84716`, the receipt carried
`disposition: "delivered"`, `confirmed: true` and both target heads, and the
delivered tree passed its own 14 tests. The happy path is no longer a
hypothesis, which changes this stage in three ways.

**Two defects that draft could not see, both now in scope as Task 1.**

1. *A delivery failure is unreachable.* `createDeliveryAdapter` in
   `apps/daemon/src/transitional-unsafe-profile.ts:218` throws when
   `delivery.publish` rejects. Nothing catches it: `effectFailures` is only
   drained by `drainEffects()`, which the IPC-serving daemon never calls. A
   diverged target therefore leaves the run parked at `effect.requested`
   forever — no `delivery.failed`, no diagnostic, no recovery. This is the same
   defect fixed for `model_call` in commit `fb16e5ac`; delivery was not fixed
   with it. Every "fails closed" cell in Tasks 3, 6 and 7 is unobservable
   end-to-end until this lands.

2. *A missing durable result fabricates a success.*
   `apps/daemon/src/product-run-application.ts:208` emits `delivery.published`
   with a synthesized receipt — `targetHeadAfter: approval.finalSha`,
   `confirmed: true` — whenever `loadDeliveryResult` returns nothing. The
   planning branch twelve lines above does the opposite and fails closed. A
   crash between the physical publish and the durable write is exactly the
   window this stage exists to close, and today it is reported as a confirmed
   delivery of a SHA nobody observed.

**One task deleted.** The draft's Task 9 retired legacy delivery writers. There
are none: `TransactionalDeliveryPublisher` has exactly one productive consumer
and there is exactly one ref write, `current-lifecycle-adapters.ts:447`. The
reachability guard moves into Task 3, where the write is replaced.

**One task dropped as a separate step.** The draft's Task 1 wrote three RED
tests whose fixes landed two tasks later. Each test now lands red in the task
that turns it green, and the shared fixture is created by its first consumer.

## Global Constraints

- Stage 8 / GLeaf is `in_review` with a NO-GO pending a live Codex re-run, and
  Stage 9 / GI is `in_review` pending a bounded independent review. The redesign
  plan does not authorize Stage 10 to start before both pass. Francisco directed
  this stage to proceed on 2026-08-15 after the live composite run exercised the
  GLeaf and GI surfaces end to end with `claude-code-cli`. Record this in the
  audit as a sequencing deviation, not as a passed gate.
- The host's global `pnpm` is 7.29.3 and incompatible with the pinned 11.21.0.
  Every command uses `corepack pnpm`.
- Tests never call a model, never use the network, never open a browser.
- **This checkout has ~77 files that are CRLF on disk while their blob is LF,
  and `git status` reports them clean.** Derive each file's convention from
  `git show HEAD:<path>`, not from disk. Inspect `git diff --numstat` before
  committing: a whole-file add/remove count is an accidental conversion.
- Stop the dev stack before the full suite. A live daemon holds the installation
  lease and fails `daemon-kernel`, `daemon-installation-lease`,
  `process-supervisor-physical` and `stage3-restart-recovery` by contention.
- `corepack pnpm typecheck` resolves the workspace through an untracked `dist`.
  Rebuild the packages before typechecking or stale types hide drift.
- No new dependency may be added to `@manyhands/core`. Commits are local.

---

## Entry state

Re-verified against the working tree on 2026-08-15, not carried over:

- `packages/execution-core/src/delivery/publisher.ts` — 95 lines: the claim, the
  fingerprint check, `recover`, the pre-flight `inspect` comparison, `publish`,
  and `assertReceipt`. The transaction shape is sound and is not rebuilt.
- `packages/execution-core/src/git/runner.ts:195` —
  `updateRef({ cwd, ref, target, expectedOldOid })` shells to
  `git update-ref <ref> <new> <old>`. **The compare-and-swap primitive exists
  and delivery does not use it.**
- `apps/daemon/src/current-lifecycle-adapters.ts:447` — the only delivery ref
  write, `git merge --ff-only`, preceded by a check that is a separate process.
- `apps/daemon/src/current-lifecycle-adapters.ts:415` — `recover` returns
  `undefined` for everything that is not already-delivered, so a diverged target
  falls through to a fresh publish attempt.
- `packages/run-coordinator/src/domain/outcomes.ts:18` — `DeliveryReceiptSchema`
  has no `deliveredTreeSha` and no `cleanlinessPolicyId`; the live receipt
  confirms both are absent.
- `packages/run-coordinator/src/reducer.ts:657` — `delivery.started` already
  refuses an approval that is not the current verified final candidate.
- `apps/daemon/src/product-run-application.ts:200` — the actor maps a failed
  observation to `delivery.failed`. The path exists and is unreachable.
- `tests/delivery-state-machine.test.ts`, `tests/delivery-target-cleanliness.test.ts`
  — the two existing delivery suites; keep both green throughout.

Out of scope: per-attempt process effects, Stage 11 legacy deletion and UI
corrections, any live model run, the longitudinal study, thesis work.

## Invariants

1. Publication is one conditional ref update. A target that no longer holds the
   approved old OID fails closed, including when its new head is an ancestor of
   the final SHA.
2. A crash anywhere around publication converges to exactly one receipt and one
   target state, and never to a receipt nobody observed.
3. A receipt records the exact delivered tree, ref and cleanliness policy, and
   is immutable.
4. A delivery approval is invalid once the candidate it approved has changed.
5. Every recovery failure carries a typed diagnostic, never only a string, and
   reaches the journal as an event an operator can act on.
6. A dirty or diverged target fails closed and publishes nothing.
7. A clean clone of the delivered ref reproduces the exact tree.

## TDD execution tasks

### Task 1: A delivery failure is reachable and never fabricated

**Files:** modify `apps/daemon/src/transitional-unsafe-profile.ts` and
`apps/daemon/src/product-run-application.ts`; create
`tests/stage10-delivery-failure-visibility.test.ts`.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  - `"records a failed observation when publication rejects"` — the delivery
    port throws; assert `execute` resolves and recorded exactly one observation
    with `observation: "failed"` and the rejection's message as `reason`. Fails
    today: the adapter throws.
  - `"records nothing when the effect was invalidated instead of failing"` — a
    cancelled effect must not become a failure.
  - `"refuses to publish a receipt the adapter never produced"` — a succeeded
    observation whose durable delivery result is missing yields
    `delivery.failed`, not a synthesized `delivery.published`. Fails today: the
    actor fabricates one.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run tests/stage10-delivery-failure-visibility.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

- [ ] **Step 3: Implement.** Mirror the `model_call` adapter: catch, record
  `{ observation: "failed", reason, observedAt }`, return. In the actor, drop
  the `??` fallback and emit `delivery.failed` when the durable receipt is
  absent, with a reason that names the missing result.
- [ ] **Step 4: Verify GREEN and commit.**

### Task 2: Typed recovery diagnostics

**Files:** create `packages/contracts/src/recovery-diagnostic.ts`; modify
`packages/contracts/src/index.ts`; create
`tests/stage10-recovery-diagnostics.test.ts`.

**Interfaces:**

```ts
export type RecoveryDiagnostic =
  | { kind: "corrupt_journal"; runId: string; sequence: number; detail: string }
  | { kind: "missing_object"; oid: string; expectedBy: string }
  | { kind: "unresolved_process"; processId: string; lastReceiptId: string }
  | { kind: "stale_decision"; decisionId: string; raisedAtGraphRevision: number; currentGraphRevision: number }
  | { kind: "target_divergence"; ref: string; expectedOid: string; actualOid: string }
  | { kind: "unrecoverable_external_effect"; effectId: string; detail: string };

export const RecoveryDiagnosticSchema: z.ZodType<RecoveryDiagnostic>;
export function describeRecoveryDiagnostic(diagnostic: RecoveryDiagnostic): string;
```

**Steps:**

- [ ] **Step 1: Write the failing test.** One case per member: the schema
  accepts a well-formed value, rejects an unknown `kind`, rejects a member
  missing its evidence field. `describeRecoveryDiagnostic` produces one line
  naming the acting evidence — for `target_divergence` it must contain both the
  expected and the actual OID, because an operator cannot act on "the target
  changed".
- [ ] **Step 2: Verify RED, implement, verify GREEN, commit.**

### Task 3: Compare-and-swap publication

**Files:** modify `createCurrentDeliveryPort` in
`apps/daemon/src/current-lifecycle-adapters.ts`; create
`tests/helpers/stage10-delivery-fixture.ts` and
`tests/stage10-delivery-boundary.test.ts`.

**Interfaces:** consumes the existing
`GitRunner.updateRef({ cwd, ref, target, expectedOldOid })`. No new primitive.
The fixture exports `buildDeliveryTargetFixture()` — a real temporary repo with
a branch, a candidate that fast-forwards, and a second commit that also
fast-forwards but is not the approved head — and later tasks reuse it.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  - `"refuses a target that advanced to another ancestor of the final SHA"` —
    approve at head `A`, advance the branch to `A'` where `A'` is an ancestor of
    the final SHA. Nothing is published and the failure names a divergence.
    Fails today: `--ff-only` accepts it.
  - `"reports a typed diagnostic when the target diverged"` — the failure
    carries `{ kind: "target_divergence", ref, expectedOid, actualOid }`.
  - `"recovers a ref that already holds the final SHA into one receipt"`.
- [ ] **Step 2: Replace the write.** Swap `merge --ff-only` for
  `updateRef({ ref: \`refs/heads/${branch}\`, target: finalSha, expectedOldOid: targetHead })`.
  Keep the pre-flight inspection: it produces the operator-facing diagnostic
  while the CAS is what makes the refusal sound.
- [ ] **Step 3: Reconcile the working tree.** The target is a checked-out
  branch, so after the ref moves the index and working tree must reach the
  delivered commit. A failure here is an ambiguous outcome, not a success.
- [ ] **Step 4: Extend recovery to three outcomes.** Ref equals the final SHA →
  complete the receipt. Ref equals the approved old OID → retry from inspection.
  Anything else → fail closed with `target_divergence`.
- [ ] **Step 5: Add the reachability guard**, shaped like
  `tests/stage9-legacy-integration-retirement.test.ts`: no productive source
  reaches a delivery ref write that is not the conditional update.
- [ ] **Step 6: Verify GREEN including both existing delivery suites, commit.**

```bash
corepack pnpm vitest run tests/stage10-delivery-boundary.test.ts tests/delivery-state-machine.test.ts tests/delivery-target-cleanliness.test.ts --retry=0 --minWorkers=1 --maxWorkers=1
```

### Task 4: The receipt binds the exact delivered tree

**Files:** modify `DeliveryReceiptSchema` and `DeliveryApprovalSchema` in
`packages/run-coordinator/src/domain/outcomes.ts`,
`TransactionalDeliveryReceipt` and `assertReceipt` in
`packages/execution-core/src/delivery/publisher.ts`, `deliveryReceipt` in
`apps/daemon/src/current-lifecycle-adapters.ts`, and the delivery cases in
`packages/run-coordinator/src/reducer.ts`; create
`tests/stage10-delivery-receipt.test.ts`.

**Interfaces:** `DeliveryReceipt` gains `deliveredTreeSha` and
`cleanlinessPolicyId`; `DeliveryApproval` gains `cleanlinessPolicyId`.

**Steps:**

- [ ] **Step 1: Write the failing test.** `deliveredTreeSha` equals
  `git rev-parse <finalSha>^{tree}` in a real repository; the reducer refuses a
  receipt whose tree does not match the delivered commit; the approval's
  cleanliness policy is carried into the receipt so a reader can tell which rule
  judged it.
- [ ] **Step 2: Verify RED, implement, verify GREEN.** Add both fields as
  optional first — historical journals contain receipts without them, including
  the delivered `run:e57c0076…` — and add a test that such a journal still
  loads.
- [ ] **Step 3: Commit.**

### Task 5: R13 — a changed candidate invalidates its approval

**Files:** create `tests/stage10-stale-approval.test.ts`; modify
`packages/run-coordinator/src/reducer.ts` only if the probe finds a hole.

**Steps:**

- [ ] **Step 1: Probe first.** `reducer.ts:657` already refuses a
  `delivery.started` whose approval is not the current final candidate. Write
  the test that tries to defeat it: verify a candidate, approve delivery, verify
  a *newer* final candidate, then publish under the first approval. If it is
  already refused, keep the test as a regression guard and say so in the commit
  message rather than inventing a change.
- [ ] **Step 2: Cover the decision path.** A resolved `approve_delivery`
  decision raised against an older graph revision must not authorize a delivery
  after the candidate changed. Assert the decision is expired, not applied.
- [ ] **Step 3: Verify and commit.**

### Task 6: The delivery restart matrix

**Files:** create `tests/stage10-delivery-restart-matrix.test.ts`.

**Steps:**

- [ ] **Step 1: Crash before the CAS.** The ref is untouched; a fresh delivery
  publishes exactly once.
- [ ] **Step 2: Crash after the CAS, before the receipt.** Recovery finds the
  ref at the final SHA, completes one receipt, publishes nothing further.
- [ ] **Step 3: Crash during working-tree reconciliation.** The ref moved, the
  tree did not; recovery completes the delivery and the tree ends at the
  delivered commit.
- [ ] **Step 4: Crash during recovery itself.** Re-entering twice yields one
  receipt.
- [ ] **Step 5: Crash between the physical publish and the durable write.** The
  case Task 1 stopped fabricating: assert the run reaches `delivery.failed` with
  a reason naming the missing durable result, and that a retry converges to one
  receipt rather than a second publication.
- [ ] **Step 6: Verify and commit.**

### Task 7: R12 — divergence and dirtiness fail closed

**Files:** create `tests/stage10-adverse-delivery-cells.test.ts`.

**Steps:**

- [ ] **Step 1: Diverged target.** The branch moved to an unrelated commit;
  nothing is published and the failure carries `target_divergence` with both
  OIDs.
- [ ] **Step 2: Unexpectedly advanced target.** The branch moved to another
  ancestor of the final SHA — the case `--ff-only` accepted — asserted
  separately from the unrelated-commit case.
- [ ] **Step 3: Dirty target.** A real user modification blocks delivery; a file
  under `.manyhands/` does not.
- [ ] **Step 4: Verify and commit.**

### Task 8: Clean clone reproduces the claim

**Files:** create `tests/stage10-clean-clone-reproduction.test.ts`.

**Steps:**

- [ ] **Step 1: Write the test.** After a successful delivery, clone the target
  into a fresh temporary directory, check out the delivered ref, and assert the
  clone's tree OID equals the receipt's `deliveredTreeSha`.
- [ ] **Step 2: Run the recorded validation recipe in the clone** and assert it
  passes. Use a minimal Node target so the recipe is a real command and no
  network install is required.
- [ ] **Step 3: Verify and commit.**

### Task 9: Close the gate

**Files:** create `docs/audits/stage-10/README.md`; modify
`docs/plans/2026-08-12-correctness-first-system-redesign.md`, `docs/README.md`
and `tests/documentation-current.test.ts` in the same commit as any table.

**Steps:**

- [ ] **Step 1: Full handoff verification on the exact tree**, with the dev
  stack stopped.

```bash
corepack pnpm test
corepack pnpm -r --filter "./packages/*" build
corepack pnpm -r --filter "./packages/*" typecheck
corepack pnpm --filter @manyhands/web exec tsc --noEmit
corepack pnpm --filter @manyhands/web build
git -c core.whitespace=cr-at-eol diff --check
```

- [ ] **Step 2: Write the audit** with per-cell evidence, the Stage 8/9
  sequencing deviation, every deviation from this plan and why, and every
  limitation that remains. State what was not proven as plainly as what was.
- [ ] **Step 3: Bounded independent gate review** by a reviewer that did not
  implement Stage 10, recorded in
  `docs/audits/stage-10/evidence/review-gate.md`.
- [ ] **Step 4: Update the status table and its contract test together, commit.**

## Self-review notes

- Task 1 exists because the live run proved the happy path and left the failure
  path unexercised; without it Tasks 3, 6 and 7 can assert refusals only at unit
  level while a real run would hang.
- `RecoveryDiagnostic` is defined in Task 2 and consumed in Tasks 3, 6 and 7, so
  Task 2 lands before them.
- Task 5 is written to be falsifiable: it may find the invariant already holds,
  and says to record that rather than manufacture a change.
- Every invariant maps to a task: 1 → 3 and 7, 2 → 1 and 6, 3 → 4, 4 → 5, 5 → 1
  and 2, 6 → 7, 7 → 8.
- The draft's legacy-retirement task is deleted rather than kept as a no-op: the
  search for a second delivery writer returned exactly one, and pretending
  otherwise would manufacture work.
