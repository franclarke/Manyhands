# ManyHands Correctness Closure Implementation Plan

> **For Codex:** REQUIRED SUB-SKILLS: use `executing-plans`, `tdd`,
> `diagnosing-bugs`, `grilling` and independent read-only Standards/Spec reviews
> task by task. Do not use Claude.

**Goal:** Make the productive V2 path contractually correct and demonstrably
functional before using it as evidence for the thesis conclusion.

**Architecture:** Preserve the canonical event-driven V2 route and its existing
Git/fencing invariants. Remediate from the truth boundary outward: evidence
relevance, typed graph semantics, authority/freshness, recovery, scheduling,
delivery/UI honesty, grounding/security, and only then empirical policy
validation. Each phase is a vertical slice with a red regression, the smallest
productive implementation, affected gates, independent reviews and a local
commit.

**Tech Stack:** TypeScript, pnpm 7.29.3, Node 22.23.1, Vitest, Next.js,
JSONL event store, Git worktrees, Codex CLI.

---

## Definition of contractual correctness

"100% correct" is bounded to the repository's declared contracts. It means:

- every documented invariant has a productive implementation and regression;
- every `satisfied` criterion has relevant evidence on the exact commit;
- known false positives are caught by mutation/negative controls;
- crash, takeover, retry and replay preserve single authority and freshness;
- scheduler decisions are based on and persist real capabilities/budget/risk;
- manifest, receipt and UI never overstate evidence;
- no known P0/P1 remains open;
- a frozen external oracle confirms the candidate before the thesis concludes
  that the system works correctly.

It does not mean correctness for every possible repository, task or model.

## Non-negotiable execution order

Do not run a new thesis N=4/N=8/N=16 series until Tasks 1-5 pass. Do not tune
policy formulas, thresholds, stimuli or oracles to obtain a favorable result.
Preserve retry-9 and retry-10 unchanged.

### Task 0: Register the audit as the active remediation program

**Files:**

- Modify: `.scratch/code-review-remediation/issues/11-run-retry7-n08-n16.md`
- Modify: `docs/tesis/HANDOFF.md`
- Modify: `docs/tesis/claim-evidence-matrix.md`

**Steps:**

1. Add the four P0 and eight P1 findings as local issues with explicit blockers.
2. Record that ticket 11 is blocked by Tasks 1-5, not accepted by retry-10.
3. Mark claims about "verified means correct" and full recovery as unsupported.
4. Run `git diff --check` and verify every new link.
5. Commit: `docs(audit): register correctness closure program`.

### Task 1: Restore typed seam semantics

**Files:**

- Modify: `packages/task-graph/src/validate-v2.ts`
- Modify: `packages/decomposer/src/planner/prompt.ts`
- Modify: `tests/task-graph-artifact-cycles.test.ts`
- Modify: `tests/decomposer-work-breakdown.test.ts`
- Modify: `docs/tesis/evidence/warehouse/pilot/defects/seam-bindings-escape-cycle-detection/README.md`

**Step 1: Write the failing graph tests**

Add regressions proving:

```ts
artifactRequirements = [artifact("registry", "script")];
seamBindings = [seam("script", "registry")];
expect(errors(validateGraphRevision(graph))).toEqual([]);
```

and a seam-only loop is not an execution cycle. Keep artifact, legacy and
hierarchy cycle controls red/green independently.

**Step 2: Verify RED**

Run:

```powershell
pnpm exec vitest run tests/task-graph-artifact-cycles.test.ts -t "non-ordering seam|seam-only loop"
```

Expected: two failures reporting `artifact_cycle`.

**Step 3: Implement the minimum graph correction**

Keep seam self-relation and participant validation, but remove SeamBinding from
the adjacency used for DAG cycles. Edge types remain hierarchy, artifact and
legacy only.

**Step 4: Clarify planner relation direction with a prompt regression**

Require the prompt to state:

```text
producer owns/provides the contract or output;
consumer imports/calls/uses it;
omit command/API seams with no internal consumer.
```

Do not introduce a generic opposite-direction rejection: callbacks and mutual
interfaces can be legitimate and need a contract-specific critic.

**Step 5: Verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/task-graph-artifact-cycles.test.ts tests/task-graph-v2.test.ts tests/graph-compiler.test.ts tests/graph-critics-v2.test.ts tests/decomposer-work-breakdown.test.ts
pnpm --filter @manyhands/task-graph typecheck
pnpm --filter @manyhands/decomposer typecheck
```

Expected: 69/69 tests and both typechecks PASS.

**Step 6: Correct the historical diagnosis and commit**

Document that the earlier "seams must close cycles" fix contradicted A5. Keep
historical journals immutable. Commit:

```text
fix(planning): keep seams out of execution cycles
docs(thesis): correct seam cycle diagnosis
```

### Task 2: Make UI verification states honest

**Files:**

- Modify: `apps/web/src/app/runs/[runId]/_components/cockpit-state.ts`
- Modify: `packages/run-coordinator/src/reducer.ts`
- Modify: `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx`
- Test: `tests/run-cockpit-chrome.test.ts`
- Test: `tests/run-model-view.test.tsx` (create if no focused view test exists)

**Step 1: Write RED cases**

For attempt and integration matrices with outcomes `unverified` and `failed`,
assert:

```ts
expect(badge.label).not.toMatch(/Verified/i);
expect(deliveryAction.enabled).toBe(false);
```

Add a `verified` control that remains green.

**Step 2: Verify RED**

Run the two focused test files. Expected: the current fallback renders
`Verified [evidence recorded]` for at least one non-verified matrix.

**Step 3: Implement explicit state mapping**

Map canonical outcomes without fallthrough:

- `verified` -> verified;
- `unverified` -> evidence incomplete;
- `failed` -> validation failed;
- absent/in-progress -> pending.

Reducer events may record completion, but must preserve the matrix outcome as
the authority for the visible/adoptable status.

**Step 4: Render criterion-level evidence and delivery guard**

Show each Evidence Matrix row, command/static proof and outcome. Disable publish
unless final matrix is verified and the canonical candidate is current.

**Step 5: Run web tests/typecheck and commit**

```powershell
pnpm exec vitest run tests/run-cockpit-chrome.test.ts tests/run-model-view.test.tsx
pnpm --filter @manyhands/web exec tsc --noEmit
```

Commit: `fix(web): represent evidence outcomes honestly`.

### Task 3: Wire test-integrity and negative controls into V2 validation

**Files:**

- Modify: `packages/execution-core/src/v2/exact-candidate-validator.ts`
- Modify: `packages/execution-core/src/validation/test-integrity.ts`
- Modify: `packages/execution-core/src/validation/candidate-validator.ts`
- Test: `tests/test-weakening-detection.test.ts`
- Test: `tests/exact-candidate-validation.test.ts`

**Step 1: Add RED end-to-end mutations**

Create candidate diffs that:

- delete a baseline test;
- change `it(...)` to `it.skip(...)`;
- introduce `.only`;
- remove a load-bearing assertion;
- leave the remaining suite green.

Assert ExactCandidateValidatorV2 returns `failed` or `unverified` with durable
integrity finding references.

**Step 2: Verify RED**

Run both focused test files. Expected: at least deletion/skip/only currently
passes without a productive finding.

**Step 3: Implement the productive gate**

Before recipe execution:

```ts
const findings = await detectTestIntegrityFindings(baseCommit, candidateCommit);
if (findings.some(isBlocking)) return failedMatrix(findings);
```

Execute frozen negative controls when the contract declares them. Persist each
finding/control execution in the matrix; never reduce it to a boolean.

**Step 4: Verify and commit**

```powershell
pnpm exec vitest run tests/test-weakening-detection.test.ts tests/exact-candidate-validation.test.ts tests/evidence-matrix.test.ts
pnpm --filter @manyhands/execution-core typecheck
```

Commit: `fix(validation): enforce test integrity on exact candidates`.

### Task 4: Make validation criterion-aware

**Files:**

- Modify: `packages/execution-core/src/validation/recipe-compiler.ts`
- Modify: `packages/execution-core/src/validation/evidence-matrix.ts`
- Modify: `packages/contracts/src/validation-contract.ts` (exact file selected after inspection)
- Test: `tests/validation-recipe.test.ts`
- Test: `tests/evidence-matrix.test.ts`
- Add fixture: `tests/fixtures/validation/wide-graph-order/`

**Step 1: Freeze the failure contract**

Add two independent criteria with one generic passing `pnpm test`. Assert the
compiler cannot mark both satisfied unless each has a focused selector, static
proof or declared shared evidence whose relevance is explicit.

Add the retry-2 ordering case: wrong projection order must not verify under the
value-aware v2 contract.

**Step 2: Verify RED**

Run validation recipe/matrix tests. Expected: the same generic command is
currently assigned to every obligation and yields false satisfaction.

**Step 3: Extend the contract minimally**

Represent evidence linkage explicitly:

```ts
type ValidationObligation = {
  criterionId: string;
  evidence: FocusedCommand | StaticProof | NegativeControl | SharedEvidence;
};
```

`SharedEvidence` must enumerate the criteria and explain why one execution is
relevant to each. Missing focused evidence produces `unverified`, never
`satisfied`.

**Step 4: Compile/deduplicate without losing attribution**

Deduplicate identical physical commands by digest, execute once, then attach
the same execution record to each explicitly linked criterion. Record duration
and command digest for policy measurement.

**Step 5: Verify and commit**

```powershell
pnpm exec vitest run tests/validation-recipe.test.ts tests/evidence-matrix.test.ts tests/exact-candidate-validation.test.ts
pnpm --filter @manyhands/contracts typecheck
pnpm --filter @manyhands/execution-core typecheck
```

Commit: `fix(validation): require criterion-relevant evidence`.

### Task 5: Freeze oracle obligations before execution

**Files:**

- Modify: `docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs`
- Modify: `docs/tesis/evidence/scripts/run-experiment.mjs`
- Modify: `packages/contracts/src/validation-contract.ts` or the actual oracle contract module
- Test: `tests/wide-graph-oracle.test.ts`
- Test: `tests/validation-recipe.test.ts`

**Steps:**

1. RED: a cell whose value/order oracle is absent from the frozen contract must
   be rejected before creating a run.
2. RED: changing oracle ID/version/hash after candidate creation invalidates
   attribution.
3. Add oracle ID, version, evaluator hash and criterion mapping to the frozen
   ValidationContract/cell manifest.
4. Execute the oracle on the exact candidate before `final_candidate.verified`;
   keep at most one external oracle execution per delivered experimental series
   as specified by the current protocol.
5. Distinguish a later stronger oracle as a new contract, not retroactive fraud.
6. Run oracle, contract and exact-candidate tests.
7. Commit: `feat(validation): freeze external oracle obligations`.

### Task 6: Enforce single authority and freshness

**Files:**

- Modify: `apps/web/src/lib/server/runs/run-operation-lease.ts`
- Modify: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`
- Modify: `packages/run-store/src/jsonl-event-store.ts`
- Modify: `packages/run-coordinator/src/domain/attempts.ts`
- Modify: `packages/orchestrator-graph/src/execution-driver.ts`
- Test: `tests/run-v2-crash-recovery.test.ts`
- Test: `tests/amendment-fingerprint-invalidation.test.ts`

**Steps:**

1. RED crash at each boundary: after claim/before fence, after fence/before
   process reconciliation, and graph revision during an active attempt.
2. Make claim/fence a recoverable protocol with one durable transition ID.
3. Before takeover work, terminate and verify prior owner processes.
4. Propagate lease loss into every active Git/process callback as abort.
5. Route every adoption through `adoptAttemptResult`; emit `attempt.stale` for
   mismatched fingerprints.
6. Run crash/fencing/freshness suites and affected typechecks.
7. Commit: `fix(coordinator): make authority and adoption freshness-safe`.

### Task 7: Implement cause-directed durable recovery

**Files:**

- Modify: `packages/orchestrator-graph/src/execution-driver.ts`
- Modify: `packages/orchestrator-graph/src/recovery-policy.ts`
- Modify: `apps/web/src/lib/server/runs/v2/command-host.ts`
- Modify: `packages/execution-core/src/integration/` journal wiring
- Test: `tests/failure-recovery-policy.test.ts`
- Test: `tests/integration-operation-recovery.test.ts`
- Test: `tests/local-decision-readiness.test.ts`

**Steps:**

1. RED each classified cause: transient timeout, auth/quota, shared
   infrastructure, scope mismatch, integration crash and branch stop.
2. Execute bounded automatic retry only for declared transient causes.
3. Suspend only the affected resource for auth/quota and open a shared circuit
   breaker for shared infrastructure.
4. Wire amendments to a new graph revision and stale only affected attempts.
5. Connect `JsonIntegrationOperationJournal` and reconcile after restart.
6. Make "Stop this branch" fail/block only the affected subtree, not the run.
7. Verify sibling progress continues in all local-failure tests.
8. Commit: `feat(recovery): execute cause-directed recovery policies`.

### Task 8: Feed real state to scheduler and persist the decision

**Files:**

- Modify: `apps/web/src/lib/server/runs/v2/execution-pipeline.ts`
- Modify: `packages/orchestrator-graph/src/execution-driver.ts`
- Modify: `packages/scheduler/src/wave-selector-v2.ts`
- Modify: `packages/run-coordinator/src/domain/events.ts`
- Test: `tests/scheduler-readiness-v2.test.ts`
- Test: `tests/scheduler-conflict-constraints.test.ts`
- Test: `tests/scheduler-scope-aware-wave.test.ts`

**Steps:**

1. RED unavailable executor/base, exhausted budget, active resource lock,
   expired risk evidence and open circuit breaker.
2. Replace "all node IDs available", empty active resources and constant
   `budgetAvailable=true` with productive state providers.
3. Extend conflict constraints to distinguish advisory, serialize and named
   resource lock without turning them into functional dependencies.
4. Persist blocked reasons, effective config, budget/risk evidence and selected
   wave in canonical events.
5. Add replay test that reconstructs why every node ran or waited.
6. Commit: `feat(scheduler): select waves from durable effective state`.

### Task 9: Complete manifest, delivery and decision UX

**Files:**

- Modify: `packages/run-coordinator/src/domain/outcomes.ts`
- Modify: `packages/execution-core/src/delivery/` actual delivery module
- Modify: `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx`
- Modify: `apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts`
- Test: `tests/final-candidate.test.ts`
- Test: `tests/delivery-state-machine.test.ts`
- Test: `tests/delivery-target-cleanliness.test.ts`
- Test: `tests/run-v2-decision-control.test.ts`

**Steps:**

1. RED missing tree SHA, graph revision, artifact IDs or recipe digest.
2. Extend FinalCandidate/manifest and receipt with those immutable fields.
3. Recheck exact candidate, target and required freshness immediately before
   fast-forward publication.
4. Add delivery preview with criterion matrix and explicit confirmation.
5. Implement `request_changes` as a new graph revision/decision path.
6. Verify receipt/manifest digests and UI actions against canonical state.
7. Commit: `feat(delivery): publish complete verified manifests`.

### Task 10: Grounding, security and observability hardening

**Files:**

- Modify: `packages/repository-index/src/source-parser.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Modify: `packages/execution-core/src/security/` actual boundary modules
- Modify: `packages/trace-store/` productive wiring
- Modify: `packages/run-store/` recovery/compaction wiring
- Test: new focused import-budget, symlink-parent and secret-diff regressions
- Test: `tests/process-evidence-journal.test.ts`

**Steps:**

1. RED 20,000-file repository prompt growth and missing import relations.
2. Parse sufficient imports/symbols or explicitly lower confidence; select
   relevant context under a deterministic token budget.
3. RED new file under a symlinked parent and secret added to candidate diff.
4. Resolve parent realpaths before writes; add deny-wins forbidden paths and
   secret scanning before adoption.
5. Replace productive in-memory traces with `JsonlTraceStore`.
6. Connect snapshot recovery/compaction with a heartbeated lock.
7. Verify restart, trace durability, context bounds and security cases.
8. Commit: `fix(platform): harden grounding security and durable traces`.

### Task 11: Make policy C reproducible and empirically grounded

**Files:**

- Modify: `packages/decomposer/src/granularity/strategy-selector.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Modify: `packages/run-coordinator/src/domain/events.ts`
- Test: `tests/granularity-utility-policy.test.ts`
- Test: `tests/planning-v2-adaptive.test.ts`
- Modify: `.scratch/code-review-remediation/issues/12-measure-validation-duplication.md`

**Steps:**

1. Without changing formula/threshold, persist every effective parameter,
   including `maxLeafPlannedPaths`.
2. Measure current `validationDuplication` against actual deduplicated command
   digests, durations and criterion links from Tasks 3-4.
3. Issue the honest H1 verdict for the current policy version.
4. If the proxy is invalid, introduce a new explicit policy version with a red
   test derived from measured data; never rewrite historical events.
5. Verify candidate tree hash + parameters + evidence reproduce the decision.
6. Commit: `feat(policy): make granularity cost evidence reproducible`.

### Task 12: Re-run the thesis evidence and finish closure

**Files:**

- Create: `docs/tesis/evidence/warehouse/wide-graph/retry-11/` or next unused retry
- Modify: tickets 11, 12, 02, 14 and 15 in canonical order
- Modify: `docs/tesis/HANDOFF.md`
- Modify: `docs/tesis/claim-evidence-matrix.md`
- Modify: thesis/presentation/defense sources and generated PDFs

**Steps:**

1. Independent Standards/Spec reviews of Tasks 1-11: `No implementes correcciones`.
2. Create clean isolated freeze on one commit and run full P0 sequentially.
3. Verify policy marker, dist hash, manifest, clean tree and authenticated mutation.
4. Create three new W1 targets and run N=4/N=8/N=16 sequentially with one
   detached watcher each and no executable changes.
5. Preserve every result. Run the frozen oracle only as permitted by the
   protocol; pre-candidate failures remain `not_run`.
6. Close ticket 11 only after functional evidence and both reviews PASS.
7. Execute ticket 12 measurement, ticket 02 replay rejection, ticket 14 claims
   re-derivation and ticket 15 editorial/PDF/visual gates.
8. Run the final repository gate on one clean commit:

```powershell
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

9. Confirm no open P0/P1, no required artifact missing and no thesis claim
   exceeds the evidence.
10. Commit local closure artifacts; never push.

## Phase review protocol

Before each task closes:

1. `grilling`: strongest counterexample and possible false positive.
2. Standards review, read-only: architecture, safety, maintainability.
3. Spec review, read-only: acceptance and evidence boundaries.
4. Correct findings with a new red regression.
5. Repeat reviews until both PASS.
6. Update the local issue and HANDOFF.

## Final acceptance

- All P0/P1 in this plan are closed with productive tests.
- Existing Git isolation, checksum/fencing and delivery fast-forward invariants
  remain green.
- Retry-9/retry-10 adverse evidence remains immutable.
- A new frozen run reaches an independently verified terminal result or the
  thesis reports the remaining adverse result without overclaiming.
- The academic conclusion follows the evidence; it is not selected in advance.
