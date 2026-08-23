# CF-150 — Audit the complete objective before closure

- **Status:** `ready-for-agent`
- **Blocked by:** CF-140

## Outcome

Perform an independent, requirement-by-requirement completion audit over the
original objective, canonical plan, gates, invariants, real/adverse cells,
production claim, documentation, study, and thesis. This audit decides whether
the durable objective may be marked complete.

## Acceptance

- Every explicit requirement, I1-I43, completion criterion 1-26, gate, R0-R19
  cell, public interface, retirement, verification command, document, study
  artifact, and thesis deliverable identifies authoritative current evidence.
- Evidence is classified as proves, contradicts, incomplete, indirect, or
  missing; only direct proof closes a requirement.
- Full checks and clean-clone product/browser/delivery verification run on the
  exact final candidate; final Git/runtime state is inventoried.
- Any missing/weak item produces a causal issue and leaves the objective active.
- The objective is marked complete only when no required work remains and the
  evidence can withstand independent review.
