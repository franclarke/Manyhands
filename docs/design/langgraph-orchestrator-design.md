# ManyHands — Technical Design Specification: LangGraph Orchestrator Refactoring

This document defines the architecture and implementation blueprint for refactoring the ManyHands orchestrator using **LangGraph.js**. It is written as a context-complete specification for agentic AI coding tools to implement the refactoring correctly without violating system invariants.

---

## 1. Context & Rationale

ManyHands is an LLM-agent orchestration system for software development. Its core value proposition is **hierarchical task decomposition, topological scheduling, and bottom-up integration**. 

### The Separation of Concerns
1.  **Agent Execution (Delegated)**: Writing code, editing files, and running local tools within a terminal environment is handled entirely by the **Gemini CLI** (`gemini`, headless via stdin). The orchestrator does *not* deal with low-level coding agent loops.
2.  **Agent Orchestration (Core Focus)**: The orchestrator's sole responsibility is to plan the work tree (DAG), manage the scheduling batches, isolate environments via git worktrees, handle human approvals/clarifications (HITL), and integrate changes bottom-up (resolving conflicts via the Composer).

### Why LangGraph?
Currently, ManyHands uses an ad-hoc, stateless loop with custom caching to pause/resume planning and execute batches. Refactoring the orchestrator into a stateful graph using **LangGraph.js** provides:
-   **Native Human-in-the-Loop (HITL)**: Replaces complex replay-caching and exceptions (`DecomposerQuestionError`) with native `interrupt()` points.
-   **Granular Checkpointing**: Saves execution snapshots per node, enabling time-travel debugging (forking executions).
-   **Formal State Machine**: Replaces Promise-based scheduling loops with a formal, verifiable control flow graph.

---

## 2. Invariants to Maintain (D1–D10)

Any implementation of the LangGraph orchestrator must strictly respect the following project rules:
-   **D1**: `graph.dependencies` remains canonical. Mutations only via `addDependency` / `removeDependency`.
-   **D4**: Gemini CLI remains the sole leaf executor. Do not introduce other LLM executors for coding tasks.
-   **D5**: `git diff HEAD` is the only source of truth for file changes. Do not trust LLM JSON responses for diffs.
-   **D6**: The orchestrator commits. Subagents (Gemini CLI) must never commit.
-   **D8**: Integration must use cherry-pick + Gemini semantic repair on conflict (max 1 attempt).

---

## 3. LangGraph State Schema (`RunState`)

The orchestrator state is modeled as a unified channels annotation.

```typescript
import { Annotation } from "@langchain/langgraph";
import type { TaskGraph } from "@manyhands/task-graph";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";

export const RunStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  workspaceId: Annotation<string>(),
  repoPath: Annotation<string>(),

  // The dynamically generated TaskGraph (software DAG)
  graph: Annotation<TaskGraph | null>(),

  // Queues and caching for decomposition
  planningQueue: Annotation<string[]>(),
  planningStepCache: Annotation<Record<string, any>>(),

  // Execution scheduler state
  currentBatchIndex: Annotation<number>(),
  batches: Annotation<string[][]>(), // array of batches containing task IDs

  // Accumulated results
  leafResults: Annotation<AgentExecutionResult[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),
  integrationResults: Annotation<IntegrationResult[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),

  // Human-in-the-loop variables
  pendingQuestion: Annotation<{ nodeId: string; question: string; options: string[] } | null>(),
  userAnswers: Annotation<Record<string, string>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({})
  }),

  status: Annotation<"created" | "planning" | "needs_review" | "approved" | "running" | "completed" | "failed">(),
  errorMessage: Annotation<string | null>()
});
```

---

## 4. Graph Architecture (StateGraph Topology)

The orchestrator control loop is represented by the following StateGraph:

```
[Start] ──► InitState ──► DecomposeNode ◄── (Answered) ── [QuestionInterrupt] (HITL)
                               │
                       (Plan Completed)
                               ▼
                          CriticNode ──► [ApprovePlanInterrupt] (HITL)
                                                 │
                                            (Approved)
                                                 ▼
                                          ScheduleBatches
                                                 │
                                            (Loop Batches)
                                                 ▼
                                          ExecuteBatchNode (Send Pattern)
                                                 │
                                           (Map-Reduce)
                                                 ▼
                                        IntegrateComposite ◄── [ConflictInterrupt] (HITL)
                                                 │
                                                 ▼
                                           RunValidation
                                                 │
                                                 ▼
                                           ApplyFinalPatch ──► [End]
```

### Key Graph Nodes & Functions

#### 1. `decomposeNode`
Iterates over the `planningQueue`. Invokes `GeminiRecursiveDecomposer`. 
-   If the decomposer returns a `question` decision:
    1.  Writes the question metadata to the `pendingQuestion` state.
    2.  Triggers `interrupt()`.
-   If the decomposer returns a `decompose` decision:
    1.  Appends children to `graph` and updates `planningQueue`.

#### 2. `criticNode`
Runs semantic critics (`runPlanCritic`, `runSeamCritic`) against the completed task graph. Once done, triggers `interrupt()` to await user review of the plan.

#### 3. `executeBatchNode` (Dynamic Concurrency)
Uses LangGraph's dynamic map-reduce pattern (`Send`).
-   For each task in the current batch (`batches[currentBatchIndex]`), it dispatches a `Send("executeLeafNode", { taskId })`.
-   `executeLeafNode` runs independently:
    1.  Creates an isolated worktree.
    2.  Invokes Gemini CLI (`gemini`).
    3.  Runs leaf validations.
    4.  If tests fail: runs 1 auto-repair attempt. If that fails, it pauses via `interrupt()` for human direction.
    5.  Performs git commit and returns the `AgentExecutionResult`.

#### 4. `integrateCompositeNode`
Fuses children's git branches bottom-up via `git cherry-pick`.
-   If a merge conflict occurs, invokes the `Composer` for a 1-attempt repair.
-   If repair fails, triggers `interrupt()` with conflict details to let the user select the resolution.

---

## 5. Persistence: JSON File Checkpointer

To keep database setups lightweight, the checkpointing mechanism is implemented as a custom JSON file checkpointer in the filesystem.

```typescript
import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata } from "@langchain/langgraph-core";
import { join } from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";

export class JsonFileCheckpointSaver extends BaseCheckpointSaver {
  private readonly directory: string;

  constructor(directory: string) {
    super();
    this.directory = directory;
  }

  async getTuple(config: any): Promise<any> {
    const { thread_id, checkpoint_id } = config.configurable;
    const filePath = join(this.directory, thread_id, `${checkpoint_id || "latest"}.json`);
    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  async put(config: any, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<any> {
    const threadId = config.configurable.thread_id;
    const threadDir = join(this.directory, threadId);
    await mkdir(threadDir, { recursive: true });

    const state = { checkpoint, metadata, config };
    const content = JSON.stringify(state, null, 2);

    await writeFile(join(threadDir, `${checkpoint.id}.json`), content, "utf-8");
    await writeFile(join(threadDir, "latest.json"), content, "utf-8");

    return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id } };
  }
}
```

---

## 6. Sincronía del Time-Travel (Forking)
Forking is non-destructive. When the user rolls back from the UI:
1.  The backend reads the history of the target run from the checkpointer.
2.  Clones the StateGraph checkpoint state up to the chosen `checkpoint_id`.
3.  Generates a **new `runId`** in the DB to avoid clobbering the failed run history.
4.  Initializes a new LangGraph process starting from the cloned state.
5.  New worktrees are automatically created under `mh-{newRunId}-{nodeId}`, preventing branch conflicts.

---

## 7. Next.js Integration & Event Sourcing
-   **Page Load**: Server Components fetch the current StateGraph checkpoint directly using `graph.getState({ configurable: { thread_id: runId } })`, avoiding the need to replay old events on page reload.
-   **SSE Stream**: The graph execution writes execution traces directly to the `LiveExecutionTraceStore` on [runner.ts](file:///c:/Users/franc/Documents/Manyhands/apps/web/src/lib/server/runs/runner.ts). The store automatically maps these traces to Server-Sent Events for the React Flow canvas and assistant-ui.

---

## 8. Handoff Milestone Checklist

When implementing this design:
1.  `[ ]` Create `@manyhands/orchestrator-graph` workspace package.
2.  `[ ]` Implement `JsonFileCheckpointSaver` and test it preserves states.
3.  `[ ]` Implement the planning StateGraph (`decomposerNode` + `interrupt` on questions).
4.  `[ ]` Wire the `/api/runs/[id]/resume` endpoint and verify planning resumes cleanly.
5.  `[ ]` Implement the execution StateGraph using `Send` parallel mapping.
6.  `[ ]` Integrate the `/api/runs/[id]/fork` endpoint and verify the canvas draws the fork.
7.  `[ ]` Run `pnpm test` and verify that all core test suites remain green.
