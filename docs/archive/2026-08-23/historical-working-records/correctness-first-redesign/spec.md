# Correctness-first redesign execution specification

## Objective

Execute the complete correctness-first redesign from attributable baseline to
production qualification, then produce as-built documentation, a controlled
exploratory study, and the final LaTeX thesis. Completion means the current
repository and attributed evidence satisfy the architecture plan's definition
of completion; it is not inferred from activity, test count, or graph size.

## Authority

1. [`PRODUCT.md`](../../../../../PRODUCT.md) defines product purpose and experience.
2. [`docs/plans/2026-08-12-correctness-first-system-redesign.md`](../../../../plans/2026-08-12-correctness-first-system-redesign.md)
   is the sole normative architecture, implementation sequence, and gate source.
3. [`docs/agents/correctness-first-execution.md`](../../../../agents/correctness-first-execution.md)
   defines the non-normative harness procedure.
4. Source, tests, Git state, persisted runs, and candidate-bound evidence prove
   current behavior.

Historical thesis/demo material is evidence only. It cannot define current
behavior or be rewritten into a success claim.

## Constraints

- Implement stages in normative order. A later stage may not bypass an earlier
  gate or preserve an incompatible route because it is easier to test.
- Use strict behavioral TDD and verify the productive path.
- Preserve unrelated changes and adverse evidence; never globally reset, clean,
  or stash.
- Keep one representation and one authority at each seam. Temporary readers
  must name their consumer and retirement stage.
- Use bounded multi-agent parallelism with disjoint ownership and independent
  gate review.
- No large live-model or product experiment before GProd. Stage 8 authorizes
  only its explicitly gated live-leaf smoke.
- Local tickets and evidence remain local unless publication is explicitly
  authorized.

## Dependency chain

```text
G0 -> G1 -> GD0/GD1 -> GR -> GRepo -> GP0/GP1 -> GS -> GA
   -> GLeaf -> GI -> GDel -> GProd
   -> as-built docs + simple guide + operations runbook
   -> study preregistration -> study execution -> study report
   -> LaTeX thesis -> final completion audit
```

Each issue declares its own blockers. `ready-for-agent` means sufficiently
specified, not reachable; an issue is claimable only when every blocker is
`closed`.

## Stage 0 work breakdown

Stage 0 is the only stage refined into concrete execution slices before G0:

| Issue | Result |
|---|---|
| CF-000 | exact baseline, environment, toolchain, dirty inventory, and clean-clone reproduction |
| CF-001 | productive-route characterization with explicit current authorities and side effects |
| CF-002 | transition ledger covering I1-I43 and completion criteria 1-26 |
| CF-003 | R0-R19 baseline register, all honestly `not_run` |
| CF-004 | non-normative multi-agent execution runbook |
| CF-005 | independent G0 audit and stage-1 authorization decision |

CF-000 is the initial evidence anchor. CF-001 and CF-002 may explore concurrently
against the same checkout, but CF-005 must cross-check their final Git identity
against CF-000. CF-003 and CF-004 are documentation-only setup and do not claim
product behavior. CF-005 integrates all evidence streams and is the only ticket
that may close G0.

## Later-stage envelopes

CF-010 through CF-110 mirror Stages 1-11. They are intentionally not decomposed
into speculative file-level implementation tickets now. When an envelope becomes
reachable, its first action is to re-inspect current source and refine that one
stage into disjoint, TDD-ready slices without changing the normative gate.

CF-120 through CF-122 create the final technical, accessible, and operational
documentation. CF-130 through CF-132 govern a new pre-registered exploratory
study after GProd. CF-140 writes and verifies the thesis only from attributable
results. CF-150 performs the requirement-by-requirement completion audit.

## Global acceptance

- Gates G0, G1, GD0, GD1, GR, GRepo, GP0, GP1, GS, GA, GLeaf, GI, GDel, and
  GProd are independently reviewed on exact candidates.
- Required real/adverse cells R0-R19 have qualifying outcomes at their required
  gates; no missing or adverse cell is called PASS.
- The 43 invariants and 26 completion criteria each have one current owner and
  direct evidence.
- Legacy productive routes, dual writers, and temporary adapters are retired as
  required.
- Tests, package/web/daemon checks, builds, clean-clone operation, accessibility,
  security, crash recovery, real browser behavior, and exact delivery pass at
  their prescribed scope.
- As-built documentation distinguishes target, current fact, inference,
  limitation, and historical evidence.
- The controlled study is frozen before execution and reports adverse evidence.
- The Spanish LaTeX thesis is readable by software engineers, approximately
  48-52 pages, builds cleanly, and makes no claim stronger than its evidence.

## Issue status discipline

Do not close an envelope because child code exists. Close it only after its
acceptance criteria, gate evidence, retirement, and exact-candidate verification
are complete. If a blocker appears, create or update a causal issue; do not hide
it behind repeated attempts or downgrade the target.
