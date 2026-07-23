## 2026-07-22T16:16:51Z
You are Planning Worker 3 (Remediation Epics & Master Backlog Designer).
Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\worker_planning_3

MISSION:
1. Read `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness\findings-ledger.json` and `PRODUCT.md`.
2. Group the root causes of all audit findings into 8 Architectural Remediation Epics:
   - Epic 1: Task Graph & Canonical Relations Contract Engine
   - Epic 2: Worktree Security, Process Supervision & Host Sandboxing
   - Epic 3: Persistence Engine & Atomic Event Store Recovery
   - Epic 4: Execution Core, Base Materialization & Input Fingerprinting
   - Epic 5: API, SSE & Web UI State Synchronization
   - Epic 6: AI Security, Prompt Protection & Token Governance
   - Epic 7: Infrastructure, Supply Chain & CI/CD Hardening
   - Epic 8: QA, Observability & End-to-End Test Infrastructure
3. Create a granular Master Remediation Backlog containing tasks with IDs `MH-REM-001` through `MH-REM-050` covering all epics and findings. Each backlog item must specify: ID, Title, Epic, Target Readiness Level (Level A, B, C, D), Priority (P0, P1, P2, P3), Related Audit Findings (`MH-AUDIT-XXX`), Technical Dependencies, Target Files/Packages, Estimate/Complexity, and Detailed Acceptance Criteria.
4. DO NOT modify any code in `apps/` or `packages/`.
5. Create the following 3 required artifacts strictly inside `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness\planning/`:
   - `04-remediation-epics.md`: Detailed specification of the 8 Architectural Epics (Goal, Architecture Target, Scope, Included Findings, Key Deliverables, Dependencies).
   - `05-master-backlog.md`: Full human-readable Master Remediation Backlog cataloguing all `MH-REM-001` to `MH-REM-050` items with complete details.
   - `remediation-backlog.json`: Machine-readable JSON ledger containing the complete structured backlog array with epics, items, dependencies, levels, and metadata.

Write all files with complete technical precision, exhaustive details, and zero placeholders. Report back when finished.

## 2026-07-22T16:18:39Z
CRITICAL USER SCOPE DIRECTIVE:
ManyHands MUST target a LOCAL, SINGLE-USER, SELF-HOSTED APPLICATION (running on localhost). It is NOT a SaaS, public cloud service, or multi-tenant platform.

STRICT RULES TO APPLY TO ALL PLANNING ARTIFACTS AND JSON LEDGERS:
1. Every finding/requirement related exclusively to SaaS, multi-tenancy, multi-user auth (OAuth/SSO), billing, RBAC, or K8s MUST be labeled as `OUT_OF_SCOPE_SAAS` and MUST NOT be included in blockers, critical path, production score, or remediation plan.
2. Threat Model: The local human user is TRUSTED. However, cloned repositories, untrusted file names, symlinks, git hooks, scripts, dependencies, prompt injections, LLM outputs, and agent-proposed commands are UNTRUSTED and must be strictly isolated and validated.
3. Web API: Exclusively bound to `127.0.0.1` / `::1` with CSRF/Origin protection and local confirmation.
4. Redefined Readiness Levels:
   - Level A: Local Thesis & Dev (execution without risk to dev workspace)
   - Level B: Secure Local Use (host protection, worktree sandbox, resource limits, cancellation)
   - Level C: Reliable Local Beta (durable long runs, crash recovery, local observability)
   - Level D: Finished Local Product (Final Goal — clone, `pnpm install`, configure keys, run reliably locally)
5. Finding Classifications in Ledgers: `BLOCKER_LOCAL_PRODUCT`, `REQUIRED_FOR_LOCAL_RELIABILITY`, `LOCAL_HARDENING`, `OPTIONAL_IMPROVEMENT`, `OUT_OF_SCOPE_SAAS`, `FALSE_POSITIVE_FOR_LOCAL_MODEL`.
