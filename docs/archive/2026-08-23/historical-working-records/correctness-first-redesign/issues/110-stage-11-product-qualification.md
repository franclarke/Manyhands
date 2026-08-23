# CF-110 — Stage 11: architecture closure and product qualification

- **Status:** `ready-for-agent`
- **Blocked by:** CF-100
- **Gate:** GProd
- **Required cells:** R18 and R19, plus final reconciliation of R0-R17

## Outcome

Remove compatibility debt, enforce one authority per invariant, finish truthful
and accessible UI projections, and qualify the actual local product with
independent correctness, topology, browser, recovery, security, and delivery
evidence.

## Mandatory first action

Run a full reachability/dependency/claims audit and preregister R18/R19 before
any qualifying execution. Split legacy deletion, CI boundaries/lint, UI states
and accessibility, security review, clean-clone install/run, R18 application,
R19 hierarchy/cost, and independent final gate review.

## Acceptance

- Every prior gate remains green on the exact handoff candidate.
- R0-R19 have qualifying, honest outcomes; R18/R19 use independent topology,
  product/browser, correctness, clean-clone, and bounded-cost oracles.
- Legacy productive routes, temporary adapters/flags, dual writers, benchmark
  knowledge, and unsupported dependency directions are deleted.
- UI meets WCAG 2.2 AA, reduced motion, small-screen/long-content, truthful state,
  and no-auto-recenter rules.
- Full tests, lint, package/web/daemon typechecks/builds, security checks,
  recovery matrices, and clean-clone operation pass.

## Retirement

Delete all remaining temporary compatibility code except explicitly read-only
historical import readers. Independent GProd review is mandatory.
