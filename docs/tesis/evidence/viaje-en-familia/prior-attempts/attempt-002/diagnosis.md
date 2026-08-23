# A002 diagnosis

- Attempt: `A002`
- Run: `run:2d098cb6cf4c52981d06b2f2359b012cadc96feaabb5adace8d9cfff56040468`
- Workspace: `Viaje Familia A002`
- Workspace ID: `92dec929-a92e-4cff-9c95-c5ba7af2aa92`
- Base commit: `e0202c7f9dee9868ea1bb6f20de9cac46936a035`
- Base tree: `1555e640f7399b75338f2ecbfcd9ad268cd814d9`
- Frozen prompt SHA-256: `c111640f523caccc6c2070bb2c8fca48d3e835c6d8777adf20bd2a23c562df5d`

## Incident classification

The daemon stack printed `Cannot fold a run without run.created.` while the UI
creation request was in progress. This was not a post-publication visibility
race and the journal was not corrupt. The web creation helper first queried the
new deterministic run ID so it could replay an existing command idempotently.
The daemon represented the missing run by attempting to fold an empty event
list, logged that expected exception through `onIpcError`, and returned a generic
`request_failed`. The web helper intentionally caught that response because
`allowMissingRun` was enabled, submitted `create_run`, queried the now-existing
run successfully, and returned HTTP 201.

The run was then cancelled from the visible UI because the expected pre-create
lookup was initially misclassified as a recurrence of the A001 journal race.
Its terminal planning failure therefore records operator cancellation, not a
Claude planning or journal-publication defect.

## Canonical timeline

- `2026-08-20T16:22:02.259Z`: sequence 1, `run.created`.
- `2026-08-20T16:22:02.377Z`: sequence 2, `create_run` accepted at revision 2.
- `2026-08-20T16:22:02.378Z`: sequence 3, planning `model_call` requested.
- `2026-08-20T16:22:03.335Z`: trace records Claude planning executor started.
- Sequences 4-10 record the visible cancellation, physical interruption, and
  terminal `planning.failed` reaction.

## Safety evidence

- The initial durable batch contains `run.created`, `command.accepted`, and
  `effect.requested` as one complete JSONL record.
- The planning receipt, both effect inputs, canonical journal/fence, and trace
  are preserved beside this file.
- After terminal cancellation, no Claude, Codex, worker, or run-owned descendant
  remained.
- Recursive inspection of the attempt state found zero brokered `auth.json`
  files.
- Screenshots under `screenshots/manyhands-ui` preserve the UI setup, planning
  state, and operator-cancelled terminal state.

## Corrective action

Add an explicit optional projection lookup that returns `null` for a missing
run without emitting an IPC error, while retaining the existing pre-query for
idempotent replay when a run already exists. The correction is qualified with
a regression before the next fresh attempt.

- ManyHands fix commit: `33ad8d13aee2145c272382be6dab32338068beee`
- Fix tree: `3494418c6fb0a0867b0eb1dbc7f3ceb02b227c7d`
- Focused verification: 15/15 engine + daemon tests passed; affected
  typechecks, ESLint, run-engine/daemon builds, web production build, and
  whitespace diff check passed.
