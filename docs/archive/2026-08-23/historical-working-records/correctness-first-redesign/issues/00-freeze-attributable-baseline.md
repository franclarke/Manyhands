# CF-000 — Freeze the attributable baseline

- **Status:** `closed`
- **Stage / gate:** Stage 0 / input to G0
- **Blocked by:** none
- **Output owner:** `docs/audits/stage-0/baseline.md`

## Objective

Create the exact, reproducible evidence anchor from which every redesign claim
will be measured. This ticket records current truth; it does not fix findings or
claim a target capability.

## Required inputs

- `AGENTS.md`, `PRODUCT.md`, and the complete canonical redesign plan.
- Current Git checkout and all dirty/untracked state.
- Workspace manifests, CI workflows, package scripts, and active Codex agent
  configuration.
- Existing baseline and historical experiment evidence, labelled by its actual
  authority.

## Execution

1. Record repository root, branch, HEAD commit/tree, remotes, worktree list, and
   the complete dirty/untracked inventory. Distinguish pre-existing user changes
   from Stage 0 artifacts.
2. Record Windows edition/build and architecture; Node, pnpm, Git, Codex CLI,
   Claude CLI, browser, and other tool versions used by baseline checks.
3. Record the effective conductor/subagent model and reasoning effort from
   current configuration or direct runtime evidence. Do not infer a requested
   model from prose.
4. Record workspace package inventory, scripts, CI jobs, and commands that
   presently define tests, typechecks, lint, and builds.
5. Reproduce the committed baseline from a separate clean clone or worktree at
   the exact commit. Keep package caches outside evidence identity and record all
   setup commands.
6. Run the current whole-repository verification commands without rewriting
   files. Preserve stdout/stderr and label every failure or skip.
7. Record running ManyHands processes and `.manyhands`/other runtime state
   separately from source state. Do not delete it.
8. Link historical baseline evidence as historical context only; current
   commands and Git identity remain authoritative.

## Acceptance criteria

- Candidate commit and tree, branch, repository root, dirty inventory, platform,
  toolchain, effective model/effort, and exact commands are recorded.
- A clean-clone/worktree reproduction at the committed candidate has direct
  outputs for tests, package/web typechecks, builds, and lint where available.
- Failures, warnings, skipped checks, absent tools, and generated state are
  explicit; no unrun check is called successful.
- The record distinguishes committed baseline, current dirty tree, and
  historical evidence.
- No source or target behavior was changed to improve the baseline.

## Verification

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short
git worktree list --porcelain
git diff --check
```

Run repository checks exactly as declared by `AGENTS.md` and the current package
scripts. Keep their full evidence outside this ticket and link it from the
baseline record.

## Handoff

Report the baseline candidate/tree, clean-clone path, all command outcomes,
dirty/generated inventory, limitations, and whether any production file was
modified. Do not mark this ticket closed until another agent can reproduce the
record.
