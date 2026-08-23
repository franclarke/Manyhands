# CF-030 — Stage 3: productive lifecycle ownership cutover

- **Status:** `ready-for-agent`
- **Blocked by:** CF-020
- **Gate:** GR
- **Required cells:** R8 and the GR portion of R10

## Outcome

Move create, query, pause/resume, decisions, cancellation, shutdown, processes,
and lifecycle reconciliation to the daemon while retaining planner/executor
internals behind explicit transitional adapters.

## Mandatory first action

Reconfirm the Stage 0 route, then split server mediator/IPC client, daemon
composition, command migration, read-only queries, cancellation/process cleanup,
restart/multi-client tests, and legacy reachability deletion.

## Acceptance

- A productive fake-executor run survives browser, Next, and daemon restart.
- Multiple clients cannot duplicate planning/execution.
- GET/list/stream have no lifecycle side effects.
- Cancellation proves physical descendant death and unambiguous state.
- R8 and relevant R10 outcomes pass on the exact candidate.

## Retirement

Delete web-owned orchestration, route-time recovery, and process-local run
ownership. Live executor remains explicitly transitional/unsafe until GLeaf.
