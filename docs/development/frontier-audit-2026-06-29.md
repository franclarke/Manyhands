# ManyHands Frontier Audit

> Read-only staff/principal-level audit. 2026-06-29. No source code was modified.
> Method: 1 main agent + 6 scoped analysis subagents (decomposer/contracts/task-graph ·
> execution-core · orchestrator/scheduler/conflict-risk · web runtime/lifecycle ·
> UI run-model · testing/code-quality). Every finding is cited as `path:line`.
> Baseline verified before analysis: **1255 tests pass** (3 skipped, 145/146 files),
> **web typecheck clean**, `git diff HEAD` = 6 in-flight files (a clean hardening fix).

Finding IDs use a fresh **A-NN** namespace to avoid collision with the existing
`F-`/`O-` IDs in [`qa-manual-findings.md`](qa-manual-findings.md). Severity:
`bug` · `arch-risk` · `unclear` · `obsolete` · `product-gap` · `nit`.

---

## 1. Executive summary

ManyHands is **far more mature than a prototype**. The core thesis — decompose a
natural-language feature into a hierarchical DAG with interface contracts, execute
leaves in isolated worktrees, validate diffs against scope, schedule risk-aware
waves, integrate bottom-up with cherry-pick + semantic repair, and gate human
intervention through one decision channel — is **really implemented and the five
load-bearing invariants hold under test**:

- `git diff HEAD` is genuinely the source of truth; stdout is diagnostic-only
  (`result/recorder.ts:183`, `executor/process.ts:52`).
- Agents never commit; unexpected commits are detected, traced, and rejected by
  default (`recorder.ts:127`, tested `tests/execution-core-recorder.test.ts:329`).
- Isolation = worktree + `ScopeChecker` with `forbiddenPaths` as a hard fail
  (`scope/checker.ts:42`).
- Integration is bottom-up cherry-pick with bounded repair; a repair that commits
  but fails parent validation is still a FAILED integration
  (`integration/agent.ts:382`, tested `tests/execution-core-integration.test.ts:846`).
- `gated` is derived from pending blocking decisions, never stored
  (`selectors.ts:308`).

A large robustness program is **already done** (PR-S1..S9 in `DECISIONS.md`; tasks
1–20 in `future-frontier-tasks.md`): native LangGraph resume/fork, verified
process-tree kill + worktree GC, world reconciliation, per-repo locks, SSE
Last-Event-ID replay, budget gates, optimistic-version CAS mutation guards. The
QA loop (`qa-manual-findings.md`, F-001..F-028 / O-1..O-11) has already closed the
worst crash-class bugs (partial-payload 500s, double-events, empty-repair commit
crash, path-traversal in fork, credential expiry preflight).

**The system is production-*shaped*. What remains is production-*hardening* at the
edges, plus closing the gap between the rich backend signal and what the operator
can actually see.** The dominant residual risks cluster in four places:

1. **Lifecycle holes on non-core mutation paths** — the `deliver` route runs
   destructive git operations with no guard; a few HITL/resume paths use a
   non-atomic active-runner check (TOCTOU) and can silently orphan a `running`
   run.
2. **Observability that never reaches the UI** — five first-class declared event
   types (cancel survivors, checkpoint degraded/lost, world reconciled, scheduling
   audit) are silently dropped by the reducer's forward-compat default, so the
   richest "what happened / why blocked" data is invisible to the human.
3. **Planning-time validation gap** — the recursive decomposer reports
   `contractValid: true` while only running the *non-executable* graph validator,
   so producer↔consumer seam errors aren't caught at decomposition.
4. **Engineering-process gaps** — there is **no CI**; the legacy `@manyhands/core`
   barrel still has 13 importers; a 6× `as unknown as TaskGraph` cast cluster
   disables the compiler on the most safety-critical object.

None of these are existential. All are tractable in 1–3 focused passes.

---

## 2. What the system currently implements

A Next.js (App Router) control room over a TypeScript monorepo of 12 packages
(~20k LOC) + web app (~28.5k LOC). The web app does **not** reimplement
orchestration; it calls API routes backed by package APIs and renders validated
artifacts.

Real, working capabilities:

- **Recursive interface-aware decomposition** via the Claude Code CLI in plan mode
  (`ClaudeCodeRecursiveDecomposer`), Codex as alternative. Each node decides if it
  is atomic or splits, emitting `sharedInterface` obligations children must honor.
  `low|medium|high` controls decomposition aggressiveness, not a fixed node count.
- **Planning + execution as LangGraph StateGraphs** with interrupt-first pure
  gates (cheap to re-run on resume), identity-merge reducers (retry replaces, not
  accumulates), and a JSON checkpointer with corruption tolerance.
- **Risk-aware scope-disjoint wave scheduling** (`selectScopeAwareWave`) wired to a
  real pairwise conflict-risk matrix enriched by a structural TypeScript
  repository index. Missing safety data serializes conservatively with audited
  warnings — never silent unsafe parallelism.
- **Isolated leaf execution**: worktree per leaf, context packer, CLI agent
  executor (executors are *data* — argv builder + output parser + log scope),
  diff-as-truth recorder, scope check, validation runner, orchestrator commit.
- **Bottom-up integration** with cherry-pick, AST/compiler-feedback semantic
  repair (bounded), and structured `IntegrationResult` evidence.
- **Full lifecycle control plane**: start/pause/resume/cancel/restart/fork/replan,
  guarded by an explicit `assertRunActionAllowed` status matrix + optimistic-version
  CAS claims; verified hard kill + GC on cancel.
- **Event-sourced UI**: append-only `RunEvent` log → pure reducer → pure selectors
  → view-models → presentational React. SSE with monotonic `seq`, Last-Event-ID
  resume, backoff, and gap-triggered full replay.
- **Durable evidence**: per-run `<id>.events.jsonl` + `RunRecord` snapshot +
  LangGraph checkpoints + trace store embedded in the snapshot.

---

## 3. End-to-end pipeline map

```
Feature prompt (+ workspace/local repo, executor selection, granularity, budgets)
  │
  ▼  POST /api/runs → RunRecord created; planning host on thread `${runId}__planning`
planningGraph (LangGraph)
  ├─ decomposePlan  (Claude Code CLI, plan mode; questions return as DATA)
  │     → recursive expand → TaskGraph + AgentTaskContracts + sharedInterfaces
  │     → criticReview (deterministic critics, in-loop)
  ├─ questionGate (interrupt) ── resume via Command({resume}) ─┐
  └─ approvalGate (interrupt) ←── plan-review/decisions ───────┘
  │   ⚠ decompose() validates with validateTaskGraph (NON-executable) → A-09
  ▼  approve → status running (auto-starts; no separate "run" affordance)
executionGraph (LangGraph, map-reduce wavefront)
  ├─ prepare → grounding: freeze seams + deterministic skeleton scaffold
  │            (⚠ commits skeleton to base-repo master — F-/O-6 / A-21)
  ├─ [routeFrontier] ── computes ready frontier from graph.dependencies (canonical)
  │     → selectScopeAwareWave (scope-disjoint + risk matrix + repo-index signals)
  │     → REQUIRED append run.scheduling.wave_selected (else wave does not run)
  ├─ executeLeaf (Send fan-out): worktree → context pack → CLI executor
  │     → git diff HEAD (truth) → scope check → validation → orchestrator commit
  ├─ leafGate (interrupt): retry_repair | accept_failing | replan_subtree | abort
  ├─ waveJoin → repeat frontier until no leaves
  ├─ integrateNextComposite (one composite/superstep): cherry-pick topo order
  │     → conflict → bounded semantic repair (AST/compiler feedback) → parent validate
  ├─ conflictGate (interrupt): retry_integration | accept_conflict | abort
  ├─ budgetGate (interrupt, between waves): extend | finish_partial | abort
  └─ runValidation → metrics (GranularityVector)
  │
  ▼  RunRecord + RunEvent log (jsonl) + checkpoints + trace store
Web projection
  ├─ live: trace events → run-model events (best-effort) over SSE
  ├─ reload: projectRunRecordToRunEvents (⚠ diverges from live path — A-15/A-16)
  ├─ reducer (entities only) → selectors (derive paint/gated/freshness)
  └─ DecisionChannel · workspace graph · focus panel (lazy artifacts?ref=) · timeline
  │
  ▼  delivery: approve_merge decision → DeliveryPanel → POST /deliver
                 → mergeRunBranch / discard / cleanup  (⚠ unguarded — A-01)
```

---

## 4. Package-by-package analysis

### `task-graph` (952 LOC, single file) — Active, solid
- **Responsibility:** plan data model, structural + executable validation, topo
  sort, readiness, status aggregation, dependency mutation helpers, `graftSubtree`.
- **Solid:** schema-first validation with a real error-code taxonomy;
  `graftSubtree` re-points boundary edges, namespaces ids, re-validates
  (`index.ts:937`); cycle/orphan detection correct and well tested.
- **Weak:** `dependency_sync_divergence` is one-directional (A-11);
  `addDependency`/`removeDependency` mutate in place behind a pure-looking
  signature (A-12); `getReadyLeaves` excludes integrators that `getTaskReadiness`
  declares ready (A-13); `getTopologicalOrder` mixes structural + dependency edges.
- **Tests/observability:** `graftSubtree` well covered; the sync helpers and
  `dependency_sync_divergence` have **no dedicated test**.

### `contracts` (481 LOC) — Active, solid
- **Responsibility:** `AgentTaskContract`, `InterfaceContract`, `ExecutionScope`,
  path/argv safety, contract-boundary validation.
- **Solid:** path-traversal/absolute/drive/home/control-char rejection
  (`index.ts:438`); careful argv-vs-shell command safety policy; interface-id
  charset + duplicate detection.
- **Weak:** boundary validation does **not** cross-check producer↔consumer (lives
  only in `validateExecutableTaskGraph`); `forbidden.reasons` keys validated as
  paths but never tied to `forbidden.paths` (A-14); metadata is `z.record(unknown)`.

### `decomposer` (5217 LOC) — Active, critical path, weakest typing
- **Responsibility:** feature → validated TaskGraph + contracts (mock,
  single-pass, recursive families + Claude/Codex CLI adapters).
- **Solid:** typed `DecomposerLlmError` with stage/kind/recoverable; bounded retry
  with structured feedback; strong recovery suite; per-step seam validation incl.
  inherited-obligation propagation; **`goal` is canonical everywhere — `intent` is
  clean** (only unrelated `ChildIntent` in execution-core).
- **Weak:** final validation uses non-executable `validateTaskGraph` (A-09);
  `reconstructGraph` is unvalidated, `any`-typed, duplicates `expand` logic (A-10);
  Codex adapter uses a **write-enabled sandbox** while planning should be read-only
  (A-20); stale "silent fallback" guard comment vs `allowNonRootFallback` (A-19);
  8 of the repo's 13 `any` live here.

### `orchestrator-graph` (2761 LOC) — Active, solid
- **Responsibility:** planning + execution StateGraphs, state annotations,
  JSON checkpointer, dynamic wavefront.
- **Solid:** interrupt-first pure gates; `dependencySatisfied`/`childSettled`
  deliberately mirrored to avoid stranding (`execution-nodes.ts:145`, repro test);
  retry-tombstone reducer; checkpoint health (missing/ok/degraded/lost) wired to
  world-reconcile.
- **Weak:** non-atomic `latest.json` write (tolerated by corruption fallback,
  A-24); resume path doesn't re-run reconciliation (A-17); checkpointer has **no
  per-threadId lock** → concurrent `put`/`putWrites` TOCTOU (F-011, still open).

### `execution-core` (7872 LOC, largest) — Active, strong invariants
- **Responsibility:** the execution substrate — worktrees, executors, scope,
  recorder, validation, integration, grounding, amendments, metrics, kill registry.
- **Solid:** all five named invariants verified with cited proofs; cancellation
  unusually rigorous (verified kills w/ PID polling); artifact exclusion is a real
  postmortem-driven fix; cleanup in `finally`.
- **Weak:** the `accept` unexpected-commit branch skips artifact-glob filtering
  (A-02); Codex path reports `usage: unavailable` so budget gates can't govern it
  (A-04); half-created worktree on `recreateAfterStaleLeftovers` failure escapes
  run-level cleanup (A-03); same-task path keyed only on `(runId,taskId)` (latent,
  A-18); pervasive stale "Gemini" comments.

### `scheduler` (956 LOC) — Active, solid, thin tests
- **Responsibility:** ready frontier → safe parallel wave (scope-disjoint + risk).
- **Solid:** canonical-dependency reads; conservative overlap; explicit
  degradation warnings; no implicit `parallel_naive`.
- **Weak:** O-7 coordination-file relaxation is count-only and frontier-relative —
  can under-serialize a real ≥3-task content collision, only the benign barrel case
  is tested (A-05/A-06); double safety-context build on the hot path (A-07).

### `conflict-risk` (865 LOC) — Active, **real signal**, untested directly
- **Solid:** genuine weighted evidence (exact-file, path-prefix, symbol,
  producer/consumer, critical-path, fixtures) + 10 static repo-index signals;
  deterministic, sorted, schema-validated.
- **Weak:** dead `explicit_dependency` promotion branch (A-08); `path_overlap`
  prefix-coarse; **no dedicated test file for 865 LOC**.

### `repository-index` (556 LOC) — Active, solid but shallow
- Deterministic structural TS index. Statement-level only (misses
  namespace-nested / re-exported / default-export symbols), so some real overlaps
  get no static signal (degrades toward less serialization). `.json` indexed but
  not parsed. No dedicated test.

### `run-store` / `trace-store` — Active
- JSON snapshot store with per-run write chains; trace store (60+ event types,
  actor-tagged) embedded in the snapshot. Solid. `readRawWithRetry` can't
  distinguish delete from transient rename (F-021, open).

### `apps/web` server runtime (`lib/server/runs`, ~9.5k LOC) — mostly solid, risk concentrated
- **Solid:** the lifecycle matrix + two-layer guards; `claimRunMutation` CAS;
  audited status mutations with rollback; cancel; per-run write serialization.
- **Weak / prototype-shaped:** `deliver` route unguarded (A-01); non-atomic
  active-runner check on HITL/resume/fork paths (A-23); silent runner-race no-op
  (A-22); `repo.save()` outside lock clobbers heartbeat (A-25); `answer` planning
  path bypasses the matrix (A-26); plan-edit patch routes accept edits on
  running/terminal runs (A-27); budget watchdog aborts without hard-kill (A-28).

### `apps/web` run-model + UI (`lib/run-model`, ~4k LOC) — disciplined core, divergence at edges
- **Solid:** genuinely event-sourced; reducer stores entities only; selectors
  derive everything; `selectFreshness`/`gated` override are textbook "UI must not
  lie"; lazy artifact resolution; robust SSE reconnect. Excellent unit coverage
  (reducer 57, selectors 52).
- **Weak:** live path lags terminal node states until a batch flush (A-15); live
  vs reload projection diverge on commit/changedFiles/freshness (A-16); **5
  declared events silently dropped** (A-30); predicted risk unwired in the
  "Riesgos" tab (A-31); `buildThreadMessages` is a divergent second reducer with
  brittle string round-trips (A-32); no in-context plan reject/edit affordance
  (A-33); integration-failure "why" not linked from the failed composite (A-34).

---

## 5. File-level notes (the files that matter most)

| File | What it is / why it matters |
|---|---|
| `packages/execution-core/src/run/executor.ts` (1418) | The execution spine: leaf run, repair, integration orchestration, metrics. |
| `packages/execution-core/src/result/recorder.ts` | Diff-as-truth + unexpected-commit detection + scope gate. Invariant home. |
| `packages/execution-core/src/integration/agent.ts` (1015) | Cherry-pick + bounded semantic repair + parent validation. |
| `packages/execution-core/src/scope/checker.ts` | forbidden=hard, allow-list=advisory. The real security boundary semantics. |
| `packages/execution-core/src/executor/{cli-executor,profiles/*,registry,kill}.ts` | Executors-as-data seam; verified process-tree kill. |
| `packages/decomposer/src/llm/recursive/recursive-decomposer.ts` (1523) | The active planner; `any` hotspot; A-09/A-10. |
| `packages/orchestrator-graph/src/nodes/execution-nodes.ts` (715) | Frontier computation, `dependencySatisfied`/`childSettled`, gates. |
| `packages/orchestrator-graph/src/checkpointer.ts` | Corruption-tolerant checkpoints; no per-thread lock (F-011). |
| `packages/scheduler/src/index.ts` (956) | `selectScopeAwareWave` + O-7 relaxation (A-05/A-06). |
| `packages/conflict-risk/src/index.ts` (865) | Real pairwise risk; untested directly. |
| `apps/web/src/lib/server/runs/execution-pipeline.ts` (1231) | Drive/stream/interrupt loop; A-15/A-22/A-25 live here. |
| `apps/web/src/lib/server/runs/execution-host.ts` (727) | Builds the execution host from RunRecord; resume seam. |
| `apps/web/src/lib/server/runs/{mutation-guard,audited-mutation,lifecycle}.ts` | The strongest part of the runtime: CAS claims + matrix + audited mutations. |
| `apps/web/src/app/api/runs/[id]/deliver/route.ts` | Destructive merge/discard/cleanup — **unguarded (A-01)**. |
| `apps/web/src/lib/run-model/reducer.ts` | Pure fold; the `default` at :412 drops 5 first-class events (A-30). |
| `apps/web/src/lib/run-model/selectors.ts` | Derives paint/gated/freshness. The discipline core. |
| `apps/web/src/lib/run-model/types.ts` (934) | ~50 RunEvent payload types — canonical vocabulary. |
| `apps/web/src/components/chat/thread.tsx` (748) + `thread-messages.ts` | Operator narrative surface; divergent second reducer (A-32). |
| `docs/DECISIONS.md` · `docs/development/qa-manual-findings.md` · `docs/design/future-frontier-tasks.md` | The living decision/QA/roadmap record — read these first. |

---

## 6. Product capability assessment

**What it can do today (verified by the QA E2E runs in `qa-manual-findings.md`):**
end-to-end run from prompt → plan → approve → parallel wave execution → bottom-up
integration → final validation → merge to a branch, with HITL gates at plan,
leaf-failure, conflict, and budget; durable resume across a 4-hour pause + server
restart; verified cancel; selective re-decomposition of a failed subtree.

**What it appears to promise (UI copy / docs):** a calm technical control room
where a human can understand *why* a run is gated/blocked, *what* an agent changed,
*why* integration failed, and *predicted* integration risk — and intervene.

**The gap:** the backend produces almost all of this signal (scheduling
`blockedReasons`/`riskSummary`/`fallbacks`, cancel `survivors`, checkpoint
degraded/lost, predicted-risk `deriveConflictList`, integration `diagnosis://`),
but the agent-first UI **does not surface it** (A-30/A-31/A-34). The "Riesgos" tab
promises predicted risk and shows only post-integration detected conflicts. The
operator can approve or silently edit-elsewhere but has no in-context "reject /
request changes / edit this node" path (A-33). So the system is more *capable* than
it is *legible*, which directly undercuts trust — the product's whole point.

---

## 7. Deprecated, outdated, or weak implementation patterns

- **No CI.** `.github/workflows` does not exist. 1255 tests + a clean typecheck run
  only locally. For a system whose value proposition is *trustworthy automation*,
  the absence of an automated gate on push/PR is the single biggest process gap.
  Modern bar: GitHub Actions running `pnpm test`, `pnpm web:typecheck`,
  `pnpm build`, `pnpm lint` on PR.
- **Legacy `@manyhands/core` barrel — 13 importers**, all in `apps/web/src`
  (`live-graph.ts`, `plan-review.ts`, `presenter.ts`, `patches.ts`,
  `execution-state.ts`, `replan-service.ts`, `planning-host.ts`,
  `integrator-service.ts`, `repo-index-cache.ts`, `editing.ts`,
  `decomposer-policy.ts`, `conflict-view-model.ts`, `nodes/[taskId]/regen/route.ts`).
  Decision says "evita en código nuevo"; the app is the sole remaining consumer.
  Migrate to specific packages, retire the barrel.
- **`as unknown as TaskGraph` double-cast cluster (6×)** — `plan-review.ts:61,132`,
  `patches.ts:367,371,375`, `editing.ts:58`. The persisted `graphSnapshot` shape
  and the live `TaskGraph` type aren't unified, so schema drift on the most
  safety-critical object is invisible to the compiler. One typed adapter fixes all.
- **Three parallel event vocabularies** — `TraceEvent` (60), `StreamEvent` (16),
  `RunEventPayloads` (50) describe overlapping lifecycle moments with manual
  bridging (`LiveExecutionTraceStore`). Coherence risk; a shared source of truth
  would remove the bridge and the live-vs-reload drift (A-15/A-16).
- **No logger abstraction** — 69 raw `console.*` in the web app, no run-id in
  prefixes; only `execution-core/src/logging/log.ts` is structured. Concurrent-run
  diagnosis is hard.
- **`any` on the planning critical path** — the recursive decomposer CLI adapters
  type every `executeStep`/`reconstructGraph`/SDK-`create` arg as `any`.
- **Non-atomic persistence primitives** — checkpointer `latest.json` write (A-24)
  and run-store writes have no `fsync` (F-012); tolerated by recovery logic but a
  power-loss torn-write window remains.
- **Stale executor comments** — "Gemini CLI" references throughout the executor
  seam and git runner; Gemini was removed (ADR-0031). Actively misleads readers.

Note: the legacy `RunSnapshot` projection and the SSE-adapter bridge are kept as
documented fallbacks; they are candidates for removal once the native pipeline is
the only production path (would eliminate A-16 by construction).

---

## 8. Features that may not make sense anymore

- **The SSE-adapter / legacy `RunSnapshot` projection bridge.** It produces a
  *different* model than the native pipeline (commit `"—"`, empty `changedFiles`,
  freshness that can't go stale — A-16). If the native path is the only production
  path, delete the bridge rather than maintain two divergent projections.
- **`OPENCODE` executor id.** It's in `EXECUTOR_IDS` and `normalizeExecutorSelection`
  but `enabled:false`; selecting it normalizes fine then throws at factory time.
  Either finish it or remove it from the selectable set.
- **The dead `explicit_dependency` conflict-risk branch** (`conflict-risk:307`):
  schema literal + consuming `if` with no producer. Wire it (a `graph.dependencies`
  edge → explicit signal) or delete it.
- **`_testOnlyOptionsHook`** (`decomposer/src/llm/normalize.ts:192`): dead no-op
  exported only for tests; move to a test util.
- **`GranularityVector`** naming is legacy (per `DECISIONS.md` it's just run
  metrics now). Not harmful, but a rename would stop implying a retired benchmark
  methodology. Low priority.
- **Do NOT remove** (these look vestigial but are load-bearing): the
  artifact-exclusion globs, `deriveConflictList` (it should be *surfaced*, not
  deleted — A-31), and the mock decomposers (used by the hermetic test suite).

---

## 9. Features worth adding

**Trust & observability (highest product leverage):**
- Surface the 5 dropped events (A-30): a recovery/system-notice strip for
  `run.cancelled` survivors, `checkpoint.degraded/lost`, `world.reconciled`; fold
  `run.scheduling.wave_selected` `blockedReasons`/`riskSummary` into per-node "why
  blocked" copy.
- Wire predicted risk (`deriveConflictList`) into the "Riesgos" tab so it stops
  over-promising (A-31); attach `diagnosis://` to failed composite nodes (A-34).
- Per-leaf terminal events so live progress reflects reality (A-15).

**Human-in-the-loop control:**
- In-context plan reject / request-changes / edit-node affordances in the control
  room (A-33) — the editable-control-plane routes exist but aren't surfaced.
- A dedicated **auth/quota gate** distinct from `leaf_validation_failed` (F-027):
  a 401/usage-limit mid-run should ask the human to re-auth, not look like a code
  failure.

**Reliability:**
- Per-threadId checkpointer lock (F-011) + `fsync` durability fence (F-012).
- Guard `deliver` on terminal status + inactive runner (A-01); make the
  active-runner claim atomic on all pipeline-starting paths (A-22/A-23).
- `cleanupWorktrees`/cherry-pick-state recovery so an aborted integration can't
  strand a worktree in `CHERRY_PICK_HEAD` (F-022).

**Agent performance:**
- Codex usage/cost parsing so budget gates govern both executors (A-04).
- Decide whether the grounding skeleton should commit to a run branch instead of
  the base repo's master (O-6) — currently it advances the user's master.

**Engineering maturity:**
- CI (test/typecheck/build/lint on PR).
- One logging abstraction with run-id correlation; consolidate the three event
  vocabularies behind one source of truth.

---

## 10. Architecture risks (ranked)

1. **Unguarded `deliver` destructive ops (A-01).** Can merge/discard/**cleanup
   worktrees+branches** while the run is still `running` → corrupt an in-flight
   integration. Highest concrete corruption vector; cheapest high-value fix.
2. **Non-atomic active-runner checks + silent runner-race no-op (A-22/A-23).** A
   lost runner race after a gate claim leaves a `running` run with no driver until
   the 10-min stale sweep — the exact "stuck run" class the rest of the code
   prevents.
3. **Planning reports executable-validity it never checked (A-09).** Producer↔
   consumer seam errors aren't caught at decomposition; only downstream callers
   catch them, after a plan is presented as valid.
4. **Five safety/observability events silently dropped by the UI (A-30).** Cancel
   survivors, corrupt-checkpoint re-runs, and reconciliation are invisible — the
   operator can't tell the system recovered, re-ran work, or orphaned processes.
5. **Scheduler O-7 relaxation can under-serialize a real content collision
   (A-05).** The recently-shipped throughput fix has no red test for the
   genuinely-conflicting case; correctness now leans on the composer/repair net.
6. **`repo.save()` outside the lock clobbers heartbeats (A-25)** → spurious
   `interrupted` from the stale sweep.
7. **Checkpointer concurrency/durability (F-011/F-012).** Parallel leaves at a
   gate can lose checkpoint writes; torn writes on power loss.
8. **Codex budget blind spot (A-04).** A stated control-room guarantee (budget
   gates) is unenforceable on the alternative executor.

---

## 11. Code quality risks (ranked)

1. **`as unknown as TaskGraph` ×6** — disables compiler checks on the central
   object (`plan-review.ts`, `patches.ts`, `editing.ts`). Unify the snapshot↔graph
   type with one adapter.
2. **`@manyhands/core` legacy barrel, 13 importers** — the biggest "legacy"
   footprint; blocks retiring a whole package.
3. **`any` on the planning critical path** — 8 of 13 `any` + the lone `as any` in
   the recursive decomposer adapters.
4. **17 god files >600 LOC** — `decomposer/index.ts` (1561, mixes schemas + 5
   classes + barrel), `recursive-decomposer.ts` (1523), `executor.ts` (1418),
   `execution-pipeline.ts` (1231), `integration/agent.ts` (1015). Extract cohesive
   units (e.g. mocks → `mocks/`).
5. **Duplicated logic** — TS `parseDiagnostics` internal-API cast copy-pasted in
   `syntax-check.ts` and `skeleton-scaffolder.ts`; an inline `git()` helper
   redefined in 10 test files (move to `tests/helpers/`).
6. **Two `pairKey` implementations** (shared vs scheduler-local) — consistent today,
   latent footgun.
7. **Mojibake / single-line packed template comments** in `decomposer/index.ts`.

Positives worth stating: **zero TODO/FIXME/HACK** in non-`.d.ts` source; only one
truly empty `catch` (an acceptable inline theme script); the ~20 comment-only
catches all carry an explicit best-effort rationale.

---

## 12. Testing and observability gaps

**Testing (genuinely high discipline — invariants codified as INV-4, INV-7,
I1–I6, O-7, F-013, with adversarial edge cases):**
- **Thin for their size:** `conflict-risk` (865 LOC, **no dedicated test**),
  `repository-index` (no dedicated test), `scheduler` (2 files for a 956-LOC
  package).
- **Untested invariants:** `dependency_sync_divergence` + the sync helpers;
  `reconstructGraph` equivalence vs `decompose`; recursive-decomposer rejection of
  a cross-branch/inherited-interface orphan *at decomposition time* (the existing
  nested-interface test calls `validateExecutableTaskGraph` manually — which
  actually demonstrates A-09); `getTopologicalOrder`; the accept-policy
  artifact-filter branch (A-02); the genuinely-conflicting O-7 case (A-05);
  `worktree_clean_failed`/failure-edge trace events firing on a failed run.
- **No parity tests** between the live trace path and the reload projection (A-15/
  A-16) — exactly where the UI diverges.
- **Always-skipped on this box:** `execution-core-kill-verify.test.ts:105`
  (`skipIf win32`) — POSIX process-group kill is never exercised on the Windows dev
  machine; worth a Linux CI lane.

**Observability:**
- The backend signal is rich and durable (trace store embedded in snapshot, jsonl
  replayable, structured exec logger). The failure is **delivery to the operator**
  (A-30/A-31/A-34) and **correlation** (no run-id in log prefixes; three event
  vocabularies). A failed run is mostly diagnosable from artifacts, but the human
  watching live can't see why.
- Console completeness on reload silently depends on best-effort append success
  (`node.cli.output` is never re-projected from `RunRecord` — A-29).

---

## 13. Recommended roadmap

**Pass 1 — Immediate hardening (low risk, high safety, days):**
- Guard `deliver` on terminal status + inactive runner (A-01).
- Make the active-runner rejection atomic in `clearExecutionPause`; drop the
  pre-claim `isRunnerActive` checks; make a lost runner-race recoverable, not
  silent (A-22/A-23).
- Switch the node-execution `repo.save()` to `repo.update` (A-25).
- Add `assertRunActionAllowed` to the `answer` planning path; gate plan-edit patch
  routes by status (A-26/A-27).
- Stand up CI (test/typecheck/build/lint, incl. a Linux lane for the win32-skipped
  kill test).

**Pass 2 — Next product-quality pass (trust & legibility, 1–2 weeks):**
- Surface the 5 dropped events as a recovery/notice strip + per-node "why blocked"
  from the scheduling audit (A-30).
- Wire predicted risk into "Riesgos" (A-31); attach `diagnosis://` to failed
  composites (A-34); per-leaf terminal events (A-15).
- In-context plan reject / edit-node affordances (A-33); a dedicated auth/quota
  gate (F-027).

**Pass 3 — Frontier architecture pass (correctness & coherence, 2–4 weeks):**
- Run `validateExecutableTaskGraph` inside `decompose()` and stop asserting
  `contractValid:true` blindly (A-09); validate `reconstructGraph` / share one
  builder (A-10).
- Unify the snapshot↔`TaskGraph` type (kill the 6× cast); retire `@manyhands/core`.
- Consolidate the three event vocabularies behind one source of truth; introduce a
  run-id-correlated logger; delete the divergent SSE-adapter bridge.
- Harden the scheduler O-7 relaxation with a red test + re-export corroboration
  (A-05/A-06); per-threadId checkpointer lock + fsync (F-011/F-012).
- Codex usage/cost parsing for budget enforcement (A-04).

**Pass 4 — Optional research/quality-measurement pass:** only after the product is
stable, design a *fresh* quality-measurement approach (no Lab Mode / replay /
thesis manifests — explicitly out of scope per `DECISIONS.md`). The required
`wave_selected` events + checkpoints already provide a durable substrate for it.

---

## 14. Top 10 highest-leverage changes

| # | Change | Why it matters | Impacted files | Effort | Risk | Verification |
|---|--------|----------------|----------------|--------|------|--------------|
| 1 | **Guard `deliver` on terminal status + inactive runner** | Closes the most direct corruption/worktree-leak vector (destructive merge/cleanup mid-run) | `deliver/route.ts`, `lifecycle.ts`, `delivery.ts` | S | Low | Red test: `deliver` on `running` → 409; passes on terminal |
| 2 | **Stand up CI** (test/typecheck/build/lint, +Linux lane) | 1255 tests gate nothing on PR; trust product needs an automated gate; runs the win32-skipped kill test | `.github/workflows/*` | S | Low | PR shows green checks; kill-verify runs on Linux |
| 3 | **Atomic active-runner claim + recoverable runner-race** | Eliminates the silent "running with no driver" stuck-run class | `execution-host.ts` (`clearExecutionPause`), `execution-pipeline.ts:161/571/724`, `resume`/`decisions`/`fork` routes, `execution-gate-service.ts` | M | Med | `resume-route-concurrency` + new race test; no run left `running` without a runner |
| 4 | **Validate executable graph at decomposition** | Stops shipping plans reported `contractValid:true` with unchecked producer↔consumer seams | `recursive-decomposer.ts:306/367-493`, `task-graph` | M | Med | Red test: cross-branch orphan seam fails `decompose()`; existing recursive suite stays green |
| 5 | **Surface the 5 dropped events + scheduling "why blocked"** | The richest safety/observability data is invisible; directly fixes trust | `reducer.ts:412`, `selectors.ts`, new `selectRecoveryNotices`, `workspace-view.ts`, decision-channel/notice components | M | Low | Reducer tests for the 5 types; UI test asserts notice strip + per-node blocked reason |
| 6 | **Unify snapshot↔`TaskGraph` type (kill 6× `as unknown as`)** | Restores compiler safety on the central object; prevents silent schema drift | `plan-review.ts`, `patches.ts`, `editing.ts`, a new typed adapter | M | Low | Typecheck clean with casts removed; round-trip adapter test |
| 7 | **Per-leaf terminal events (live progress truth)** | Live UI shows nodes stuck "Verificando" then snaps; under-represents progress on every run | `execution-pipeline.ts:936-958`, `run-model-trace-adapter.ts:82-101` | M | Med | Parity test: live event stream folds to same per-node states as reload projection |
| 8 | **Artifact-filter the accept-policy commit range** | Re-opens the exact `node_modules` regression on the accept path | `result/recorder.ts:152-177` | S | Low | Red test: accept-range commit touching `node_modules` is rejected |
| 9 | **Retire `@manyhands/core` barrel (13 importers)** | Biggest legacy footprint; unblocks package retirement | the 13 `apps/web/src` files | M | Low | Imports point at specific packages; typecheck + tests green; `core` unreferenced |
| 10 | **Codex usage/cost parsing for budget gates** | Budget control (a stated guarantee) is unenforceable on the alternative executor | `executor/profiles/codex.ts`, `executor/registry.ts:83` | M | Med | Test: a Codex run reports non-zero usage; budget gate fires |

(Strong runners-up: harden scheduler O-7 with a red test (A-05); per-threadId
checkpointer lock + fsync (F-011/F-012); dedicated auth/quota gate (F-027);
in-context plan reject/edit (A-33).)

---

## 15. Open questions (need human/product clarification)

1. **Grounding → master (O-6):** should the deterministic walking-skeleton commit
   to the run branch instead of advancing the base repo's `master`? On a real user
   repo this writes a "scaffolded by ManyHands" commit to their default branch.
2. **Allow-list scope is advisory by design.** Confirmed intentional (worktree +
   forbidden + cherry-pick are the real net), but it means an off-spec agent that
   writes outside its declared paths still passes. Is a stricter "must match
   declared scope" mode wanted for high-stakes runs?
3. **Reducer forward-compat tolerance (F-014..F-017):** orphan/unknown events
   advance the cursor silently. Documented as deliberate. Do you want an audit
   channel for genuinely-corrupt events, or keep pure forward-compat?
4. **O-7 relaxation policy (A-05/A-06):** should coordination-file relaxation
   require re-export-like evidence (e.g. an `index.ts` barrel) rather than any
   ≥3-shared extension-bearing path? And should the threshold count over the plan,
   not the momentary frontier?
5. **Is the SSE-adapter / legacy `RunSnapshot` bridge still a production path?** If
   not, deleting it removes the live-vs-reload divergence (A-16) by construction.
6. **`O-11` (`spawn cmd.exe ENOENT`)** in final run-validation on Windows — real
   runner/COMSPEC bug or an artifact of the preview-launched server env? Needs
   isolation on a clean Windows run.
7. **Codex planning sandbox (A-20):** confirm planning must be read-only and switch
   the Codex adapter to a read-only sandbox mode (the Claude adapter already uses
   `--permission-mode plan`).

---

### Appendix — invariant verification summary

| Invariant | Verdict | Proof |
|---|---|---|
| `git diff HEAD` is truth, not stdout | ✅ Holds | `recorder.ts:183`, `process.ts:52` |
| Agents never commit; unexpected detected+recorded | ✅ Holds | `recorder.ts:127`; test `:329` |
| Isolation = worktree + ScopeChecker; forbidden hard-fail | ✅ Holds (allow-list advisory by design) | `scope/checker.ts:42` |
| Bottom-up cherry-pick + repair; parent validation gates | ✅ Holds | `integration/agent.ts:382`; test `integration:846` |
| Default executor Claude Code CLI; Codex alternative | ✅ Holds | `registry.ts:127` |
| `graph.dependencies` canonical for scheduling | ✅ Holds | `scheduler/index.ts:510`; `execution-nodes.ts:137` |
| Missing safety data → conservative serialize + warn | ✅ Holds | `scheduler/index.ts:370-391` |
| Resume/fork reconstruct from RunRecord/checkpoint | ✅ Holds (gate-resume skips reconcile — A-17) | `execution-host.ts:184-198` |
| Lifecycle via `assertRunActionAllowed` | ⚠ Mostly | gaps A-01 (deliver), A-26 (answer planning), A-27 (patches) |
| `gated` derived from pending decisions | ✅ Holds | `selectors.ts:308` |
| Start uses CAS/active-runner guard | ⚠ Atomic for start/restart; non-atomic for resume/fork/decisions | A-22/A-23 |
| Audited critical status mutations | ✅ Holds | `audited-mutation.ts` |
| `goal` canonical, not `intent` | ✅ Clean | decomposer/contracts/task-graph |

*End of audit. No files other than this report were created; no source was modified.*
