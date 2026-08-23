# A003 diagnosis

- Attempt: `A003`
- Run: `run:6b689cdc600bbd9ca4971d6d2b8d8c7d87428e6c35e63e0935b0da5b6213e021`
- Workspace: `Viaje Familia A003`
- Workspace ID: `37a25daa-ca12-4559-9836-735f278a2fa1`
- Base commit: `a963ef3fa6731d473999eeb8886cf0383a052bb0`
- Base tree: `1555e640f7399b75338f2ecbfcd9ad268cd814d9`
- ManyHands commit: `33ad8d13aee2145c272382be6dab32338068beee`
- Frozen prompt SHA-256: `c111640f523caccc6c2070bb2c8fca48d3e835c6d8777adf20bd2a23c562df5d`

## Incident classification

Planning started normally from the visible UI. The create route returned HTTP
201 without the A002 false missing-run error, and the first canonical batch was
complete: `run.created`, `command.accepted`, `effect.requested`.

During productive repository grounding, ManyHands wrote this untracked runtime
artifact inside the target:

`?? .manyhands/cache/index-a963ef3fa6731d473999eeb8886cf0383a052bb0.json`

The cache is persistent, not transient. The productive planner used the
Repository Model default cache root under the inspected repository. Execution
only garbage-collects worktrees. Delivery treats `.manyhands/` as exempt from
its logical cleanliness policy but does not remove it. Therefore A003 was
guaranteed to finish with a physically dirty target whose runtime artifact was
absent from a clean clone. That violates the frozen experiment even if all
later model and product checks were to pass.

The run was cancelled from the visible UI before graph publication or execution
so the product defect could be fixed before a fresh attempt. Its terminal
`planning.failed` event records operator cancellation, not a provider failure.

## Canonical timeline

- `2026-08-20T16:52:25.666Z`: sequence 1, `run.created`.
- `2026-08-20T16:52:25.783Z`: sequence 2, `create_run` accepted.
- `2026-08-20T16:52:25.784Z`: sequence 3, planning effect requested.
- Claude planning was physically active as a direct daemon child; no worker or
  Codex process started.
- `2026-08-20T16:59:22.155Z`: cancellation accepted/requested.
- `2026-08-20T16:59:23.267Z`: planning effect physically interrupted.
- `2026-08-20T16:59:23.268Z`: sequence 10, terminal `planning.failed` reaction.

## Safety and evidence

- Claude and its MCP child exited after cancellation.
- No run worker or Codex execution process was started.
- Recursive inspection found zero brokered `auth.json` files.
- Journal/fence, both effect inputs, cancellation receipt, trace, the generated
  cache artifact, and controlled UI screenshots are preserved beside this file.
- The target remained at the exact base commit; its only change was the runtime
  `.manyhands/` directory created by planning.

## Required corrective action

Make the Repository Model cache root configurable and have productive planning
place it under the daemon state root, namespaced by stable target identity. A
regression must prove the target remains physically clean, the cache is outside
the target, and a second grounding reuses it before the next fresh attempt.

- ManyHands fix commit: `c98f39c7e975c34ba8cbffb7d3f4246a1efa6633`
- Fix tree: `991cd6d1ed4dd60247a495bdece9af69dee67599`
- Focused verification: 16 tests passed and 2 performance cases were skipped;
  the broader affected set passed 38 tests with 2 performance skips. Affected
  typechecks, ESLint, repository-index/daemon builds (including the compiled
  worker), independent review, and whitespace diff check passed.
