# CF-060 — Stage 6: productive planning and frontier cutover

- **Status:** `ready-for-agent`
- **Blocked by:** CF-050
- **Gate:** GS
- **Required cell:** R15

## Outcome

Make live planning emit only `SemanticPlan -> GraphRevision`; make hard readiness
deterministic over exact obligations/versions/decisions/resources/leases and keep
soft integration risk advisory to frontier selection.

## Mandatory first action

Trace all live planner/compiler/scheduler callers, then split productive cutover,
readiness, selection, indexed risk, scoped decisions, metrics, and reachability
retirement tests. Retain `maxParallel=1` productively until GI.

## Acceptance

- No productive legacy projection or all-pairs conflict-risk product remains.
- Perturbing soft risk changes cost/order only, never validity or dependencies.
- Unknown write overlap blocks approval/frontier rather than being serialized.
- R15 proves unrelated ready work continues during a scoped decision.

## Retirement

Delete the legacy projection/compiler and pairwise conflict product after all
productive imports move and historical readers are isolated.
