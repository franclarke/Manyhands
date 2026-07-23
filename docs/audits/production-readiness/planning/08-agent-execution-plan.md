# 08 — Multi-Agent Execution Plan & Collaboration Topology

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Executive Summary & Team Topology

This document specifies the multi-agent execution topology, role boundaries, workspace discipline, context window management, handoff protocols, and verification standards required to execute the ManyHands remediation backlog (`MH-REM-001` through `MH-REM-050`).

To achieve rapid, high-quality parallel execution without workspace contamination or regressions:
- Autonomous subagents operate inside designated workspace folders under `.agents/`.
- Every agent is assigned specific roles and wave targets.
- All code modifications follow the **Minimal Change Principle** and **Integrity Mandate** (zero hardcoding, real logic execution).

```
                            ┌─────────────────────────────────┐
                            │    Orchestrator Coordinator     │
                            │   (Phase & Wave Supervision)    │
                            └────────────────┬────────────────┘
                                             │
      ┌──────────────────────────────┬───────┴───────────────┬──────────────────────────────┐
      │                              │                       │                              │
┌─────▼───────┐              ┌───────▼─────┐         ┌───────▼─────┐                ┌───────▼─────┐
│ Implementer │              │ Implementer │         │   QA Agent  │                │ Specialist  │
│  Agent A    │              │   Agent B   │         │ (Regression │                │ Security /  │
│ (Core Graph │              │(Persistence/│         │ & Evidence) │                │ Git Sandbox)│
│ & Contracts)│              │  Web Core)  │         └─────────────┘                └─────────────┘
└─────────────┘              └─────────────┘
```

---

## 2. Agent Roles & Operational Archetypes

### 1. Orchestrator Coordinator (`orchestrator`)
- **Primary Function**: Manages overall wave progression, verifies exit criteria before advancing to subsequent waves, resolves inter-agent dependencies, and enforces system prompt protections.
- **Allowed Actions**: Launching subagents, reviewing `handoff.md` reports, updating master `BRIEFING.md`, executing repository build verification commands.
- **Prohibited Actions**: Direct code modifications in `apps/` or `packages/`.

### 2. Implementer Agents (`implementer_1`, `implementer_2`, ...)
- **Primary Function**: Executes code modifications in `apps/` and `packages/` to implement specific `MH-REM-XXX` items.
- **Workflow**: Re-read target file ➔ Assess impact ➔ Modify using `replace_file_content` / `multi_replace_file_content` ➔ Run build & typecheck ➔ Document changes in `handoff.md`.
- **Prohibited Actions**: Whole-file replacements, "while-I'm-here" refactoring, modifying files without prior view.

### 3. QA & Verification Agents (`qa_1`, `qa_2`)
- **Primary Function**: Independently verifies implemented code changes against test suites, writes regression tests for `MH-AUDIT-XXX` findings, and inspects evidence matrices.
- **Workflow**: Reproduce failure ➔ Run fix ➔ Verify edge cases ➔ Audit code changes for integrity violations or facade implementations.
- **Prohibited Actions**: Feature development or unverified pass claims.

### 4. Specialist Domain Agents (`specialist_security`, `specialist_git`)
- **Primary Function**: Provides deep technical domain analysis (e.g., OS process isolation, git worktree internals, prompt injection sanitization).
- **Workflow**: Inspect codebase ➔ Provide targeted implementation patterns and adversarial attack payloads to implementers.

---

## 3. Workspace Discipline & File Conventions

Each agent operates strictly within its designated folder in `.agents/`:

```
.agents/
├── orchestrator/           # Master plan, progress, briefing
├── implementer_1/          # Task worker workspace (MH-REM-001 to 005)
├── implementer_2/          # Task worker workspace (MH-REM-006 to 011)
├── qa_1/                   # QA verification workspace
└── ...
```

### Strict Workspace Rules
1. **Metadata Only**: `.agents/` contains ONLY agent metadata (`BRIEFING.md`, `progress.md`, `ORIGINAL_REQUEST.md`, `handoff.md`).
2. **NO Source Code in `.agents/`**: Placing source code, test files, or package code inside `.agents/` is a critical layout compliance violation.
3. **Write Scope**: An agent writes ONLY to its assigned folder in `.agents/` and the target files in `apps/` / `packages/` specified in its mission.
4. **Communication Guideline**: Use **Files** for content delivery (handoff reports, proposals) and **Messages** for short coordination ("I'm done, check my report").

---

## 4. 5-Component Handoff Protocol

Every transfer of responsibility or task completion must produce a self-contained `handoff.md` in the agent's working directory containing the following 5 mandatory sections:

1. **Observation**: Exact file paths, line numbers, verbatim errors, and executed command outputs.
2. **Logic Chain**: Step-by-step reasoning connecting observations to conclusions and implementations.
3. **Caveats**: Areas not investigated, assumptions made, or edge cases requiring future monitoring (state "No caveats" if none).
4. **Conclusion**: Actionable final assessment supported directly by the logic chain.
5. **Verification Method**: Independent verification instructions including exact CLI commands (`pnpm test`, `pnpm --filter ... typecheck`) and expected test outputs.

---

## 5. Context Window Management & Succession Rules

To prevent context exhaustion and degradation during long execution runs:

1. **BRIEFING.md Maintenance**: Keep `BRIEFING.md` under **100 lines**. It serves as an active index, not a log.
2. **Append-Only Protection**: The sections `## 🔒 My Identity` and `## 🔒 Key Constraints` are append-only and must NEVER be truncated or removed.
3. **BRIEFING_ARCHIVE.md**: When `BRIEFING.md` exceeds 100 lines, move detailed non-protected logs to `BRIEFING_ARCHIVE.md`.
4. **Context Succession**:
   - **Hard Handoff**: Triggered when a task is fully complete and verified. All 5 handoff sections fully populated.
   - **Soft Handoff**: Triggered when an agent approaches context limits mid-task. The agent writes a `handoff.md` with a detailed "Remaining Work" section, allowing a fresh successor agent to resume seamlessly.

---

## 6. Integrity Mandate & Anti-Cheating Policy

All agent work must be genuine and verifiable. A Forensic Auditor will independently review code edits and test outputs.

### Prohibited Strategies (Violations will cause task rejection)
- ❌ **No Hardcoded Test Returns**: Hardcoding expected string outputs in source methods to pass tests without underlying logic.
- ❌ **No Dummy Facades**: Creating empty stubs or no-op functions that simulate success.
- ❌ **No Test Weakening**: Deleting existing assertions, adding pylint/eslint suppressions without justification, or relaxing test timeouts to mask race conditions.
- ❌ **No Fabricated Evidence**: Inventing commit SHAs, test results, or command logs.
