# Attempt 005 run start

- Run id: `run:9f36ca57cb6eb890e0d24168f63d14fa1d8886e14d1cb4119fc7cc36c5cf0c6a`
- Workspace id: `c0e8a731-d808-4935-b316-3ceca1bc48c4`
- Started by the visible productive UI with the single `Generar plan` action.
- Productive route returned `POST /api/runs 201` and navigated to the exact run URL.
- Frozen prompt length/SHA-256: 2286 / `c111640f523caccc6c2070bb2c8fca48d3e835c6d8777adf20bd2a23c562df5d`.
- Persisted target base: commit `e83bafa0e9799984a752e7be7c767334c8e1a41a`, tree `1555e640f7399b75338f2ecbfcd9ad268cd814d9`, branch `main`.
- Persisted planning selection: `claude-code-cli` / `sonnet`.
- Persisted execution and repair selections: `codex-cli` / `gpt-5.4-mini`, effort `medium`.
- Persisted policy: autonomy `autonomous`, `maxParallel=6`, `scopePolicy=strict`, routing fixed; absent granularity condition is productive Auto.
- First and only initial durable batch (schema v4, checksum present): seq 1 `run.created`, seq 2 `command.accepted`, seq 3 `effect.requested` for `stage3:planning` / `model_call`.
- Initial trace: `executor_started`, actor `agent`, task `planning`, at `2026-08-20T19:42:52Z`.
- No `Cannot fold a run without run.created` text appeared in the journal or trace.
- Repository index cache was written below the isolated daemon state root; the target remained clean.

UI screenshots:

- `01-configuracion-ui.png`
- `02-planificando.png`
