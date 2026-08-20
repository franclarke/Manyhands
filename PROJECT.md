# ManyHands Documentation Overhaul & System Audit — Project Blueprint

## Architecture & System Overview
ManyHands coordinates autonomous coding agents to turn high-level software goals into verified, integrated, and delivered production code. The system is transitioning from a legacy prototype to the target architecture defined in `docs/plans/2026-08-12-correctness-first-system-redesign.md`.

### Modular Decomposition & Layering
1. **Contracts & Core Data Types Layer**:
   - `packages/shared`: Zero-dependency primitive schemas (`ReasoningEffortSchema`, `EpistemicAssessmentSchema`), CLI process utilities, executor registry.
   - `packages/contracts`: Authoritative Zod schemas and deterministic canonical hashing (`computeCanonicalDigest`) for goal, plan, contracts, seams, artifacts, validation, and effects.
   - `packages/task-graph`: Executable canonical DAG revisions (`GraphRevisionSchema`, `CanonicalTaskNode`), typed relations (`ResourceClaimSchema`, `ArtifactRequirementSchema`, `SeamBindingSchema`), and resource write authority.
2. **Grounding & Planning Engine Layer**:
   - `packages/repository-index`: Queryable AST & exact Git blob model (`RepositoryModel`), resource catalog (`ResourceCatalog`), and budgeted query interface (`RepositoryQuery`).
   - `packages/decomposer`: Multi-turn `PlanningEngine` with budget tracking, `GranularityPolicy` 4.0, deterministic plan verification (`verifyPlan`), and direct compilation (`compilePlan`) into `GraphRevision`.
3. **Scheduling & Conflict Risk Layer**:
   - `packages/scheduler`: Frontier-based continuous readiness scheduler (`canonical-frontier.ts`), claim overlap analysis, lease tracking.
   - `packages/conflict-risk`: Resource-indexed claim overlap and interference analysis.
4. **Execution & Sandboxing Layer**:
   - `packages/execution-core`: Content-addressed artifact materialization (`ExactGitManifestMaterializer`, `GitArtifactBuilder`), immutable execution bases (`ExecutionBaseBuilder`), hierarchical evidence matrix (`buildEvidenceMatrix`), worker process supervision.
   - `native/windows-job-runner`: Pure Rust Win32 process containment with dual nested Job Objects (`KILL_ON_JOB_CLOSE`), creation filetime ticks verification, and receipt files (`started.json`, `final.json`).
   - `native/windows-ipc-acl`: Pure Rust Win32 security helper enforcing protected DACLs (Current User + Local System) and private Named Pipe proxying.
5. **Persistence & Telemetry Layer**:
   - `packages/run-store`: Canonical event store (`JsonlEventStore`), durable effect input store (`FileEffectInputStore`), atomic file writes (`DurableFile`), and file locks (`DurableLock`).
   - `packages/trace-store`: Diagnostic and telemetry store (`JsonlTraceStore`) strictly separated from authoritative domain events.
6. **Runtime Engine & Coordination Layer**:
   - `packages/run-engine`: Actor-based runtime engine (`DurableRunEngine`, `RunActor`), effect dispatching (`EffectDispatcher`), and physical effect adapters.
   - `packages/run-coordinator`: Domain event definitions, state machine reducer (`reducer.ts`), command envelope dispatcher.
   - `packages/orchestrator-graph`: Canonical execution driver (`CanonicalExecutionDriver`), concurrent resource invariants, and execution base closure.
7. **Host Applications Layer**:
   - `apps/daemon`: Local privileged composition root, single-authoritative journal writer, Lamport bakery ticket guard (`daemon.lease`), HMAC-SHA256 authenticated IPC server with replay protection.
   - `apps/web`: Next.js 15 + React 19 + Tailwind CSS 4 + `@xyflow/react` BFF client and event-sourced projection UI, enforcing strict local security boundaries (`boundary.ts`) against DNS rebinding and CSRF.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Core Contracts README | Pedagogical Spanish documentation of all 25 schemas, canonical hashing, and transition status in `packages/contracts/README.md`. | Milestone 1 | R1, R2, R4 |
| 2 | Task Graph README | Pedagogical Spanish documentation of `GraphRevision`, typed relations, resource authority, and topological levels in `packages/task-graph/README.md`. | Milestone 1 | R1, R2, R4 |
| 3 | Shared Primitives README | Pedagogical Spanish documentation of primitive types, executor registry, and Windows CLI process handling in `packages/shared/README.md`. | Milestone 1 | R1, R2, R4 |
| 4 | Decomposer README | Pedagogical Spanish documentation of `PlanningEngine`, `GranularityPolicy` 4.0, `verifyPlan`, and `compilePlan` in `packages/decomposer/README.md`. | Milestone 2 | R1, R2, R4 |
| 5 | Repository Index README | Pedagogical Spanish documentation of `RepositoryModel`, `ResourceCatalog`, `RepositoryQuery`, and AST indexers in `packages/repository-index/README.md`. | Milestone 2 | R1, R2, R4 |
| 6 | Scheduler README | Pedagogical Spanish documentation of `canonical-frontier.ts`, readiness evaluation, claim overlap, and wave selectors in `packages/scheduler/README.md`. | Milestone 3 | R1, R2, R4 |
| 7 | Conflict Risk README | Pedagogical Spanish documentation of resource-indexed claim conflict analysis vs legacy pair risk in `packages/conflict-risk/README.md`. | Milestone 3 | R1, R2, R4 |
| 8 | Execution Core README | Pedagogical Spanish documentation of manifest materialization, artifact building, execution bases, and evidence matrices in `packages/execution-core/README.md`. | Milestone 3 | R1, R2, R4 |
| 9 | Run Store README | Pedagogical Spanish documentation of `JsonlEventStore`, `FileEffectInputStore`, and durable locking in `packages/run-store/README.md`. | Milestone 4 | R1, R2, R4 |
| 10 | Trace Store README | Pedagogical Spanish documentation of `JsonlTraceStore` and diagnostic event separation in `packages/trace-store/README.md`. | Milestone 4 | R1, R2, R4 |
| 11 | Run Engine README | Pedagogical Spanish documentation of `DurableRunEngine`, `RunActor`, and effect dispatchers in `packages/run-engine/README.md`. | Milestone 4 | R1, R2, R4 |
| 12 | Run Coordinator README | Pedagogical Spanish documentation of domain events, state machine reducer, and command envelopes in `packages/run-coordinator/README.md`. | Milestone 4 | R1, R2, R4 |
| 13 | Orchestrator Graph README | Pedagogical Spanish documentation of `CanonicalExecutionDriver` and resource invariants in `packages/orchestrator-graph/README.md`. | Milestone 4 | R1, R2, R4 |
| 14 | Daemon App README | Pedagogical Spanish documentation of composition root, Lamport lease guard, and HMAC-SHA256 IPC in `apps/daemon/README.md`. | Milestone 5 | R1, R2, R4 |
| 15 | Web App README | Pedagogical Spanish documentation of Next.js 15 BFF client, React Flow canvas, `boundary.ts` security, and 18 API routes in `apps/web/README.md`. | Milestone 5 | R1, R2, R4 |
| 16 | Windows Job Runner README | Pedagogical Spanish documentation of Win32 FFI custody runner, dual Job Objects, filetime ticks, and receipts in `native/windows-job-runner/README.md`. | Milestone 5 | R1, R2, R4 |
| 17 | Windows IPC ACL README | Pedagogical Spanish documentation of Win32 protected DACLs and private Named Pipe proxying in `native/windows-ipc-acl/README.md`. | Milestone 5 | R1, R2, R4 |
| 18 | Centralized Architecture Guides | 17 technical guide files under `docs/modules/*.md` explaining each subsystem's architecture, interfaces, and lifecycle for third parties. | Milestone 6 | R3, R4 |
| 19 | Docs Main Navigation & Hub | Overhaul of `docs/README.md` into a comprehensive architecture navigation hub with system lifecycle diagrams, interaction matrix, and onboarding paths. | Milestone 6 | R3, R4 |
| 20 | Consistency & Symbol Audit | Full cross-check of all links, symbols, schemas, and elimination of obsolete claims across all generated markdown files. | Milestone 7 | R4 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Domain, Graph & Contracts | `packages/contracts`, `packages/task-graph`, `packages/shared` READMEs | none | DONE |
| M2 | Planning & Grounding | `packages/decomposer`, `packages/repository-index` READMEs | M1 | DONE |
| M3 | Scheduling & Execution Core | `packages/scheduler`, `packages/conflict-risk`, `packages/execution-core` READMEs | M1 | DONE |
| M4 | Persistence, Engine & Coordination | `packages/run-store`, `packages/trace-store`, `packages/run-engine`, `packages/run-coordinator`, `packages/orchestrator-graph` READMEs | M1, M3 | DONE |
| M5 | Applications & Native Bridges | `apps/daemon`, `apps/web`, `native/windows-job-runner`, `native/windows-ipc-acl` READMEs | M1, M4 | DONE |
| M6 | Central Architecture Guides | `docs/modules/*.md` (17 guides) & `docs/README.md` | M1, M2, M3, M4, M5 | IN_PROGRESS |
| M7 | Global Verification & Audit Gate | Link checking, symbol validation, consistency review across all docs | M6 | PLANNED |

---

## Interface Contracts & Guidelines
1. **Language & Terminology**:
   - Pedagogical, clear Spanish for explanations, concepts, and architectural narratives.
   - Exact English for technical symbols, types, classes, functions, schemas, CLI commands, file paths, and environment variables.
2. **Standard README Structure per Module**:
   - `## Propósito y Responsabilidad` (Purpose & Responsibilities in ManyHands)
   - `## Arquitectura Modular Interna` (Directory layout & component breakdown)
   - `## Patrones de Diseño y Estrategias Técnicas` (Why and how it is built)
   - `## Puntos de Entrada, Interfaces y Schemas Clave` (Exported APIs, Zod schemas, types)
   - `## Estado de Transición y Brechas Arquitectónicas` (Alignment with 2026-08-12 redesign plan)
   - `## Comandos de Verificación` (Typecheck and test commands)
3. **No Obsolete Claims**:
   - Do not state that transitional or legacy modules are target architecture.
   - Always clearly label legacy compatibility layers (e.g. `src/legacy/`).

---

## Code Layout
- `packages/contracts/README.md`
- `packages/task-graph/README.md`
- `packages/shared/README.md`
- `packages/decomposer/README.md`
- `packages/repository-index/README.md`
- `packages/scheduler/README.md`
- `packages/conflict-risk/README.md`
- `packages/execution-core/README.md`
- `packages/run-store/README.md`
- `packages/trace-store/README.md`
- `packages/run-engine/README.md`
- `packages/run-coordinator/README.md`
- `packages/orchestrator-graph/README.md`
- `apps/daemon/README.md`
- `apps/web/README.md`
- `native/windows-job-runner/README.md`
- `native/windows-ipc-acl/README.md`
- `docs/modules/` (individual module architecture guides)
- `docs/README.md` (central navigation and architecture hub)
