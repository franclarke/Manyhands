# 11 — Comprehensive Remediation Risk Register

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Risk Register Summary

This document catalogues the technical, architectural, security, and execution risks associated with remediating ManyHands for local production readiness.

Each risk is evaluated using a standard 3x3 Likelihood vs Impact matrix to determine the Risk Score (High, Medium, Low), along with a preventative **Mitigation Strategy** and an action-ready **Contingency Plan**.

---

## 2. Risk Matrix Classification

| Risk ID | Category | Title | Likelihood | Impact | Score | Mitigation Strategy | Contingency Plan | Owner |
|---|---|---|---|---|---|---|---|---|
| `RISK-SEC-001` | Host Security | Grounding Agent Staging User Dirty Workspace Files | Medium | High | **HIGH** | Run `git status --porcelain` before writing files; abort or isolate in separate worktree (`MH-REM-001`). | Fallback to automatic snapshot worktree branching if dirty state is detected. | Execution Core Lead |
| `RISK-SEC-002` | Host Security | Unsanitized `process.env` Spawning Planning CLI Processes | High | High | **HIGH** | Filter environment variables using `buildAgentEnvironment()` and register with process supervisor (`MH-REM-018`). | Kill unsupervised orphan child processes immediately on host startup. | Security Lead |
| `RISK-SEC-003` | Host Security | Path Traversal & Symlink Escapes via Scope Checker | Medium | High | **HIGH** | Resolve all paths against `worktreeRoot` using `path.resolve` and reject `../` or symlinks pointing outside sandbox (`MH-REM-019`, `MH-REM-023`). | Immediately terminate attempt and log security violation trace. | Security Lead |
| `RISK-PERS-001` | Persistence | Durable Lock Ownership Deletion during Timeout Takeover | High | High | **HIGH** | Inspect `owner.json` PID and `acquiredAt` timestamp in lock release callback before unlinking lock dir (`MH-REM-002`). | Force lock re-verification before write operations in event store. | Persistence Lead |
| `RISK-PERS-002` | Persistence | Abrupt Process Crash Corrupting JSONL Event Log WAL | Medium | High | **HIGH** | Write events using true append streams (`fs.createWriteStream`) with atomic write retries (`MH-REM-012`, `MH-REM-013`). | Replay state from latest verified `RunSnapshot` log checkpoint. | Persistence Lead |
| `RISK-GIT-001` | Git / Worktrees | Windows `.git/index.lock` Contention under High Concurrency | High | Medium | **HIGH** | Implement exponential backoff retry loops in `SimpleGitRunner` for index lock acquisition (`MH-REM-021`). | Serialize git commit operations through a local in-memory lock queue. | Execution Core Lead |
| `RISK-GIT-002` | Git / Worktrees | Worktree Directory Accumulation Leaking Disk Space | Medium | Medium | **MEDIUM** | Wrap execution pipeline in `finally` block executing `worktrees.gcRun(runId)` (`MH-REM-020`). | Run automated setup CLI disk cleanup on application boot (`MH-REM-048`). | Infrastructure Lead |
| `RISK-API-001` | API / Web UI | SSE Stream Disconnect Leaving Server Polling Loop Active | High | Medium | **HIGH** | Wire `request.signal.addEventListener('abort', ...)` to terminate background polling timers (`MH-REM-032`). | Add server-side inactivity heartbeat timeout (30s) to clear orphan streams. | Web API Lead |
| `RISK-AI-001` | AI Security | Indirect Prompt Injection via Cloned Untrusted Code | High | High | **HIGH** | Enclose user file snippets in `<user_file_content>` XML envelope tags and filter injection keywords (`MH-REM-038`). | Abort LLM decomposition if prompt injection pattern exceeds confidence threshold. | AI Guardrails Lead |
| `RISK-AI-002` | AI Security | Uncapped LLM Token Consumption Drain | Medium | High | **HIGH** | Enforce `maxBudget` cumulative token spending limits per run in `LLMDecomposer` (`MH-REM-039`). | Require explicit user confirmation in UI before executing high-token prompts. | AI Guardrails Lead |
| `RISK-QA-001` | QA & Testing | Fragile Regex UI Tests Masking Layout Regressions | High | Low | **MEDIUM** | Refactor source code string matching tests to DOM component rendering tests (`MH-REM-003`). | Revert component layout changes failing visual scale assertions. | QA Lead |
| `RISK-SCOPE-001` | Scope | Misallocating Effort to Out-of-Scope Multi-Tenant SaaS Features | Medium | Medium | **MEDIUM** | Label all SaaS/OAuth/K8s/Billing requirements as `OUT_OF_SCOPE_SAAS` across all ledgers (`MH-REM-031`). | Refocus engineering sprints strictly on single-user local self-hosted product milestones. | Orchestrator Lead |

---

## 3. Contingency Response Protocol

If a High-Score risk materializes during remediation execution:

1. **Immediate Quarantine**: Pause execution of the affected wave component.
2. **Regression Isolation**: Run targeted regression test suite to isolate failure cause.
3. **Contingency Activation**: Execute pre-planned contingency action specified in matrix.
4. **Handoff Documentation**: Log root cause and mitigation outcome in agent `handoff.md`.
