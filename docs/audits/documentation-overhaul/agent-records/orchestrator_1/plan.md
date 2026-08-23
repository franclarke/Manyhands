# ManyHands Documentation Overhaul & Code Audit Plan

## Objective
Execute a comprehensive code analysis and documentation overhaul for the ManyHands codebase across all packages, apps, native crates, and architecture documentation. All documentation will be pedagogical, precise, and written in Spanish with English code symbols and technical terms, reflecting the target architecture from `docs/plans/2026-08-12-correctness-first-system-redesign.md` and identifying all transition gaps.

## Milestones
- [ ] Phase 0: Repository Survey & Blueprint
  - Explorer 1: Survey packages (`contracts`, `task-graph`, `shared`, `decomposer`, `repository-index`)
  - Explorer 2: Survey packages (`scheduler`, `conflict-risk`, `execution-core`, `run-store`, `trace-store`, `run-engine`, `run-coordinator`, `orchestrator-graph`)
  - Explorer 3: Survey apps (`apps/daemon`, `apps/web`), native crates (`native/windows-job-runner`, `native/windows-ipc-acl`), and `docs/*`
  - Merge into `PROJECT.md`
- [ ] Milestone 1: Core Domain, Graph & Contracts Documentation
  - `packages/contracts`
  - `packages/task-graph`
  - `packages/shared`
- [ ] Milestone 2: Planning, Decomposition & Grounding Documentation
  - `packages/decomposer`
  - `packages/repository-index`
- [ ] Milestone 3: Scheduling, Conflict Risk & Execution Core Documentation
  - `packages/scheduler`
  - `packages/conflict-risk`
  - `packages/execution-core`
- [ ] Milestone 4: Persistence, Engine & Coordination Documentation
  - `packages/run-store`
  - `packages/trace-store`
  - `packages/run-engine`
  - `packages/run-coordinator`
  - `packages/orchestrator-graph`
- [ ] Milestone 5: Applications & Native Bridges Documentation
  - `apps/daemon`
  - `apps/web`
  - `native/windows-job-runner`
  - `native/windows-ipc-acl`
- [ ] Milestone 6: Centralized Architecture Guides & Global Consistency Verification
  - `docs/modules/*`
  - `docs/README.md`
  - Global link and symbol cross-validation
- [ ] Milestone 7: Final Review & Quality Gate
