# CF-004 — Establish the correctness-first multi-agent harness

- **Status:** `closed`
- **Stage / gate:** Stage 0 / input to G0
- **Blocked by:** none
- **Output owner:** `docs/agents/correctness-first-execution.md` and
  `.scratch/correctness-first-redesign/`

## Objective

Turn the canonical migration method into an agent-usable, non-normative harness
that preserves code ownership, strict TDD, independent gate review, evidence
custody, and cause-based recovery.

## Acceptance criteria

- The runbook defines conductor, explorer, slice-worker, and gate-verifier roles
  with explicit write policy.
- Preflight includes Git truth, blockers, ownership, effective model/effort,
  sandbox capability, and productive-route inspection.
- The loop is trace -> red for the right reason -> smallest vertical green ->
  narrow/broad verification -> retirement -> independent review -> handoff.
- Concurrent writers require disjoint ownership and a single shared-seam owner.
- Failure handling records class, authority, causal change, and stop rule; blind
  deterministic retries are forbidden.
- Gate outcomes distinguish satisfied, failed, inconclusive, not_run, and
  not_applicable, and bind the exact candidate.
- The backlog contains detailed Stage 0 tickets, stage 1-11 envelopes, final
  documentation/study/thesis issues, blockers, and acceptance criteria.
- The runbook is explicitly subordinate to the canonical plan and does not
  authorize early experiments, pushes, or destructive cleanup.

## Verification

Review all issue links and blockers, confirm only Stage 0 is detailed into
implementation-sized slices, and run `git diff --check` over the owned files.
