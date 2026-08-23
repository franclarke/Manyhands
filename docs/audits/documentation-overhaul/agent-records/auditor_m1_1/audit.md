# Forensic Audit Report — Milestone 1: Core Domain, Graph & Contracts READMEs

**Work Products Audited**:
1. `packages/contracts/README.md`
2. `packages/task-graph/README.md`
3. `packages/shared/README.md`

**Auditor**: Forensic Auditor M1 (`.agents/auditor_m1_1`)  
**Evaluation Date**: 2026-08-18  
**Integrity Mode**: `development` (per `ORIGINAL_REQUEST.md`)  
**Verdict**: **CLEAN (with Mandatory Documentation Inconsistency Findings)**

---

## Executive Summary

A forensic integrity inspection and static/dynamic verification was performed on the documentation artifacts produced for Milestone 1. 

The audit confirms that the work product represents a genuine, high-quality, pedagogical technical documentation overhaul. No cheating, fabricated test outputs, dummy facades, or deceptive claims were found. The underlying TypeScript implementations build with zero errors (`pnpm build`), pass strict typechecking (`pnpm typecheck`), and pass all associated test suites in `tests/`.

However, the audit identified **four (4) documentation inconsistencies/symbol discrepancies** and **one (1) test execution path nuance** across the generated READMEs where cited symbols, file structures, or example snippets deviate from the actual implementation code in `src/`.

---

## Phase 1: Forensic Verification & Empirical Evidence

### Check 1: Hardcoded Test Results & Facade Detection
- **Objective**: Detect if any source code, schemas, or tests contain dummy `return <constant>`, hardcoded test pass assertions, or facade stubs.
- **Finding**: **PASS**. All schemas in `packages/contracts/src/`, `packages/task-graph/src/`, and `packages/shared/src/` use real Zod `.strict()` schemas with custom `.superRefine()` logic, deterministic SHA-256 canonical serialization (`canonical-json.ts`), real graph traversal/validation (`canonical-graph.ts`), and real Win32 process containment (`node-cli-process.ts`).

### Check 2: Pre-populated Artifacts & Fabrication Detection
- **Objective**: Verify whether results or logs were pre-populated before execution.
- **Finding**: **PASS**. No fabricated logs or artificial attestation files were detected.

### Check 3: Typecheck & Compilation Verification
- **Command**:
  ```bash
  pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared typecheck
  ```
- **Raw Execution Output**:
  ```text
  Scope: 3 of 16 workspace projects
  packages/shared typecheck$ tsc -p tsconfig.json --noEmit
  packages/shared typecheck: Done
  packages/contracts typecheck$ tsc -p tsconfig.json --noEmit
  packages/contracts typecheck: Done
  packages/task-graph typecheck$ tsc -p tsconfig.json --noEmit
  packages/task-graph typecheck: Done
  Exit code: 0
  ```
- **Finding**: **PASS**. 100% strict TypeScript compliance.

### Check 4: Package Build Verification
- **Command**:
  ```bash
  pnpm --filter @manyhands/contracts --filter @manyhands/task-graph --filter @manyhands/shared build
  ```
- **Raw Execution Output**:
  ```text
  Scope: 3 of 16 workspace projects
  packages/shared build$ tsup src/index.ts src/node-cli-process.ts --format esm,cjs --dts --clean
  packages/shared build: CJS dist\node-cli-process.cjs 9.00 KB
  packages/shared build: CJS dist\index.cjs            13.31 KB
  packages/shared build: ESM dist\node-cli-process.js 7.61 KB
  packages/shared build: ESM dist\index.js            10.27 KB
  packages/shared build: DTS dist\index.d.ts             11.26 KB
  packages/shared build: DTS dist\node-cli-process.d.ts  2.75 KB
  packages/contracts build$ tsup src/index.ts --format esm,cjs --dts --clean
  packages/contracts build: CJS dist\index.cjs 113.40 KB
  packages/contracts build: ESM dist\index.js 96.99 KB
  packages/contracts build: DTS dist\index.d.ts  589.65 KB
  packages/task-graph build$ tsup src/index.ts --format esm,cjs --dts --clean
  packages/task-graph build: CJS dist\index.cjs 68.06 KB
  packages/task-graph build: ESM dist\index.js 62.75 KB
  packages/task-graph build: DTS dist\index.d.ts  165.55 KB
  Exit code: 0
  ```
- **Finding**: **PASS**. Multi-format ESM/CJS and `.d.ts` bundles build cleanly.

### Check 5: Test Suite Execution
- **Command**:
  ```bash
  pnpm test canonical
  pnpm test executor
  pnpm test contracts
  ```
- **Raw Execution Output**:
  - `pnpm test canonical`: 12 test files passed, 58 tests passed (0 failures).
  - `pnpm test executor`: 5 test files passed, 110 tests passed (0 failures).
  - `pnpm test contracts`: 4 test files passed, 22 tests passed (0 failures).
- **Finding**: **PASS**. 190 tests across 21 test files executed and passed cleanly.

---

## Phase 2: Static Analysis & Symbol Verification Findings

A symbol-by-symbol comparison between each README and the actual TypeScript `src/` files revealed the following specific findings:

### Finding F1: Phantom File in `packages/contracts/README.md` File Tree
- **Location**: `packages/contracts/README.md`, lines 21 & 43.
- **Observation**:
  The README file tree lists 26 files (while stating "25 módulos TypeScript en `src/`"), including:
  ```text
  ├── effect-intent.ts             # EffectIntentSchema y validación de intenciones de efectos físicos
  ├── effect-protocol.ts           # PhysicalEffectReceiptSchema y protocolo de atestación de efectos
  ```
- **Actual Code**:
  `packages/contracts/src/effect-intent.ts` does NOT exist. `EffectIntentSchema`, `buildEffectIntent`, and `validateEffectIntentIdentity` are located inside `packages/contracts/src/effect-protocol.ts`.
- **Severity**: Low (Doc error / layout mismatch).

---

### Finding F2: Inaccurate Code Snippets in `packages/contracts/README.md`
- **Location**: `packages/contracts/README.md`, lines 188–223 (Ejemplos 2 y 3).
- **Observation**:
  1. **Example 2 (`ScopeContractSchema.parse(scopeData)`)**:
     - The provided `scopeData` literal lacks `ContractIdentity` fields (`schemaVersion: 2`, `id`, `revision`, `provenance`, and `nodeId`), which `ScopeContractSchema` strictly requires.
     - The `outputRoots` field is provided as an array of objects `[{ path: "...", purpose: "..." }]`, whereas `OutputRootSchema` in `scope-contract.ts` is `RepoRelativePathSchema.superRefine(...)` (a string array `string[]`, not object array).
  2. **Example 3 (`buildInputFingerprint(...)`)**:
     - Passes arguments `{ taskContractDigest, baseTreeSha, environmentDigest, toolsetDigest }` to `buildInputFingerprint`.
     - In `input-fingerprint.ts`, `InputFingerprintMaterialSchema` requires `{ executionBase: { repositoryViewDigest, treeSha }, nodeContractDigest, resourceClaimDigest, contextDigest, executorProfileDigest, sandboxCapabilityDigest }`.
     - The snippet calls `console.log("Attempt InputFingerprint:", fingerprint.digest);`, but `buildInputFingerprint` returns a string digest (`InputFingerprint = string`), so `fingerprint.digest` evaluates to `undefined`.
- **Severity**: Medium (Code examples will throw `ZodError` if executed as written).

---

### Finding F3: Phantom Export Name & Signature Mismatch in `packages/task-graph/README.md`
- **Location**: `packages/task-graph/README.md`, lines 29, 44, 93, and 131.
- **Observation**:
  - The README repeatedly documents `computeGraphRevisionTopologicalLevels` with signature `(graph: GraphRevision): Map<string, number>`.
- **Actual Code**:
  - In `packages/task-graph/src/topological-level.ts`, the actual exported function is:
    ```typescript
    export function computeLegacyGraphRevisionV2TopologicalLevels(graph: LegacyGraphRevisionV2): Record<string, number>;
    ```
  - The function `computeGraphRevisionTopologicalLevels` does not exist in the codebase.
- **Severity**: Medium (Exported function name mismatch).

---

### Finding F4: Inaccurate Parameter Signature for `readGraphRevision` in `packages/task-graph/README.md`
- **Location**: `packages/task-graph/README.md`, line 132.
- **Observation**:
  - The README table specifies `readGraphRevision(input: unknown): GraphRevisionRead`.
- **Actual Code**:
  - In `packages/task-graph/src/compatibility-reader.ts`, `readGraphRevision` requires two arguments:
    ```typescript
    export function readGraphRevision(input: unknown, hasher: DigestHasher): GraphRevisionRead;
    ```
- **Severity**: Low (Parameter list omission in documentation table).

---

### Finding F5: Vitest Test Invocation Guidance in all 3 READMEs
- **Location**: `packages/contracts/README.md` (line 251), `packages/task-graph/README.md` (line 285), `packages/shared/README.md` (line 229).
- **Observation**:
  - The READMEs suggest running `pnpm test packages/contracts`, `pnpm test packages/task-graph`, and `pnpm test packages/shared`.
  - In this repository, tests reside in `tests/*.test.ts` at the monorepo root. Passing `packages/<name>` to `vitest run` matches 0 test files.
- **Remediation**:
  - The test commands in the READMEs should guide developers to run `pnpm test canonical`, `pnpm test contract`, `pnpm test executor`, or specific test file paths (e.g. `pnpm test tests/canonical-contract-roundtrip.test.ts`).
- **Severity**: Low (Operational developer experience).

---

## Adversarial Review & Edge Cases

| Dimension | Assessment | Notes |
|---|---|---|
| **Assumption Stress-Testing** | Robust | Zero circular dependencies found; clean layering `shared (L0) -> contracts (L1) -> task-graph (L2)`. |
| **Fail-Closed Security** | Robust | `unsafeRepoRelativePathReason` and `RepoRelativePathSchema` prevent path traversal (`..`), drive letters, and control characters. |
| **CLI & Windows Safety** | Robust | `resolveCliProcessInvocation` correctly disables delayed expansion (`/v:off`) and uses `windowsVerbatimArguments: true` to prevent DEP0190 command injection. `killCliProcessTree` uses `taskkill.exe /pid <PID> /t /f` with close barriers. |
| **Replay & Concurrency** | Robust | `replayPhysicalEffectReceipts` fails closed on receipt conflicts. `checkResourceAuthority` prevents unauthorized mutations. |

---

## Conclusion & Verdict

- **Integrity Verdict**: **CLEAN**
  - No integrity violations, deceptive code, dummy facades, or fabricated outputs were found.
- **Quality Recommendation**:
  - Update `packages/contracts/README.md` to remove `effect-intent.ts` from the file tree, fix Examples 2 & 3 to reflect exact Zod schemas, correct `computeLegacyGraphRevisionV2TopologicalLevels` and `readGraphRevision` in `packages/task-graph/README.md`, and update the Vitest test commands.
