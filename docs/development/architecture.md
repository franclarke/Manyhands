# Architecture

ManyHands is a visual orchestration workspace for multi-agent software development. Takes a feature in natural language, decomposes it recursively into a hierarchical DAG, executes leaf tasks in isolated git worktrees with Gemini CLI, and integrates results bottom-up with cherry-pick.

## Product Architecture

```
Web App (Next.js App Router)
  → API routes
  → Core orchestration (RunExecutor)
  → Agent executor (GeminiCliExecutor)
  → Git / worktree layer (WorktreeManager, SimpleGitRunner)
  → Trace / evaluation layer (trace-store, run-store)
```

The web app does not reimplement orchestration logic. It calls API routes backed by existing package APIs and displays validated core artifacts: `TaskGraph`, `AgentTaskContract`, `RunRecord`, `GranularityVector`.

## Execution Pipeline

```
Feature prompt (user)
  → GeminiRecursiveDecomposer     (recursive interface-aware decomposition)
  → TaskGraph + AgentTaskContracts + sharedInterfaces
  → RunExecutor (orchestrator)
      → BatchScheduler             (maxParallel=3, respects graph dependencies)
      → WorktreeManager.create()   (isolated git worktree per leaf)
      → FileSystemContextPacker    (files + consumedInterfaces → prompt)
      → GeminiCliExecutor          (gemini -p <prompt> --approval-mode yolo)
      → ScopeChecker               (git diff --name-only vs allowed/forbidden paths)
      → ValidationRunner           (leafValidationCommands)
      → ResultRecorder             (git diff HEAD → patch + trace events)
      → git commit (orchestrator)
      → WorktreeManager.clean()
  → IntegrationAgent (bottom-up, per composite)
      → git cherry-pick (topological order)
      → Gemini semantic repair on conflict (max 1 attempt)
        - context: parent goal + sharedInterface + child intents
      → ValidationRunner           (parentValidationCommands)
  → GranularityVector              (17 metrics: 9 pre-execution + 8 post-execution)
  → RunRecord (persisted as JSON)
```

## Package Boundaries

Dependency direction: `apps → specific packages → shared`. Never import from `apps` inside packages. `@manyhands/core` is a legacy barrel still consumed by `apps/web` for shared types and the mock-planning flow; do not add new dependencies to it.

| Package | Responsibility | Status |
|---------|---------------|--------|
| `task-graph` | TaskNode, TaskGraph, DAG validation, topo sort | Active |
| `contracts` | AgentTaskContract V1+V2, InterfaceContract, ExecutionScope | Active |
| `decomposer` | GeminiRecursiveDecomposer (default), Anthropic baselines | Active |
| `execution-core` | Full real-execution pipeline | Active |
| `scheduler` | sequential_dag, parallel_naive, risk_aware policies | Active |
| `run-store` | RunSnapshot, patches, JSON persistence | Active |
| `trace-store` | TraceEvent (planning + execution) | Active |
| `conflict-risk` | Pairwise conflict risk prediction (consumed by the UI) | Active |
| `repository-index` | Structural TypeScript repo index (feeds conflict-risk) | Active |
| `shared` | EntityId, IsoTimestamp, NonEmptyString | Active |
| `core` | Legacy barrel consumed by apps/web | Legacy |

The Lab Mode packages (`scope-validation`, `worktree-runner`, `evaluator`) and the `calculator` smoke-test artefact were removed in the June 2026 cleanup.

## Thesis Artifacts

**Artifact 1 — Interface-Aware Recursive Decomposer** (`packages/decomposer/src/llm/recursive/`):
`GeminiRecursiveDecomposer` decomposes each node with a single LLM call that decides `atomic` (leaf) or `decompose` (composite + sharedInterface). When decomposing, it produces TypeScript type and function signatures that the child nodes must honor. The `FileSystemContextPacker` injects `consumedInterfaces` into each leaf's prompt, fixing the inter-agent seam before dispatching agents in parallel.

**Artifact 2 — Contract-Aware Composer** (`packages/execution-core/src/integration/agent.ts`):
`IntegrationAgent` does cherry-pick and, on conflict, invokes Gemini with full semantic context: parent goal, canonical `sharedInterface`, each child's intent and diff. Repair resolves by reference to the contract, not by guessing the merge. If `parentValidationCommands` exist, the Composer runs them against the integrated worktree to verify the seam is correct.

## Decomposer Policy

Configurable via `MANYHANDS_DECOMPOSER` env var:

| Value | Decomposer | Requirement |
|-------|-----------|-------------|
| (default) | `GeminiRecursiveDecomposer` | `MANYHANDS_GEMINI_BIN` (default: `gemini`) |
| `single-pass` | `AnthropicSinglePassDecomposer` | `ANTHROPIC_API_KEY` |
| `anthropic-recursive` | `AnthropicRecursiveDecomposer` | `ANTHROPIC_API_KEY` |

## Runtime Design

- **Persistence:** JSON for workspaces and runs. SQLite deferred.
- **SSE:** execution events streamed to the web UI in real time via `/api/runs/[runId]/events`.
- **Repos:** supports both fixture provisioning (`createFixtureRepoProvisioner`, ADR-0027) and local git folders (`createDefaultRepoProvisioner` with `kind: "localPath"`).
- **Tests:** 344 passing + 3 skipped. `MockAgentExecutor` enables pipeline testing without invoking Gemini.

## Lab Mode

The original deterministic Lab Mode (`mock-v0`/`conflict-v0` fixtures, `MetadataDrivenMockDecomposer`, `/lab`/`/replay` routes) was removed in June 2026. A new Lab will be designed from scratch when the thesis formulation is finalized and the product is ready.
