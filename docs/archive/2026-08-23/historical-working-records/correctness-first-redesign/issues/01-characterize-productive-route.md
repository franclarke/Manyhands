# CF-001 — Characterize the current productive route

- **Status:** `closed`
- **Stage / gate:** Stage 0 / input to G0
- **Blocked by:** none
- **Output owner:** `docs/audits/stage-0/productive-route.md`

## Objective

Trace the actual current path from run creation through planning, scheduling,
execution, integration, validation, and delivery. Identify current authority and
side effects at every seam without rewriting the code to resemble the target.

## Required route

Start at the productive `POST /api/runs` handler and follow concrete callers,
types, stores, processes, tests, and UI selectors through:

```text
intake -> planning -> approval -> scheduling -> leaf execution
       -> artifact/candidate handling -> composite/root integration
       -> validation/evidence -> delivery -> web projection
```

Also trace GET/list/stream, pause/resume, decisions, cancellation, liveness
recovery, process supervision, and restart recovery because they reveal current
lifecycle authority.

## Execution

1. Record each hop as caller -> callee with file, exported symbol, state read,
   state written, physical effect, and the test that actually covers it.
2. Identify every lifecycle writer, journal/store/projection, background promise,
   process registry, fence/lease, candidate/artifact representation, and recovery
   trigger.
3. Identify where the productive route crosses legacy planning representations,
   `orchestrator-graph`, `conflict-risk`, commit-as-artifact behavior, or web-owned
   execution.
4. Determine whether GET/list/stream handlers have side effects. A read-path
   reconciliation call is recorded as a transition gap, not normalized away.
5. Search production code and generic prompts for benchmark-specific nouns or
   fixture answers and record exact matches.
6. Classify each observed capability as implemented, partial, incompatible,
   absent, or uncertain. Link direct code/test/persisted-run evidence.
7. Draw one current-state route diagram and one authority table. Do not draw the
   target as if it were current.

## Exclusions

- No production edits, refactors, deprecations, or compatibility adapters.
- No claim based solely on a README, class name, or passing isolated unit test.
- No live-model benchmark or wide-graph run.

## Acceptance criteria

- Every required route segment has concrete files and symbols or is explicitly
  documented as absent/unknown.
- Current lifecycle, process, graph, artifact, validation, evidence, and delivery
  authorities are unambiguous.
- GET side effects, benchmark knowledge, legacy productive imports, and process
  ownership have explicit findings.
- Contradictions between current code and the canonical plan are named as
  transition gaps with target stage and retirement, not silently resolved.
- Another engineer can reproduce the trace using the recorded commands.

## Verification

Use `rg` for callers/imports and narrow characterization tests only when they do
not mutate source. Confirm the final record's local links and run
`git diff --check`.

## Handoff

Report route entrypoints, current authorities, contradictions, unproven areas,
and paths that later reachability tests must prohibit.
