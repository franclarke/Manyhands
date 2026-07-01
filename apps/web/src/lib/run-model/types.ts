/**
 * Run operative model — v1 conceptual types.
 *
 * Source of truth: `docs/design/run-operative-model.md` (frozen, refinements A–P).
 * This module is PURE TYPES + a few `const` vocabularies. No runtime logic, no
 * React, no backend imports — it must stay reducible/testable in isolation
 * (PR 02 of `docs/design/implementation-plan.md`).
 *
 * Frozen decisions honoured here:
 *  - `RunEvent` is the dynamic source of truth (envelope: seq/at/runId/actor/type/payload).
 *  - `ExecutionState` does NOT include `stale` — freshness is a derived, orthogonal axis.
 *  - There is NO `node.invalidated` event — invalidation is derived from seam revision.
 *  - `Seam` carries `revision`, `signature` and optional `contract`.
 *  - `node.verify.passed` / `integration.validated` can record `builtAgainst`.
 *  - `Decision.choice` is structured, never a free string.
 *  - `Conflict` has `dimension`, `status`, `diagnosisRef` and optional `seamId`.
 *  - `Amendment` has `changeKind`, `fromRevision`, `toRevision`, `affects`.
 *  - `Evidence` may include `invalidationTrace`.
 *  - Heavy artifacts (diffs/logs) are referenced via `*Ref`, never embedded.
 *
 * NAMING COLLISION (deliberate, do NOT resolve here): the backend already defines
 * a `RunEvent` in `apps/web/src/lib/server/runs/events.ts` — a flat, kind-based SSE
 * union with no `seq`/`actor`/`payload`. That type is UNRELATED to this envelope.
 * This module never imports it. The legacy rename (`RunEvent` → `StreamEvent`) and
 * the SSE→RunEvent adapter belong to PR 11; do not touch the backend here.
 */

// ── Identifiers & primitives ───────────────────────────────────────────────
// Plain aliases for readability (not nominal/branded in v1).

export type RunId = string;
export type NodeId = string;
export type SeamId = string;
export type WaveId = string;
export type DecisionId = string;
export type ConflictId = string;
export type AmendmentId = string;

/** ISO-8601 timestamp. */
export type IsoTimestamp = string;

/** Opaque reference to a heavy artifact resolved on demand (diff/log/diagnosis). */
export type BlobRef = string;

/** Who originated an event. */
export type Actor = "system" | "agent" | "human";

// ── Shared value objects ────────────────────────────────────────────────────

/** Mirrors the app's executor selection shape without coupling to its module. */
export interface ExecutorSelection {
  executorId: string;
  model: string;
}

export type Aggressiveness = "low" | "medium" | "high";
export type Readiness = "ok" | "warning" | "error";
export type RunOutcome = "success" | "failed" | "interrupted";
export type RunControlStatus =
  | "created"
  | "generating"
  | "paused"
  | "needs_review"
  | "approved"
  | "running"
  | "completed"
  | "completed_with_accepted"
  | "failed"
  | "interrupted";
export type RunControlPendingHumanAction = "none" | "question" | "decision";

export interface RunConfig {
  aggressiveness: Aggressiveness;
  planningModel: string;
  executionSelection: ExecutorSelection;
  repairSelection: ExecutorSelection;
}

export interface RunContext {
  repo: string;
  baseCommit: string;
  readiness: Readiness;
}

export interface RunControl {
  status: RunControlStatus;
  version: number;
  pendingHumanAction: RunControlPendingHumanAction;
  updatedAt: IsoTimestamp;
  pausedDuring?: "generating" | "running";
  interruptedDuring?: "generating" | "running";
}

/** A node's result is valid against these seam revisions (enables derived invalidation). */
export interface SeamRevisionRef {
  seamId: SeamId;
  revision: number;
}

export interface TestSummary {
  pass: number;
  total: number;
}

// ── Run ──────────────────────────────────────────────────────────────────────
// Identity + config = a record (provided at store init), NOT event-sourced.

export interface Run {
  id: RunId;
  intent: string;
  workspaceId: string;
  config: RunConfig;
  control: RunControl;
  context?: RunContext;
  /** Pointer to the materialized snapshot (a fold cache, not a second source of truth). */
  snapshotRef?: BlobRef;
}

// ── Node & execution ──────────────────────────────────────────────────────────

export type NodeRole = "root" | "composite" | "leaf";

export type BuildStatus = "pending" | "pass" | "fail";

export interface VerifyLoop {
  iteration: number;
  maxIterations: number;
  build: BuildStatus;
  testsPass: number;
  testsTotal: number;
}

/**
 * Lifecycle of a node. DERIVED from the fold of `node.*` / `integration.*` events.
 * Intentionally has NO `stale` member — staleness is a separate derived axis
 * (`Freshness`), because a node can be e.g. `integrated` AND stale at once.
 */
export const EXECUTION_STATE_KINDS = [
  "idle",
  "blocked",
  "grounding",
  "running",
  "verifying",
  "integrated",
  "failed"
] as const;
export type ExecutionStateKind = (typeof EXECUTION_STATE_KINDS)[number];

export type ExecutionState =
  | { kind: "idle" }
  | { kind: "blocked"; waitingOn: Array<NodeId | SeamId | DecisionId> }
  | { kind: "grounding" }
  | { kind: "running"; agent: string; model: string }
  | { kind: "verifying"; loop: VerifyLoop }
  | { kind: "integrated"; commit: string }
  | { kind: "failed"; cause: string };

export interface Node {
  id: NodeId;
  parentId: NodeId | null;
  role: NodeRole;
  title: string;
  goal: string;
  depth: number;
  /** `guessed` during Proposal, `derived` once Foundation extracts real paths. */
  scope: { paths: string[]; origin: "guessed" | "derived" };
  produces: SeamId[];
  consumes: SeamId[];
  /** Derived from events — never set imperatively. */
  execution: ExecutionState;
  /**
   * Seam revisions the node's latest successful result was built against
   * (set by `node.verify.passed` for leaves, `integration.validated` for
   * composites). This is the freshness INPUT read by `selectFreshness` (PR 05) —
   * it is recorded data, not derived state. Undefined until the first success.
   */
  builtAgainst?: SeamRevisionRef[];
  /** For a producer leaf: the seam revision its latest result produces
   *  (from `node.verify.passed.produces`). */
  producedRevision?: SeamRevisionRef;
  /**
   * Files the node's latest successful result changed (from `node.verify.passed`).
   * Recorded data (not derived); undefined until the first success. Surfaced by the
   * focus view-model as on-demand depth — never used to decide a node's display.
   */
  changedFiles?: string[];
  /**
   * Latest planning (graph-generation) telemetry for this node, from `plan.node.status`.
   * An ORTHOGONAL axis (like `freshness`): it records HOW the planner arrived at the
   * node (clean / retried / fell back / failed), NOT the node's execution lifecycle.
   * It must NEVER drive `execution`/`display` (a `fallback` node is still a normal
   * proposed leaf to execute) and a planning retry is autonomous — never human
   * attention. Recorded data; undefined when the planner produced the node cleanly
   * on the first attempt (the common case). See `selectPlanningHealth` (PR 05).
   */
  planning?: NodePlanningStatus;
}

// ── Planning health (graph-generation telemetry — orthogonal to execution) ──────

/**
 * Lifecycle of a single recursive planning step, mirroring the engine's
 * `RecursiveStepPlanningState` (`packages/decomposer`). `retrying`/`failed`/
 * `fallback` are the CONCERNS the agent-first model surfaces; `generating`
 * (in-flight) and `generated` (planned cleanly, possibly after a recovered retry)
 * are normal and read as clean by `selectPlanningHealth`.
 */
export type PlanningState = "generating" | "generated" | "retrying" | "failed" | "fallback";

export interface NodePlanningStatus {
  state: PlanningState;
  /** 1-based attempt index when the state was recorded. */
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  /** Classified failure kind from `GraphGenerationErrorDetails` (e.g. `missing_json`). */
  errorKind?: string;
  errorMessage?: string;
}

// ── Seam ───────────────────────────────────────────────────────────────────
// The contract between nodes; what makes safe parallelism possible.

export type SeamState = "draft" | "frozen" | "amended";

export interface Seam {
  id: SeamId;
  name: string;
  producerNodeId: NodeId;
  consumerNodeIds: NodeId[];
  /** Syntax (types). `contract` carries the semantics that the signature can't. */
  signature: { draft: string; frozen?: string; extractedFrom?: string };
  /** Semantic notes beyond the type, e.g. { "duration.unit": "ms" }. */
  contract?: Record<string, string>;
  /** 1 on freeze; +1 on every `seam.amended`. Drives derived invalidation. */
  revision: number;
  state: SeamState;
  /**
   * The `changeKind` of the latest amendment (set by `seam.amended`). Read by
   * `selectFreshness`: a **signature** change breaks consumers (they derive as
   * stale); a **contract** change enriches semantics and does NOT invalidate
   * consumers by itself. Undefined until the seam is amended.
   */
  lastChangeKind?: AmendmentChangeKind;
}

// ── Wave ──────────────────────────────────────────────────────────────────────
// Membership is emitted as an event; the live wavefront is DERIVED from node state.

export interface WavePlan {
  waveId: WaveId;
  index: number;
  nodeIds: NodeId[];
  unlockedBySeams: SeamId[];
}

export interface Wave {
  id: WaveId;
  index: number;
  nodeIds: NodeId[];
  unlockedBySeams: SeamId[];
  opened?: boolean;
  closed?: boolean;
}

// ── Decision ─────────────────────────────────────────────────────────────────
// Unified resource for every human intervention.

export const DECISION_KINDS = [
  "approve_plan",
  "clarify",
  "resolve_conflict",
  "approve_amendment",
  "approve_merge"
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** Structured choice — never a free string. */
export type DecisionChoice =
  | { action: "approve" | "reject" | "accept" }
  | { resolutionId: string }
  | { answer: string };

export interface DecisionContext {
  nodeIds?: NodeId[];
  seamId?: SeamId;
  conflictId?: ConflictId;
  amendmentId?: AmendmentId;
  question?: string;
  options?: string[];
  diffRef?: BlobRef;
  /**
   * Set when the clarify decision is an execution gate (leaf_validation_failed,
   * merge_conflict, budget_exceeded) rather than a planner question — the UI
   * renders gate options and phase-aware copy from this. Additive: older
   * events simply lack it.
   */
  gate?: string;
}

export type DecisionStatus = "pending" | "resolved";

export interface Decision {
  id: DecisionId;
  kind: DecisionKind;
  /** Blocks the dependent subtree (not the whole run) when true. */
  blocking: boolean;
  context: DecisionContext;
  status: DecisionStatus;
  resolution?: { choice: DecisionChoice; actor: "human"; at: IsoTimestamp };
}

// ── Conflict ──────────────────────────────────────────────────────────────────

export const CONFLICT_DIMENSIONS = ["textual", "interface", "behavioral", "structural"] as const;
export type ConflictDimension = (typeof CONFLICT_DIMENSIONS)[number];

export const CONFLICT_STATUSES = ["detected", "decided", "resolved"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export interface Conflict {
  id: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  nodeIds: NodeId[];
  seamId?: SeamId;
  files: string[];
  autoResolvable: boolean;
  /** Two interpretations, failing assertion, candidate resolutions + blast radius. */
  diagnosisRef: BlobRef;
  resolution?: { by: "system" | "human"; resolutionId: string };
}

// ── Amendment ─────────────────────────────────────────────────────────────────
// The living plan in action.

export type AmendmentKind = "scope" | "seam";
export type AmendmentChangeKind = "contract" | "signature";

export interface AmendmentDetail {
  seamId?: SeamId;
  fromRevision?: number;
  toRevision?: number;
  newSignature?: string;
  contract?: Record<string, string>;
  paths?: string[];
}

export type AmendmentStatus = "proposed" | "applied";

export interface Amendment {
  id: AmendmentId;
  nodeId: NodeId;
  kind: AmendmentKind;
  /** `signature` breaks consumers (forces re-execution); `contract` enriches semantics. */
  changeKind: AmendmentChangeKind;
  detail: AmendmentDetail;
  /** Snapshot of the blast radius as-proposed (audit); the live blast is derived. */
  affects: NodeId[];
  status: AmendmentStatus;
}

// ── Evidence ──────────────────────────────────────────────────────────────────

export interface InvalidationTraceEntry {
  seamId: SeamId;
  from: number;
  to: number;
  cause: string;
  reExecuted: NodeId[];
  reIntegrated: NodeId[];
  preserved: NodeId[];
}

export interface Evidence {
  aggregateDiffRef: BlobRef;
  tests: TestSummary;
  narrativeRef: BlobRef;
  integrationCommit: string;
  invalidationTrace?: InvalidationTraceEntry[];
}

// ── Run metrics (legacy GranularityVector name) ───────────────────

/**
 * The run's `GranularityVector` made visible in the agent-first model. Mirrors the
 * field names of `computeGranularityVector` (packages/execution-core/granularity)
 * EXACTLY so wiring the real backend later is a mechanical assignment — this module
 * stays pure and does NOT import execution-core. The legacy schema tracks
 * pre-execution DAG structure plus post-execution outcomes; `estimatedTokensPerLeaf`/`totalCostUsd`/
 * `testsPassedRate` are optional. Rates are 0–1. Recorded data (from
 * `run.metrics.ready`); never derived, never gates the run.
 */
export interface GranularityMetrics {
  // pre-execution — DAG structure
  depth: number;
  leafCount: number;
  compositeCount: number;
  avgLeafDepth: number;
  maxLeafDepth: number;
  dependencyCount: number;
  avgAcceptanceCriteriaPerLeaf: number;
  estimatedTokensPerLeaf?: number;
  // post-execution — outcomes
  integrationSuccessRate: number;
  leafSuccessRate: number;
  conflictRate: number;
  totalDurationMs: number;
  linesChanged: number;
  unexpectedCommitCount: number;
  scopeViolationCount: number;
  totalCostUsd?: number;
  testsPassedRate?: number;
}

// ── Derived view types (prepared for the selector layer, PR 05) ────────────────

export type Freshness = "fresh" | "stale";

/** The lifecycle center-of-gravity of a whole run (derived by `selectPhase`). */
export type RunPhase =
  | "framing"
  | "proposal"
  | "foundation"
  | "supervision"
  | "reconciliation"
  | "disposition";

/** Overall run health (derived by `selectHealth`). */
export type RunHealth = "failing" | "attention" | "working" | "settled";

/**
 * Per-composite reconciliation progress (derived by `selectIntegrationProgress`):
 * `integrated`/`failed` from the composite's execution; `ready` when every child is
 * integrated but the composite is not yet (integration imminent / in progress);
 * `pending` otherwise. Derived from existing node state — needs no new backend event.
 */
export type IntegrationState = "pending" | "ready" | "integrated" | "failed";
export interface CompositeIntegration {
  id: NodeId;
  state: IntegrationState;
  childIds: NodeId[];
  doneChildCount: number;
  totalChildCount: number;
}

/**
 * Derived summary of graph-generation robustness (by `selectPlanningHealth`).
 * Reports which nodes the planner had to retry / fall back / failed to plan.
 * `clean` means no node carries a non-`generating` planning concern. This is a
 * diagnostic / audit axis — it never gates the run and never enters the decision
 * channel (planning retries/repair are autonomous, not human attention).
 */
export interface PlanningHealth {
  retrying: NodeId[];
  fallback: NodeId[];
  failed: NodeId[];
  clean: boolean;
}

/** The single conceptual state the UI paints a node with (derived). */
export type NodeDisplay =
  | "idle"
  | "blocked"
  | "running"
  | "verifying"
  | "gated"
  | "done"
  | "failed"
  | "obsolete";

/**
 * What the node card renders. Produced by `selectRenderableNodeState` (PR 05),
 * which guarantees an `integrated` + `stale` node renders as `obsolete` (never a
 * plain "done"). `display` is the ONLY thing the UI needs to paint a node — it
 * must never read `execution.kind` directly. The other fields are extra context.
 */
export interface RenderableNodeState {
  display: NodeDisplay;
  lifecycle: ExecutionStateKind;
  freshness: Freshness;
  obsolete: boolean;
  verify?: VerifyLoop;
}

// ── RunModel (the normalized fold target; built by the reducer in PR 04) ───────

export interface RunModel {
  /** Identity/config — seeded from the Run record at store init, not from events. */
  run: Run;
  nodes: Map<NodeId, Node>;
  seams: Map<SeamId, Seam>;
  waves: Map<WaveId, Wave>;
  /** Recorded scheduling audit selections by wave index. */
  schedulingWaves: Map<number, RunSchedulingWaveSelectedPayload>;
  conflicts: Map<ConflictId, Conflict>;
  decisions: Map<DecisionId, Decision>;
  amendments: Map<AmendmentId, Amendment>;
  evidence?: Evidence;
  /** The run's granularity metrics (from `run.metrics.ready`); a fold cache, not derived. */
  metrics?: GranularityMetrics;
  /** Last applied `seq` (idempotency / append-only cursor). */
  cursor: number;
}

// ── Event payloads (v1) ────────────────────────────────────────────────────
// Conceptual minimums from run-operative-model.md §3. Heavy data via *Ref only.

export type EmptyPayload = Record<string, never>;

export interface RunCreatedPayload {
  intent: string;
  workspaceId: string;
  config: RunConfig;
}
export interface RunContextResolvedPayload {
  repo: string;
  baseCommit: string;
  readiness: Readiness;
}

export interface PlanNodeProposedPayload {
  nodeId: NodeId;
  parentId: NodeId | null;
  role: NodeRole;
  title: string;
  goal: string;
  depth: number;
}
export interface PlanNodeStatusPayload {
  nodeId: NodeId;
  state: PlanningState;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
  errorKind?: string;
  errorMessage?: string;
}
export interface PlanSeamProposedPayload {
  seamId: SeamId;
  name: string;
  producerNodeId: NodeId;
  consumerNodeIds: NodeId[];
  draftSignature: string;
}
export interface PlanReadyPayload {
  rootId: NodeId;
  nodeCount: number;
  seamCount: number;
  criticFindings: string[];
}

export interface SkeletonFileCommittedPayload {
  path: string;
  kind: string;
}
export interface SeamFrozenPayload {
  seamId: SeamId;
  revision: number;
  frozenSignature: string;
  extractedFrom: string;
}
export interface ScopeDerivedPayload {
  nodeId: NodeId;
  paths: string[];
}
export interface WavePlannedPayload {
  waves: WavePlan[];
}
export interface GroundingCompletedPayload {
  skeletonCommit: string;
}

export interface WaveOpenedPayload {
  waveId: WaveId;
  nodeIds: NodeId[];
}
export interface WaveClosedPayload {
  waveId: WaveId;
}
export interface NodeExecutionStartedPayload {
  nodeId: NodeId;
  agent: string;
  model: string;
  /** Set on re-execution (amendment/stale repair). */
  reason?: string;
}
export interface NodeVerifyIterationPayload {
  nodeId: NodeId;
  iteration: number;
  maxIterations: number;
  build: BuildStatus;
  testsPass: number;
  testsTotal: number;
}
export interface NodeVerifyPassedPayload {
  nodeId: NodeId;
  commit: string;
  changedFiles: string[];
  /** Seam revisions this result is valid against (enables derived invalidation). */
  builtAgainst: SeamRevisionRef[];
  /** For a producer: the revision it produces. */
  produces?: SeamRevisionRef;
}
export interface NodeVerifyFailedPayload {
  nodeId: NodeId;
  iteration: number;
  cause: string;
}
export interface NodeRepairStartedPayload {
  nodeId: NodeId;
  reason: string;
}
export interface NodeExecutionFailedPayload {
  nodeId: NodeId;
  cause: string;
}
export interface NodeCliOutputPayload {
  nodeId: NodeId;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface AmendmentProposedPayload {
  amendmentId: AmendmentId;
  nodeId: NodeId;
  kind: AmendmentKind;
  changeKind: AmendmentChangeKind;
  detail: AmendmentDetail;
  affects: NodeId[];
  diagnosisRef?: BlobRef;
}
export interface SeamAmendedPayload {
  seamId: SeamId;
  revision: number;
  changeKind: AmendmentChangeKind;
  signature?: string;
  contract?: Record<string, string>;
}
export interface AmendmentAppliedPayload {
  amendmentId: AmendmentId;
}

export interface IntegrationStartedPayload {
  compositeNodeId: NodeId;
  childNodeIds: NodeId[];
}
export interface ConflictDetectedPayload {
  conflictId: ConflictId;
  dimension: ConflictDimension;
  status: ConflictStatus;
  nodeIds: NodeId[];
  seamId?: SeamId;
  files: string[];
  autoResolvable: boolean;
  diagnosisRef: BlobRef;
}
export interface ConflictResolvedPayload {
  conflictId: ConflictId;
  by: "system" | "human";
  resolutionId: string;
}
export interface IntegrationValidatedPayload {
  compositeNodeId: NodeId;
  testsPass: number;
  testsTotal: number;
  passed: boolean;
  builtAgainst?: SeamRevisionRef[];
  failuresRef?: BlobRef;
}
export interface IntegrationCompletedPayload {
  compositeNodeId: NodeId;
  commit: string;
  status: string;
}

export interface RunEvidenceReadyPayload {
  aggregateDiffRef: BlobRef;
  tests: TestSummary;
  narrativeRef: BlobRef;
  integrationCommit: string;
  invalidationTrace?: InvalidationTraceEntry[];
}
export interface RunMetricsReadyPayload {
  metrics: GranularityMetrics;
}
export interface RunCompletedPayload {
  status: RunOutcome;
}

export interface RunStatusChangedPayload {
  status: RunControlStatus;
  version: number;
  pendingHumanAction: RunControlPendingHumanAction;
  updatedAt: IsoTimestamp;
  pausedDuring?: "generating" | "running";
  interruptedDuring?: "generating" | "running";
}
/**
 * Audited cancellation (INV-2/INV-6): emitted by the cancel endpoint AFTER the
 * run's process trees were force-killed and verified, with the kill and
 * worktree-GC inventory. `survivors` non-empty means a tree outlived the
 * verified kill and the user must be warned.
 */
export interface RunCancelledPayload {
  killedProcesses: number;
  escalatedKills: number;
  survivors: number[];
  cleanedWorktrees: string[];
  gcFailures: string[];
}

/**
 * Cold-restart reconciliation (INV-3): physical world vs. recorded state.
 * Emitted before re-entering the execution graph; `invalidatedTaskIds` re-run.
 */
export interface WorldReconciledPayload {
  baseCommitReachable: boolean;
  keptTaskIds: string[];
  invalidatedTaskIds: string[];
  cleanedWorktrees: string[];
  gcFailures: string[];
  removedLocks: string[];
  warnings: string[];
}
/** latest.json was corrupt; the resume used an older valid checkpoint. */
export interface CheckpointDegradedPayload {
  usedCheckpointId: string;
  corrupted: string[];
}
/** Every checkpoint of the thread is unreadable; execution re-enters from scratch. */
export interface CheckpointLostPayload {
  corrupted: string[];
}

export interface DecisionRaisedPayload {
  decisionId: DecisionId;
  kind: DecisionKind;
  blocking: boolean;
  context: DecisionContext;
}
export interface DecisionResolvedPayload {
  decisionId: DecisionId;
  choice: DecisionChoice;
  actor: "human";
}

export type SchedulingAuditPolicy = "sequential_dag" | "parallel_naive" | "risk_aware";
export type SchedulingAuditSource = "execution-host" | "run-executor";
export type SchedulingAuditRiskLevel = "low" | "medium" | "high" | "blocking";

export interface SchedulingAuditRiskSummary {
  low: number;
  medium: number;
  high: number;
  blocking: number;
}

export interface SchedulingAuditReason {
  taskId: NodeId;
  reason: string;
  relatedTaskIds: NodeId[];
  riskLevel?: SchedulingAuditRiskLevel;
}

export interface SchedulingAuditFallback {
  code: string;
  taskIds: NodeId[];
  message: string;
}

export interface RunSchedulingWaveSelectedPayload {
  version: 1;
  source: SchedulingAuditSource;
  waveIndex: number;
  policy: SchedulingAuditPolicy;
  readyTaskIds: NodeId[];
  selectedTaskIds: NodeId[];
  blockedTaskIds: NodeId[];
  blockedReasons: SchedulingAuditReason[];
  riskSummary: SchedulingAuditRiskSummary;
  fallbacks: SchedulingAuditFallback[];
  warnings: SchedulingAuditFallback[];
}

/**
 * Map of v1 event type → payload. The authoritative v1 vocabulary.
 * `RunEventType` is derived from this map's keys.
 */
export interface RunEventPayloads {
  // Framing
  "run.created": RunCreatedPayload;
  "run.context.resolved": RunContextResolvedPayload;
  // Proposal
  "plan.started": EmptyPayload;
  "plan.node.proposed": PlanNodeProposedPayload;
  "plan.node.status": PlanNodeStatusPayload;
  "plan.seam.proposed": PlanSeamProposedPayload;
  "plan.ready": PlanReadyPayload;
  // Foundation
  "grounding.started": EmptyPayload;
  "skeleton.file.committed": SkeletonFileCommittedPayload;
  "seam.frozen": SeamFrozenPayload;
  "scope.derived": ScopeDerivedPayload;
  "wave.planned": WavePlannedPayload;
  "grounding.completed": GroundingCompletedPayload;
  // Supervision
  "wave.opened": WaveOpenedPayload;
  "node.execution.started": NodeExecutionStartedPayload;
  "node.verify.iteration": NodeVerifyIterationPayload;
  "node.verify.passed": NodeVerifyPassedPayload;
  "node.verify.failed": NodeVerifyFailedPayload;
  "node.repair.started": NodeRepairStartedPayload;
  "node.execution.failed": NodeExecutionFailedPayload;
  "node.cli.output": NodeCliOutputPayload;
  "wave.closed": WaveClosedPayload;
  "amendment.proposed": AmendmentProposedPayload;
  "seam.amended": SeamAmendedPayload;
  "amendment.applied": AmendmentAppliedPayload;
  // Reconciliation
  "integration.started": IntegrationStartedPayload;
  "conflict.detected": ConflictDetectedPayload;
  "conflict.resolved": ConflictResolvedPayload;
  "integration.validated": IntegrationValidatedPayload;
  "integration.completed": IntegrationCompletedPayload;
  // Disposition
  "run.evidence.ready": RunEvidenceReadyPayload;
  "run.metrics.ready": RunMetricsReadyPayload;
  "run.completed": RunCompletedPayload;
  "run.status.changed": RunStatusChangedPayload;
  "run.scheduling.wave_selected": RunSchedulingWaveSelectedPayload;
  "run.cancelled": RunCancelledPayload;
  // Recovery (cold restart)
  "world.reconciled": WorldReconciledPayload;
  "checkpoint.degraded": CheckpointDegradedPayload;
  "checkpoint.lost": CheckpointLostPayload;
  // Cross-cutting (human decisions)
  "decision.raised": DecisionRaisedPayload;
  "decision.resolved": DecisionResolvedPayload;
}

/** Known v1 event types (the stable vocabulary). */
export type RunEventType = keyof RunEventPayloads;

/**
 * Runtime list of the v1 event types. Kept in sync with `RunEventPayloads` via the
 * `satisfies` guard below (a typo or stray type fails `web:typecheck`).
 */
export const RUN_EVENT_TYPES = [
  "run.created",
  "run.context.resolved",
  "plan.started",
  "plan.node.proposed",
  "plan.node.status",
  "plan.seam.proposed",
  "plan.ready",
  "grounding.started",
  "skeleton.file.committed",
  "seam.frozen",
  "scope.derived",
  "wave.planned",
  "grounding.completed",
  "wave.opened",
  "node.execution.started",
  "node.verify.iteration",
  "node.verify.passed",
  "node.verify.failed",
  "node.repair.started",
  "node.execution.failed",
  "node.cli.output",
  "wave.closed",
  "amendment.proposed",
  "seam.amended",
  "amendment.applied",
  "integration.started",
  "conflict.detected",
  "conflict.resolved",
  "integration.validated",
  "integration.completed",
  "run.evidence.ready",
  "run.metrics.ready",
  "run.completed",
  "run.status.changed",
  "run.scheduling.wave_selected",
  "run.cancelled",
  "world.reconciled",
  "checkpoint.degraded",
  "checkpoint.lost",
  "decision.raised",
  "decision.resolved"
] as const satisfies readonly RunEventType[];

/**
 * v2 event types — defined as known vocabulary but NOT emitted in v1 and without
 * payload interfaces yet. They do not block the demo. Payloads land in a later PR.
 */
export const RUN_EVENT_TYPES_V2 = [
  "plan.node.thinking",
  "plan.cli.output",
  "node.blocked",
  "integration.cherrypick",
  "conflict.repair.started",
  "integration.diagnosis.started",
  "run.accepted",
  "run.rejected"
] as const;
export type RunEventTypeV2 = (typeof RUN_EVENT_TYPES_V2)[number];

// ── RunEvent envelope ────────────────────────────────────────────────────────

/**
 * The append-only event envelope = dynamic source of truth.
 * `type` stays `string` for forward-compatibility (consumers ignore unknown
 * types); the known v1 vocabulary is `RunEventType` / `RUN_EVENT_TYPES`.
 */
export interface RunEvent {
  seq: number;
  at: IsoTimestamp;
  runId: RunId;
  actor: Actor;
  type: string;
  payload: Record<string, unknown>;
}

/** Typed authoring helper for fixtures/reducer: a `RunEvent` narrowed to a known type. */
export type RunEventOf<K extends RunEventType> = Omit<RunEvent, "type" | "payload"> & {
  type: K;
  payload: RunEventPayloads[K];
};

/** A fixture is just an ordered list of events; `playback` is fixture-only timing. */
export interface RunFixture {
  runId: RunId;
  events: RunEvent[];
  playback?: { delaysMs: number[] };
}
