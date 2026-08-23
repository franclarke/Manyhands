# CF-090 — Stage 9: hierarchical integration and bounded parallelism

- **Status:** `ready-for-agent`
- **Blocked by:** CF-080
- **Gate:** GI
- **Required cells:** R1, R2, R3, R11, and R16

## Outcome

Implement composite attempts over exact child manifests, parent-owned shared
resources, the same scope enforcer as leaves, cause/authority-directed repair,
and bounded resource-aware parallel selection.

## Mandatory first action

Inspect current integration journals/repair and define exact composite fixtures.
Split deterministic composition, parent integration execution, hierarchical
validation, repair/amendment routing, crash reconciliation, convergence, and
parallel selection/cost evidence.

## Acceptance

- Typed seams, independent leaves, and explicit sequential version chains pass
  R1-R3.
- Integration cannot modify child-owned resources; R11 repairs at the lowest
  authority and changed candidates stale evidence.
- R16 converges to one reconciled composite attempt/outcome after daemon crash.
- Permitted parallel and sequential schedules converge to the same exact result.

## Retirement

Delete universal integration repair, implicit parent power, and the productive
legacy orchestration package after reachability proof.
