# Wave 0 Implementation Strategies & Diagnosis Report (MH-REM-001, MH-REM-002, MH-REM-003)

**Author**: `teamwork_preview_explorer_m2` (Wave 0 Implementation Explorer)  
**Date**: 2026-07-22  
**Repository**: `c:\Users\franc\Documents\Proyectos\Manyhands`  
**Status**: Comprehensive Investigation Complete  

---

## Executive Summary

This report delivers complete technical designs, root cause analyses, and test specifications for the three Wave 0 tasks:
1. **MH-REM-001 (GroundingAgent Dirty Workspace Check)**: Strategy to enforce clean workspaces before scaffolding walking skeletons in `@manyhands/execution-core`.
2. **MH-REM-002 (Lock Ownership Fencing)**: Design for token-scoped lock releases in `@manyhands/run-store` to prevent premature lock deletion when locks are stolen or stale.
3. **MH-REM-003 (Baseline UI Tests Diagnosis)**: Diagnosis and minimal fix formulations for the two failing baseline UI tests (`tests/typography-scale.test.ts` and `tests/run-loading-skeleton.test.ts`).

---

## 1. MH-REM-001: GroundingAgent Dirty Workspace Check

### 1.1 Problem Statement & Code Inspection
In `packages/execution-core/src/run/grounding-agent.ts`, the `GroundingAgent.run(params)` method scaffolds walking skeleton interface files directly inside `params.repoRoot` and commits them via `GitRunner.commit(...)`.

**Current Workflow in `GroundingAgent.run`**:
- Accepts `params: GroundingAgentParams` (`repoRoot`, `graph`, `selection`/`model`, `runId`).
- Calls `collectProducedInterfaces(params.graph)`. If 0 contracts, returns `this.git.head(params.repoRoot)`.
- Writes deterministic scaffold files using `fs.writeFile` to `params.repoRoot`.
- If unresolved contracts remain, executes `runLlmFallback` (LLM executor writing into `params.repoRoot`).
- Calls `this.git.addAllExcluding(params.repoRoot, DEFAULT_ARTIFACT_GLOBS)` and `this.git.commit(...)`.

**Vulnerability**:
If `params.repoRoot` contains uncommitted changes (dirty index or modified/untracked files) before `GroundingAgent` runs, scaffold generation will write over dirty files or stage pre-existing uncommitted work into the `mh-grounding: walking skeleton scaffold` commit.

### 1.2 Git Operations & `statusPorcelain` Integration
The `GitRunner` interface (`packages/execution-core/src/git/runner.ts`) provides:
```ts
/** Full worktree/index dirtiness for conservative crash recovery. */
statusPorcelain(cwd: string): Promise<string[]>;
```
In `SimpleGitRunner`, `statusPorcelain` runs `git status --porcelain=v1 --untracked-files=all`.

**Proposed Modification in `GroundingAgent.run`**:
Insert a dirty workspace guard at the beginning of `GroundingAgent.run(params)` before any write or scaffolding operation occurs:

```ts
// GroundingAgent.run implementation in packages/execution-core/src/run/grounding-agent.ts:

async run(params: GroundingAgentParams): Promise<string> {
  const dirtyFiles = await this.git.statusPorcelain(params.repoRoot);
  if (dirtyFiles.length > 0) {
    throw new Error(
      `GroundingAgent cannot run in a dirty workspace. Uncommitted changes detected:\n${dirtyFiles.join("\n")}`
    );
  }

  const contracts = collectProducedInterfaces(params.graph);
  if (contracts.length === 0) {
    return this.git.head(params.repoRoot);
  }
  ...
}
```

### 1.3 Error Handling & Abort Semantics
- **Error Type**: Standard `Error` with clear diagnostic context detailing all uncommitted porcelain status entries.
- **Abort Behavior**: Aborts immediately before any filesystem writes (`mkdir`/`writeFile`) or git modifications take place.
- **Safety**: Guarantees zero side effects on the target workspace when uncommitted changes exist.

### 1.4 Test Design & File Placement for MH-REM-001
- **Primary Test Location**: `tests/grounding-agent-dirty-workspace.test.ts`  
  *Rationale*: In this monorepo, `vitest.config.ts` includes `tests/**/*.test.ts`. Placing the test suite in `tests/grounding-agent-dirty-workspace.test.ts` allows `vitest` to run it automatically as part of `pnpm test` while testing `GroundingAgent` from `@manyhands/execution-core`. (An alias or co-located file in `packages/execution-core/src/run/grounding-agent-dirty-workspace.test.ts` can also be added if `vitest.config.ts` includes subpackage tests).

**Test Cases Specification**:
1. **Clean Workspace Success**:
   - Mock `git.statusPorcelain` returning `[]`.
   - Verify scaffold files are generated and `git.commit` returns expected SHA.
2. **Dirty Workspace with Modified Files**:
   - Mock `git.statusPorcelain` returning `[" M src/index.ts"]`.
   - Expect `GroundingAgent.run` to reject with error containing `"GroundingAgent cannot run in a dirty workspace"`.
   - Verify `writeFile` and `git.commit` are never called.
3. **Dirty Workspace with Untracked Files**:
   - Mock `git.statusPorcelain` returning `["?? temp.txt"]`.
   - Verify rejection with exact list of dirty files included in error message.

---

## 2. MH-REM-002: Lock Ownership Fencing

### 2.1 Problem Statement & Code Inspection
In `packages/run-store/src/jsonl-event-store.ts`, `JsonlRunEventStore` manages durable file locks via `acquireDurableLock(lockPath)`:

```ts
// Existing acquireDurableLock implementation in packages/run-store/src/jsonl-event-store.ts:
async function acquireDurableLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath, { recursive: false });
      await writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        "utf8"
      );
      return () => rm(lockPath, { recursive: true, force: true });
    } catch (error) { ... }
  }
}
```

**Vulnerability**:
If Process A acquires the lock and stalls (or undergoes a GC pause longer than `LOCK_STALE_AFTER_MS = 30_000`), Process B detects the lock as stale, breaks it, and acquires `lockPath` with its own `owner.json`. When Process A eventually wakes up and calls its returned `release()` function (`rm(lockPath)`), Process A deletes Process B's active lock directory without checking ownership!

### 2.2 Token-Scoped Lock Ownership Fencing Design
To enforce ownership fencing:
1. **Token Generation**: Generate a unique UUID token (`randomUUID()`) when acquiring the lock directory.
2. **Owner Record Extension**: Store `token` in `owner.json`:
   ```ts
   interface LockOwnerRecord {
     pid: number;
     acquiredAt: string;
     token: string;
   }
   ```
3. **Fenced Release**: In `release()`, read `owner.json` before deleting `lockPath`. Only delete `lockPath` if `ownerData.token === token`.

**Proposed Code Design in `packages/run-store/src/jsonl-event-store.ts`**:

```ts
interface LockOwnerRecord {
  pid: number;
  acquiredAt: string;
  token: string;
}

async function acquireDurableLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath, { recursive: false });
      const token = randomUUID();
      const ownerRecord: LockOwnerRecord = {
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        token
      };
      await writeFile(path.join(lockPath, "owner.json"), JSON.stringify(ownerRecord, null, 2), "utf8");

      return async () => {
        const ownerFile = path.join(lockPath, "owner.json");
        try {
          const content = await readFile(ownerFile, "utf8");
          const data = JSON.parse(content) as Partial<LockOwnerRecord>;
          if (data.token === token) {
            await rm(lockPath, { recursive: true, force: true });
          }
        } catch {
          // If lock directory or owner.json was already removed or superseded, do not delete another process's lock
        }
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_AFTER_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (inspectionError) {
        if (isNotFound(inspectionError)) continue;
        throw inspectionError;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for durable run-store lock ${lockPath}.`);
      }
      await delay(10);
    }
  }
}
```

### 2.3 Test Design & File Placement for MH-REM-002
- **Primary Test Location**: `tests/run-store-lock-ownership-fencing.test.ts`

**Test Cases Specification**:
1. **Normal Lock Acquisition and Clean Fenced Release**:
   - Acquire lock on temp directory, verify `owner.json` contains valid `token` (UUID), `pid`, `acquiredAt`.
   - Call `release()`, verify lock directory is cleanly removed.
2. **Prevent Stolen Lock Deletion (Fencing Safeguard)**:
   - Process A acquires lock (`tokenA`).
   - Simulate lock takeover by Process B: overwrite `owner.json` with `tokenB`.
   - Process A calls `release()`.
   - **Assertion**: Lock directory MUST still exist on disk and `owner.json` MUST still contain `tokenB`. Process A's release did NOT delete Process B's lock.
3. **Graceful Handling of Missing Lock File**:
   - Acquire lock, manually remove `lockPath` directory, call `release()`.
   - Verify `release()` completes without throwing errors.

---

## 3. MH-REM-003: Baseline UI Tests Diagnosis

Execution of `pnpm test` revealed 2 failing test suites (out of 166 test files and 961 tests).

### 3.1 Failure 1: `tests/typography-scale.test.ts`

#### Diagnostic Observations
- **Test File**: `tests/typography-scale.test.ts`
- **Assertion Failed**: `foundation v-next — no off-scale arbitraries in components > finds no off-grid spacing half-steps (2.5 / 5.5)`
- **Error Output**:
  ```
  AssertionError: off-grid spacing remains:
  app\runs\proto\[fixture]\cockpit-fixture-view.client.tsx:73
  app\runs\[runId]\_components\run-model-view.client.tsx:132: expected [ …(2) ] to deeply equal []
  ```

#### Root Cause Analysis
The test enforces the foundation design system rule that all component padding, margin, and gap spacing must use 4px grid steps (`px-2`, `px-3`, `gap-2`, etc.) and prohibits half-step arbitraries (`2.5` = 10px, `5.5` = 22px).

Inspection of the offending files:
1. `apps/web/src/app/runs/proto/[fixture]/cockpit-fixture-view.client.tsx` line 73:
   ```tsx
   className={`${ICON_BUTTON} !w-auto gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-label font-semibold`}
   ```
   Contains `px-2.5` (off-grid padding).
2. `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx` line 132:
   ```tsx
   <span className="flex min-w-0 items-center gap-2.5">
   ```
   Contains `gap-2.5` (off-grid flex gap).

#### Minimal Focused Fix
1. In `apps/web/src/app/runs/proto/[fixture]/cockpit-fixture-view.client.tsx` (line 73):
   Change `px-2.5` to `px-3` (12px, 4px grid step).
2. In `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx` (line 132):
   Change `gap-2.5` to `gap-2` (8px, 4px grid step).

---

### 3.2 Failure 2: `tests/run-loading-skeleton.test.ts`

#### Diagnostic Observations
- **Test File**: `tests/run-loading-skeleton.test.ts`
- **Assertion Failed**: `run loading skeleton > mirrors the current cockpit regions and dimensions`
- **Error Output**:
  ```
  expected '"use client";\r\n\r\nimport { useMemo…' to contain 'px-6 py-4'
  ```

#### Root Cause Analysis
`tests/run-loading-skeleton.test.ts` validates layout alignment between the route loading skeleton (`apps/web/src/app/runs/[runId]/loading.tsx`) and the actual run view (`apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx`) to avoid visual layout shifts when dynamic server rendering resolves.

The test checks that both files contain the layout class `"px-6 py-4"`:
```ts
const sharedLayoutClasses = [
  "px-6 py-4",
  "grid-cols-[minmax(0,1fr)_340px]",
  "border-r border-[var(--color-border)]",
  "bg-[var(--color-surface)]"
];
```

Inspection of header regions:
- `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx` (line 102):
  ```tsx
  <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
  ```
  The header in `run-model-view.client.tsx` uses `px-4 py-2`.
- `apps/web/src/app/runs/[runId]/loading.tsx` (line 20):
  ```tsx
  <header className="flex shrink-0 items-center justify-between gap-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
  ```
  The header in `loading.tsx` still carries legacy `px-6 py-4`.

#### Minimal Focused Fix
1. In `apps/web/src/app/runs/[runId]/loading.tsx` (line 20):
   Update header classes from `px-6 py-4` to `px-4 py-2` (and `gap-6` to `gap-4`).
2. In `tests/run-loading-skeleton.test.ts` (line 18):
   Update `sharedLayoutClasses` array entry from `"px-6 py-4"` to `"px-4 py-2"`.

---

## 4. Verification Matrix

| Task | Test Command | Verification Target | Expected Result |
|---|---|---|---|
| **MH-REM-001** | `npx vitest run tests/grounding-agent-dirty-workspace.test.ts` | GroundingAgent dirty workspace rejection | All 3 test cases pass; no writes on dirty workspace |
| **MH-REM-002** | `npx vitest run tests/run-store-lock-ownership-fencing.test.ts` | Token-scoped lock release | All 3 test cases pass; stolen locks are not deleted |
| **MH-REM-003** | `pnpm test` | Baseline UI tests suite | `tests/typography-scale.test.ts` & `tests/run-loading-skeleton.test.ts` pass; 166/166 test files pass |

---
