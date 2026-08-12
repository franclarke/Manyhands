# ManyHands documentation

ManyHands is being redesigned from a path-oriented multi-agent control plane into
a correctness-first software engineering system.

## Sources of truth

1. [`PRODUCT.md`](../PRODUCT.md) — product purpose, users and stable experience
   principles.
2. [`2026-08-12-correctness-first-system-redesign.md`](plans/2026-08-12-correctness-first-system-redesign.md)
   — the only normative architecture and implementation plan.
3. [`agents/`](agents/) — local workflow for implementation agents, including
   the [correctness-first execution runbook](agents/correctness-first-execution.md).
4. [`tesis/`](tesis/) — academic material and attributable historical evidence;
   it is not a current architecture specification.
5. [`audits/stage-0/`](audits/stage-0/) — Stage 0 baseline, productive-route
   trace, transition ledger and required-cell registry for the current redesign.

The former `docs/design`, `docs/system`, `docs/core-pillars`, `docs/adr`,
`docs/development` and older plan were removed on 2026-08-12. They contained
incompatible targets and claims superseded by observed run failures.

## Implementation status

The current source tree is transitional. A type, class or test with the same
name as a target capability does not prove that the capability is implemented.
Use the gap table and stage exit criteria in the redesign plan, then verify the
productive path, tests and persisted evidence before reporting status.

The Stage 0 baseline must pass before implementation advances to Stage 1. No
large live-model benchmark should run until Stage 11 eligibility gates are
satisfied.
