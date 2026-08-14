# Stage 8 independent gate review

**Verdict:** `NO-GO`

**Scope:** bounded review of the predeclared Stage 8 / GLeaf gate criteria, the
R0/R10/R14/R17 evidence retained under `C:\mh8-evidence`, and the sandbox
boundary on the productive path. No recursive discovery pass.

**Reviewed implementation candidate:** `d3c617c4d989bb76de4fbeb1ddd5d15814fe348e`

**Reviewed implementation tree:** `df2b0b5e3a5c72da48d7ffea713b3fa517a02aea`

**Reviewer independence:** the reviewer did not author the Stage 8
implementation. The findings below are stated against retained evidence and the
productive path, not against the implementer's account of them.

## Confirmed

- **R0 is a real end-to-end live leaf.** The retained journal at
  `C:\mh8-evidence\r0-final-pass` holds 24 events covering planning, the raised
  and resolved graph decision, approval, readiness, wave selection, one attempt,
  candidate creation, validation, artifact adoption and final verification.
  Candidate `f8d1eed639a15aeb29d93b120423630933a03a85`, tree
  `b11777e1037a97fd0a747f79c7c082ace3aefcf1`, exactly two changed files, matrix
  `matrix-7817ac4d6efa0d78` `verified` with a negative control among its
  evidence refs. The source clone `C:\Users\franc\Documents\mh8-r0-sandbox`
  remains at baseline `00273f055e7d4a7bdb706d02a90e88f65d9a370c` with a clean
  tree, and both live candidate commits exist there as reachable objects.
- **R14 fails closed.** `SANDBOX_UNAVAILABLE` is raised by the provider before
  any provider CLI is spawned, the attempt fails durably, and the run raises a
  decision instead of retrying or degrading.
- **R10 cancellation, timeout and daemon restart** are journaled consistently
  with the recorded claims, including credential-scope removal on restart.
- **R17 lineage is causal, not cosmetic.** Attempt 1 stays immutably failed;
  attempt 2 carries `retryOfAttemptId` and a genuinely different
  `inputFingerprint` derived through `recoveryContextDigest` from the prior
  attempt's identity and failure reason.
- **Credential brokering holds.** Only declared files are copied into an
  attempt-local home, and `isolatedEnvironment: true` gives the executor process
  exactly the constructed environment — no host `HOME` or `USERPROFILE`.

## Blocking findings

### B1 — the qualifying run refutes the declared sandbox capabilities

`C:\mh8-evidence\r0-final-pass\state\traces\run_stage8_live-codex_1786729259953\traces.jsonl`,
events `trace-5` and `trace-6`, record the sandboxed Codex leaf running

```
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command
  "Get-Content -Raw C:\Users\franc\.agents\skills\code-1.0.4\SKILL.md"
```

from inside the attempt worktree, and returning the file's contents after
`succeeded in 673ms`. The same read appears in the R17 qualifying run. Codex
additionally reported `Skill descriptions were shortened to fit the skills
context budget. Codex can still see every skill`, so host-installed skills were
loaded into the attempt despite `--ignore-user-config` and a brokered
`CODEX_HOME`.

At the time of review the provider reported a frozen constant of
`filesystem: "declared_mounts"`, `network: "none"` and
`enforcement: "executor_native"`, identical for both executors and for both
Windows sandbox modes, and the executor profile revision separately recorded
`hooks`, `plugins` and `mcp` as `disabled`. Those are declarations, not
measurements, and the qualifying run refutes the first two. This is not
cosmetic: `satisfiesSandboxProfile` admitted the `workspace` profile only while
`filesystem !== "host_visible"`, so the overstated value is what allowed R0 to
qualify rather than fail closed.

**Disposition:** the capability record has been corrected on this branch —
read and write are now separate axes, `network` is `provider_only`, host tooling
visibility is explicit, and the executor profile revision is derived from the
provider rather than from a parallel literal. The correction changes the
executor profile revision digest and therefore the attempt input fingerprint, so
**the retained R0 and R17 evidence was produced under the superseded
declaration**. One live R0 re-run under the corrected record is required before
this finding closes.

### B2 — the Stage 8 deliverable for Claude is unexecuted

The stage requires "Live Codex, then Claude, through the same attempt/effect
protocol", and gate GLeaf constrains "either executor profile". `claude-code-cli`
is wired into `stage8SandboxFor` and `MANYHANDS_CLAUDE_CREDENTIAL_PATH`, but no
retained evidence contains a live Claude attempt. Claude Code additionally has
no native OS sandbox, so the workspace provider's `enforcement:
"executor_native"` is weaker for that executor than for Codex and is not
separately measured.

**Disposition — closed on 2026-08-14.** The authority chose the amendment: Stage
8 qualifies exactly one live executor. The finding is closed not by documenting
the gap but by removing the unqualified route — `resolveDaemonProfile` requires
a declared Codex source and `stage8SandboxFor` refuses any executor other than
`codex-cli` before a sandbox session exists, so an operator cannot start a live
Claude attempt under a boundary nobody measured.

## Resolved during review

- **The handoff tree was red.** `corepack pnpm test` on the working tree failed
  `tests/documentation-current.test.ts`, which pins the plan's status table. The
  audit's "274 files / 1,819 tests passed" was measured on the committed
  candidate, not on the tree being handed off. The documentation contract and
  the table are now updated together.
- `tests/stage8-sandbox-contract.test.ts` asserted
  `not.toEqual(expect.arrayContaining(["--dangerously-skip-permissions",
  "project,local"]))`, which passes whenever *either* member is absent and so
  never pinned the absence of the permission bypass. Split into two
  `not.toContain` assertions.
- The plan's Stage 8 status row was missing its `Next-stage disposition` cell.

## Remaining limitations recorded, not blocking

- `enforcement` is `executor_native` for both executors: process-tree custody is
  the daemon supervisor's, not the sandbox's. No `strong` profile exists, and
  the provider correctly refuses to claim one.
- `filesystemWrite: "workspace_only"` is the executor's documented behavior and
  is consistent with every retained run, but no adverse cell has yet attempted a
  write outside the workspace and observed it blocked. Until such a cell exists
  the write boundary is declared-and-consistent, not measured.
- Stage 8 qualification ran on Node 24.16.0 under a recorded operator exception
  rather than the Node 22 runtime named by the plan.

## Verdict

Stage 8 / GLeaf remains `in_review`. B2 is closed by the Codex-only scope
amendment. B1 stays open and is deferred for Codex quota: one live R0 re-run
under the corrected capability record. This review authorizes no Stage 9 work,
no longitudinal experiment and no thesis claim.
