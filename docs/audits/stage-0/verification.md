# Stage 0 clean-clone verification

**Architecture baseline:** `f8082e5f2adcf89adfb4a3d76f95bdc0c44e3265`

**Architecture baseline tree:** `4a8e169a0d68f3cd8a25c9a7ba098c422307d15f`

**Rejected candidate:** `9cf3e87a9a534bd07947cfaedb6d78f88205b642`

**Rejected tree:** `694b99d80023d329502987563d2b8fb4b8df113e`

**Stable clean clone:** `C:/mh-g0-9cf3-02`

**Initially empty store:** `C:/mh-store-9cf3-02`

**Corepack shims:** `C:/mh-shim-9cf3-02`

## Gate decision

G0 is `in_progress`. The stable short-path clone was clean and reproduced installation,
the characterization checks, all current source tests, package/web typechecks,
package builds, and the Next production build on the exact candidate. The
but independent review rejected this candidate: converting the pnpm 7 lock to
pnpm 11 changed four direct resolutions and a wider set of transitive
resolutions. Stage 1 is blocked until a resolution-preserving candidate repeats
the clean-clone checks and passes independent review.

This decision proves an attributable transition baseline only. It does not
prove any Stage 1-11 target capability, production readiness, or thesis
hypothesis. R0-R19 remain `not_run`.

## Final stable-clone results

| Check | Outcome | Evidence |
|---|---|---|
| Clone identity | `pass` | Exact candidate/tree, empty status, Node v24.16.0 and pnpm 11.21.0 in `candidate-9cf3-shortpath-identity.log`. |
| Cold frozen install | `pass` | 630 packages installed from the initially empty isolated store in `candidate-9cf3-shortpath-clean-install.log`. |
| Stage 0 contracts | `pass` | 2 files and 9 tests in `candidate-9cf3-shortpath-stage0-contracts.log`. |
| Focused productive route | `pass` | 18 files and 138 tests in `candidate-9cf3-shortpath-focused-route.log`. |
| Full suite | `pass` | 229 files; 1481 passed and 4 skipped in `candidate-9cf3-shortpath-full-tests.log`. |
| Package typechecks | `pass` | 12 packages in `candidate-9cf3-shortpath-typechecks.log`. |
| Web typecheck | `pass` | Dedicated command receipt with exit 0 in `candidate-9cf3-shortpath-web-typecheck.log`. |
| Package build | `pass` | 12 packages in `candidate-9cf3-shortpath-package-build.log`. |
| Web build | `pass` | Package build plus successful Next production build and generated route table in `candidate-9cf3-shortpath-web-build.log`. |
| Lint baseline | `fail`, non-blocking for G0 | 78 pre-existing errors and 0 warnings in `candidate-9cf3-shortpath-lint.log`. |

The exact commands, working directories, exit codes, results, and paths are in
[`commands.json`](commands.json). SHA-256 values for the entire log set are in
[`logs.sha256`](logs.sha256); no individual hash is duplicated here.

## Pre-Stage 1 reproducibility remediation

The first attributable candidate exposed a real harness/toolchain defect rather
than a product defect:

- `a3f45c72` pins pnpm 11.21.0, updates the lockfile, and pins CI Node 22.22.0.
  The final lockfile SHA-256 is
  `92d6ebaa559baff3ddf9990839522bf77d9bafd8aac594c462ccca1f9a41a112`.
- `9cf3e87a` makes one Windows shim regression assertion case-insensitive, which
  matches Windows path semantics.

Both commits precede Stage 1 and change reproducibility/tests, not the productive
run architecture. Their necessity and scope remain visible rather than being
folded into a false claim that the original toolchain was reproducible.

## Preserved adverse history

Earlier pnpm 7 and long-path attempts remain in the log set and in
[`commands.json`](commands.json). In particular,
`candidate-9cf3-web-build.log` records an attempt whose `%TEMP%` clone passed
installation and source checks, after which the web build observed missing
plugin/files and `ENOENT`. Later inspection found the clone, store and shim
paths absent, but no receipt establishes why. The attempt therefore remains
`inconclusive`; it neither proves a product defect nor a host cleanup cause.
The stable short-path clone was then created independently and passed the same
web build.

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
  is the fail-closed recipe for the replacement candidate: it refuses existing
  clone/store/shim targets and records setup, strict preflight, commands and
  post-check identity.
- Node v24.16.0 was used for local verification; CI is pinned to Node 22.22.0.
- No model was invoked to establish G0 product evidence.
- The full suite's four skips remain skips, not passes.
- A successful build and the characterized current route do not establish the
  correctness-first target architecture.
