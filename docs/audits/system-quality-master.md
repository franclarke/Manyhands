# ManyHands system quality master

Canonical audit/remediation record for the active product. The working tree is
the source of truth; older phase reports are evidence inputs, not current state.

## Completion rule

Every productive UI control must trace to a handler, API/service, durable fact
and visible outcome. Every productive endpoint must have a UI consumer or an
explicit operational purpose. A finding closes only with a regression or a
reproducible runtime check; absence of a grep match is not completion evidence.

Disposition vocabulary: `keep`, `complete`, `repair`, `consolidate`, `remove`.
Severity: S1 data/safety, S2 broken critical flow, S3 material degradation,
S4 cleanup or minor UX.

## Current baseline (2026-07-14)

- Current dirty checkout is intentional and preserved.
- Git ownership is authorized for this repository under the alternate Windows
  user via a repository-scoped `safe.directory` entry.
- Claude is not available for this user. Product validation uses Codex CLI.
- U2A-1/U2A-2 and RU1/RU2 predated this pass and were revalidated as present.

## Closed findings in this pass

| ID | Severity | Decision | Evidence |
|---|---:|---|---|
| SYS-001 | S2 | repair | Initial planning, replan and regen now use `PlanningInvocationService`; canonical selection/effort, supervised spawn and deterministic-fallback policy are shared. `planning-invocation-*`, editable-control-plane and replan gate regressions pass. |
| SYS-002 | S2 | complete | `CapabilityService` separates declared models from executor readiness, validates stage capability/effort and exposes `/api/capabilities`. Capability and run-create regressions pass. |
| SYS-003 | S2 | repair | Command center no longer assumes Claude readiness. It consumes capability data, disables unavailable executors with a reason and selects a usable planning/execution model. Web typecheck passes. |
| SYS-004 | S2 | repair | Event-log locks use token ownership, quarantine takeover and generation-safe release. Durable event-log/Windows/concurrency regressions pass. |
| SYS-006 | S2 | repair | Execution-gate events capture the exact checkpoint identity. Cold restart reapplies a durable resolved choice only to that suspension; later retry checkpoints cannot inherit it. Retry and replan recovery regressions pass. |
| SYS-007 | S2 | repair | Run records, journals and event logs now fsync by default (`MANYHANDS_FSYNC=0` is an explicit disposable-data opt-out). Malformed records remain visible in the sidebar/list API and diagnostics reports record, event-log and checkpoint health. Durability/corruption regressions pass. |
| SYS-008 | S3 | repair | Wave selection now carries its durable `waveId` into leaf and repair attempts. Human `retry_repair` dispatch persists `run.scheduling.retry_dispatched` before emitting the direct Send and the retry attempt carries that identity. Graph/scheduling/journal regressions pass. |
| SYS-009 | S3 | consolidate | New/missing execution config defaults to fixed stage selections, create rejects the dormant complexity mode, and forks migrate explicit legacy complexity records to fixed. Legacy explicit reads remain supported and their tier lanes reference only registered models. Routing regressions pass. |
| SYS-005 | S2 | repair | RunRecord→event-log recovery repairs missing status transitions idempotently; stale `created` runs become `interrupted`. Recovery and sweep regressions pass. |

## Confirmed open queue

| ID | Severity | Decision | Confirmed gap | Required evidence to close |
|---|---:|---|---|---|
| SYS-010 | S2 | complete/remove | Several API routes have no evident productive UI consumer (`auto-resolve`, `plan-review`, node review/run, risks acknowledge and others). | Per-route control matrix; expose complete UX or remove route/types/tests. |
| SYS-011 | S2 | repair | Full browser traversal of home→planning→execution→integration→delivery/recovery is not yet revalidated on this checkout. | Codex-only disposable-repo run, console/network evidence and screenshots. |
| SYS-012 | S3 | repair | Historical QA findings around SSE ordering, stale snapshots, checkpoint locking and conflict integration require current reproduction. | Current-state regression or explicit resolved evidence for every item. |

## Remaining audit streams

1. Complete the route/control matrix and classify every visible action and API.
2. Revalidate decisions, lifecycle, delivery, fork, terminals and diagnostics.
3. Audit event/reducer selectors against every terminal and gated state.
4. Exercise crash, restart, multi-process, cancellation and recovery paths.
5. Browser-test accessibility, keyboard, responsive behavior, overflow and
   graph projections using real persisted runs.
6. Run the complete test/typecheck/lint/build matrix and inspect `git diff HEAD`.
