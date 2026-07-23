# 12 — Open Architectural Questions & Decision Tradeoffs

**Target Repository**: ManyHands  
**Scope**: Local Single-User Self-Hosted Application (127.0.0.1 / localhost)  
**Document Status**: Final Architectural Plan  
**Target Product Level**: Level D (Finished Local Product)  

---

## 1. Overview & Decision Framework

This document records key architectural tradeoffs, underspecified contract details, and design decisions that require architect or lead developer confirmation prior to or during remediation implementation.

In accordance with the **Local Single-User Self-Hosted Scope Directive**:
- Options are evaluated based on simplicity, host safety, local execution performance, and developer experience on `localhost`.

---

## 2. Key Architectural Questions & Tradeoff Analysis

### Question 1: Worktree Sandbox vs Local Docker Container Isolation

- **Context**: Agents execute validation commands and code modifications. Should execution run directly in git worktrees on the host OS or inside isolated local Docker containers?
- **Options Considered**:
  - **Option A (Default Worktree Isolation)**: Run commands directly in isolated Git worktrees with environment variable sanitization (`buildAgentEnvironment()`) and path traversal checks.
    - *Pros*: Fast, zero Docker installation prerequisite, instant execution.
    - *Cons*: Relies on Node process boundaries for host protection.
  - **Option B (Mandatory Docker Container Isolation)**: Execute all validation and agent commands inside ephemeral Docker containers.
    - *Pros*: Perfect containerized process and file system isolation.
    - *Cons*: Requires Docker Desktop/Daemon running on developer machine; slower setup.
- **Recommended Option**: **Option A as primary default**, with Option B available as an optional adapter (`MH-REM-046`).
- **Impact on Architecture**: Keeps initial developer onboarding friction minimal while allowing security-sensitive users to enable Docker sandboxing via local config.
- **Decision Status**: **PROPOSED / AWAITING ARCHITECT SIGN-OFF**

---

### Question 2: Grounding Agent Dirty Workspace Behavior

- **Context**: When a user launches a goal run in a local repository that contains uncommitted changes (`git status --porcelain != ""`), how should `GroundingAgent` react?
- **Options Considered**:
  - **Option A (Strict Abort)**: Immediately abort run initialization with a clear error: `"Repository has uncommitted changes. Stash or commit before running."`
  - **Option B (Automatic Temporary Stash)**: Automatically run `git stash save` before grounding and `git stash pop` after run completion.
  - **Option C (Isolated Skeleton Worktree)**: Create a temporary worktree from `HEAD` and write walking skeleton files exclusively inside the temporary worktree.
- **Recommended Option**: **Option A by default**, with an optional flag `--allow-dirty` that triggers Option C.
- **Impact on Architecture**: Guarantees zero risk of staging or overwriting user uncommitted work (`MH-AUDIT-GIT-010`).
- **Decision Status**: **PROPOSED / AWAITING ARCHITECT SIGN-OFF**

---

### Question 3: Event Store Log Compaction & Snapshot Thresholds

- **Context**: Long-running runs accumulate tens of thousands of JSONL events. When should event log compaction truncate historical WAL lines?
- **Options Considered**:
  - **Option A (Event Count Threshold)**: Trigger compaction every 5,000 recorded events.
  - **Option B (File Size Threshold)**: Trigger compaction when `events.jsonl` exceeds 10 MB.
  - **Option C (Snapshot Checkpoint Boundary)**: Compact historical events prior to the latest verified `RunSnapshot` whenever a milestone completes.
- **Recommended Option**: **Option C combined with Option B (10 MB cap)**.
- **Impact on Architecture**: Prevents event replay degradation while ensuring crash recovery can always rebuild state from the last snapshot (`MH-REM-015`).
- **Decision Status**: **PROPOSED / AWAITING ARCHITECT SIGN-OFF**

---

### Question 4: Local API Secret Storage & Key Management

- **Context**: Where should LLM API keys (OpenAI, Anthropic, Gemini) and local session tokens be stored on a self-hosted single-user installation?
- **Options Considered**:
  - **Option A (Environment Variables / `.env.local`)**: Read keys directly from `process.env` or local `.env.local` file.
  - **Option B (Encrypted Local Keyring)**: Encrypt API keys using machine-specific hardware key/passphrase before storing on disk.
- **Recommended Option**: **Option A for local development baseline**, with Option B as a hardening enhancement (`MH-REM-042`).
- **Impact on Architecture**: Simple configuration for local users while preventing secret leakage to spawned agent sub-processes.
- **Decision Status**: **PROPOSED / AWAITING ARCHITECT SIGN-OFF**

---

### Question 5: Untrusted LLM Command Execution Confirmation Threshold

- **Context**: When an agent proposes executing terminal shell commands during goal execution, which commands require explicit human confirmation in the UI?
- **Options Considered**:
  - **Option A (Confirm All Commands)**: Require human click confirmation for every shell command.
  - **Option B (Confirm Mutating / High-Risk Commands)**: Automatically execute read-only commands (`git status`, `pnpm test`), but block and prompt human confirmation for mutating or destructive commands (`git push`, `rm`, `npm publish`).
  - **Option C (Fully Autonomous)**: Execute all proposed commands automatically without human prompt.
- **Recommended Option**: **Option B (Contextual Decision Card & Modal)** (`MH-REM-043`).
- **Impact on Architecture**: Aligns with `PRODUCT.md` decision queue design while protecting local developer machine from hostile prompt injections.
- **Decision Status**: **PROPOSED / AWAITING ARCHITECT SIGN-OFF**
