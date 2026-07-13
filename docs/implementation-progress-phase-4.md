# Phase 4 — Implementation Progress

## Estabilización pendiente de Phase 3

Status: completed.

The watchdog failure was a product durability race at the B-018 boundary: a transient Windows `EPERM` while atomically renaming the JSONL temporary file rejected the required `run.cancelled` append after the watchdog had already verified `allDead`. The cancellation itself was not reclassified as successful; the bounded retry now applies only to `EPERM`/`EACCES`/`EBUSY` publish failures, preserves the temporary file cleanup rule, and still surfaces a non-transient or exhausted failure. `tests/durable-run-event-log-windows-lock.test.ts` injects the concrete rename failure and proves one durable, idempotent `run.cancelled` event with `payload.allDead=true`.

The resume concurrency test was non-hermetic because its fire-and-forget route kicks reached real planning/resume pipeline exports. The test now uses the existing runner seam at the route import boundary for planning and execution starts/resumes, drains tracked background tasks, and asserts the winning restart kick exactly once. It no longer invokes a titler, decomposer, or executor process.

Commits:

- `05637ed fix(events): recover required events after transient Windows lock errors`
- `4413ed1 test(resume): make concurrency coverage fully hermetic`

Directed result: `tests/durable-run-event-log-windows-lock.test.ts` and `tests/resume-route-concurrency.test.ts` passed 20/20 tests. The original watchdog provisioning test also passed in independent processes during stabilization; remaining repetitions and the full matrix are recorded in final Phase 4 verification.

## B-025 — Operational states and Recovery Center

Status: completed.

Root cause: the run workspace had reducer-derived graph state but no focused, pure operational projection of cancellation, pending decisions, degraded/recovery evidence, artifact disposition, and only-safe lifecycle actions. Components would otherwise need to infer recovery from disparate status/error details.

Design: `selectOperationalRecovery` consumes the normalized `RunModel` together with canonical native events. It produces operational state, blocking reasons, pending decisions, cancellation evidence, artifact/delivery availability, and a finite set of actions backed by existing routes. `OperationalRecoveryCenter` is rendered inside the existing run workspace and only invokes `/cancel`, `/resume`, or `/restart`; delivery remains in its existing real delivery panel, and decision resolution remains in the canonical decision control-plane. No frontend recovery action was invented for ambiguous attempts or degraded logs.

Modified components and selectors:

- `apps/web/src/lib/run-model/operational-recovery.ts`
- `apps/web/src/app/runs/[runId]/_components/operational-recovery-center.client.tsx`
- `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx`

Tests: `tests/operational-recovery.test.ts` covers running/cancelling evidence, pending decisions, partial, unverified, and degraded state. Consumer coverage: `tests/run-model-reducer.test.ts` and `tests/cancel-terminal.test.ts`.

Results: directed tests passed 65/65; `pnpm --filter @manyhands/web exec tsc --noEmit` passed. Refresh remains a reconstruction from the seed plus durable event log; no second UI state is persisted. Legacy run status remains supported through existing seed projection.

Deferred: attempt adopt/discard and event-log reconciliation actions are deliberately not exposed because the current API does not provide a safe operator route for them. This does not add B-029+ work.

Commit: recorded after commit creation.

## B-026 — Final viewer from immutable commits

Status: completed.

Root cause: the existing final viewer used Git object reads, but its routes did not accept and validate the manifest identity/final SHA requested by the client, and tree output did not expose immutable object metadata or base-to-final changes.

Design: final reads now resolve a `FinalArtifactReference` against the run-owned manifest, reject a mismatched manifest ID or SHA, verify `finalSha^{commit}`, and use `git show`, `git ls-tree -l`, and `git diff --name-status --find-renames` in the provisioned execution repository. The client seed carries an immutable manifest view and sends its manifest ID/SHA whenever the final context is selected. Final reads never traverse the mutable source checkout; legacy runs without a manifest remain unavailable for final context rather than falling back.

Modified routes and viewer: `workspace-context.ts`, workspace tree/file routes, run-model seed/types, and the existing Files surface. Tests in `tests/final-apply.test.ts` cover a divergent source checkout, mismatch rejection, final-tree mode, and base-to-final changed files; `tests/workspace-file-containment.test.ts` remains the path-boundary consumer.

Results: final artifact and containment tests passed 11/11. Web typecheck is rerun as part of the committed verification.

Deferred: binary preview and visual base/final diff panes remain represented by immutable metadata and the existing diff surface; no writable terminal is added to the final viewer.

Commit: recorded after commit creation.
