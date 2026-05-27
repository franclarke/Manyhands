# Run Export And Import

## Execute Without Writing

```bash
pnpm demo:execute:mock
```

Runs the balanced deterministic mock execution flow and prints a summary. No files are written.

## Export Explicitly

```bash
pnpm demo:execute:mock -- --mode balanced --export examples/runs/passwordless-login-balanced.mock-run.json
```

Writes a complete `RunSnapshot` JSON artifact to the requested path.

## Save To Local Store

```bash
pnpm demo:execute:mock -- --mode balanced --save
```

Stores the snapshot under `.manyhands/runs/`.

## List Runs

```bash
pnpm runs:list
```

Prints local run ids, feature ids, modes, statuses and short hashes.

## Show A Run

```bash
pnpm runs:show -- passwordless-login:balanced:mock-execution-run
```

Prints counts and metadata for a saved snapshot.

## Import And Export Stored Runs

```bash
pnpm runs:import -- examples/runs/passwordless-login-balanced.mock-run.json
pnpm runs:export -- passwordless-login:balanced:mock-execution-run --out tmp/passwordless-login-balanced.json
```

Imports validate the snapshot schema before saving. Exports read from the local JSON store and write a validated artifact.

## Out Of Scope

These commands do not run real agents, create git worktrees, use SQLite, merge branches or perform evaluation statistics.
