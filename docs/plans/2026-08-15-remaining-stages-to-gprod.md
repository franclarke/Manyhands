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
| 8 / GLeaf | `pass` | Live R0/R10/R14/R17 evidence exists. B2 closed by Codex-only amendment; B1 resolved by operator authorization accepting the qualifying live Claude Code execution evidence (`run:e57c0076…`). |
| 9 / GI | `in_review` | Deterministic work complete on a green tree. Needs a bounded independent review. |
| 10 / GDel | `in_review` | Publication is one conditional ref update with a receipt for the exact delivered tree; seven invariants, a five-cell restart matrix, R12 and R13. Needs a bounded independent review. |
| 11 | superseded | Replaced by Stages 11–13 below. |
| 11 (new) | `pass` | Deliverables landed, audit and bounded independent review completed in `docs/audits/stage-11/` (`GObs: pass`). |
| 12 / GArch | `pass` | Architecture closure verified, single canonical authority per invariant, dependency boundaries enforced mechanically (`GArch: pass`). |
| 13 / GProd | `in_progress` | Active stage: product qualification, independent reviews, demonstration runs (R18/R19). |

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
- R19 — **the demonstration run**: a larger meaningful hierarchy, judged on
  useful boundaries, real parallelism and bounded cost, explicitly not on node
  count. This is the run Francisco presents, so it is designed once and executed
  once: a goal whose natural decomposition is several layers deep and wider than
  one wave, on a target that makes the boundaries legible to an audience.

  Everything exercised so far is one root over two leaves. Depth beyond that is
  untested, and the failures it would surface — scheduling across more than one
  wave, repair routed to the right descendant, integration composing more than
  two artifacts, a workspace that stays readable at a dozen nodes — are exactly
  what R19 exists to find. Treat a cheaper mid-size rehearsal as part of this
  cell, not as a separate stage: run it, fix what it surfaces, then run the
  demonstration on a tree that has already been de-risked.
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

## What Stage 11 has delivered, on 2026-08-16

Both blockers named for the demonstration run are closed.

**`autonomy` decides something.** The level travels in the durable run
definition, and a pure policy in `run-coordinator` decides what a standing
authorization may answer. The axis is reversibility, not confidence: `semi`
resolves what lives inside the run's own workspace and can be discarded with it,
`autonomous` additionally publishes, and no level answers a `clarify_goal` —
that decision exists precisely because the answer could not be derived. The
actor performs the delegated act, so the answer lands in the same journal as the
question and is stamped with the authorization that produced it; the workspace
says which acts a person performed and which the delegation did.

**Nothing on screen without a fact behind it.** A mechanical sweep asserts every
identity and every sentence the run model exposes appears in the journal it was
built from, over a canonical graph, a historical legacy journal and a run that
failed before compiling anything. The pre-planning placeholder is named as the
one value drawn from no fact, admissible only because the model marks that graph
provisional. The guard is kept honest by a case that feeds it a fabricated node
and requires it to complain, and by asserting how many values each pass
examined — a guard that silently starts checking nothing still reports zero
violations.

**A refused publication reads as evidence.** Stage 10's recovery diagnostic was
being flattened into `Error.message` at the adapter boundary. It now travels
through the durable side store the planning and execution results already use,
onto `delivery.failed`, into the projection, and out as labelled fields: the ref
and both OIDs rather than "the target changed".

**The workspace answers to a keyboard.** React Flow puts every node in the tab
order and never activates one, so the central object of the run could be reached
without a mouse and not operated; the focused element also carried no accessible
name. Both fixed, along with a nested `main` landmark, an `h1 → h3 → h2`
outline, an English status that only ever reached assistive tech, and white text
on the copper accent at 2.4:1.

Still open in Stage 11: the audit, and a bounded independent review of GObs.

## What the rehearsal run found, on 2026-08-16

The first hands-off run. Two attempts on the sandbox target, same goal: a
readability CLI over four metric modules.

**Attempt 1 was rejected by the compiler** with six `resource_double_writer`
findings. The plan verifier orders writers of one resource transitively; the
graph validator demanded a direct artifact requirement between every pair, so a
five-writer plan needed a complete graph. Two authorities for one invariant, and
the stricter one made every fan-out wider than two units unplannable. Fixed, with
controls that keep the fix from being "stop checking".

**Attempt 2 planned six nodes and approved itself.** Root plus five leaves, nine
artifact requirements, and `decision.resolved` stamped
`{ kind: "autonomy_policy", level: "autonomous" }`. Three leaves executed,
validated and adopted their artifacts with nobody watching.

Three findings stand, in the order they matter for R19:

1. **The graph is deep, not wide.** Every `readiness.observed` named exactly one
   ready node: the planner chained all five units, because that is the only legal
   shape when they all write the same package. The transitive fix unblocked
   depth; it did not buy parallelism. Units creating different new files under
   one package still cannot be expressed as disjoint, so **R19 cannot yet
   demonstrate real parallelism**, only real depth. This is a resource-granularity
   question in the Stage 9 model and is not reopened here.
2. **A delegated run parked on a decision it was authorized to answer.** Only the
   plan approval was wired; decisions raised during execution were not. Fixed.
3. **`artifact_error` materializing a predecessor's artifact** at depth 3 of the
   chain (`unit:sentence-length` consuming `unit:top-words`). Undiagnosed. It is
   the first failure this system has hit that is not about contracts or
   ordering, and it needs its own investigation before R19.

And one observability gap, unfixed: when the compiler rejects a plan, the
proposal is discarded. Diagnosing attempt 1 meant reasoning from the finding
text, because the plan the model actually produced was never retained.

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
