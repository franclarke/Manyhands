# Stage 7 Git-native Artifacts and Exact Validation Implementation Plan

**Goal:** Make every productive attempt, adopted artifact, validation result, and human review refer to immutable, scoped Git content rather than a transport commit or mutable status record.

**Architecture:** Preserve Stage 6's canonical route: SemanticPlan -> GraphRevision -> canonical frontier. Evolve the existing manifest/fingerprint contracts into the only productive execution transport. The daemon remains owner of lifecycle facts; execution-core owns Git object inspection, retention, exact materialization, and validation. Historical V2 readers may replay old journals but never produce or materialize commit artifacts after cutover.

**Tech Stack:** TypeScript, Zod, Node 22.22.0, Git CLI through GitRunner, JSONL stores/journal, Vitest, tsup, pnpm.

---

## Entry state and scope

- Stage 6 / GS passed at code candidate 02f05e4cc320a11a0a1c762e2a2faa04d4bc1af0; documentation closure is 945786e9ea2060c34230d8581925e6aa1a01a7cf.
- Starting points already exist: packages/contracts/src/artifact-manifest.ts, packages/contracts/src/input-fingerprint.ts, packages/run-coordinator/src/domain/{attempts,artifacts}.ts, and JSONL stores in packages/run-store.
- The concrete gap is real: ArtifactMaterializer accepts only commit artifacts and calls GitRunner.cherryPick; V2NodeExecutor emits commit locations. This is the productive transport Stage 7 retires.
- Do not implement a live model run, sandbox enforcement, provider integration, broad composite authority, delivery publication, the experiment, or thesis work. Those remain outside this stage.

## Invariants

1. InputFingerprint includes every eligibility input. Retry, repair, integration, and validation observations are immutable records; none reopens or overwrites a terminal attempt.
2. ChangeSetManifest and CandidateTreeManifest are immutable content. Lifecycle lives only in canonical events/receipts, never fields inside a manifest.
3. Materialization validates base/preimages, writes declared OIDs and modes into a temporary index, verifies the resulting tree, and never cherry-picks, applies text patches, traverses commit ancestry, runs filters, or permits hooks.
4. Retained refs/manyhands/runs/... refs make adopted/evidenced candidates reachable until no active attempt, artifact, evidence, delivery, or audit-retention rule references them.
5. Each evidence item binds candidate/tree, baseline, recipe/proof strategy, command/selector, environment, and authority. Missing permitted authority for a required root criterion yields needs_input.
6. A human review binds exact candidate/tree plus rubric. Any later candidate invalidates it; model judgement/tests remain advisory.

## TDD execution tasks

### Task 1: Pin the productive transport boundary

**Files:**

- Create tests/stage7-git-native-productive-boundary.test.ts.
- Extend tests/execution-core-v2-node-executor.test.ts and tests/execution-driver-produced-artifacts.test.ts.

**Steps:**

1. Trace the daemon worker, canonical execution driver, V2NodeExecutor, ExecutionBaseBuilder, and ArtifactMaterializer.
2. Write RED tests proving the product route cannot emit commit artifacts, call GitRunner.cherryPick, or put mutable lifecycle fields in manifests.
3. Add adversarial fixtures for unowned paths, deletion, executable mode, symlink, gitlink, binary blob, no-op, bad preimage, stale artifact, and wrong resulting tree.

**Verify RED:**

    $runtime = 'C:\mh-runtime-c781-09\node-v22.22.0-win-x64'
    $env:Path = "$runtime;$env:Path"
    pnpm.cmd exec vitest run tests\stage7-git-native-productive-boundary.test.ts tests\execution-core-v2-node-executor.test.ts --retry=0 --maxWorkers=1

**Commit:** test: pin Stage 7 Git-native transport boundary

### Task 2: Complete immutable attempt and validation identities

**Files:**

- Modify packages/contracts/src/input-fingerprint.ts only if normative inputs are absent.
- Modify packages/run-coordinator/src/domain/attempts.ts, packages/run-coordinator/src/domain/artifacts.ts, and packages/run-coordinator/src/domain/events.ts.
- Modify packages/run-store/src/attempt-store.ts and packages/run-store/src/artifact-store.ts.
- Extend tests/input-fingerprint.test.ts, tests/attempt-adoption.test.ts, tests/artifact-registry.test.ts; create tests/stage7-attempt-lineage.test.ts.

**Steps:**

1. Make purpose, ordinal, exact execution-base inputs, retry/repair lineage, and terminal states explicit.
2. Permit idempotent creation only for byte-identical records. Reject changed identity, duplicate active fingerprint, reopening terminal attempts, and replacing evidence.
3. Key validation observations separately by exact candidate/tree, recipe/proof strategy, and environment.
4. Recompute freshness immediately before adoption and journal stale/rejected facts through the daemon.

**Verify:** canonical ordering, duplicate active identity, terminal immutability, stale adoption, retry/repair lineage, and candidate-specific validation identity.

**Commit:** feat: make execution attempts immutable and fingerprint-bound

### Task 3: Retain and build canonical Git-native manifests

**Files:**

- Modify packages/contracts/src/artifact-manifest.ts only for missing fail-closed contract invariants.
- Add focused Git artifact/ref modules under packages/execution-core/src/git/; narrowly extend packages/execution-core/src/git/runner.ts.
- Extend tests/canonical-artifact-manifests.test.ts; create tests/stage7-git-artifact-retention.test.ts.

**Steps:**

1. Inspect an orchestrator-created candidate and build a canonical change-set or candidate-tree manifest with exact OIDs, modes, base/result tree, and retained ref.
2. Verify object-store identity/format, object types, source candidate agreement, deterministic order, unique entries, and exact preimages/postimages.
3. Create short Windows-safe namespaced refs atomically under refs/manyhands/runs/<run>/attempts/<attempt>/....
4. Permit ref deletion only via an explicit retention decision after every active/adopted/evidenced/pending/audit reference has cleared. Prove the retained ref survives git gc.

**Verify:** SHA-1/SHA-256 shape; add/modify/delete; mode/type change; symlink/gitlink/binary; malformed OID; ref collision; premature retention deletion; post-GC reachability.

**Commit:** feat: retain immutable Git-native artifact manifests

### Task 4: Replace cherry-pick with exact manifest materialization

**Files:**

- Replace behavior in packages/execution-core/src/base/artifact-materializer.ts.
- Update packages/execution-core/src/base/execution-base-manifest.ts, packages/execution-core/src/base/execution-base-builder.ts, packages/execution-core/src/v2/node-executor.ts, and packages/orchestrator-graph/src/canonical-execution-driver.ts.
- Create tests/stage7-exact-artifact-materialization.test.ts; extend tests/execution-core-v2-node-executor.test.ts.

**Steps:**

1. Make manifest digest/ref the canonical artifact input/output. Leave historical commit readers explicitly non-productive.
2. Materialize declared entries through a temporary index, checking the base tree and every preimage; write the tree and compare it to resultTreeSha.
3. Fail closed on undeclared paths, no-op change, wrong selector/base, conflicting preimage, malformed mode, unsupported object, unresolved submodule, or active Git operation. Clean up the temporary index on every failure.
4. Treat a CandidateTreeManifest as exclusive base/final subject, never an overlay beside sibling change sets.

**Verify:** clean base + manifest yields exact tree without cherry-pick; every adversarial fixture rejects deterministically with no active Git operation or partial adoption.

**Commit:** feat: materialize execution bases from exact Git manifests

### Task 5: Apply controlled Git policy

**Files:**

- Modify packages/execution-core/src/git/runner.ts and focused runner tests.
- Add GitPolicy under packages/execution-core/src/git/ only if the runner cannot express the policy cohesively.
- Create tests/stage7-git-policy.test.ts.

**Steps:**

1. Use argument arrays and explicitly disable hooks, external diff/textconv, unsafe protocols, inherited credential helpers, repository-executed config, filters/attributes, and line-ending conversion for artifact operations.
2. Keep identity/config explicit and credentials out of Git config, prompts, manifests, and logs.
3. Parse Git paths NUL-delimited where available. Reject traversal, absolute paths, symlink escape, undeclared submodule fetch/init, and repository configuration that would execute host code.

**Verify:** fake-runner tests assert effective arguments and prove hostile hook/config/attributes cannot alter object identity or execute a command.

**Commit:** feat: enforce deterministic Git policy for artifacts

### Task 6: Bind validation evidence to exact candidates and authority

**Files:**

- Modify packages/execution-core/src/validation/evidence-matrix.ts, packages/execution-core/src/validation/candidate-validator.ts, packages/execution-core/src/v2/exact-candidate-validator.ts, and only necessary validation contract types.
- Modify packages/execution-core/src/delivery/candidate-preparer.ts to carry candidate-tree manifest identity.
- Extend tests/exact-candidate-validation.test.ts, tests/exact-candidate-cache.test.ts, tests/validation-recipe.test.ts, tests/validation-without-commands.test.ts; create tests/stage7-evidence-authority.test.ts.

**Steps:**

1. Bind every observation to manifest/tree, baseline, recipe/proof strategy, command/selector digest, environment, outcome, authority, and required baseline/negative-control evidence.
2. Verify selectors before execution. Reject no-op candidates and candidate/baseline/cached-tree mix-ups.
3. Route a required criterion without an allowed materializable oracle to deterministic needs_input; model prose does not approve or reject it.
4. Keep model-authored tests supporting-only unless the Goal Contract requires a human final decision over them.

**Verify:** wrong selector, stale/cross-tree cache hit, no-op diff, self-authored-test-only proof, unavailable oracle, baseline mismatch, and missing negative control cannot verify a required root criterion.

**Commit:** feat: bind validation evidence to exact candidates and authority

### Task 7: Bind human review and adoption through the daemon

**Files:**

- Modify apps/daemon/src/transitional-unsafe-worker.ts and the smallest necessary run-engine/journal adapter surface.
- Create tests/stage7-daemon-attempt-lifecycle.test.ts and tests/stage7-human-review-binding.test.ts.

**Steps:**

1. Persist attempt, retained-manifest, validation, review, stale, and adoption facts through the daemon actor/journal with command receipts, revision checks, and fences.
2. Model review with exact candidate-tree and rubric digests. Refuse stale review after a candidate change.
3. Use a deterministic fake executor through the actual daemon route: create attempt, candidate -> manifest, validation, review, adoption, restart/replay, duplicate command replay.
4. Confirm browser code and GET/SSE cannot acquire Git capability, mutate manifests, accept reviews, or invoke recovery.

**Verify:** replay returns the original receipt; stale review is refused; old retained artifact stays readable after restart; stale/rejected candidates never enter the adopted projection.

**Commit:** feat: cut daemon execution to immutable manifest evidence

### Task 8: Retire old productive transport and qualify GA

**Files:**

- Remove only productive commit/cherry-pick code made obsolete by Tasks 3--7; preserve documented historical readers if replay requires them.
- Create tests/stage7-legacy-transport-reachability.test.ts and tests/stage7-ga-artifact-evidence.test.ts.
- After GA only, write docs/audits/stage-7/README.md, update canonical stage state, and prepare the Stage 7 -> 8 handoff.

**Steps:**

1. Scan productive daemon/execution entrypoints for commit artifacts, cherryPick, cherryPickMainline, mutable manifest status, and implicit source-commit transport. Eliminate reachability, not merely exports.
2. Run the deterministic GA scenario through the product route: scoped candidate; binary/mode/symlink/gitlink/delete; retained ref; restart/replay; exact validation; stale approval; unavailable oracle; self-authored-test negative case; GC reachability.
3. Freeze candidate SHA/tree and perform exactly one independent bounded read-only review. Preserve commands, tool versions, manifests, refs, receipts, adverse failures, and verdict.
4. Mark Stage 7 / GA pass only if every gate cell passes. Otherwise record the block and stop; do not start Stage 8.

**Verification matrix:**

    $runtime = 'C:\mh-runtime-c781-09\node-v22.22.0-win-x64'
    $env:Path = "$runtime;$env:Path"

    pnpm.cmd exec vitest run tests\canonical-artifact-manifests.test.ts tests\input-fingerprint.test.ts tests\attempt-adoption.test.ts tests\artifact-registry.test.ts tests\stage7-*.test.ts --retry=0 --maxWorkers=1
    pnpm.cmd exec vitest run tests\execution-core-v2-node-executor.test.ts tests\execution-driver-produced-artifacts.test.ts tests\exact-candidate-validation.test.ts tests\exact-candidate-cache.test.ts tests\validation-recipe.test.ts tests\validation-without-commands.test.ts --retry=0 --maxWorkers=1
    pnpm.cmd --filter @manyhands/contracts typecheck
    pnpm.cmd --filter @manyhands/run-coordinator typecheck
    pnpm.cmd --filter @manyhands/run-store typecheck
    pnpm.cmd --filter @manyhands/execution-core typecheck
    pnpm.cmd --filter @manyhands/orchestrator-graph typecheck
    pnpm.cmd --filter @manyhands/daemon typecheck
    pnpm.cmd exec tsc -p tsconfig.json --noEmit
    pnpm.cmd --filter @manyhands/contracts build
    pnpm.cmd --filter @manyhands/execution-core build
    pnpm.cmd --filter @manyhands/daemon build
    git -c core.whitespace=cr-at-eol diff --check

Run the full suite with retry=0 only after focused checks pass, in an environment that can complete it without the documented 60-second host-pipe limit. An interrupted run is inconclusive, never green.

**Commit:** docs: record Stage 7 artifact evidence gate

## Completion checklist

- [ ] Every behavior begins with an observed productive RED, followed by the smallest GREEN change.
- [ ] Attempts and validation observations are immutable and replay-safe.
- [ ] Every adopted artifact is a verified, retained Git-native manifest.
- [ ] No productive route uses whole-commit cherry-pick or mutable manifest status.
- [ ] Evidence/review bind exact candidate, baseline, selector, environment, authority, and rubric.
- [ ] GA adversarial cases and Stage 3--6 regressions pass.
- [ ] Stage 8 remains not_started; no live model, experiment, or thesis work was initiated.
