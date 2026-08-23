# CF-122 — Write the production operations and recovery runbook

- **Status:** `ready-for-agent`
- **Blocked by:** CF-110

## Outcome

Document supported platforms, clean installation, configuration, daemon/web
startup and shutdown, executor credentials/capabilities, upgrades, logs and
diagnostics, retention/backup, crash recovery, cancellation, delivery failures,
security boundaries, and safe troubleshooting.

## Acceptance

- Every command is tested from a clean clone on each supported platform or
  explicitly platform-scoped.
- Recovery procedures reference observable diagnostics and never ask operators
  to fabricate lifecycle state or delete evidence broadly.
- Secret handling and residual same-user host risk are explicit.
- A fresh operator can complete a run and diagnose each supported failure class.
