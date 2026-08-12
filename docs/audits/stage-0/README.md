# Stage 0 attributable baseline

**Gate:** G0

**Status:** `pass`

**Baseline subject:** `f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265`

**Baseline tree:** `4a8e169a0d68f3cd8a25c9a7ba098c422307d15f`

**Accepted Stage 0 candidate:** `c7819799d22e920359050d4491bbca57e4a3cf8f`

**Accepted candidate tree:** `cb68af5cb33bbbae4db295dccc094eb517076b57`

**Rejected Stage 0 candidate:** `9cf3e87a9a534bd07947cfaedb6d78f88205b642`

**Rejected candidate tree:** `694b99d80023d329502987563d2b8fb4b8df113e`

**Branch:** `codex/correctness-first-full-implementation`

**Captured:** 2026-08-12 (`America/Buenos_Aires`)

This directory makes the transition baseline attributable before any Stage 1
production change. The baseline subject contains the reviewed normative
architecture and its adversarial review. Candidate `c7819799` is the accepted
reproducible baseline. Candidate `9cf3e87a` and the later adverse attempts remain
historical evidence and do not support the accepted gate claim.

## Evidence set

- [`environment.json`](environment.json) records the allowlisted host and tool
  facts. It deliberately excludes environment variables, tokens and private
  configuration.
- [`commands.json`](commands.json) identifies the accepted qualification and
  points to the per-receipt exact commands in [`evidence-index.json`](evidence-index.json).
  A gate command is not a pass until it has an exit code, log and SHA-256 on the
  exact committed tree.
- [`productive-route.md`](productive-route.md) traces the current path from run
  creation through delivery and the mutating GET reconciliation path.
- [`transition-ledger.md`](transition-ledger.md) maps I1–I43 and DoC1–DoC26 to
  current owners, gaps, target stages and retirement obligations.
- [`required-cells.md`](required-cells.md) registers R0–R19. Every cell is
  `not_run` at G0; historical experiments do not fill target cells.
- [`verification.md`](verification.md) records the accepted clean short-path
  qualification, its mechanical outcomes and the bounded independent review.
- [`logs.sha256`](logs.sha256) authenticates the complete evidence log set under
  [`logs/`](logs/), including the rejected `candidate-9cf3-shortpath-*` records and
  preserved adverse attempts.
- [`evidence-index.json`](evidence-index.json) covers every retained log exactly
  once and keeps unknown command, candidate, working-directory or exit fields
  explicitly `null` instead of inventing attribution.

## Admitted claims

At G0 this evidence may prove only that:

1. the baseline source, architecture and environment are identifiable;
2. the current productive route and its transition gaps are traceable;
3. every target invariant, completion criterion and required cell has a future
   owner and gate;
4. new files containing a frozen legacy marker cannot appear without changing
   the explicit characterization test;
5. no redesign behavior was implemented before the gate; qualification exposed
   and corrected one pre-existing durable-lock deadline-ordering defect.

## What G0 does not prove

G0 does not prove a daemon, durable general effect protocol, immutable
Repository Views, direct semantic compilation, Git-native scoped artifacts,
enforced sandbox, hierarchical integration, crash-safe delivery, production
readiness or thesis hypotheses. Component tests using fakes characterize the
current implementation; they are not evidence for target capabilities.

## Initial dirty-state custody

The program began on `main` at
`2339cd8b75dbea9cffaf41bb5a3c9d724caff5f3` with only:

- a modified normative redesign plan; and
- the untracked adversarial review under `docs/audits/`.

Those files were inspected, passed the focused documentation/architecture
checks and were committed without reset or cleanup as `f8082e5f`. No unrelated
user work was discarded.

## Gate closure conditions

Candidate `c7819799` passed all 18 required receipts in the fresh clean clone
`C:/mh-g0-c781-09` using Node v22.22.0 and pnpm 11.21.0. The full suite passed
231 files and 1,487 tests with 4 explicit skips; all 12 package typechecks,
package build, web typecheck and Next production build passed. The final
identity receipt preserved the exact candidate/tree and an empty Git status.
Lint remains the characterized non-blocking G0 baseline of 78 diagnostics with
fingerprint `74bd6c28c7f21924479e2ec82cfea8de75b8b4d36c0707c0892a64c3db822c70`.

The qualification corrected the real durable-lock defect first exposed by
`0cf4b5b8`: an expired waiter could attempt stale-lock recovery before checking
its own deadline. A deterministic regression now protects the corrected
ordering. One bounded independent binary review returned GO for the exact
candidate and receipt set. G0 is therefore `pass` and Stage 1 is authorized and
`in_progress`. Earlier rejected candidates and incomplete receipts remain
adverse history only. All R0–R19 cells remain `not_run`.
