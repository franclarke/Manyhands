# Correctness-first execution runbook

## Purpose and authority

This runbook defines the non-normative multi-agent harness used to execute the
[correctness-first redesign](../plans/2026-08-12-correctness-first-system-redesign.md).
It operationalizes that plan; it does not amend its architecture, gates,
invariants, or retirement requirements. `PRODUCT.md` and the architecture plan
remain authoritative when this runbook is incomplete or conflicts with them.

Work is tracked as local Markdown according to the
[issue tracker](issue-tracker.md) and [triage labels](triage-labels.md). Never
publish `.scratch/` remotely without explicit authorization.

## Harness roles

Use no more concurrent agents than the configured capacity. Prefer bounded
parallelism with explicit ownership over broad fan-out.

| Role | Responsibility | Write policy |
|---|---|---|
| conductor | owns the objective, dependency frontier, integration, shared seams, gate state, and final claims | sole writer for shared contracts, manifests, lockfiles, stage status, and cross-cutting integration unless ownership is reassigned explicitly |
| explorer | reads code, tests, logs, Git state, and persisted evidence; returns paths, symbols, commands, and contradictions | read-only |
| slice worker | implements one independently verifiable ticket using TDD | writes only the exact files/directories declared in the assignment |
| gate verifier | reviews the handoff candidate against the normative gate and reruns required checks | read-only during review; remediation becomes a new ticket with explicit ownership |

The conductor must retain one slot for coordination and integration. Two agents
may write concurrently only when their declared ownership sets are disjoint and
neither can affect the other's public seam. A shared public interface is a
contract-first or conductor-owned change, not an invitation to concurrent edits.

## Preflight

Before claiming any ticket:

1. Read `AGENTS.md`, `PRODUCT.md`, the complete architecture plan, this runbook,
   and the ticket.
2. Confirm the actual Git root, branch, `HEAD`, `git status --short`, and
   `git diff HEAD`. Preserve every unrelated modification.
3. Confirm every `Blocked by` ticket is `closed`; otherwise do not claim it.
4. Inspect the productive callers, schemas, tests, and retirement path named by
   the active stage. Source and persisted runs describe current truth, not the
   target.
5. Declare owned files/directories and exclusions in the agent assignment.
6. Record the effective model, reasoning effort, tools, platform, and sandbox
   capability. A silent model or capability downgrade is a blocked preflight.
7. For behavioral work, state the observable failing scenario and the narrowest
   command that will reproduce it before editing production code.

Never use global `stash`, `reset`, or `clean`. Do not reformat, rename, or repair
unrelated files. Do not push, open a pull request, or publish local tickets or
evidence without explicit authorization.

## Ticket execution loop

Each ticket uses this sequence:

1. **Trace.** Follow the real productive route and identify current authority,
   state, side effects, compatibility consumers, and the intended retirement.
2. **Red.** Add or identify a targeted regression that fails for the observed
   production reason. Record the command and relevant failure, not merely a red
   filename.
3. **Green.** Implement the smallest complete vertical replacement consistent
   with the target architecture. Do not create a parallel representation for
   convenience.
4. **Narrow verification.** Run the focused test, then affected package
   typechecks/builds and direct integration checks.
5. **Broad verification.** Run the stage-required checks and `pnpm test` on the
   exact handoff tree. UI behavior additionally requires the real browser path;
   journal or API evidence cannot substitute.
6. **Retirement.** Prove productive reachability moved, remove the superseded
   path when the stage authorizes it, and retain only named historical readers.
7. **Review.** Inspect `git diff --numstat`, `git diff --check`, dependency
   direction, generated state, and the evidence record.
8. **Handoff.** Report files, candidate SHA/tree, commands and results, remaining
   failures, adverse evidence, and whether any later stage was touched.

A ticket becomes `closed` only after every acceptance criterion is verified.
Passing a narrow test does not close a product or gate-level requirement.

## Ownership and integration protocol

- Every writer assignment names exact owned paths and says that the agent is not
  alone in the repository.
- An agent must not revert, overwrite, stage, or commit another agent's changes.
- If a required edit crosses ownership, stop and ask the conductor to reassign
  the file or split the seam. Do not coordinate through coincidental edit order.
- The conductor reviews each completed slice before combining it. Shared barrels,
  package manifests, public schemas, configuration, and lockfiles have one
  writer at a time.
- A subagent result is a claim, not evidence. The conductor inspects the actual
  diff and reruns the relevant commands on the integrated tree.
- Commits are focused and local. A gate review names the exact candidate it
  evaluated; later edits invalidate that review where their inputs overlap.

## Gate review

The stage author does not self-certify a gate. A gate verifier receives the
normative gate, candidate, environment, required cells, commands, retirement
obligation, and known adverse evidence.

The verifier must classify each requirement as:

- `satisfied`: direct evidence proves it on the exact candidate;
- `failed`: evidence contradicts it;
- `inconclusive`: evidence exists but cannot establish the claim;
- `not_run`: no qualifying execution exists;
- `not_applicable`: the gate explicitly accepts a reviewed rationale.

A gate closes only when all mandatory deterministic checks, real/adverse cells,
product oracles, reachability checks, and retirements required at that point are
satisfied. Findings produce remediation tickets; the verifier does not quietly
patch the candidate during review. All R0-R19 cells begin as `not_run` in the
[G0 register](../audits/stage-0/required-cells.md).

## Failure and retry policy

Never repeat a deterministic failure with identical causal inputs.

For every failed attempt or command, record:

1. observed symptom and exact evidence;
2. failure class: transient provider/network, environment/capability, code/test,
   context/granularity, contract/topology, scope/authority, artifact/preimage,
   integration, validation/flakiness, cancellation, delivery divergence, or
   internal invariant;
3. the authority that owns the correction;
4. what evidence, input fingerprint, environment, contract, or policy will be
   different before another attempt;
5. the bounded stop rule.

Transient retries require evidence of transience and bounded backoff. A code or
test failure creates a causal repair attempt. Wrong decomposition creates an
amendment. Missing capability blocks the affected executor. Unknown physical
effect outcome is reconciled before any repeat. A second identical deterministic
failure escalates rather than consuming another blind retry.

## Evidence custody

Every gate record must bind:

- base and handoff candidate commit/tree;
- dirty-worktree inventory and generated runtime state;
- OS, runtime, package manager, Git, executor/model, reasoning effort, and
  effective sandbox/credential/network policy;
- exact command/procedure and versioned oracle;
- complete outcome, including skipped, failed, inconclusive, and `not_run`
  observations;
- raw logs, screenshots, manifests, receipts, and persisted run/event paths
  needed to reproduce the claim;
- retirement/reachability proof and residual limitations.

Never promote a self-authored test, successful build, process exit code, clean
Git status, node count, or model opinion into broader product evidence. Browser
claims require visible browser evidence. Delivery claims require exact
candidate, external oracle, and destination receipt. Preserve adverse evidence.

## Stage cadence and freeze rules

- Work only from the open frontier: `ready-for-agent` tickets whose blockers are
  all `closed`.
- Refine the active stage against current source before assigning production
  slices; later-stage envelopes stay blocked and must not be opportunistically
  implemented.
- Update the canonical plan's active-stage status only with attributable
  evidence.
- No large live-model benchmark, five-run series, or wide-graph experiment is
  permitted. Stage 5 / GP1 may execute only the two pre-registered, offline,
  attributable planner sessions authorized by D5.4 of the canonical plan; a
  repeat requires a recorded causal change and does not authorize productive
  cutover. The bounded two-run plus optional-third
  [exploratory study](../plans/2026-08-13-exploratory-longitudinal-study.md)
  starts only after Stage 11 establishes GProd eligibility. Other earlier
  live-model use remains prohibited except for the explicitly authorized Stage
  8 smoke path after its prerequisites pass.
- Documentation may track verified as-built behavior incrementally, but the
  final experiment and thesis cannot reinterpret target design as implemented
  fact.

## Handoff template

```text
Ticket / gate:
Candidate SHA and tree:
Owned files changed:
Observed production path:
Regression red command and reason:
Implementation summary:
Verification commands and results:
Required cells and outcomes:
Retirement/reachability evidence:
Adverse or inconclusive evidence:
Generated/runtime artifacts:
Remaining blockers:
Later stages touched: yes/no (explain if yes)
```
