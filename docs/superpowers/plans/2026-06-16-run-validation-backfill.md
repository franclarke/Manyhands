# Run-Validation Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `completed` imply the project's tests passed on the integrated deliverable, by deterministically backfilling run-level validation commands and marking honest `unverified` completions when no command exists.

**Architecture:** Two pure helpers in `execution-state.ts` — one backfills `root.contract.runValidationCommands` from detected workspace commands at planning time, the other derives a `validation` summary at settle time. Wiring is additive: planning-host persists the backfilled graph; `settleExecutionOutcome` attaches the summary; the presenter surfaces it. No executor or graph-node changes — the run-level validation node already consumes `root.contract.runValidationCommands`.

**Tech Stack:** TypeScript, Zod, Vitest, Next.js (apps/web), pnpm monorepo.

**Spec:** [docs/superpowers/specs/2026-06-16-run-validation-backfill-design.md](../specs/2026-06-16-run-validation-backfill-design.md) (alcance A).

---

## File Structure

- `apps/web/src/lib/server/runs/execution-state.ts` — **modify**: add pure helpers `backfillRunValidationCommands` and `deriveRunValidationSummary` next to the existing `collectRunValidationCommands`.
- `apps/web/src/lib/server/runs/schema.ts` — **modify**: add `RunValidationSummarySchema` and the optional `validation` field on `RunRecordSchema`.
- `apps/web/src/lib/server/runs/planning-host.ts` — **modify**: invoke the backfill in `runCriticsForRun` and persist the mutated graph into `run.planning`.
- `apps/web/src/lib/server/runs/execution-pipeline.ts` — **modify**: derive and attach `validation` in `settleExecutionOutcome` (both completed and failed branches).
- `apps/web/src/lib/api-types.ts` — **modify**: add `validation` to `RunResponse["run"]`.
- `apps/web/src/lib/server/runs/presenter.ts` — **modify**: pass `run.validation` through in `toRunResponse`.
- `tests/run-validation-backfill.test.ts` — **create**: unit tests for the two pure helpers.

> **TDD note (CLAUDE.md §6):** every task writes the failing test first (red), then the minimal code (green). No implementation line is written before its red test.

---

## Task 1: `backfillRunValidationCommands` pure helper

**Files:**
- Test: `tests/run-validation-backfill.test.ts`
- Modify: `apps/web/src/lib/server/runs/execution-state.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/run-validation-backfill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TaskGraph } from "@manyhands/task-graph";
import { backfillRunValidationCommands } from "@/lib/server/runs/execution-state";
import type { DetectedCommands } from "@/lib/server/providers/command-detection";

function graphWithRoot(rootContract?: Record<string, unknown>): TaskGraph {
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-06-16T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "Root",
        goal: "root",
        status: "planned",
        granularity: "auto",
        depth: 0,
        childrenIds: ["leaf"],
        dependencies: [],
        ...(rootContract !== undefined ? { contract: rootContract } : {})
      }
    }
  } as unknown as TaskGraph;
}

const detected: DetectedCommands = { packageManager: "npm", test: "npm run test" };

describe("backfillRunValidationCommands", () => {
  it("injects the detected test command on a root with empty run validation", () => {
    const { graph, backfilled } = backfillRunValidationCommands(graphWithRoot({}), detected);
    expect(backfilled).toEqual({ command: "npm", args: ["run", "test"], timeoutMs: 120_000, cwd: "worktree" });
    const root = graph.nodes[graph.rootId] as { contract: { runValidationCommands: unknown[] } };
    expect(root.contract.runValidationCommands).toEqual([backfilled]);
  });

  it("does not overwrite run validation commands the LLM already authored", () => {
    const existing = [{ command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }];
    const input = graphWithRoot({ runValidationCommands: existing });
    const { graph, backfilled } = backfillRunValidationCommands(input, detected);
    expect(backfilled).toBeUndefined();
    const root = graph.nodes[graph.rootId] as { contract: { runValidationCommands: unknown[] } };
    expect(root.contract.runValidationCommands).toEqual(existing);
  });

  it("prefers test over build/typecheck/lint", () => {
    const all: DetectedCommands = {
      packageManager: "npm",
      test: "npm run test",
      build: "npm run build",
      typecheck: "npm run typecheck",
      lint: "npm run lint"
    };
    const { backfilled } = backfillRunValidationCommands(graphWithRoot({}), all);
    expect(backfilled?.args).toEqual(["run", "test"]);
  });

  it("is a no-op when no command was detected", () => {
    const input = graphWithRoot({});
    const { graph, backfilled } = backfillRunValidationCommands(input, { packageManager: "unknown" });
    expect(backfilled).toBeUndefined();
    const root = graph.nodes[graph.rootId] as { contract?: { runValidationCommands?: unknown[] } };
    expect(root.contract?.runValidationCommands ?? []).toEqual([]);
  });

  it("rejects a detected command that violates the safety whitelist", () => {
    const unsafe: DetectedCommands = { packageManager: "npm", test: "npm run test && rm -rf /" };
    const { backfilled } = backfillRunValidationCommands(graphWithRoot({}), unsafe);
    expect(backfilled).toBeUndefined();
  });

  it("does not mutate the input graph (pure)", () => {
    const input = graphWithRoot({});
    backfillRunValidationCommands(input, detected);
    const root = input.nodes[input.rootId] as { contract: { runValidationCommands?: unknown[] } };
    expect(root.contract.runValidationCommands).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- run-validation-backfill`
Expected: FAIL — `backfillRunValidationCommands` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/lib/server/runs/execution-state.ts`, add imports at the top:

```ts
import { validationCommandSafetyIssues, type ExecutionValidationCommand } from "@manyhands/contracts";
import type { DetectedCommands } from "../providers/command-detection";
```

Then append:

```ts
const RUN_VALIDATION_TIMEOUT_MS = 120_000;

/** First detected command, in the same priority order as the plan critic. */
function detectedValidationCommand(detected: DetectedCommands | undefined): string | undefined {
  if (detected === undefined) return undefined;
  return detected.test ?? detected.build ?? detected.typecheck ?? detected.lint;
}

/** Split a "npm run test" string into a safe { command, args } pair, or undefined. */
function toExecutionValidationCommand(detectedCommand: string): ExecutionValidationCommand | undefined {
  const tokens = detectedCommand.trim().split(/\s+/);
  const [command, ...args] = tokens;
  if (command === undefined || command.length === 0) return undefined;
  if (validationCommandSafetyIssues(command, args).length > 0) return undefined;
  return { command, args, timeoutMs: RUN_VALIDATION_TIMEOUT_MS, cwd: "worktree" };
}

/**
 * Deterministically backfill the root's run-level validation command from the
 * detected workspace commands when the decomposer left it empty. Pure: returns a
 * cloned graph; never overwrites LLM-authored commands.
 */
export function backfillRunValidationCommands(
  graph: TaskGraph,
  detected: DetectedCommands | undefined
): { graph: TaskGraph; backfilled?: ExecutionValidationCommand } {
  const existing = collectRunValidationCommands(graph);
  if (existing.length > 0) return { graph };

  const detectedCommand = detectedValidationCommand(detected);
  if (detectedCommand === undefined) return { graph };

  const command = toExecutionValidationCommand(detectedCommand);
  if (command === undefined) return { graph };

  const next = structuredClone(graph);
  const root = next.nodes[next.rootId] as { contract?: Record<string, unknown> } | undefined;
  if (root === undefined) return { graph };
  root.contract = { ...(root.contract ?? {}), runValidationCommands: [command] };
  return { graph: next, backfilled: command };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- run-validation-backfill`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/run-validation-backfill.test.ts apps/web/src/lib/server/runs/execution-state.ts
git commit -m "feat(runs): deterministic run-level validation backfill helper"
```

---

## Task 2: `deriveRunValidationSummary` pure helper + schema field

**Files:**
- Test: `tests/run-validation-backfill.test.ts` (append)
- Modify: `apps/web/src/lib/server/runs/execution-state.ts`
- Modify: `apps/web/src/lib/server/runs/schema.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/run-validation-backfill.test.ts`:

```ts
import { deriveRunValidationSummary } from "@/lib/server/runs/execution-state";

function graphWithRunCommand(): TaskGraph {
  return graphWithRoot({
    runValidationCommands: [{ command: "npm", args: ["run", "test"], timeoutMs: 120_000, cwd: "worktree" }]
  });
}

describe("deriveRunValidationSummary", () => {
  const at = "2026-06-16T00:00:00.000Z";

  it("marks completed runs with run commands as passed", () => {
    const summary = deriveRunValidationSummary(graphWithRunCommand(), "completed", { passed: true }, at);
    expect(summary).toEqual({ status: "passed", command: "npm run test", ranAt: at });
  });

  it("marks completed runs without run commands as unverified", () => {
    const summary = deriveRunValidationSummary(graphWithRoot({}), "completed", undefined, at);
    expect(summary).toEqual({ status: "unverified" });
  });

  it("marks failed runs whose run validation failed as failed", () => {
    const summary = deriveRunValidationSummary(graphWithRunCommand(), "failed", { passed: false }, at);
    expect(summary).toEqual({ status: "failed", command: "npm run test", ranAt: at });
  });

  it("returns undefined for failures unrelated to run validation", () => {
    expect(deriveRunValidationSummary(graphWithRoot({}), "failed", undefined, at)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- run-validation-backfill`
Expected: FAIL — `deriveRunValidationSummary` is not exported.

- [ ] **Step 3: Add the schema type first (single source of truth)**

In `apps/web/src/lib/server/runs/schema.ts`, add before `RunRecordSchema`:

```ts
export const RunValidationSummarySchema = z.object({
  status: z.enum(["passed", "failed", "unverified"]),
  command: z.string().optional(),
  ranAt: z.string().datetime().optional()
});

export type RunValidationSummary = z.infer<typeof RunValidationSummarySchema>;
```

Inside `RunRecordSchema`, add next to `repositoryGrounding` (near the end of the object):

```ts
  /** Run-level validation verdict, surfaced so `completed` never implies an unrun check. */
  validation: RunValidationSummarySchema.optional(),
```

- [ ] **Step 4: Write the helper, importing the single type**

In `apps/web/src/lib/server/runs/execution-state.ts`, extend the existing
`import type { RunRecord } from "./schema";` to also bring in the summary type:

```ts
import type { RunRecord, RunValidationSummary } from "./schema";
```

Then append the helper (no local type — reuse the schema type to avoid a
duplicate `RunValidationSummary` export colliding through the runs barrel):

```ts
/** Summarize run-level validation for honest `completed`/`failed` reporting. */
export function deriveRunValidationSummary(
  graph: TaskGraph,
  outcomeStatus: string,
  validationResult: { passed: boolean } | undefined,
  at: string
): RunValidationSummary | undefined {
  const commands = collectRunValidationCommands(graph);
  const label =
    commands.length > 0 ? `${commands[0]!.command} ${(commands[0]!.args ?? []).join(" ")}`.trim() : undefined;

  if (outcomeStatus === "completed") {
    return label === undefined ? { status: "unverified" } : { status: "passed", command: label, ranAt: at };
  }
  if (validationResult?.passed === false && label !== undefined) {
    return { status: "failed", command: label, ranAt: at };
  }
  return undefined;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test -- run-validation-backfill`
Expected: PASS (10 tests total).
Run: `pnpm web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/run-validation-backfill.test.ts apps/web/src/lib/server/runs/execution-state.ts apps/web/src/lib/server/runs/schema.ts
git commit -m "feat(runs): derive run-level validation summary + schema field"
```

---

## Task 3: Wire backfill into planning

**Files:**
- Modify: `apps/web/src/lib/server/runs/planning-host.ts:398-420` (`runCriticsForRun`)

- [ ] **Step 1: Write the failing test**

Create `tests/run-validation-planning-backfill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backfillRunValidationCommands, collectRunValidationCommands } from "@/lib/server/runs/execution-state";
import type { TaskGraph } from "@manyhands/task-graph";

// Guard test: the planning wiring must persist what the helper produces, so the
// execution-time reader (collectRunValidationCommands) sees the backfilled cmd.
it("a backfilled graph exposes the run command to the execution reader", () => {
  const graph = {
    id: "g", planId: "p", repo: "r", baseBranch: "main", baseCommit: "0".repeat(40),
    rootId: "root", createdAt: "2026-06-16T00:00:00.000Z", dependencies: [],
    nodes: { root: { id: "root", parentId: null, kind: "root", title: "R", goal: "r", status: "planned", granularity: "auto", depth: 0, childrenIds: [], dependencies: [], contract: {} } }
  } as unknown as TaskGraph;
  const { graph: next } = backfillRunValidationCommands(graph, { packageManager: "npm", test: "npm run test" });
  expect(collectRunValidationCommands(next)).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails or passes for the right reason**

Run: `pnpm test -- run-validation-planning-backfill`
Expected: PASS (it exercises Task 1/2 code). This pins the contract the wiring must honor.

- [ ] **Step 3: Wire the backfill in `runCriticsForRun`**

In `apps/web/src/lib/server/runs/planning-host.ts`, import the helper at the top:

```ts
import { backfillRunValidationCommands } from "./execution-state";
```

In `runCriticsForRun`, after `detectedCommands` is resolved and before computing `planningCritic`, mutate and persist the planning graph. Replace the existing `await repo.save({ ...(await repo.get(runId)), planningCritic, seamCritic });` block with:

```ts
  // Deterministic run-level validation backfill: if the decomposer left the root
  // without run validation commands, inject the detected project command so the
  // run-level validation node actually runs and `completed` means "tests green".
  const latest = await repo.get(runId);
  const latestPlanning = latest.planning as MockPlanningFlowResult | undefined;
  let planningToPersist = latest.planning;
  if (latestPlanning !== undefined) {
    const { graph: backfilledGraph, backfilled } = backfillRunValidationCommands(
      latestPlanning.decomposition.graph,
      detectedCommands
    );
    if (backfilled !== undefined) {
      planningToPersist = {
        ...latestPlanning,
        decomposition: { ...latestPlanning.decomposition, graph: backfilledGraph }
      };
    }
  }
  await repo.save({ ...latest, planning: planningToPersist, planningCritic, seamCritic });
```

- [ ] **Step 4: Run typecheck + full suite**

Run: `pnpm web:typecheck`
Expected: no errors (the `MockPlanningFlowResult` import already exists in planning-host.ts).
Run: `pnpm test`
Expected: PASS (no regressions; existing planning-host tests still green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/runs/planning-host.ts tests/run-validation-planning-backfill.test.ts
git commit -m "feat(runs): backfill run validation command during planning"
```

---

## Task 4: Attach `validation` summary at settle time

**Files:**
- Modify: `apps/web/src/lib/server/runs/execution-pipeline.ts:600-645` (`settleExecutionOutcome`)

- [ ] **Step 1: Write the failing test**

The derivation logic is already unit-tested in Task 2. This task wires it; verify by a focused assertion in an existing execution-pipeline test if present, otherwise rely on typecheck + the Task 2 unit tests. Add a regression assertion to `tests/run-validation-backfill.test.ts`:

```ts
it("passed summary carries the exact command label", () => {
  const summary = deriveRunValidationSummary(graphWithRunCommand(), "completed", { passed: true }, "2026-06-16T00:00:00.000Z");
  expect(summary?.command).toBe("npm run test");
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test -- run-validation-backfill`
Expected: PASS.

- [ ] **Step 3: Wire into `settleExecutionOutcome`**

In `apps/web/src/lib/server/runs/execution-pipeline.ts`, import the helper (it is exported from the runs barrel; add to the existing `execution-state` import or import directly):

```ts
import { deriveRunValidationSummary } from "./execution-state";
```

After computing `result` (around line 606), add:

```ts
  const validationSummary = deriveRunValidationSummary(
    host.taskGraph,
    outcome.status,
    persistedValidation,
    new Date().toISOString()
  );
```

In the completed branch, extend the `transitionTo(currentRun, "completed", { ... })` payload:

```ts
    await transitionTo(currentRun, "completed", {
      execution: result,
      ...(finalApplication !== undefined ? finalApplication : {}),
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      completedAt: new Date().toISOString()
    });
```

In the failed branch, extend the `getRunRepository().save({ ... })` payload:

```ts
    await getRunRepository().save({
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      execution: result,
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      errorMessage: outcome.errorMessage ?? describeExecutionFailure(result)
    });
```

- [ ] **Step 4: Run typecheck + suite**

Run: `pnpm web:typecheck`
Expected: no errors.
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/runs/execution-pipeline.ts tests/run-validation-backfill.test.ts
git commit -m "feat(runs): attach run validation summary on settle"
```

---

## Task 5: Surface `validation` through the API presenter

**Files:**
- Modify: `apps/web/src/lib/api-types.ts` (add `validation` to `RunResponse["run"]`)
- Modify: `apps/web/src/lib/server/runs/presenter.ts:7-68` (`toRunResponse`)

- [ ] **Step 1: Write the failing test**

Create `tests/run-presenter-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toRunResponse } from "@/lib/server/runs/presenter";
import type { RunRecord } from "@/lib/server/runs/schema";

function baseRun(): RunRecord {
  return {
    runId: "r1", workspaceId: "w1", granularity: "balanced", model: "gemini-2.5-flash",
    userPrompt: "x", title: "x", version: 1, status: "completed",
    createdAt: "2026-06-16T00:00:00.000Z", updatedAt: "2026-06-16T00:00:00.000Z", patches: []
  } as unknown as RunRecord;
}

describe("toRunResponse validation", () => {
  it("passes the validation summary through", () => {
    const run = { ...baseRun(), validation: { status: "unverified" as const } };
    expect(toRunResponse(run).run.validation).toEqual({ status: "unverified" });
  });

  it("omits validation when absent", () => {
    expect(toRunResponse(baseRun()).run.validation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- run-presenter-validation`
Expected: FAIL — `validation` is not on the response payload.

- [ ] **Step 3: Add the type**

In `apps/web/src/lib/api-types.ts`, find the `RunResponse` `run` object type and add (next to `status`):

```ts
    validation?: { status: "passed" | "failed" | "unverified"; command?: string; ranAt?: string };
```

- [ ] **Step 4: Pass it through in the presenter**

In `apps/web/src/lib/server/runs/presenter.ts`, inside `toRunResponse`, after the `payload` object is created (e.g. after line 19), add:

```ts
  if (run.validation !== undefined) payload.validation = run.validation;
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `pnpm test -- run-presenter-validation`
Expected: PASS.
Run: `pnpm web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api-types.ts apps/web/src/lib/server/runs/presenter.ts tests/run-presenter-validation.test.ts
git commit -m "feat(runs): expose run validation summary in the run API"
```

---

## Task 6: Plan-review visibility (info finding) — optional but recommended

**Files:**
- Modify: `apps/web/src/lib/plan-critic.ts` (emit an info finding when backfill will apply)

> This makes the plan-review panel show that run-level validation WILL run. It is
> cosmetic; skip if scope must stay minimal.

- [ ] **Step 1: Write the failing test**

Append to `tests/plan-critic.test.ts` a case: a graph whose root has no `runValidationCommands` but `detectedCommands.test` is present should yield a `run_validation_backfilled` info finding. (Mirror the existing `missing_validation_commands` test shape in that file.)

- [ ] **Step 2: Run it**

Run: `pnpm test -- plan-critic`
Expected: FAIL — no such finding yet.

- [ ] **Step 3: Implement**

In `runPlanCritic`, after the leaf loop, if `suggested !== undefined` and the root has no `runValidationCommands`, push:

```ts
  findings.push({
    severity: "info",
    code: "run_validation_backfilled",
    message: `Run-level validation will run \`${suggested}\` on the integrated result.`
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- plan-critic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/plan-critic.ts tests/plan-critic.test.ts
git commit -m "feat(runs): plan critic flags run-validation backfill"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the whole suite + typechecks**

Run: `pnpm test`
Expected: all green (prior baseline was 1047 passed; new tests add to it).
Run: `pnpm web:typecheck && pnpm -F @manyhands/execution-core typecheck`
Expected: no errors.

- [ ] **Step 2: Manual E2E regression (optional, needs dev server + gemini)**

Re-run the `dicey` flow from memory `manyhands-e2e-run-via-api`: create a fresh repo with a `test` script, POST a run with `autonomy: "autonomous"`, and confirm (a) the persisted plan's root carries `runValidationCommands`, and (b) the run only reaches `completed` if `node --test` passes, with `validation.status === "passed"`.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch to merge or open a PR for `feat/run-validation-backfill`.

---

## Out of scope (see spec §7)

Recoverable gate on run-validation failure (currently hard `failed`), parent/leaf backfill, LLM repair of leaf commands, and `npm install` provisioning for repos with dependencies.
