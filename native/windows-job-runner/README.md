# ManyHands Windows Job runner

This small, dependency-free Windows executable is the custody boundary for a
supervised process effect. It creates nested custodian and provider Job Objects
with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, joins custody before creating the
provider, starts it suspended, and verifies both Job memberships. It records the
provider and custodian PIDs with their kernel creation times, publishes a
checksummed immutable `started.json` receipt, and only then resumes provider
code.

The daemon keeps the runner's stdin pipe open. EOF means ownership was lost; the
runner terminates both Jobs, including descendants. After provider exit, the
runner terminates the provider Job and verifies its active-process count is zero
before exclusively publishing a `final.json` receipt bound to the exact started
checksum. An unexpected custodian exit intentionally produces no synthetic
final receipt by itself. On explicit recovery, an absent pair of Job Objects
may be converged only after the helper proves that both exact durable process
identities are dead; live, reused, or unknowable identities fail closed and are
never killed by PID.

The source intentionally uses only Rust's standard library and direct Win32 FFI.
No binary is committed. Build with `rustc` or Cargo and configure the daemon with
the resulting absolute executable path.
