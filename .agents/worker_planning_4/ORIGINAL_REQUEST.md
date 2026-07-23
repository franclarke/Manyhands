## 2026-07-22T13:16:51-03:00
You are Planning Worker 4 (Execution Graph, Strategy & Release Gates Designer).
Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\worker_planning_4

MISSION:
1. Read existing audit reports in `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness/` and reference the 8 Epics and backlog items `MH-REM-001` to `MH-REM-050`.
2. DO NOT modify any code in `apps/` or `packages/`.
3. Create the following 8 required artifacts strictly inside `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness\planning/`:
   - `06-dependency-graph.md`: Mermaid DAG diagram showing ALL remediation backlog items (`MH-REM-XXX`) and Epics. MUST be strictly acyclic (zero cycles). Topological ordering from Wave 0 to Wave 8, critical path analysis.
   - `07-implementation-waves.md`: Detailed wave-by-wave plan (Wave 0 to Wave 8):
     - Wave 0: Audit Integrity Fixes & Test Suite Foundation (Level A baseline)
     - Wave 1: Core Contracts & Task Graph Typed Relations
     - Wave 2: Persistence Engine & Event Store WAL
     - Wave 3: Worktree Sandbox & Security Boundary (Level B Exit)
     - Wave 4: Execution Core & Fingerprint Materialization
     - Wave 5: API, SSE & Web UI State Sync (Level C Exit)
     - Wave 6: AI Security, Prompt Protection & Token Budgeting
     - Wave 7: Supply Chain, Containerization & Observability
     - Wave 8: Multi-Tenant Architecture & Isolation (Level D Exit)
     Include objectives, items, entry/exit criteria, agent skills, verification commands for each wave.
   - `08-agent-execution-plan.md`: Multi-agent execution topology for implementing the backlog (roles, folder rules, handoff protocols, verification, context limits, succession rules).
   - `09-test-strategy.md`: Multi-tier testing strategy (Unit, Integration, E2E, Adversarial), verification methodology per epic, test runner invocations, regression test suites for each `MH-AUDIT-XXX`.
   - `10-release-gates.md`: Binary release gates corresponding to Product Readiness Levels (Gate A: Local Baseline, Gate B: Private Beta, Gate C: Single-Tenant Production, Gate D: Multi-Tenant SaaS). Non-negotiable pass/fail metrics, security checks, test thresholds.
   - `11-risk-register.md`: Technical, architectural, security, and execution risks (Likelihood, Impact, Score, Mitigation Strategy, Contingency Plan, Owner).
   - `12-open-questions.md`: Architectural tradeoffs, underspecified contracts, design questions requiring human/architect decision before execution.
   - `planning-command-results.md`: Detailed execution log and command results from validating code paths, line numbers, running typecheck commands (`pnpm test`, `pnpm -r --filter "./packages/*" typecheck`, `pnpm --filter @manyhands/web exec tsc --noEmit`).

Write all files with complete technical depth, exhaustive detail, and zero placeholders. Report back when finished.

## 2026-07-22T16:19:02Z
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

