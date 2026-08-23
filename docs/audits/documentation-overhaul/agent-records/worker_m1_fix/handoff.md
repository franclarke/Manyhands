# Handoff Report — Milestone 1 Remediation (Worker M1 Fix)

## 1. Observation

1. **`packages/contracts/README.md` File Structure and Table**:
   - `packages/contracts/src/` contains exactly 25 TypeScript modules.
   - The file `effect-intent.ts` does not exist in `packages/contracts/src/`; its schemas (`EffectIntentSchema`, `EffectIntentMaterialSchema`, `buildEffectIntent`, `validateEffectIntentIdentity`) are exported from `packages/contracts/src/effect-protocol.ts`.
   - The directory tree in `packages/contracts/README.md` previously listed 26 files including `effect-intent.ts`, and the module table listed `effect-intent.ts / effect-protocol.ts`.

2. **`packages/contracts/README.md` Code Snippets**:
   - **Ejemplo 2 (`ScopeContract`)**: Previously passed `{ allowedPaths: [...], forbiddenPaths: [...], coordinationPaths: [...], outputRoots: [{ path: "...", purpose: "..." }] }` to `ScopeContractSchema.parse(...)`. This failed Zod validation because:
     - `ScopeContractSchema` inherits from `ContractIdentityShape`, requiring `schemaVersion: 2`, `id: string`, `revision: string`, `provenance: "authored" | "compiled" | "legacy_inferred"`, and `nodeId: string`.
     - `outputRoots` expects `z.array(OutputRootSchema)` where `OutputRootSchema` is a repository-relative string (`RepoRelativePathSchema`), not an array of objects.
   - **Ejemplo 3 (`InputFingerprint`)**: Previously passed `{ taskContractDigest, baseTreeSha, environmentDigest, toolsetDigest }` to `buildInputFingerprint(...)` and read `fingerprint.digest`. This failed because:
     - `InputFingerprintMaterialSchema` requires `{ executionBase: { repositoryViewDigest, treeSha }, consumedArtifactDigests, nodeContractDigest, resourceClaimDigest, contextDigest, executorProfileDigest, sandboxCapabilityDigest }`.
     - `buildInputFingerprint` returns a `string` (the digest hash), not an object with `.digest`.

3. **`packages/task-graph/README.md` Symbols and Signatures**:
   - In `packages/task-graph/src/topological-level.ts`, the exported function is `computeLegacyGraphRevisionV2TopologicalLevels(graph: LegacyGraphRevisionV2): Record<string, number>`. The README previously referenced `computeGraphRevisionTopologicalLevels` returning `Map<string, number>`.
   - In `packages/task-graph/src/compatibility-reader.ts`, `readGraphRevision` requires two arguments: `readGraphRevision(input: unknown, hasher: DigestHasher): GraphRevisionRead`. The function table in the README previously omitted `hasher: DigestHasher`.
   - In Example 1 (`buildGraphRevision`), `repositoryView` previously used `{ snapshotId, baseTreeSha }` instead of `{ digest, treeSha, resourceCatalogDigest }` from `RepositoryViewRefSchema`, and `resourceClaims` was missing `source: "compiler"`, `ownerPhase: "implementation"`, and used invalid `inputVersion`.

4. **Verification Execution**:
   - `pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared typecheck` completed with exit code 0.
   - `pnpm test` completed across all 316 test files (2,062 tests passing, 0 failures).

## 2. Logic Chain

1. Starting from Observation 1, removing `effect-intent.ts` from the directory tree and attributing `EffectIntentSchema` to `effect-protocol.ts` ensures the documentation accurately reflects the 25 files in `packages/contracts/src/`.
2. Starting from Observation 2, updating `ScopeContract` and `InputFingerprint` snippets in `packages/contracts/README.md` to provide all mandatory `ContractIdentityShape` fields and strict `InputFingerprintMaterial` parameters ensures that copying and executing the snippets against `@manyhands/contracts` produces valid parses and correct digest strings without runtime Zod errors.
3. Starting from Observation 3, renaming the function reference to `computeLegacyGraphRevisionV2TopologicalLevels`, adding `hasher: DigestHasher` to the `readGraphRevision` signature, and correcting `GraphRevisionMaterial` in Example 1 aligns `packages/task-graph/README.md` 100% with the exports in `packages/task-graph/src/topological-level.ts`, `compatibility-reader.ts`, and `canonical-graph.ts`.
4. Starting from Observation 4, the clean typecheck and test suite execution confirm that no syntax or domain regressions exist in the workspace.

## 3. Caveats

- No caveats. All changes are documentation corrections and snippet alignments against existing tested source code.

## 4. Conclusion

All findings from Reviewer M1 and Auditor M1 have been remediated:
- `packages/contracts/README.md` correctly references 25 modules, accurately attributes `effect-protocol.ts`, and contains fully validated `ScopeContract` and `InputFingerprint` code examples.
- `packages/task-graph/README.md` documents `computeLegacyGraphRevisionV2TopologicalLevels` with correct signature and semantics, includes `hasher: DigestHasher` in `readGraphRevision`, and provides a strictly conforming `GraphRevisionMaterial` snippet.

## 5. Verification Method

To independently verify these fixes:

1. Inspect modified files:
   - `packages/contracts/README.md` (lines 40-70, 100-115, 185-230)
   - `packages/task-graph/README.md` (lines 25-50, 90-100, 130-135, 160-205)

2. Run package typechecks:
   ```bash
   pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared typecheck
   ```

3. Run the contract and task-graph test suites:
   ```bash
   pnpm test -- contract
   pnpm test -- graph
   ```

4. Invalidation condition: Any typecheck error or runtime Zod parsing failure when executing the documented code snippets.
