# Production Readiness Technical Audit Plan — ManyHands

## Objective
Execute a comprehensive, multi-agent adversarial Production Readiness Technical Audit of the ManyHands repository. Produce all 14 mandatory markdown audit reports, findings ledger, coverage ledger, and command results document under `docs/audits/production-readiness/`.

## Audit Scope & Domains
1. **Cartography & Inventory**: Complete 100% mapping of `apps/` and `packages/`, comparing target architecture (`PRODUCT.md`, `docs/system/`) vs actual implementation.
2. **Security & Host Boundary**: Worktree isolation, process supervision, lease fencing, input sanitization, command execution security (`docs/system/05-worktree-layer.md`, `docs/system/security-boundary.md`).
3. **Orchestration & Scheduler Concurrency**: Task Graph execution, DAG invariants, conflict risk, seam bindings, readiness transitions, composite node mechanics.
4. **Git & Worktrees**: Branch management, candidate commits, worktree lifecycle, dirty state prevention, git lock handling.
5. **Persistence & Recovery**: Run store, trace store, event immutability, crash recovery, atomic file operations, fingerprinting.
6. **APIs, SSE & Web UI/Frontend**: SvelteKit routes, SSE event streaming, decision queues, React Flow canvas behavior, state synchronization.
7. **AI Security, Cost & LLM Guardrails**: Prompt injection vectors, token budget management, LLM output validation, sidecar/MCP security.
8. **Infrastructure & Supply Chain**: pnpm workspace topology, dependency audit, security vulnerabilities, build reproducibility.
9. **Testing, Observability & QA**: Test suite coverage, mock vs real tests, trace logging, diagnostic telemetry.
10. **Scalability & Missing Systems Assessment**: Performance bottlenecks, transition gaps between target docs and current codebase.
11. **Remediation Plan & Ledgers**: 30-day prioritized remediation plan, `findings-ledger.json`, `coverage-ledger.json`, `command-results.md`, `00-executive-summary.md`.

## Execution Topology
- Specialist Explorer Subagents (`teamwork_preview_explorer`) will investigate specific packages/apps and extract evidence (line numbers, code snippets, tests, architectural gaps).
- Subagents will write domain reports to their `.agents/<explorer_id>/` working directories.
- Orchestrator synthesizes domain reports, verifies findings against code, populates ledgers, and writes all final documents to `docs/audits/production-readiness/`.

## Mandatory Deliverables
- `docs/audits/production-readiness/00-executive-summary.md`
- `docs/audits/production-readiness/01-system-map.md`
- `docs/audits/production-readiness/02-critical-invariants.md`
- `docs/audits/production-readiness/03-findings.md`
- `docs/audits/production-readiness/04-security-review.md`
- `docs/audits/production-readiness/05-orchestration-concurrency-review.md`
- `docs/audits/production-readiness/06-git-worktree-review.md`
- `docs/audits/production-readiness/07-persistence-recovery-review.md`
- `docs/audits/production-readiness/08-api-frontend-review.md`
- `docs/audits/production-readiness/09-ai-security-cost-review.md`
- `docs/audits/production-readiness/10-infrastructure-supply-chain-review.md`
- `docs/audits/production-readiness/11-testing-observability-review.md`
- `docs/audits/production-readiness/12-scalability-assessment.md`
- `docs/audits/production-readiness/13-missing-systems.md`
- `docs/audits/production-readiness/14-remediation-plan.md`
- `docs/audits/production-readiness/findings-ledger.json`
- `docs/audits/production-readiness/coverage-ledger.json`
- `docs/audits/production-readiness/command-results.md`
