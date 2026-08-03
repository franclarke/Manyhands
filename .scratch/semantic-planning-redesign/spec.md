# Semantic planning redesign

## Objective

Replace the productive `PlanningEnvelope + CandidatePlan + WorkBreakdown`
planning path with one deep `PlanningModule` whose interface owns the durable
planning transaction. The model proposes an untrusted `SemanticPlanDraft`;
ManyHands canonicalizes it into the only authoritative `SemanticPlan`, selects
an `ExecutionCut`, compiles the executable graph and commits the terminal
planning outcome before returning success.

Historical journals remain readable and immutable. Their old planning payloads
are evidence, not inputs to the productive path.

## Confirmed seams

### External seam

`PlanningModule.start/resume/replay` is the caller and test interface. The Run
Coordinator acquires the lease and continues execution; it does not orchestrate
candidate generation, canonicalization, quorum, policy, compilation or
persistence itself.

### Internal adapter seams

- `SemanticProposalPort`: Codex/Claude production adapters and a recorded
  adapter for deterministic tests and replay.
- `PlanningRecordPort`: durable JSONL implementation and in-memory test
  implementation.
- Repository inspection remains local-substitutable through the existing
  repository snapshot implementation.

The Graph Compiler and policy are in-process implementation details exercised
through `PlanningModule` with focused compiler contract tests only where their
existing public interfaces remain independently useful.

## Canonical flow

```text
Run + protocol + lease
  -> immutable planning attempt
  -> SemanticPlanDraft receipts
  -> deterministic canonicalization
  -> SemanticPlan candidates
  -> safety and comparability gates
  -> ExecutionCut selection
  -> GraphRevision + contracts
  -> durable terminal commit
  -> PlanningOutcome
```

## Invariants

1. The model never authors persistent IDs, hashes, snapshot IDs, event IDs,
   revisions or executable validation commands.
2. A semantic concept has one representation. Acceptance lives on its owning
   module, seam or global plan. A seam contains participants, compatibility,
   materialization and verification together.
3. Canonicalization may normalize and assign identity but never invent a
   semantic decision.
4. Product mode requests alternatives but can proceed with one safe candidate,
   recording degraded comparison.
5. Experiment mode requires the protocol's number of safe, distinct and
   comparable candidates.
6. The policy selects an execution cut; it never rewrites the semantic plan.
7. `ready` is returned only after proposal receipts, selected plan, compiled
   graph and terminal outcome are durably committed under the caller's fence.
8. Replay uses recorded proposals and never invokes a live model.
9. Legacy planning artifacts remain readable but are not translated silently
   into the productive path.

## Required behavior

- One safe and one rejected draft yields `ready/degraded` in product mode.
- The same inputs yield `not_ready/insufficient_comparable_candidates` in an
  experiment requiring two candidates.
- Snapshot, goal digest, plan IDs, module IDs, seam IDs and hashes are derived
  deterministically by ManyHands.
- A malformed local reference, ungrounded scope, uncovered required criterion,
  unverifiable leaf or incomplete seam rejects only its candidate.
- No safe candidate yields a typed `not_ready/no_safe_candidate` outcome.
- A durable commit failure cannot produce `ready`.
- Replay reproduces canonicalization, selection and compilation hashes from
  recorded proposal receipts.

## Migration rule

Replace the productive path vertically. Compatibility code may read historical
events, but no new productive event or compiler input may contain a
`CandidatePlan` or model-authored `WorkBreakdown`.

## Verification

- TDD at `PlanningModule.start/resume/replay`.
- Focused semantic planning and compiler suites.
- Affected package and web typechecks.
- Root test suite, package build and web build in the isolated worktree.
- A recorded Warehouse planning replay followed by one bounded live preflight
  before any new thesis experiment.

