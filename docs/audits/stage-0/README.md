# Stage 0 attributable baseline

**Gate:** G0

**Status:** `in_progress`

**Baseline subject:** `f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265`

**Baseline tree:** `4a8e169a0d68f3cd8a25c9a7ba098c422307d15f`

**Branch:** `codex/correctness-first-full-implementation`

**Captured:** 2026-08-12 (`America/Buenos_Aires`)

This directory makes the transition baseline attributable before any Stage 1
production change. The subject commit contains the reviewed normative
architecture and its adversarial review. The later gate-evidence commit may add
only documentation, tests and harness configuration; it must not alter the
productive run path characterized here.

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

## Admitted claims

At G0 this evidence may prove only that:

1. the baseline source, architecture and environment are identifiable;
2. the current productive route and its transition gaps are traceable;
3. every target invariant, completion criterion and required cell has a future
   owner and gate;
4. existing legacy reachability cannot grow without changing the explicit
   characterization test;
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

G0 remains `in_progress` until a clean local clone of the Stage 0 harness commit
starts clean and passes the focused route suite, full tests, package/web
typechecks and builds. The command registry must contain the exact results and
log hashes, the plan status must point here, and an independent reviewer must
confirm that Stage 1 production code was not started.
