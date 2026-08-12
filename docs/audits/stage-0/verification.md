# Stage 0 clean-clone verification

**Architecture baseline:** `f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265`

**Architecture baseline tree:** `4a8e169a0d68f3cd8a25c9a7ba098c422307d15f`

**Accepted candidate:** `c7819799d22e920359050d4491bbca57e4a3cf8f`

**Accepted tree:** `cb68af5cb33bbbae4db295dccc094eb517076b57`

**Stable clean clone:** `C:/mh-g0-c781-09`

**Initially empty store:** `C:/mh-store-c781-09`

**Corepack shims:** `C:/mh-shim-c781-09`

**Pinned runtime:** `C:/mh-runtime-c781-09` (Node v22.22.0; pnpm 11.21.0)

## Gate decision

G0 is `pass`. Candidate `c7819799` produced the complete 18-receipt set in a
fresh short-path clone under the pinned Node v22.22.0 and pnpm 11.21.0
toolchain. The final receipt confirms the exact candidate/tree and an empty Git
status. One bounded independent binary review returned GO after checking the
candidate identity, receipt completeness, results, lint characterization,
secret hygiene and final cleanliness. Stage 1 is authorized and `in_progress`.

The accepted candidate includes the root-cause correction for the durable-lock
defect exposed by `0cf4b5b8`: a waiter whose acquisition deadline had expired
could check staleness and attempt recovery before rejecting its own timeout. A
deterministic regression now requires the deadline check before stale-lock
mutation. Earlier candidates rejected for dependency drift or harness defects
remain adverse evidence and are not attributed to this gate.

This decision proves an attributable transition baseline only. It does not
prove any Stage 1-11 target capability, production readiness, or thesis
hypothesis. R0-R19 remain `not_run`.

## Final stable-clone results

| Check | Outcome | Evidence |
|---|---|---|
| Setup and identity | `pass` | Fresh paths; exact candidate/tree; Node v22.22.0 and pnpm 11.21.0 in `candidate-c7819799-final-setup.log`. |
| Cold frozen install | `pass` | Isolated cold installation completed in `candidate-c7819799-final-clean-install.log`. |
| Stage 0 contracts | `pass` | 4 files and 14 tests in `candidate-c7819799-final-stage0-contracts.log`. |
| Focused productive route | `pass` | 18 files and 138 tests in `candidate-c7819799-final-focused-route.log`. |
| Full suite | `pass` | 231 files; 1,487 passed and 4 skipped in `candidate-c7819799-final-full-tests.log`. |
| Package typechecks | `pass` | All 12 package typechecks in `candidate-c7819799-final-package-typechecks.log`. |
| Web typecheck | `pass` | Dedicated command receipt with exit 0 in `candidate-c7819799-final-web-typecheck.log`. |
| Package build | `pass` | Package build completed in `candidate-c7819799-final-package-build.log`. |
| Web build | `pass` | Successful Next production build in `candidate-c7819799-final-web-build.log`. |
| Lint baseline | `frozen_nonblocking` | 78 diagnostics; fingerprint `74bd6c28c7f21924479e2ec82cfea8de75b8b4d36c0707c0892a64c3db822c70` in `candidate-c7819799-final-lint.log`. |
| Final identity | `pass` | Exact candidate/tree, unchanged tool hashes and empty status in `candidate-c7819799-final-final-identity.log`. |

The accepted qualification is identified in [`commands.json`](commands.json);
its exact per-receipt commands, working directories, exit codes, results and
paths are in [`evidence-index.json`](evidence-index.json). SHA-256 values for the entire log set are in
[`logs.sha256`](logs.sha256); no individual hash is duplicated here.

## Pre-Stage 1 reproducibility remediation

The first attributable candidates exposed harness/toolchain defects before the
accepted qualification:

- `a3f45c72` pins pnpm 11.21.0, updates the lockfile, and pins CI Node 22.22.0.
  That rejected candidate's lockfile SHA-256 is
  `92d6ebaa559baff3ddf9990839522bf77d9bafd8aac594c462ccca1f9a41a112`.
- `9cf3e87a` makes one Windows shim regression assertion case-insensitive, which
  matches Windows path semantics.

Both commits precede Stage 1 and change reproducibility/tests, not the productive
run architecture. Their necessity and scope remain visible rather than being
folded into a false claim that the original toolchain was reproducible.
Candidate `c7819799` additionally contains the narrowly scoped durable-lock
deadline fix and its regression because the full qualification found a real
pre-existing product safety defect.

## Preserved adverse history

Earlier pnpm 7 and long-path attempts remain in the log set and in
[`commands.json`](commands.json). In particular,
`candidate-9cf3-web-build.log` records an attempt whose `%TEMP%` clone passed
installation and source checks, after which the web build observed missing
plugin/files and `ENOENT`. Later inspection found the clone, store and shim
paths absent, but no receipt establishes why. The attempt therefore remains
`inconclusive`; it neither proves a product defect nor a host cleanup cause.
The accepted short-path clone was later created independently and passed the
same web build as part of the complete 18-receipt qualification.

The lint failure is different: it is a reproducible current repository finding.
It does not block G0 because G0 freezes current truth, but it remains required
work before GProd can claim a fully green production-quality gate.

## Evidence integrity and limitations

- [`logs.sha256`](logs.sha256) covers every retained final/adverse log, which
  are explicitly versionable despite the repository-wide `*.log` ignore rule.
- [`evidence-index.json`](evidence-index.json) classifies every retained log exactly
  once; incomplete historical receipts preserve `null` fields and are not used
  as accepted-candidate claims.
- [`../../../scripts/verify-stage0-clean-clone.ps1`](../../../scripts/verify-stage0-clean-clone.ps1)
  is the fail-closed recipe used for the accepted candidate: it refuses existing
  clone/store/shim targets and records setup, strict preflight, commands and
  post-check identity.
- [`../../../scripts/verify-stage0-closure.ps1`](../../../scripts/verify-stage0-closure.ps1)
  verifies that the gate-record commit is a single-parent, evidence-only child
  of the exact qualified candidate and contains all 18 required receipts.
- The accepted qualification used pinned Node v22.22.0 and pnpm 11.21.0.
- No model was invoked to establish G0 product evidence.
- The full suite's four skips remain skips, not passes.
- A successful build and the characterized current route do not establish the
  correctness-first target architecture.
