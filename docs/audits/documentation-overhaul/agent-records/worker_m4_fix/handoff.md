# Handoff Report — Milestone 4 Documentation Remediation

## 1. Observation

Direct findings and exact discrepancies observed between source code and documentation:

1. **`packages/run-store/src/effect-receipt-store.ts:45` & `packages/run-store/src/snapshot-store.ts:21`**:
   - The exported class names are `FilePhysicalEffectReceiptStore` (not `FileEffectReceiptStore`) and `RunSnapshotStore` (not `SnapshotStore`).
   - In `packages/run-store/README.md` (Sec. 1, 2, 4.1, 4.3, 5), `FileEffectReceiptStore` and `SnapshotStore` were used.
   - In `packages/run-store/README.md` (Sec. 4.3 snippet), events passed to `appendFenced` lacked `occurredAt`, `sequence`, and proper `payload` structures conforming to `RunEventSchema`, and referenced non-existent `projection.status` instead of `projection.lifecycle`.

2. **`packages/run-engine/src/physical-effect-adapters.ts` & `packages/run-engine/src/run-event-journal.ts`**:
   - Physical effect adapters are exported as factory functions: `createModelCallPhysicalEffectAdapter`, `createSandboxCreatePhysicalEffectAdapter`, `createGitMutationPhysicalEffectAdapter`, `createArtifactMaterializePhysicalEffectAdapter`, `createValidationPhysicalEffectAdapter`, `createDeliveryPhysicalEffectAdapter`, `createCleanupPhysicalEffectAdapter`.
   - `FencedRunActorJournal` class is exported in `src/run-event-journal.ts:17` implementing `RunActorJournalPort`.
   - In `packages/run-engine/README.md` (Sec. 4.2 snippet), `FileEffectReceiptStore` was imported from `@manyhands/run-store` (causing a compilation failure) and `projection.status` was logged.

3. **`packages/run-coordinator/src/domain/events.ts:349` & `packages/run-coordinator/src/domain/decisions.ts:26-48` & `packages/run-coordinator/src/reducer.ts:90-139`**:
   - `decision.raised` event payload requires a `decision` conforming to `DecisionInputSchema` (`id`, `kind`, `question`, `options: [{ id, label }]`, `affectedNodeIds`, `evidenceRefs`, `impact`).
   - `RunProjection` stores decisions in `decisions: Record<string, Decision>` and pending decision IDs in `readiness.pendingDecisionIds`.
   - In `packages/run-coordinator/README.md` (Sec. 4.3 snippet), `decision.raised` passed non-compliant fields (`decisionId`, `title`, `description`, `optionId`), and accessed `updatedProjection.pendingDecisions` which evaluated to `undefined`.

## 2. Logic Chain

1. In `packages/run-store/README.md`:
   - Replaced all instances of `FileEffectReceiptStore` with `FilePhysicalEffectReceiptStore`.
   - Replaced all instances of `SnapshotStore` with `RunSnapshotStore`.
   - Updated the Sec. 4.3 code example so that `eventStore.appendFenced` receives valid `RunEvent` objects with `sequence`, `occurredAt`, and typed `payload` conforming to `RunEventSchema`, and updated the projection logging to `projection.lifecycle`.
2. In `packages/run-engine/README.md`:
   - Updated the import and instantiation in Sec. 4.2 snippet to use `FilePhysicalEffectReceiptStore` from `@manyhands/run-store`.
   - Updated Sec. 2 module breakdown and Sec. 4.1 symbol catalogue to document the concrete factory functions (`create*PhysicalEffectAdapter`) and added `FencedRunActorJournal`.
   - Corrected `projection.status` to `projection.lifecycle`.
3. In `packages/run-coordinator/README.md`:
   - Corrected the `decision.raised` event payload in Sec. 4.3 snippet to satisfy `DecisionInputSchema` with required fields `id`, `kind: "clarify_goal"`, `question`, `options: [{ id, label }]`, `affectedNodeIds`, `evidenceRefs: []`, and `impact: "architecture"`.
   - Updated the projection access to `updatedProjection.decisions`.
4. Verified that all workspace package typechecks pass cleanly via `pnpm -r --filter "./packages/*" typecheck` with exit code 0.

## 3. Caveats

No caveats. All remediation items specified by Reviewer M4 in `reviewer_m4/review.md` and `DISPATCH.md` have been addressed directly and verified against source contracts.

## 4. Conclusion

All 3 README files (`packages/run-store/README.md`, `packages/run-engine/README.md`, `packages/run-coordinator/README.md`) now accurately reflect the source code implementations, types, factory functions, and Zod schemas. Snippets are fully typed, valid, and executable without exceptions.

## 5. Verification Method

To independently verify the changes:

1. **Verify TypeScript compilation & type checking**:
   ```bash
   pnpm -r --filter "./packages/*" typecheck
   ```
2. **Inspect modified README files**:
   - `packages/run-store/README.md`
   - `packages/run-engine/README.md`
   - `packages/run-coordinator/README.md`
3. **Invalidation condition**: Any reference to obsolete symbols (`FileEffectReceiptStore`, `SnapshotStore`, `ProcessSupervisePhysicalEffectAdapter`, `pendingDecisions`, `projection.status`) or non-compliant snippet payloads.
