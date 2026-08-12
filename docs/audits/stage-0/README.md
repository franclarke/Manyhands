# Stage 0 attributable baseline

**Gate:** G0

**Status:** `in_progress`

**Baseline subject:** `f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265`

**Baseline tree:** `4a8e169a0d68f3cd8a25c9a7ba098c422307d15f`

**Rejected Stage 0 candidate:** `9cf3e87a9a534bd07947cfaedb6d78f88205b642`

**Rejected candidate tree:** `694b99d80023d329502987563d2b8fb4b8df113e`

**Branch:** `codex/correctness-first-full-implementation`

**Captured:** 2026-08-12 (`America/Buenos_Aires`)

This directory makes the transition baseline attributable before any Stage 1
production change. The baseline subject contains the reviewed normative
architecture and its adversarial review. Candidate `9cf3e87a` added only gate
evidence, tests and reproducibility/harness configuration, but independent
review rejected its lock conversion before G0 could close.

## Evidence set

- [`environment.json`](environment.json) records the allowlisted host and tool
  facts. It deliberately excludes environment variables, tokens and private
  configuration.
- [`commands.json`](commands.json) is the command registry. A gate command is not
  a pass until it has an exit code, log and SHA-256 on the exact committed tree.
- [`productive-route.md`](productive-route.md) traces the current path from run
  creation through delivery and the mutating GET reconciliation path.
- [`transition-ledger.md`](transition-ledger.md) maps I1–I43 and DoC1–DoC26 to
  current owners, gaps, target stages and retirement obligations.
- [`required-cells.md`](required-cells.md) registers R0–R19. Every cell is
  `not_run` at G0; historical experiments do not fill target cells.
- [`verification.md`](verification.md) records the clean short-path clone, its
  mechanical outcomes and the independent finding that rejected it.
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
5. no product behavior was changed before the gate.

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

Candidate `9cf3e87a` passed the mechanical checks in the clean short-path clone
`C:/mh-g0-9cf3-02`. A cold frozen-lockfile installation placed 630 packages from
an initially empty store, and the Stage 0 contracts, focused route, full suite,
package/web typechecks, package build, and Next production build passed. Lint
still reports the characterized pre-existing baseline of 78 errors and 0
warnings. Independent review then rejected the candidate because the pnpm 11
lock conversion changed baseline direct and transitive dependency resolutions.
Subsequent harness candidates exposed fail-closed PowerShell and toolchain
oracle defects before an accepted qualification could be recorded; their
partial receipts remain adverse evidence. The first fully executable successor,
`0cf4b5b8`, then exposed a real durable-lock deadline-ordering defect after
1,485 passing tests; the next candidate includes its deterministic regression
and root-cause fix. G0 therefore remains `in_progress`;
Stage 1 is blocked until a resolution-preserving candidate produces the exact
18-receipt set, is recorded by a direct evidence-only child commit, and passes
independent review. All R0–R19 cells remain `not_run`.

The independent G0 review is fail-closed. Its dependency-drift finding is
preserved in [`verification.md`](verification.md); no Stage 1 work is authorized
until the reissued candidate closes it.
