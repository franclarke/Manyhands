# Handoff Report — Milestone 4 Review (Persistence, Engine & Coordination READMEs)

## 1. Observation

- **`packages/run-store`**:
  - `packages/run-store/src/effect-receipt-store.ts:45`: `export class FilePhysicalEffectReceiptStore` exists. The README (`packages/run-store/README.md`) refers to it as `FileEffectReceiptStore` on lines 12, 49, 97, 125, 223.
  - `packages/run-store/src/snapshot-store.ts:21`: `export class RunSnapshotStore` exists. The README refers to it as `SnapshotStore` on lines 15, 52, 129.
  - `packages/run-store/README.md:188-210`: Code snippet builds invalid event objects lacking `occurredAt` and `payload` wrapping, and accesses `projection.status` which does not exist on `RunProjection` (`packages/run-coordinator/src/reducer.ts:90-130`).
- **`packages/run-engine`**:
  - `packages/run-engine/README.md:146, 157`: Snippet imports and instantiates `FileEffectReceiptStore` from `@manyhands/run-store`, which is not exported (the real export is `FilePhysicalEffectReceiptStore`).
  - `packages/run-engine/src/physical-effect-adapters.ts:192-252`: Exports factory functions (`createModelCallPhysicalEffectAdapter`, `createSandboxCreatePhysicalEffectAdapter`, etc.), not classes (`ModelCallPhysicalEffectAdapter`, etc.), and has no `ProcessSupervisePhysicalEffectAdapter`.
  - `packages/run-engine/src/run-event-journal.ts:17`: `export class FencedRunActorJournal` exists but is omitted from Table 4.1.
  - `packages/run-engine/README.md:197`: Snippet accesses `projection.status` instead of `projection.lifecycle`.
- **`packages/run-coordinator`**:
  - `packages/run-coordinator/README.md:191-208`: Snippet passes an invalid `decision` object for `decision.raised` (`decisionId`, `title`, `description`, `options: [{ optionId, title }]`) violating `DecisionInputSchema` (`packages/run-coordinator/src/domain/decisions.ts:26-48`), and calls `Object.keys(updatedProjection.pendingDecisions)` which causes a runtime `TypeError` because `pendingDecisions` does not exist on `RunProjection`.
- **`packages/trace-store`**:
  - `packages/trace-store/README.md`: All 62 event types in `TraceEventTypeSchema`, `TraceActorSchema`, `JsonlTraceStore`, `InMemoryTraceStore`, and `redactSecrets` match `packages/trace-store/src/` accurately.
- **`packages/orchestrator-graph`**:
  - `packages/orchestrator-graph/README.md`: `CanonicalExecutionDriver`, `assertNoConcurrentResourceConflict`, `executionBaseArtifacts`, transitional status, and snippet match `packages/orchestrator-graph/src/` accurately.
- **`packages/execution-core`**:
  - `packages/execution-core/README.md:187-192`: Updated snippet correctly imports and uses `SimpleGitRunner`, which is exported in `packages/execution-core/src/index.ts:7`.
- **Monorepo Build & Typecheck Commands**:
  - `pnpm -r --filter "./packages/*" typecheck` exited with code 0 across all 13 workspace packages.
  - `pnpm build` exited with code 0 across all workspace packages.

## 2. Logic Chain

1. In accordance with DISPATCH.md and PROJECT.md, Reviewer M4 conducted a line-by-line verification of the 5 newly authored README files and 1 updated snippet against actual source code in `packages/*/src/`.
2. While Spanish narrative clarity, modular structure, and architectural positioning are exemplary, several symbol discrepancies and snippet inaccuracies were identified:
   - In `packages/run-store/README.md`, referencing `FileEffectReceiptStore` instead of `FilePhysicalEffectReceiptStore` and `SnapshotStore` instead of `RunSnapshotStore` misleads readers about public API names.
   - In `packages/run-store/README.md` and `packages/run-coordinator/README.md`, the code snippets construct event payloads that violate `RunEventSchema` and `DecisionInputSchema`, which causes immediate Zod validation errors at runtime.
   - In `packages/run-coordinator/README.md`, `updatedProjection.pendingDecisions` throws an uncaught runtime `TypeError`.
   - In `packages/run-engine/README.md`, the snippet imports a nonexistent symbol (`FileEffectReceiptStore`), and Table 4.1 documents factory functions as nonexistent classes.
3. Because code snippets and symbol tables are intended as authoritative technical references for developers, uncompilable or throwing snippets undermine documentation correctness.
4. Therefore, the required verdict is `REQUEST_CHANGES` to fix these specific, actionable items.

## 3. Caveats

- No caveats. All packages were built, typechecked, and their AST/export structures directly examined in their respective `src/` directories.

## 4. Conclusion

**Verdict**: `REQUEST_CHANGES`

All findings are clearly identified with exact line numbers, root causes, and suggested fixes in `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\reviewer_m4\review.md`. Once the worker applies these targeted symbol and snippet corrections, Milestone 4 will achieve full compliance.

## 5. Verification Method

To independently verify the findings:

1. **Verify class names in `run-store`**:
   ```bash
   # Check export of FilePhysicalEffectReceiptStore
   grep -n "export class FilePhysicalEffectReceiptStore" packages/run-store/src/effect-receipt-store.ts
   # Check export of RunSnapshotStore
   grep -n "export class RunSnapshotStore" packages/run-store/src/snapshot-store.ts
   ```

2. **Verify adapter exports in `run-engine`**:
   ```bash
   # Check factory functions in physical-effect-adapters.ts
   grep -n "export function create.*PhysicalEffectAdapter" packages/run-engine/src/physical-effect-adapters.ts
   ```

3. **Verify `DecisionInputSchema` in `run-coordinator`**:
   ```bash
   # Inspect DecisionInputSchema definition
   grep -n -A 25 "export const DecisionInputSchema" packages/run-coordinator/src/domain/decisions.ts
   ```

4. **Verify `RunProjection` properties**:
   ```bash
   # Inspect RunProjection definition
   grep -n -A 40 "export interface RunProjection" packages/run-coordinator/src/reducer.ts
   ```
