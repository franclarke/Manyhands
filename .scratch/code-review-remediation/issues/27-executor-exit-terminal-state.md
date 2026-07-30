# 27 - Convergencia terminal cuando el ejecutor termina inesperadamente

**What to build:** cuando una tarea de planificación o ejecución iniciada en
background termina con error, el run debe converger a un estado durable y
observable. Un proceso ejecutor que sale sin candidate, un planner que termina
sin resultado, un proceso huérfano o un restart interrumpido no pueden dejar el
run indefinidamente en `planning` o `running` sin evento terminal. La ruta debe
conservar las decisiones reales: un run bloqueado por una decisión pendiente no
debe marcarse como fallido por el mero hecho de que su driver terminó de forma
normal.

**Blocked by:** 26.

**Status:** closed

## Evidence that motivated the successor

Retry-11 is preserved as invalid and is not reused as a measurement. Its
durable evidence is under
`docs/tesis/evidence/warehouse/wide-graph/retry-11/`; the affected runs ended
with the Codex process gone while the persisted lifecycle remained `running`
or `planning`, with no candidate SHA, receipt, or delivery.

## Acceptance criteria

- [x] RED regression reproduces executor/planner background-task failure through
  a productive seam and proves that the run cannot remain active without a
  terminal event.
- [x] GREEN persists one causal terminal failure for executor exit or planner
  failure, with a useful reason and the correct operation authority.
- [x] Duplicate failure handling is idempotent and fencing-safe.
- [x] Genuine pending decisions remain pending and do not become failures.
- [x] Orphan detection, explicit restart, cancellation, heartbeat loss, and
  process evidence converge to the documented durable state.
- [x] Regressions cover executor exit without candidate, orphan process,
  interrupted restart, a real pending decision, and a run with no pending
  decisions.
- [x] Focused tests, affected typechecks, and repository gates pass.
- [x] Independent Standards and Spec reviews pass on the fixed point.
- [x] Retry-9, retry-10, and retry-11 evidence remains byte-for-byte untouched.

## Resolution — 2026-07-30

- RED: `tests/run-background-terminal-failure.test.ts` reproduced an executor
  task rejection through `startRunBackgroundTask` and initially exposed the
  missing terminal transition.
- GREEN: `markRunFailedAfterBackgroundTask` records one causal `run.failed`
  event, uses the failed operation when it still owns the run, and performs a
  stale, fenced control takeover only when no fresh owner exists. Pending
  decisions remain untouched; a released lease is reclaimed rather than
  fabricated.
- The runner retries a transient failure-handler error once and emits an
  explicit fatal diagnostic if durable persistence still fails.
- Existing crash-recovery, cancellation, process-supervision and lease tests,
  plus the new five-test regression file, pass. The web typecheck and
  `git diff --check` pass.
- Independent Standards and Spec reviews were requested at the fixed point;
  retry-9/10/11 paths are not modified by this ticket.
