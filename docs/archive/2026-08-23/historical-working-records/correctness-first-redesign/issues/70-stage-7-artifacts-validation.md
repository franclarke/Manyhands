# CF-070 — Stage 7: immutable attempts, Git-native artifacts, and exact evidence

- **Status:** `ready-for-agent`
- **Blocked by:** CF-060
- **Gate:** GA
- **Required cells:** R6, R7, and the GA portion of R13

## Outcome

Bind attempts to complete input fingerprints; transport exact Git object/mode
manifests rather than commits; retain object reachability; and bind proof and
human review to exact candidates.

## Mandatory first action

Inspect current candidate custody, artifacts, validation recipes, approval
bindings, Git policies, and delivery consumers. Split attempts/fingerprints,
manifest building, materialization/retention, proof strategies/evidence,
candidate-bound review, and transport retirement.

## Acceptance

- Exact add/modify/delete/type/mode/binary/symlink/gitlink behavior is preserved
  or rejected by explicit policy; R6/R7 pass.
- No unowned path, stale approval, wrong selector, no-op, or self-authored-only
  test can prove a root criterion; R13's GA path passes.
- Git GC cannot remove referenced objects and materialization does not traverse
  commit ancestry or run filters/hooks.

## Retirement

Commit-as-artifact transport and mutable manifest lifecycle status are
productively unreachable and removed at their prescribed boundary.
