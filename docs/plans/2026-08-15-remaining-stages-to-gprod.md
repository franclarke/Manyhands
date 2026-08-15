# Remaining stages to GProd

> **Authority:** this document replaces Stage 11 of
> [`the correctness-first redesign`](2026-08-12-correctness-first-system-redesign.md)
> with three stages. Everything else in that plan — invariants, canonical model,
> gates G0…GDel, the required real and adverse cells — stands unchanged and
> remains the authority. Stages 0–10 are not reopened here.

**Why now:** ten stages in, the system planned, executed, integrated, verified
and delivered a real composite goal end to end on 2026-08-15. The old Stage 11
was written when that was still hypothetical, and bundles six unrelated
deliverables behind one gate. Splitting it lets each remaining piece be finished
and judged instead of half-done in parallel.

---

## Verified current state

Read from the working tree and the run journals on 2026-08-15, not carried over.

| Stage / gate | Status | What is actually true |
| --- | --- | --- |
| 0–7 | `pass` | Attributable candidates, audits in `docs/audits/`. |
| 8 / GLeaf | `in_review` | Live R0/R10/R14/R17 evidence exists; the bounded independent review returned `NO-GO`. B2 closed by the Codex-only scope amendment; **B1 open**: one live R0 re-run under the corrected capability record, deferred for Codex quota. |
| 9 / GI | `in_review` | Deterministic work complete on a green tree. Needs a bounded independent review. |
| 10 / GDel | `in_review` | Publication is one conditional ref update with a receipt for the exact delivered tree; seven invariants, a five-cell restart matrix, R12 and R13. Needs a bounded independent review. |
| 11 | superseded | Replaced by Stages 11–13 below. |

**The end-to-end evidence that changes the picture.** Run
`run:e57c0076…` on 2026-08-15: composite root plus two leaves, both leaves
executed by `claude-code-cli`, validated against real `node --test` runs and
adopted; integration composed them; the final candidate verified; delivery moved
the target's `main` from `00273f0` to `3b84716`; the delivered tree passed its
own 14 tests. The productive path is no longer a hypothesis.

## What actually remains

Each item is something observed, with where it was observed. Nothing here is
aspiration.

**The UI does not read the canonical graph.**
`apps/web/src/lib/run-model/reducer.ts:57` parses `graph.compiled` with
`LegacyGraphRevisionV2Schema`; the daemon emits the canonical `GraphRevision`.
The parse fails silently, the reducer falls back to a provisional single-node
placeholder, and a finished three-node run renders as one node labelled
`RUNNING · Diseñando la solución`. The lifecycle track is unaffected — the badge
correctly reached `Delivered` — so this is one adapter, not the UI. 18
references across 4 files.

**A user-facing control does nothing.** The run form offers
`Supervisado / Semi / Autónomo`, and `autonomous` has no productive
implementation in the daemon path: the only match in the tree is a prompt
string. Both live runs parked at `Approve graph revision 1?` regardless.

**`corepack pnpm typecheck` is red: 36 errors across 21 test files.** It covers
`tests/` and resolves the workspace through an untracked `dist`, so a stale
build hides the drift until someone rebuilds. Eleven of those errors are from
tests written on 2026-08-15. A typecheck nobody runs is a boundary nobody
enforces, which is precisely what old Stage 11 promised to fix in CI.

**Three gates are open.** GLeaf needs one live R0 re-run; GI and GDel each need
a bounded independent review by someone who did not implement them.

**R18 and R19 have never run.** A medium real application and a larger
meaningful hierarchy, with independent topology, product and clean-clone
oracles. They are the only cells that judge product quality rather than
mechanism.

**Legacy routes are still present** behind named consumers and retirement
stages: commit artifact transport (`allowCommitTransport`, named for Stage 11),
the transitional adapters, the legacy graph projections the UI still imports.

---

## Stage 11 — Make the product tell the truth

**Purpose:** what the operator sees is derived from the journal, or it is not
shown. Today a finished run displays a placeholder from before planning, which
is exactly the "domain state invented by a component" the project forbids.

**Why first:** R18 and R19 judge topology and usefulness, and a reviewer reads
those through the workspace. Judging the product through a view that fabricates
its central object would produce a verdict about the view. It is also the
smallest of the three and unblocks the other two.

**Deliverables**

- The run model reads the canonical `GraphRevision`. The legacy path survives
  only for historical journals, with a named consumer and a retirement stage.
- Every node, edge, seam and artifact the UI shows resolves to a journal fact;
  no component invents domain state.
- The provisional pre-planning graph is visibly provisional and cannot outlive
  `graph.compiled`.
- Recovery diagnostics and decisions render with the evidence they carry — a
  `target_divergence` shows both OIDs, not "the target changed".
- `autonomy` either drives the daemon path or the control is removed. A setting
  that silently does nothing is worse than its absence.
- Accessibility on the run workspace: WCAG 2.2 AA, `prefers-reduced-motion`,
  long content, small screens. No `fitView`, focus, zoom or recentring driven by
  events.

**Gate GObs — the workspace is derivable**

- Replaying a real journal renders the same graph the daemon compiled: node
  count, roles, parentage, seams and artifacts.
- No rendered domain value lacks a journal fact behind it, proven by a
  reachability test over the run model, not by inspection.
- A failed run shows its diagnostic with the evidence the diagnostic carries.
- The three live journals already on disk replay without loss.
- Accessibility checks pass on the workspace and the decision dialog.

**Retirement:** the legacy graph projection leaves productive rendering; it may
remain for historical replay only, named and dated.

---

## Stage 12 — Close the architecture

**Purpose:** one authority per invariant, enforced mechanically rather than by
convention.

**Deliverables**

- `corepack pnpm typecheck` green across the workspace, `tests/` included, and
  added to the documented gate command list.
- Package dependency boundaries enforced by a test, not a README:
  `apps -> specific packages -> shared`, no new dependency on `@manyhands/core`.
- Delete the legacy lifecycle, planning, graph, conflict, artifact and delivery
  routes whose replacements have shipped and whose retirement stage has arrived.
  Anything preserved keeps a named consumer, a reason and a date.
- One owner per invariant, listed, with its deterministic verification named.

**Gate GArch — the architecture is closed**

- Typecheck, build, lint and the full suite are green on one attributable
  candidate with the dev stack stopped.
- No productive source reaches a retired route, proven by reachability tests in
  the shape already used for integration and delivery.
- Every invariant in the redesign plan names exactly one owning module and one
  verifying test.
- Deleting the retired routes does not change any gate's evidence.

**Retirement:** temporary adapters, flags and dual writes.

---

## Stage 13 — Qualify the product

**Purpose:** decide whether the product is good, not whether the mechanism is
correct. The prior gates answer the second question and cannot answer the first.

**Deliverables**

- Close the three open gates: the live R0 re-run for GLeaf, and bounded
  independent reviews for GI, GDel and the two stages above.
- R18: a medium real application, with independent topology, product and
  clean-clone oracles.
- R19: a larger meaningful hierarchy, judged on useful boundaries, real
  parallelism and bounded cost — explicitly not on node count.
- Operator, recovery, security and limitations documentation updated to what the
  system does, including what it does not do.
- Freeze the bounded post-GProd study target, prompts, browser flows, cutoffs
  and evidence schema. Do not execute counted study runs.

**Gate GProd — evaluation eligibility**

- All prior gates pass on an attributable candidate.
- Required adverse cells passed; inapplicable cells explain why.
- Remaining limitations do not contradict the product claim.
- The bounded exploratory study is eligible to run with independent browser,
  correctness and clean-clone delivery oracles.

---

## Order and dependencies

```
Stage 11 (GObs) ──► Stage 12 (GArch) ──► Stage 13 (GProd)
      │                                        ▲
      └─ makes R18/R19 judgeable ──────────────┘
```

Stage 12 deletes routes; doing that before Stage 11 would remove the legacy
graph projection the UI still depends on, and the UI would go from wrong to
blank. Stage 13 needs both: a truthful view to judge through, and a closed
architecture so a gate result attributes to one candidate.

## Open decisions for the operator

1. **GLeaf's B1.** The blocking item is a live R0 re-run with `codex-cli`,
   deferred for quota. Two live runs on 2026-08-15 exercised the same surface
   with `claude-code-cli` and passed. Either the Codex re-run happens, or the
   scope amendment is revised to accept the Claude evidence and the audit says
   so. This plan does not decide it.
2. **Who reviews.** GI, GDel, GObs and GArch each need a reviewer who did not
   implement them. A subagent dispatched with the audit and the tree is the
   cheapest option available and has to be requested explicitly.

## Out of scope

Counted study runs, thesis work, remote delivery, multi-repository runs, and any
architecture change not required by a gate above.
