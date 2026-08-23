# Attempt 004 — Stage 8 execution defects

- Run: `run:e30fcc59f7fa5c93acb307749befa2d6604878e01c37305040e8774fa94c211f`
- Workspace: `9925d141-5a60-4a39-b34e-a496fce40c47`
- Base commit: `56389d9cb7c83ae618850793438afd829b3d450f`
- Base tree: `1555e640f7399b75338f2ecbfcd9ad268cd814d9`
- ManyHands candidate: `c98f39c7e975c34ba8cbffb7d3f4246a1efa6633`

## What passed

- The run was created and operated through the visible productive UI.
- The frozen prompt matched SHA-256 `c111640f523caccc6c2070bb2c8fca48d3e835c6d8777adf20bd2a23c562df5d`.
- Persisted selections were Claude Sonnet for planning and Codex `gpt-5.4-mini` at medium effort for execution and repair, with Auto granularity and autonomous policy.
- The first durable batch was exactly `run.created`, `command.accepted`, `effect.requested`.
- Repository indexing left the target clean and wrote its cache under the daemon state root.
- Planning produced 13 semantic units and compiled a 12-node graph with the required root plus the expanded composites Ruta e itinerario, Organización and Recuerdos; the graph recorded 14 artifact requirements, 7 seam bindings and 25 resource claims.
- Execution reached six simultaneous Codex leaves in six distinct worktrees, proving physical parallelism.

## Failure 1: requested workspace-write became read-only

The worker log records the exact Codex argv with `--sandbox workspace-write`, `--ask-for-approval never` and `windows.sandbox="elevated"`. Nevertheless, every Codex trace header reports `sandbox: read-only`, and multiple independent leaves report rejected writes and empty diffs. A local no-write probe against Codex 0.148.0 confirmed that adding the explicit legacy config override `sandbox_mode="workspace-write"` makes the CLI report workspace-write.

## Failure 2: terminal cancellation leaked scoped state

After the visible UI cancellation, the journal reached `operation.interrupted` with `allDead=true`; runner, worker and all Codex processes were gone. Two brokered `auth.json` files and the two worktrees for `itinerary-search` and `memories-notes` nevertheless remained for more than 100 seconds. The transitional worker can create Stage 8 sandbox state, but the daemon only installed terminal revocation callbacks for the `sandboxed_live` profile. Worktree GC also lived in the worker and was skipped on an aborted repository signal, so a physically terminated worker could not clean it.

## Disposition

- The run was cancelled through the visible UI and archived after terminality.
- Safe durable artifacts were copied here before cleanup; credential contents were never read or copied.
- The exact attempt directory was validated for path containment, process quiescence and absence of reparse points, then sent to the Windows Recycle Bin. This evidence directory was preserved.

## Fixes and verification

- `83633cd79d21ae05879a6569bcad4f0e1c5ff91c` preserves the requested Codex workspace sandbox with the explicit legacy config override. Its focused Codex CLI suite passed 8/8.
- `6e90a86aa0bd916bc5f64e7e08eba651698e1a3d` makes live cleanup daemon-owned and retryable from durable physical receipts, uses collision-resistant run/attempt credential scopes, reclaims worktrees under a cross-process lease and keeps cleanup failures non-terminal until recovery converges.
- The joint affected matrix passed 9 files and 81/81 tests, including physical success, physical cancellation, cold recovery with identical receipts, credential-scope collision, worktree crash windows, lease contention/release and Stage 8 sandbox contracts.
- `@manyhands/execution-core` and `@manyhands/daemon` typechecks, focused ESLint, both production builds (including `dist/transitional-unsafe-worker.js`) and `git -c core.whitespace=cr-at-eol diff --check` all passed.
- A005 live qualification: pending.
