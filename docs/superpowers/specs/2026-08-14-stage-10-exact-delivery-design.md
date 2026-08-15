# Stage 10 / GDel — crash-safe exact delivery

**Date:** 2026-08-14
**Status:** approved design, not yet implemented
**Authority:** this document refines
[`the redesign plan`](../../plans/2026-08-12-correctness-first-system-redesign.md)
Stage 10. Where the two disagree, the plan wins.

## Purpose

Prevent crash-induced false success or duplicate publication.

## Entry state

Stage 10 is **not authorized to start**. Stage 8 / GLeaf is `in_review` pending
a live R0 re-run, and Stage 9 / GI is `in_review` pending that and a bounded
independent gate review. This design may be written and reviewed now.

## What already exists

The delivery path is further along than the plan's wording suggests. Everything
below was read, not assumed.

- `TransactionalDeliveryPublisher` already sequences claim, recover, inspect,
  publish and complete, with an idempotency key bound to a request fingerprint.
- Its `recover` step already covers the crash-after-publish case: on restart it
  detects that the target already carries the approved SHA and returns the
  receipt instead of publishing again.
- `targetWorkingTreeIsClean` already implements a `.manyhands`-aware cleanliness
  rule, so the orchestrator's own worktree pool does not block delivery while
  every real user change still does.
- `GitRunner.updateRef({ cwd, ref, target, expectedOldOid })` **already exists**.
  The compare-and-swap primitive is present and unused by delivery.
- The reducer already refuses a `delivery.started` whose approval does not match
  the current verified final candidate's manifest, commit and target snapshot.
- `run-engine-effect-crash-matrix.test.ts` already covers five crash positions
  around a physical effect, per effect kind.

## The gap

1. **Delivery is check-then-act, not compare-and-swap.** The adapter reads
   `symbolic-ref` and `rev-parse`, then runs `git merge --ff-only`. Two problems:
   the read and the write are separate, and `--ff-only` only requires ancestry.
   A target that advanced to a *different* commit which is still an ancestor of
   the final SHA is published over. GDel requires an unexpectedly advanced
   target to fail closed.
2. **The receipt records a commit, not a tree.** GDel requires an immutable
   receipt for the exact delivered tree and ref.
3. **The delivery intent does not bind its cleanliness policy.** The policy is
   applied but not recorded, so a receipt cannot say which rule it was judged by.
4. **There is no typed diagnostic surface.** The plan names six conditions —
   corrupt journal, missing object, unresolved process, stale decision, target
   divergence, unrecoverable external effect — and today they surface as
   untyped `Error` strings, which an operator cannot act on and a test cannot
   assert precisely.
5. **No clean-clone cell.** Nothing proves a fresh clone of the delivered ref
   reproduces the claim.

## Design

### Compare-and-swap delivery

The publish step becomes one conditional ref update:

```
updateRef({ cwd, ref: `refs/heads/${branch}`, target: finalSha, expectedOldOid: targetHead })
```

Git fails the update if the ref no longer holds `expectedOldOid`, which closes
the window between the check and the write and makes "unexpectedly advanced"
fail closed even when the new head is an ancestor of the final SHA.

The pre-flight inspection stays: it produces the diagnostic that tells an
operator *why* delivery refused. The CAS is what makes the refusal sound; the
inspection is what makes it legible.

The working tree still has to be reconciled after the ref moves, because the
target is a checked-out branch. Delivery therefore keeps requiring a clean tree
and updates the index and working tree to the delivered commit after the CAS
succeeds, treating a failure there as an ambiguous outcome rather than a
success.

### Ambiguous outcomes

An ambiguous outcome is one where the ref may or may not have moved — a crash
between the CAS and the receipt, or a working-tree reconciliation that failed
after the ref moved. Reconciliation reads the ref and decides:

| Ref state | Meaning | Action |
|---|---|---|
| equals `finalSha` | the CAS succeeded | complete the receipt |
| equals `targetHead` | the CAS never ran | retry from inspection |
| anything else | someone else moved it | fail closed with a divergence diagnostic |

This is the existing `recover` step, extended to the third case, which today
returns `undefined` and silently falls through to a fresh publish attempt.

### Receipt

The receipt gains the delivered tree OID and the cleanliness policy identifier
it was judged under. Both are immutable and bound to the same request
fingerprint the approval already carries.

### Typed diagnostics

A discriminated union in `@manyhands/contracts`, one member per named
condition, each carrying the evidence an operator needs to act:

```ts
type RecoveryDiagnostic =
  | { kind: "corrupt_journal"; runId: string; sequence: number; detail: string }
  | { kind: "missing_object"; oid: string; expectedBy: string }
  | { kind: "unresolved_process"; processId: string; lastReceiptId: string }
  | { kind: "stale_decision"; decisionId: string; raisedAtGraphRevision: number; currentGraphRevision: number }
  | { kind: "target_divergence"; ref: string; expectedOid: string; actualOid: string }
  | { kind: "unrecoverable_external_effect"; effectId: string; detail: string };
```

Delivery failures carry one of these rather than a string, and the existing
`delivery.failed` event gains the diagnostic beside its reason.

### Restart matrix

The matrix covers each phase at the granularity the system actually has.
Per-attempt process effects were deliberately **not** adopted: GDel is about
delivery crash-safety, reconciliation at run level is already proven by Stage 8,
and attempt-level effects would bring their own fencing, lease and
reconciliation work. That decision is recorded here so a later reader does not
mistake it for an oversight.

| Phase | Crash cell | Existing coverage to reuse |
|---|---|---|
| Planning | crash between proposal and approval | Stage 6 canonical planning tests |
| Execution | crash mid-wave with concurrent attempts | Stage 8 restart, Stage 9 concurrency |
| Validation | crash after validation, before adoption | GD1 matrix |
| Integration | crash mid-composite | Stage 9 R16 |
| Cancellation | crash during cancellation | Stage 8 R10 |
| Cleanup | crash during worktree cleanup | new |
| Delivery | crash before CAS, after CAS, during reconciliation | new |

### Retirement

Delivery without an intent, a CAS and a reconciliation path is removed. Any
remaining caller must be named with a retirement stage or deleted.

## Testing

Deterministic: real temporary Git repositories, controlled processes, fixtures.
No model calls, no network, no browser.

Required cells:

- **R9** crash after physical success — one receipt, no duplicate publication.
- **R12** delivery target divergence — fails closed with a `target_divergence`
  diagnostic, including the case where the new head is an ancestor of the final
  SHA.
- **R13** stale approval — an approval is invalid once the candidate changes.
- **Clean clone** — a fresh clone of the delivered ref reproduces the exact tree
  and passes the recorded validation recipe.

## Out of scope

Per-attempt process effects, Stage 11 legacy deletion, live model runs, the
longitudinal study and thesis work.
