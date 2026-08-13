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
6. [`audits/stage-1/`](audits/stage-1/) — accepted canonical correctness kernel
   and the evidence that closes G1.
7. [`audits/stage-2/`](audits/stage-2/) — accepted durable daemon/effect kernel
   and the evidence that closes GD0 and GD1.
8. [`audits/stage-3/`](audits/stage-3/) — accepted productive daemon ownership,
   restart/cancellation evidence and the bounded review that closes GR.
9. [`audits/stage-4/`](audits/stage-4/) — accepted deterministic Repository
   Model, views, resource catalog, productive grounding and GRepo review.
10. [`handoffs/2026-08-12-stage-2-to-stage-3.md`](handoffs/2026-08-12-stage-2-to-stage-3.md)
   — historical continuation boundary used to start Stage 3.
11. [`handoffs/2026-08-13-stage-3-to-stage-4.md`](handoffs/2026-08-13-stage-3-to-stage-4.md)
    — historical continuation boundary used to start Stage 4 / GRepo.
12. [`handoffs/2026-08-13-stage-4-to-stage-5.md`](handoffs/2026-08-13-stage-4-to-stage-5.md)
    — current continuation boundary for starting Stage 5 / GP0+GP1.
13. [`plans/2026-08-13-exploratory-longitudinal-study.md`](plans/2026-08-13-exploratory-longitudinal-study.md)
    — bounded post-GProd study for the thesis demonstration: two required visual
    runs and one optional conditional run.

The former `docs/design`, `docs/system`, `docs/core-pillars`, `docs/adr`,
`docs/development` and older plan were removed on 2026-08-12. They contained
incompatible targets and claims superseded by observed run failures.

## Implementation status

The current source tree is transitional. A type, class or test with the same
name as a target capability does not prove that the capability is implemented.
Use the gap table and stage exit criteria in the redesign plan, then verify the
productive path, tests and persisted evidence before reporting status.

Stages 0, 1, 2, 3 and 4 pass on attributable candidates. The daemon is the
productive lifecycle owner, apps/web is its server-side command/query BFF, and
productive planning is grounded through deterministic Repository Model views
and budgeted queries. Stages 5–11 remain `not_started`. No large live-model
benchmark should run; Stage 5 allows only its two pre-registered offline GP1
sessions. The bounded exploratory study runs only after Stage 11 eligibility
gates are satisfied.
