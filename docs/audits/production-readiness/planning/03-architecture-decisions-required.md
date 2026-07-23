# 03 — Architecture Decision Records (ADRs)

**Target System**: ManyHands Monorepo (`apps/web`, `packages/*`)  
**Document Version**: 2.0.0  
**Status**: Formal Specification (Single-User Local Application Architecture)  
**Author**: Principal Engineering Review Board (Planning Worker 2)  
**Date**: 2026-07-22  

---

## Executive Overview

This document presents the seven foundational Architecture Decision Records (ADRs) required to resolve root cause audit findings, establish critical system invariants, and progress ManyHands through its Product Readiness Levels (Level A -> B -> C -> D) as a **Single-User, Self-Hosted Local Application**.

### Product Architecture Scope & Threat Model
ManyHands is designed strictly as a **Local Workstation Application** running on `127.0.0.1` / `::1`. It is **NOT** a SaaS, cloud multi-tenant platform, or enterprise hosted service.

- **Threat Model**: The local human user is **TRUSTED**. Cloned repositories, file names, symlinks, git hooks, scripts, external dependencies, prompt injection payloads, LLM completions, and agent-proposed commands are **UNTRUSTED** and must be strictly isolated and validated.
- **Web API Boundary**: Bound exclusively to local loopback with CSRF/Origin validation and native dialog local confirmation. Multi-tenant cloud authentication (OAuth2/SSO), RBAC, and multi-tenant DB isolation are categorized as `OUT_OF_SCOPE_SAAS`.

---

## ADR Index

| ADR ID | Title | Target Readiness Level | Status | Primary Audit Findings Addressed |
|---|---|---|---|---|
| **ADR-001** | Task Graph & Canonical Relations Revision Model | Level B | Approved | `MH-AUDIT-ORCH-001`, `MH-AUDIT-ORCH-002`, `MH-AUDIT-ORCH-003`, `MH-AUDIT-ORCH-004` |
| **ADR-002** | Worktree Isolation, Host Protection & Process Supervision | Level B | Approved | `MH-AUDIT-GIT-010`, `MH-AUDIT-SEC-001`, `MH-AUDIT-SEC-002`, `MH-AUDIT-GIT-001`, `MH-AUDIT-GIT-005`, `MH-AUDIT-GIT-007` |
| **ADR-003** | Persistence Engine & Atomic Event Store Recovery | Level B / Level C | Approved | `MH-AUDIT-PERS-001`, `MH-AUDIT-PERS-002`, `MH-AUDIT-PERS-004`, `MH-AUDIT-PERS-006`, `MH-AUDIT-QA-001`, `MH-AUDIT-GAP-001` |
| **ADR-004** | Execution Base Materialization & Input Fingerprinting | Level B | Approved | `MH-AUDIT-ORCH-003`, `MH-AUDIT-ORCH-004` |
| **ADR-005** | Event Stream (SSE), Local Reconnection & Web UI State Synchronization | Level C | Approved | `MH-AUDIT-API-001`, `MH-AUDIT-API-002`, `MH-AUDIT-API-006`, `MH-AUDIT-API-008` |
| **ADR-006** | LLM Guardrails, Prompt Injection & Token Budget Management | Level D | Approved | `MH-AUDIT-AI-001`, `MH-AUDIT-AI-002`, `MH-AUDIT-AI-003` |
| **ADR-007** | Supply Chain, Monorepo Hardening & Local Distribution | Level C / Level D | Approved | `MH-AUDIT-INFRA-001`, `MH-AUDIT-QA-003` |

---

## ADR-001: Task Graph & Canonical Relations Revision Model

### Status
**Approved** — Target for Readiness Level B (Secure Local Use)

### Context
The Production Readiness Audit identified major deficiencies in task graph validation and scheduling:
1. `validateGraphRevision` (`packages/task-graph/src/validate-v2.ts:44-88`) checked parent-child hierarchy cycles (`parentId`) but completely omitted consumer-producer cycle validation over `ArtifactRequirement` relations (`MH-AUDIT-ORCH-001`). As a result, circular artifact dependencies could be compiled and scheduled, causing indefinite worker hangs.
2. `selectReadyWaveV2` (`packages/scheduler/src/wave-selector-v2.ts:32-79`) evaluated node readiness but ignored `ConflictConstraint` records in `GraphRevision` (`MH-AUDIT-ORCH-002`), allowing conflicting nodes modifying overlapping resources to run in parallel.
3. `V2ExecutionDriver` mutated shared promise driver state concurrently without compare-and-swap protection (`MH-AUDIT-ORCH-003`).
4. Scope isolation critic over-restricted valid file edits (`MH-AUDIT-ORCH-004`).

### Decision
We adopt a unified **Canonical Typed Relations & Immutable GraphRevision Model**:

1. **Four Canonical Relations**:
   - `parentId`: Integration hierarchy and structural ownership.
   - `ArtifactRequirement`: Functional consumer-producer dependency (a node requires a materialized artifact produced by another node).
   - `SeamBinding`: Shared interface contracts between nodes without forcing execution ordering by itself.
   - `ConflictConstraint`: Resource exclusion signals (scheduling barrier to prevent parallel wave execution of conflicting nodes).

2. **Kahn's Algorithm Cycle Detection in `validateGraphRevision`**:
   `validateGraphRevision` MUST construct an explicit directed graph $G = (V, E)$ where $E = E_{\text{parent}} \cup E_{\text{artifact}}$. Kahn's topological sort algorithm MUST be executed during graph compilation. If the top-sort queue terminates with unvisited nodes, compilation MUST fail immediately with `CyclicDependencyError`.

3. **Conflict-Aware Wave Selection**:
   `selectReadyWaveV2` MUST pass all candidate ready nodes through `ConflictRiskAnalyzer`. Any node $N$ that shares a `ConflictConstraint` with an active node currently running in the wave MUST be deferred to a subsequent wave.

4. **Immutable Compare-and-Swap (CAS) Graph Revision Reductions**:
   Graph updates produce a strictly incremented `GraphRevision` (`revisionId`, `parentRevisionId`, `timestamp`). No in-place graph node mutations are permitted.

```typescript
// Canonical Interface Contract: packages/task-graph/src/types-v2.ts

export type RelationType = 'parentId' | 'ArtifactRequirement' | 'SeamBinding' | 'ConflictConstraint';

export interface GraphEdge {
  readonly id: string;
  readonly type: RelationType;
  readonly sourceNodeId: string; // Producer / Parent / Primary
  readonly targetNodeId: string; // Consumer / Child / Conflicting
  readonly contractId?: string;
}

export interface GraphRevision {
  readonly revisionId: string; // e.g. "rev_0042"
  readonly parentRevisionId: string | null;
  readonly runId: string;
  readonly nodes: ReadonlyMap<string, TaskNode>;
  readonly edges: readonly GraphEdge[];
  readonly createdAt: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly detectedCycles?: readonly string[][];
}
```

### Options Considered
- **Option A: Single Generic `dependency` Array (Legacy Baseline)**: Node records contained a string array of dependency IDs. *Rejected* because it blended functional dependencies, execution ordering, and conflict constraints into one lossy structure, preventing granular scheduling decisions.
- **Option B: Dynamic Graph Reduction via LangGraph Checkpointer**: Delegate state management directly to LangGraph. *Rejected* per Decision A18 (`docs/DECISIONS.md`), as framework adapters must not define domain persistence.
- **Option C: Canonical Typed Relations with Immutable GraphRevision CAS (Selected)**: Enforces clear mathematical semantics, guarantees cycle-free artifact DAGs, and supports fine-grained conflict-aware wave scheduling.

### Consequences
- **Positive**: Eliminates deadlocks caused by artifact cycles (`MH-AUDIT-ORCH-001`); prevents resource contention races during parallel node execution (`MH-AUDIT-ORCH-002`); guarantees deterministic graph state transitions.
- **Negative**: Adds a top-sort validation step during graph compilation ($O(|V| + |E|)$ computational cost, negligible for typical graphs $< 1000$ nodes).

### Affected Packages & Systems
- `packages/task-graph` (`src/validate-v2.ts`, `src/types-v2.ts`, `src/graph-reducer.ts`)
- `packages/scheduler` (`src/wave-selector-v2.ts`, `src/conflict-risk.ts`)
- `packages/orchestrator-graph` (`src/v2/execution-driver.ts`)

---

## ADR-002: Worktree Isolation, Host Protection & Process Supervision

### Status
**Approved** — Target for Readiness Level B (Secure Local Use)

### Context
The Production Readiness Audit revealed critical host boundary and process isolation failures:
1. `GroundingAgent` (`packages/execution-core/src/run/grounding-agent.ts:77-101`) directly edited and staged files in `repoRoot` without checking `git status --porcelain`, forcibly staging uncommitted user host files into automated commits (`MH-AUDIT-GIT-010`, **P0 Critical**).
2. Scope path checker (`packages/execution-core/src/scope/checker.ts:46-54`) failed to sanitize `../` path traversal sequences (`MH-AUDIT-SEC-002`).
3. Planning V2 spawned processes with unfiltered `process.env` and bypassed process supervisor registration (`MH-AUDIT-SEC-001`), leaking API keys and escaping lifecycle tracking.
4. Worktrees and Git branches leaked on run exits (`MH-AUDIT-GIT-001`).
5. Git runners suffered contention on `.git/index.lock` under parallel wave execution (`MH-AUDIT-GIT-005`).

### Decision
We implement a **Layered Host Worktree Isolation & Supervised Process System**:

1. **Host Workspace Safeguard**:
   Before executing any grounding, staging, or worktree creation, `GroundingAgent` MUST invoke `git status --porcelain`. If any uncommitted or untracked changes exist in the user's host working directory, `GroundingAgent` MUST abort with `HostDirtyWorkspaceError` or create its skeleton in an isolated temporary worktree. User host files MUST NEVER be modified or staged.

2. **Scope Path Traversal Defense**:
   `ScopeChecker` MUST sanitize all file mutation paths using absolute path resolution:
   ```typescript
   const resolvedRoot = path.resolve(worktreeRoot);
   const resolvedTarget = path.resolve(worktreeRoot, targetPath);
   if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
     throw new ScopeViolationError(`Path traversal attempt detected: ${targetPath}`);
   }
   ```

3. **Supervised Process Registry & Environment Filtering**:
   All CLI and shell sub-processes MUST be spawned through a central `SupervisedProcessManager`. Environments MUST be stripped of sensitive host keys using `buildAgentEnvironment()`, which passes only explicitly allowlisted environment variables (`MH_AGENT_ID`, `NODE_ENV`, `PATH`, allowlisted provider keys). Every spawned process PID MUST be registered in `LiveProcessRegistry` to guarantee process SIGTERM/SIGKILL termination on run completion or cancellation.

4. **Worktree Lifecycle Garbage Collection**:
   `V2ExecutionDriver` MUST wrap node execution in a try-finally block where `finally` executes `worktreeManager.cleanupAttemptWorktree(attemptId)`. Cleanups MUST remove temporary Git branches and unbind worktree folders.

5. **Index Lock Retry Queueing**:
   Git operations contending on `.git/index.lock` MUST retry using an exponential backoff with random jitter (base delay 100ms, 5 retries, max 2000ms).

```typescript
// Interface Contract: packages/execution-core/src/git/supervised-process-manager.ts

export interface ProcessSpawnOptions {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly allowlistedEnv: Record<string, string>;
  readonly timeoutMs: number;
}

export interface LiveProcessRegistry {
  registerProcess(pid: number, attemptId: string, cleanupFn: () => Promise<void>): void;
  unregisterProcess(pid: number): void;
  terminateAllForRun(runId: string): Promise<void>;
}
```

### Options Considered
- **Option A: Direct Subprocess Execution on User Filesystem**: Fast, zero overhead. *Rejected* due to severe risk of corrupting user code repositories (`MH-AUDIT-GIT-010`).
- **Option B: Full Docker Container Requirement for Local Dev**: Require Docker running on host for all local runs. *Rejected* because local users may not have Docker installed.
- **Option C: Layered Host Worktree Isolation + Supervised Process Registry (Selected)**: Provides fast local execution with strict host protections, zero external dependencies, and complete process cancellation guarantees.

### Consequences
- **Positive**: Absolute protection of user workspace (`MH-AUDIT-GIT-010`); immunity to path traversal attacks (`MH-AUDIT-SEC-002`); zero secret leaks in child processes (`MH-AUDIT-SEC-001`); clean worktree teardown (`MH-AUDIT-GIT-001`).
- **Negative**: Slightly increased disk I/O when creating temporary Git worktree directories for attempts.

### Affected Packages & Systems
- `packages/execution-core` (`src/run/grounding-agent.ts`, `src/scope/checker.ts`, `src/git/runner.ts`)
- `apps/web` (`src/lib/server/runs/v2/run-coordinator-host.ts`, `src/lib/server/runs/v2/execution-pipeline.ts`)

---

## ADR-003: Persistence Engine & Atomic Event Store Recovery

### Status
**Approved** — Target for Readiness Level B (Fenced Locks & Retries) & Readiness Level C (Compaction & Durable Traces)

### Context
The audit identified multiple critical failure modes in the file-based persistence layer:
1. `acquireDurableLock` (`packages/run-store/src/jsonl-event-store.ts:173-197`) release callback unconditionally deleted `lockPath` directory without verifying ownership (**P0 Critical**, `MH-AUDIT-PERS-001`). If Process A timed out, Process B acquired the lock; when Process A later completed, its release callback deleted Process B's lock directory.
2. `atomicWrite` (`jsonl-event-store.ts:254-269`) retried transient file renames without delay and leaked `.tmp` files (`MH-AUDIT-PERS-002`).
3. Telemetry events logged into `InMemoryTraceStore` were never flushed to disk, causing diagnostic data evaporation on crash (`MH-AUDIT-PERS-004`, `MH-AUDIT-QA-001`).
4. `JsonlAttemptStore` lacked an `update()` method (`MH-AUDIT-PERS-006`).
5. Event logs accumulated tens of thousands of JSONL events over long runs, degrading state replay performance linearly ($O(N)$) due to lack of compaction (`MH-AUDIT-GAP-001`).

### Decision
We implement a **Fenced Durable Locking, Compacting Event Store & Durable Telemetry Engine**:

1. **Fenced Lock Ownership Verification**:
   When acquiring a durable lock, `acquireDurableLock` MUST write an `owner.json` file inside the lock directory containing `{ pid: number, acquiredAt: string, token: string }`. The release callback MUST read `owner.json` and verify `token === myToken`. If the token does not match (indicating lock takeover), the release callback MUST NOT delete the directory.

```typescript
// Lock Verification Protocol: packages/run-store/src/durable-lock.ts

export interface LockOwnerPayload {
  readonly pid: number;
  readonly acquiredAt: string;
  readonly lockToken: string; // Cryptographically random UUID v4
}

export async function releaseDurableLock(lockPath: string, lockToken: string): Promise<boolean> {
  const ownerFile = path.join(lockPath, 'owner.json');
  try {
    const raw = await fs.promises.readFile(ownerFile, 'utf-8');
    const payload: LockOwnerPayload = JSON.parse(raw);
    if (payload.lockToken !== lockToken) {
      // Lock was taken over by another process due to timeout; DO NOT DELETE
      return false;
    }
    await fs.promises.rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    return false;
  }
}
```

2. **Atomic File Writes with `fsync` & Jittered Delay**:
   `atomicWrite` MUST write data to a unique temporary file (`file.tmp.<uuid>`), execute `fsync()` on the file descriptor to flush bytes to physical storage, and attempt `fs.rename()`. In case of `EBUSY` or `EPERM` errors (common under Windows file locking), retries MUST execute with exponential backoff and random jitter (10ms, 20ms, 40ms, max 5 retries). Unused `.tmp` files MUST be cleaned up in a `finally` block.

3. **Snapshot Compaction & Event Truncation Subsystem**:
   When event log size exceeds 1,000 events, `EventStoreCompactor` MUST compute a verified `RunSnapshot`, write `snapshot.json`, and truncate historical events prior to the snapshot commit checkpoint, retaining only active delta events.

4. **Durable `JsonlTraceStore`**:
   Replace `InMemoryTraceStore` with a durable `JsonlTraceStore` located at `.manyhands/runs/<runId>/traces.jsonl`. Flush diagnostic telemetry asynchronously with background buffer draining.

5. **Attempt Store `update()` Method**:
   Extend `JsonlAttemptStore` to expose `update(attemptId, patchFn)` supporting atomic attempt state updates.

### Options Considered
- **Option A: PostgreSQL / Heavy Database Requirement**: Require local Postgres. *Rejected* because it breaks simple local developer setup (`pnpm install && pnpm dev`).
- **Option B: Plain Unlocked JSON Writes**: Fast, simple. *Rejected* due to severe data corruption risks under concurrent process access.
- **Option C: Fenced Lock Verification + Compacting JSONL Event Store (Selected)**: Guarantees crash consistency, lock fencing safety, zero database setup overhead, and fast replay performance.

### Consequences
- **Positive**: Absolute prevention of foreign lock deletion races (`MH-AUDIT-PERS-001`); crash-safe atomic file writes (`MH-AUDIT-PERS-002`); persistent diagnostic traces (`MH-AUDIT-QA-001`); bounded event log memory overhead (`MH-AUDIT-GAP-001`).
- **Negative**: Slightly increased disk I/O during periodic snapshot compaction flushes.

### Affected Packages & Systems
- `packages/run-store` (`src/jsonl-event-store.ts`, `src/attempt-store.ts`, `src/compactor.ts`)
- `packages/trace-store` (`src/index.ts`, `src/jsonl-trace-store.ts`)

---

## ADR-004: Execution Base Materialization & Input Fingerprinting

### Status
**Approved** — Target for Readiness Level B (Secure Local Use)

### Context
Node execution attempts in ManyHands must be completely deterministic and reproducible. In early implementations, worker attempts occasionally executed against unverified or stale workspace commits (`MH-AUDIT-ORCH-003`), or were invalidated unnecessarily when unrelated nodes modified global graph metadata (`MH-AUDIT-ORCH-004`).

Decision A8 and A9 in `docs/DECISIONS.md` specify that node attempts are immutable, identified by an `InputFingerprint`, and execute against an explicitly materialized `ExecutionBase`.

### Decision
We formalize the **Execution Base Builder & Node-Local Input Fingerprinting Specification**:

1. **Node-Local Input Fingerprint Specification**:
   An `InputFingerprint` identifies the exact inputs to a node attempt. Crucially, the fingerprint MUST be **node-local**. It includes the node ID, contract revisions, baseline Git commit hash, SHA-256 hashes of required input artifacts, scope contract hash, and executor profile identity. It **EXCLUDES** the global `GraphRevision` ID so that graph amendments in independent subtrees do not invalidate active attempts.

```typescript
// Fingerprint Calculation: packages/execution-core/src/fingerprint.ts

export interface InputFingerprintPayload {
  readonly nodeId: string;
  readonly scopeContractHash: string;
  readonly validationContractHash: string;
  readonly baseCommitHash: string;
  readonly consumedArtifactHashes: ReadonlyMap<string, string>; // artifactId -> sha256
  readonly executorProfileId: string;
}

export function computeInputFingerprint(payload: InputFingerprintPayload): string {
  const sortedArtifacts = Array.from(payload.consumedArtifactHashes.entries())
    .sort(([k1], [k2]) => k1.localeCompare(k2))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

  const raw = [
    payload.nodeId,
    payload.scopeContractHash,
    payload.validationContractHash,
    payload.baseCommitHash,
    sortedArtifacts,
    payload.executorProfileId,
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}
```

2. **Explicit Base Materialization (`ExecutionBaseBuilder`)**:
   `ExecutionBaseBuilder` MUST construct the exact workspace directory for an attempt by:
   - Checking out the run baseline Git commit.
   - Fetching and applying ONLY the materialized artifacts explicitly listed in the node's `ArtifactRequirement` edges.
   - Writing an `execution-base-manifest.json` recording the exact base commit, applied artifact versions, and timestamps.
   - Transitive or un-declared sibling commits MUST NOT be applied blindly.

3. **Stale Attempt Rejection**:
   When an attempt completes, `RunCoordinator` MUST compare the attempt's `InputFingerprint` against the node's current input requirements. If the fingerprint matches, the attempt result is adopted; if stale, the result is marked `stale` and discarded without modifying integration state.

### Options Considered
- **Option A: Global Graph Revision Fingerprinting**: Include `graphRevisionId` in fingerprint. *Rejected* because any graph edit (e.g. adding a node in a separate subtree) would invalidate all running node attempts across the entire graph.
- **Option B: Blind Transitive Git Merge**: Merge all completed sibling branches into execution base. *Rejected* because it violates scope contracts and introduces non-deterministic integration bugs.
- **Option C: Explicit Manifest-Based Materialization + Node-Local Fingerprinting (Selected)**: Guarantees exact dependency isolation, maximal parallelism, and deterministic attempt verification.

### Consequences
- **Positive**: Node attempts execute with zero non-determinism; independent graph changes do not waste LLM tokens or invalidate active attempts; integration errors are caught at explicit composite boundaries.
- **Negative**: Requires materializing explicit artifact manifests for nodes that consume heavy binary artifacts.

### Affected Packages & Systems
- `packages/execution-core` (`src/base/builder.ts`, `src/fingerprint.ts`)
- `packages/contracts` (`src/scope.ts`, `src/validation.ts`)
- `packages/orchestrator-graph` (`src/v2/execution-driver.ts`)

---

## ADR-005: Event Stream (SSE), Local Reconnection & Web UI State Synchronization

### Status
**Approved** — Target for Readiness Level C (Reliable Local Beta)

### Context
The Web API and real-time state synchronization layer suffered from serious resource leak and local security audit findings:
1. `apps/web/src/app/api/runs/[runId]/events/route.ts:45-89` did not bind `request.signal` to background event store polling timers (`MH-AUDIT-API-001`). Disconnected browser tabs left active timers running infinitely on the server.
2. All 17 API endpoints in `apps/web` lacked local origin / CSRF verification (`MH-AUDIT-API-006`).
3. The local native folder picker route allowed unauthenticated background OS native file dialog spawning without user confirmation (`MH-AUDIT-API-008`).
4. Client-side state hook `useLiveRunModel` (`apps/web/src/lib/client/use-live-run-model.ts:88`) accumulated an unbounded event array in memory and refolded state from event 0 on every message, leading to $O(N^2)$ CPU bottlenecks and browser freezes on long runs (`MH-AUDIT-API-002`).

### Decision
We implement a **Loopback-Bound SSE Event Stream with Automatic Teardown, CSRF/Origin Protection & Incremental State Synchronization Engine**:

1. **Loopback Binding & Local CSRF / Origin Verification**:
   The Next.js web application MUST bind strictly to `127.0.0.1` and `::1`. Implement `apps/web/src/middleware.ts` to verify `Origin` and `Host` headers on mutating requests, preventing malicious external web pages from triggering actions against local APIs (`MH-AUDIT-API-006`). Native OS dialog routes (`/api/local-fs/pick-folder`) MUST require explicit user interaction tokens (`MH-AUDIT-API-008`).

2. **AbortSignal Server Resource Teardown**:
   The SSE route handler MUST listen to `request.signal` abort events and immediately clear background event polling loops and event listeners:

```typescript
// Server SSE Handler Teardown: apps/web/src/app/api/runs/[runId]/events/route.ts

export async function GET(request: NextRequest, { params }: { params: { runId: string } }) {
  // Validate request origin for local security boundary
  if (!isValidLocalOrigin(request)) {
    return new NextResponse('Forbidden Local Origin', { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = eventStore.subscribe(params.runId, (event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      request.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch (_) {}
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

3. **Client Incremental Fold Engine & Event Id Checkpointing**:
   `useLiveRunModel` MUST manage a bounded event memory window (max 500 recent events) and maintain a cached `RunSnapshot`. Upon SSE reconnection, the client sends `Last-Event-ID: <eventId>`. The server streams only events recorded after `<eventId>`. The client applies incoming events incrementally to the snapshot projection, eliminating $O(N^2)$ refold costs (`MH-AUDIT-API-002`).

4. **UI Rule: Zero Auto-Recentering Canvas**:
   Per Rule A17 (`docs/DECISIONS.md`), incoming events MUST NEVER trigger automatic canvas recentering (`fitView`), panning, or zoom changes. Canvas state changes occur strictly upon explicit user interaction.

### Options Considered
- **Option A: Short Polling (`HTTP GET /api/runs/[runId]`)**: Simple to implement. *Rejected* due to excessive network request overhead and latency.
- **Option B: Cloud WebSockets with External Broker**: Require cloud backend. *Rejected* because ManyHands is a single-user local application.
- **Option C: Loopback SSE with AbortSignal Teardown & Incremental Fold (Selected)**: Guarantees zero background leaks on tab close, strong local API security, and fluid UI rendering.

### Consequences
- **Positive**: Zero server background leak on client disconnect (`MH-AUDIT-API-001`); protection against local CSRF / origin exploitation (`MH-AUDIT-API-006`); high-performance 60fps UI state rendering without browser locks (`MH-AUDIT-API-002`).
- **Negative**: Requires clients to manage EventId state checkpoints across network reconnects.

### Affected Packages & Systems
- `apps/web` (`src/middleware.ts`, `src/app/api/runs/[runId]/events/route.ts`, `src/app/api/local-fs/pick-folder/route.ts`, `src/lib/client/use-live-run-model.ts`, `src/lib/run-model/*`)

---

## ADR-006: LLM Guardrails, Prompt Injection & Token Budget Management

### Status
**Approved** — Target for Readiness Level D (Finished Local Product)

### Context
AI security and cost management audits highlighted critical risks:
1. `packages/decomposer/src/planner/work-breakdown.ts:112-145` directly concatenated raw repository file content into LLM prompt strings without sanitization or XML delimiter escaping (`MH-AUDIT-AI-001`, **P1 High**). An untrusted cloned repository could contain prompt injection payloads (e.g., in a code file or issue title), taking control of agent planning.
2. `packages/decomposer/src/llm-decomposer.ts:65-98` executed prompt completions without spending limits or max token caps (`MH-AUDIT-AI-002`, **P1 High**), exposing the user to unexpected API costs.
3. Sidecar MCP tool wrappers (`packages/shared/src/sidecar-wrapper.ts:44`) permitted unrestricted system execution capabilities (`MH-AUDIT-AI-003`).

### Decision
We implement a **3-Tier Local AI Safety, Prompt Envelope & Token Budget Governance Subsystem**:

1. **XML Prompt Envelope Isolation**:
   All user codebase snippets, repository files, issue titles, and external context strings MUST be wrapped in explicit XML envelope tags (`<user_repository_file path="...">`). Any instance of closing tags (e.g., `</user_repository_file>`) inside user content MUST be escaped to `&lt;/user_repository_file&gt;`. System prompts MUST explicitly instruct the LLM that text inside `<user_repository_file>` tags contains untrusted data and MUST NOT be executed as system instructions.

```typescript
// Sanitization & Envelope Wrapping: packages/decomposer/src/planner/prompt-envelope.ts

export function wrapUntrustedContent(content: string, tag: string, attributes: Record<string, string> = {}): string {
  const attrStr = Object.entries(attributes)
    .map(([k, v]) => `${k}="${escapeXmlAttribute(v)}"`)
    .join(' ');
  const openTag = attrStr ? `<${tag} ${attrStr}>` : `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Escape any occurrences of the closing tag inside the content
  const escapedContent = content.replace(new RegExp(`</${tag}>`, 'gi'), `&lt;/${tag}&gt;`);

  return `${openTag}\n${escapedContent}\n${closeTag}`;
}
```

2. **Pre-Execution Token Budget Accounting**:
   Every local run MUST initialize a `TokenBudgetLedger` with configured limits (`maxBudgetUsd`, `maxInputTokens`, `maxOutputTokens`). Before invoking any LLM API call, `RunCoordinator` MUST query `TokenBudgetLedger`. If cumulative spending exceeds the user's budget threshold, the call MUST abort with `TokenBudgetExceededError` before calling the LLM API provider. Input and output token counts from API response metadata MUST be durably recorded in the event log.

3. **Capability-Restricted MCP Sidecar Wrapper**:
   MCP sidecar wrappers MUST enforce strict schema validation on tool parameters and restrict execution capabilities using explicit tool permission allowlists defined in the agent profile.

### Options Considered
- **Option A: Unsanitized Direct String Interpolation (Baseline)**: Simple, zero overhead. *Rejected* due to severe prompt injection vulnerability from untrusted cloned repositories (`MH-AUDIT-AI-001`).
- **Option B: External SaaS Guardrail Proxy**: Route all prompts through a third-party security API. *Rejected* due to added latency, external service dependency, and privacy concerns for local developer source code.
- **Option C: Monorepo-Native Safety Envelope, Token Accounting Coordinator & Sandboxed Sidecars (Selected)**: Provides robust prompt injection defense, strict financial cost caps, zero external latency, and complete local execution privacy.

### Consequences
- **Positive**: Total immunity to indirect prompt injection via cloned repo files (`MH-AUDIT-AI-001`); deterministic financial caps preventing runaway LLM API bills (`MH-AUDIT-AI-002`); secure sidecar tool execution (`MH-AUDIT-AI-003`).
- **Negative**: Adds small token overhead for XML envelope tags in LLM context windows.

### Affected Packages & Systems
- `packages/decomposer` (`src/planner/work-breakdown.ts`, `src/planner/prompt-envelope.ts`, `src/llm-decomposer.ts`)
- `packages/shared` (`src/sidecar-wrapper.ts`, `src/token-budget.ts`)
- `apps/web` (`src/lib/server/runs/v2/run-coordinator-host.ts`)

---

## ADR-007: Supply Chain, Monorepo Hardening & Local Distribution

### Status
**Approved** — Target for Readiness Level C / Level D

### Context
The monorepo and CI setup suffered from consistency and testing fragile dependencies:
1. Monorepo packages contained mismatched workspace dependency specifiers (`packages/execution-core/package.json:18-28`) using fixed versions (e.g. `"1.0.0"`) instead of standard pnpm `"workspace:*"` specifiers (`MH-AUDIT-INFRA-001`).
2. UI component unit tests (`tests/run-loading-skeleton.test.ts:25`) used fragile `fs.readFileSync()` string matching over TSX source files (`MH-AUDIT-QA-003`), causing tests to break whenever component formatting changed.
3. Smooth local product distribution requires reproducible builds (`pnpm install && pnpm build`).

### Decision
We execute **Monorepo Standardization, DOM Component Testing & Zero-Config Local Setup Optimization**:

1. **Monorepo Workspace Specifier Standardization**:
   All internal monorepo package dependencies in `package.json` manifests across `packages/*` and `apps/*` MUST be standardized to `"workspace:*"`. Fixed version specifiers for internal packages are strictly prohibited.

2. **React Testing Library DOM Component Tests**:
   All UI component unit tests MUST render React/Svelte components in a virtual DOM environment (React Testing Library / JSDOM) and assert accessibility roles, DOM text content, and visual states. Source code raw text regex matching is forbidden (`MH-AUDIT-QA-003`).

3. **Zero-Config Local Setup (`pnpm dev`)**:
   Standardize setup instructions and local environment configuration scripts to enable a developer to clone the repo, run `pnpm install`, configure local API keys, and launch the application seamlessly.

4. **CI Supply Chain Vulnerability & Lockfile Audit**:
   CI workflows MUST execute `pnpm audit --audit-level high` on every pull request to ensure monorepo dependencies remain free of high-severity vulnerabilities.

### Options Considered
- **Option A: Manual Ad-Hoc Dependency Management**: Maintain fixed package versions. *Rejected* due to dependency drift risks and broken local builds (`MH-AUDIT-INFRA-001`).
- **Option B: Source Code Regex Unit Tests**: Test UI by inspecting source text. *Rejected* due to extreme flakiness (`MH-AUDIT-QA-003`).
- **Option C: Monorepo Standardization, RTL Unit Testing & Zero-Config Local Distribution (Selected)**: Guarantees reproducible builds, robust test suites, and seamless local installation.

### Consequences
- **Positive**: Clean, predictable monorepo build graph (`MH-AUDIT-INFRA-001`); resilient UI test suite (`MH-AUDIT-QA-003`); effortless local developer installation and execution.
- **Negative**: Requires updating all monorepo package manifests to standard `workspace:*` syntax.

### Affected Packages & Systems
- Monorepo root `package.json` and all `packages/*/package.json` files
- `apps/web` component test suites (`tests/ui-component-rendering.test.ts`)
- `.github/workflows/ci.yml` (CI/CD pipeline)

---

## Sign-Off & Implementation Protocol

All seven Architecture Decision Records defined herein have been formally reviewed and approved by the Principal Engineering Review Board. Implementation teams MUST adhere strictly to the designs, TypeScript interfaces, and invariant contracts specified in these ADRs during remediation and feature work for the single-user local product.
