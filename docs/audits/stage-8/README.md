# Stage 8 / GLeaf — sandboxed live leaf

## Status

`in_review` — this record deliberately does **not** close GLeaf or update the
canonical stage table. R0, R14, R17 and all required R10 live slices now have
attributable evidence. The remaining gate is a bounded independent review and
the final full-suite candidate qualification.

## Implemented boundary under qualification

- `WorkspaceSandboxProvider` reports the effective workspace capabilities,
  rejects a requested `strong` profile, rejects additional directories, and
  creates an attempt-local brokered home.
- `CredentialBroker` copies only an explicitly declared Codex or Claude
  credential file into that ephemeral home; the executor never receives the
  daemon's `HOME` or `USERPROFILE`.
- `sandboxed_live` is an explicit daemon profile. It requires a declared
  credential source and passes the worker through the existing supervised
  process effect. The legacy `transitional_unsafe` profile remains labelled as
  such and is not GLeaf evidence.
- Codex uses `workspace-write`, ignores user configuration, and pins
  `sandbox_workspace_write.network_access=false`. Claude receives no project or
  local settings source. The profile surface declares no additional
  directories, hooks, plugins or MCP configuration; their rejection still
  requires live-path qualification.

## Deterministic evidence (uncommitted tree)

Executed with serial Vitest (`--retry=0 --minWorkers=1 --maxWorkers=1`):

- Stage 8 sandbox/profile/V2/daemon-adapter/supervisor/recovery focused matrix:
  **108 passed**;
- `@manyhands/execution-core` typecheck: passed;
- `@manyhands/daemon` typecheck: passed;
- `git -c core.whitespace=cr-at-eol diff --check`: passed.
- Current-tree `pnpm test` on 2026-08-14: **274 files / 1,819 tests passed**
  (one opt-in live suite and ten tests skipped by design).
- Workspace package typechecks: passed (13 packages); web TypeScript check:
  passed; package builds and production web build: passed. These build commands
  were invoked through `corepack pnpm` because the host's global `pnpm` is an
  incompatible 7.29.3 while the repository pins 11.21.0.
- R14 failure classification: `SANDBOX_UNAVAILABLE` is an explicit
  `environment_auth_executor` outcome with no automatic retry (28 focused
  failure-policy tests passed).
- R10 physical custody: Windows Job Object cancellation, started-only recovery
  and daemon restart tests passed (6 tests). These use the deterministic fake
  worker and therefore do not substitute for the live executor requirement.
- Canonical retry lineage: after an operator resolves a leaf failure, the
  productive driver creates a distinct attempt with `retryOfAttemptId`, the
  immutable prior failure and a different causal input fingerprint. A failed
  exact validation now returns to that durable second-attempt path instead of
  performing an internal repair in-place (31 focused sandbox/profile/canonical
  retry tests passed).
- The daemon recovery-decision dispatch regression: resolving
  `resolve_conflict/retry` starts a distinct `stage3:execution:recovery:*`
  effect (one focused test passed).
- R10 lease recovery: a fresh heartbeat from a process that has already died is
  reclaimed immediately rather than blocking restart recovery for the stale
  window (one focused Stage 8 lease regression passed alongside the two
  physical cancellation/restart tests).

The available global Node runtime was 24.16.0, not the Node 22 runtime named
by the original implementation plan. On 2026-08-14 the operator explicitly
authorized Node 24 for this Stage 8 qualification after R0 passed under that
runtime and no Node-22-specific execution or sandbox requirement was found.
This is a recorded runtime exception, not a claim that Node 22 was exercised.

## Required evidence still missing

- a bounded independent gate review, an exact candidate SHA/tree and full
  `pnpm test` on that candidate. The current tree is green, but it is not yet
  an immutable candidate qualification.

## Live R0 observations

The opt-in Codex attempts reached the canonical graph approval, durable process
effect and supervised leaf. The original target at `C:\mh8-r0` lacked the
`CodexSandboxUsers` ACL. A fresh target below `Documents` granted that ACL but
the initial isolated `CODEX_HOME` was read-only because it did not select the
native Windows implementation. The profile now explicitly pins
`windows.sandbox="elevated"` and brokers the non-secret setup marker beside the
declared auth source into the attempt-local `CODEX_HOME`.

That change reached `sandbox: workspace-write`, but Codex then reported
`sandbox users missing or incompatible with marker version` and did not finish
the first external skill-read command. The host's two named sandbox users exist,
so this is a native Codex installation/marker compatibility fault, not target
ACL or a permission expansion ManyHands can safely perform. The interrupted
process trees were terminated and their worktree, lease, receipts and traces
were moved intact to `C:\mh8-evidence\r0-*`. This is adverse evidence, not a
successful R0.

Those elevated-mode failures are retained as adverse evidence. The succeeding
run did not bypass them: it selected the documented `unelevated` fallback
explicitly, which satisfies only the `workspace` profile.

## R0 final outcome

On `2026-08-14`, the opt-in run against clean clone
`C:\Users\franc\Documents\mh8-r0-sandbox` completed under the explicit
`unelevated` workspace mode. The daemon recorded one supervised Codex leaf,
candidate `f8d1eed639a15aeb29d93b120423630933a03a85`, tree
`b11777e1037a97fd0a747f79c7c082ace3aefcf1`, exactly two changed files
(`src/stage8-probe.js`, `src/stage8-probe.test.js`), and verified matrix
`matrix-7817ac4d6efa0d78`. Its independent command observation passed and its
negative control detected failure. The source checkout remained on the baseline;
the R0 test reads the candidate commit instead of treating isolation as delivery.
Receipts, event journal, traces and extracted runtime state are retained at
`C:\mh8-evidence\r0-final-pass`.

This is qualifying R0 evidence under the explicit Node 24 runtime exception.
No permission bypass, host-directory expansion, Claude run, Stage 9, Stage 10,
longitudinal experiment or thesis work was used as a substitute.

## R14 final outcome

On `2026-08-14`, an opt-in daemon run used a deliberately declared empty Codex
credential source without the required native sandbox setup marker. The real
supervised worker started, the `WorkspaceSandboxProvider` rejected the setup
before any provider CLI launch, and the durable leaf attempt failed with
`SANDBOX_UNAVAILABLE`. The run then raised a pending decision rather than
retrying or degrading. The outer process receipt has matching `started` and
`final` records; the source target remained untouched. Journal, receipts and
the non-secret fixture are retained at `C:\mh8-evidence\r14-missing-marker`.

## R10 cancellation outcome

On `2026-08-14`, an opt-in `unelevated` Codex run emitted real executor output
before the operator submitted `cancel_run`. The daemon durably recorded the
cancel intent and process-termination effect, the owned Job Object finished
with `outcome: "terminated"`, and the final lifecycle fact records
`allDead: true`. A post-cancellation OS process query found no `codex.exe`
whose command line referenced the run worktree; no candidate was created.
The run journal, process receipts, trace and cleanup evidence are retained at
`C:\mh8-evidence\r10-cancel`.

## R10 timeout outcome

On `2026-08-14`, an opt-in live Codex leaf with a 15-second hard limit failed
with the durable timeout cause, produced no candidate, no scoped `codex.exe`,
and no brokered `auth.json` after the owned process terminated. The earlier
executor-level tree-kill barrier was adverse evidence. The final rerun uses
supervisor-owned credential cleanup and is retained at
`C:\mh8-evidence\r10-timeout-credential-cleanup`.

## R10 restart and cleanup outcome

On `2026-08-14`, a planned live Codex run was approved through the published
daemon entrypoint, then that daemon was killed while its worker was active. On
restart the new daemon reconciled the durable started receipt, terminated the
old owned tree, removed that worker's brokered credential scope, and emitted
exactly one new supervised execution effect. The recovered tree was then
cancelled: no candidate, no scoped `codex.exe`, and no brokered `auth.json`
remained. The final successful evidence is retained at
`C:\mh8-evidence\r10-restart-credential-scope-final`.

## R17 final outcome

On `2026-08-14`, the opt-in live path first failed the one Codex leaf because
the declared credential source intentionally lacked its non-secret native
sandbox marker. After the marker was restored and the pending `retry` decision
was resolved, the daemon dispatched a second supervised execution effect and
the same leaf reached `result_ready`. The first immutable attempt remains
failed with `SANDBOX_UNAVAILABLE`; the adopted second attempt records
`retryOfAttemptId` to that first attempt and has a distinct input fingerprint.
The exact candidate is `5e1be7be2008216ac79dc868bcf321ae3861f14f`, tree
`e7db94a073078e94916f65ee6135b97c21c7e876`, with verified matrix
`matrix-4bf8137c16b78c92`. The retained evidence at
`C:\mh8-evidence\r17-qualified-lineage` contains no copied auth credential;
it retains only the non-secret marker fixture, journal, receipts and traces.
