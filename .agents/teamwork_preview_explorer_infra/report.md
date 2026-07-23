# Infrastructure & Supply Chain Audit Report: ManyHands Monorepo

**Auditor**: teamwork_preview_explorer (Infrastructure & Supply Chain Specialist)  
**Date**: 2026-07-21  
**Target Repository**: `franclarke/Manyhands`  
**Working Directory**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_infra`

---

## 1. Executive Summary

This audit presents a comprehensive analysis of the ManyHands monorepo configuration, build infrastructure, pnpm workspace setup, package dependency tree, layering boundary compliance, and supply chain security.

### Core Audit Verdict:
- **Layering Boundary Compliance**: **PASS (with minor specifier inconsistency)**. The dependency DAG strictly adheres to `apps -> specific packages -> shared`. Zero productive usages of legacy `@manyhands/core` exist. Package dependency graph is acyclic.
- **Build Infrastructure & Reproducibility**: **NEEDS REMEDIATION**. The build and typecheck scripts in root `package.json` ignore `apps/web`. Furthermore, package-level `tsconfig.json` files override base tsconfig paths, breaking TypeScript source resolution, and none of the 12 packages declare `tsup` in their package `devDependencies`.
- **Supply Chain & Dependency Health**: **NEEDS REMEDIATION**. The repository depends on End-of-Life (EOL) ESLint v8 tooling, contains an unused phantom devDependency (`ts-morph`), has mismatched React 19 type versions, and exhibits undeclared root dependency usage in `apps/web` scripts.

A total of **10 Infrastructure Audit Findings (`MH-AUDIT-INFRA-001` through `MH-AUDIT-INFRA-010`)** have been identified and categorized below.

---

## 2. Scope & Methodology

### Inspected Files & Configurations:
- Root files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `.eslintrc.cjs`, `pnpm-lock.yaml`.
- Workspace packages (12 packages under `packages/*`):
  - `@manyhands/conflict-risk`
  - `@manyhands/contracts`
  - `@manyhands/decomposer`
  - `@manyhands/execution-core`
  - `@manyhands/orchestrator-graph`
  - `@manyhands/repository-index`
  - `@manyhands/run-coordinator`
  - `@manyhands/run-store`
  - `@manyhands/scheduler`
  - `@manyhands/shared`
  - `@manyhands/task-graph`
  - `@manyhands/trace-store`
- Web Application: `apps/web/package.json`, `apps/web/tsconfig.json`.
- Scripts & Tooling: `scripts/*.mjs`, `apps/web/scripts/*.mjs`.
- Automated Architecture Guards: `tests/architecture-baseline.test.ts`, `tests/dependency-validation.test.ts`.

---

## 3. Detailed Audit Findings (`MH-AUDIT-INFRA-xxx`)

| Finding ID | Severity | Category | File & Exact Line Number | Summary |
|---|---|---|---|---|
| `MH-AUDIT-INFRA-001` | **MEDIUM** | Monorepo Setup | `packages/execution-core/package.json:23` | Inconsistent `workspace:^0.1.0` dependency specifier |
| `MH-AUDIT-INFRA-002` | **HIGH** | Build Infrastructure | `packages/*/package.json` (12 files) | Missing local `tsup` `devDependencies` across all packages |
| `MH-AUDIT-INFRA-003` | **HIGH** | Build Infrastructure | `apps/web/tsconfig.json:26-30` | `paths` override discards base monorepo TS path aliases |
| `MH-AUDIT-INFRA-004` | **MEDIUM** | Build Infrastructure | `package.json:9-10` | Root `build` script omits main web app (`apps/web`) |
| `MH-AUDIT-INFRA-005` | **HIGH** | Build Infrastructure | `package.json:17`, `tsconfig.json:8` | Root `typecheck` script ignores `apps/web` |
| `MH-AUDIT-INFRA-006` | **MEDIUM** | Supply Chain Security | `package.json:27-29`, `apps/web/package.json:54-56` | EOL ESLint v8 & `@typescript-eslint` v7 toolchain |
| `MH-AUDIT-INFRA-007` | **LOW** | Dependency Tree | `package.json:31`, `apps/web/scripts/ui-shots.mjs:1` | Undeclared root `puppeteer-core` dependency in web scripts |
| `MH-AUDIT-INFRA-008` | **LOW** | Supply Chain Security | `package.json:32` | Unused phantom devDependency (`ts-morph`) |
| `MH-AUDIT-INFRA-009` | **LOW** | Supply Chain Security | `apps/web/package.json:37-38, 52-53` | React 19 package vs `@types/react` patch version mismatch |
| `MH-AUDIT-INFRA-010` | **LOW** | Build Environment | `pnpm-workspace.yaml:6`, `apps/web/package.json:36` | Native `node-pty` C++ compilation dependency risk |

---

### Finding Breakdown

#### `MH-AUDIT-INFRA-001`: Inconsistent `workspace:^0.1.0` Dependency Specifier
- **Location**: `packages/execution-core/package.json` (Line 23)
- **Severity**: **MEDIUM**
- **Category**: Monorepo Workspace Configuration
- **Description**: In `packages/execution-core/package.json`, line 23 specifies:
  `"@manyhands/repository-index": "workspace:^0.1.0"`
  In contrast, all other 11 workspace packages and `apps/web` use `"workspace:*"` for all internal workspace dependencies.
- **Impact**: Inconsistent pnpm workspace resolution semantics. `workspace:^` can result in non-deterministic linking or publishing errors when version numbers drift across workspace packages.
- **Remediation**: Update line 23 of `packages/execution-core/package.json` to `"@manyhands/repository-index": "workspace:*"`.

---

#### `MH-AUDIT-INFRA-002`: Missing Local `tsup` `devDependencies` Across All Workspace Packages
- **Location**: All 12 package configuration files:
  - `packages/conflict-risk/package.json:17`
  - `packages/contracts/package.json:17`
  - `packages/decomposer/package.json:22`
  - `packages/execution-core/package.json:17`
  - `packages/orchestrator-graph/package.json:17`
  - `packages/repository-index/package.json:17`
  - `packages/run-coordinator/package.json:17`
  - `packages/run-store/package.json:17`
  - `packages/scheduler/package.json:17`
  - `packages/shared/package.json:22`
  - `packages/task-graph/package.json:17`
  - `packages/trace-store/package.json:17`
- **Severity**: **HIGH**
- **Category**: Build Infrastructure & Hermetic Reproducibility
- **Description**: Every package in `packages/*` specifies `"build": "tsup src/index.ts ..."` under `scripts`. However, not a single package declares `tsup` in its `devDependencies`. `tsup` is declared solely at the root `package.json:33`.
- **Impact**: Breaks hermetic build reproducibility. If any package is built in isolation (e.g. `pnpm --filter @manyhands/shared build`), in a container without root hoisting, or published, the build fails with `tsup: command not found`.
- **Remediation**: Add `"devDependencies": { "tsup": "^8.3.5", "typescript": "^5.7.2" }` to each package `package.json` or configure pnpm catalog dependencies.

---

#### `MH-AUDIT-INFRA-003`: `apps/web/tsconfig.json` Overrides `paths`, Discarding Base Monorepo TS Aliases
- **Location**: `apps/web/tsconfig.json` (Lines 26–30)
- **Severity**: **HIGH**
- **Category**: Build Infrastructure & TypeScript Resolution
- **Description**: `apps/web/tsconfig.json` extends `../../tsconfig.base.json`. In TypeScript tsconfig hierarchy rules, defining `"paths"` in a child config completely replaces the parent's `"paths"` object.
  Lines 26–30 in `apps/web/tsconfig.json`:
  ```json
  "paths": {
    "@/*": [
      "./src/*"
    ]
  }
  ```
  This overrides and discards all 13 `@manyhands/*` path definitions from `tsconfig.base.json:21-33`.
- **Impact**: `apps/web` cannot resolve TypeScript source files in `packages/*/src` directly during editing/typechecking. Instead, it must rely on built `dist/` outputs via `node_modules`. This forces running `pnpm build:packages` before `apps/web` typecheck or IDE navigation works correctly.
- **Remediation**: Include the `@manyhands/*` path mappings in `apps/web/tsconfig.json` or structure tsconfig path inheritance to merge paths cleanly.

---

#### `MH-AUDIT-INFRA-004`: Root `package.json` `build` Script Omits Main Application (`apps/web`)
- **Location**: `package.json` (Lines 9–10)
- **Severity**: **MEDIUM**
- **Category**: Monorepo Build Scripts
- **Description**: Root `package.json` lines 9–10:
  ```json
  "build": "pnpm build:packages",
  "build:packages": "pnpm -r --filter \"./packages/*\" build"
  ```
  The root `build` script only compiles `packages/*` and excludes `apps/web`.
- **Impact**: Running `pnpm build` at root fails to compile the web application. Standard monorepo CI workflows expect `pnpm build` to compile all buildable targets in the workspace.
- **Remediation**: Update `"build"` in `package.json` to `"pnpm build:packages && pnpm web:build"`.

---

#### `MH-AUDIT-INFRA-005`: Root `package.json` `typecheck` Script Ignores `apps/web`
- **Location**: `package.json` (Line 17), `tsconfig.json` (Line 8)
- **Severity**: **HIGH**
- **Category**: Quality Assurance & Type Checking
- **Description**: Root `package.json` line 17 defines `"typecheck": "tsc -p tsconfig.json --noEmit"`. Root `tsconfig.json` line 8 specifies `"include": ["packages/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]`, explicitly excluding `apps/web`.
- **Impact**: Running `pnpm typecheck` at the monorepo root passes even if `apps/web` has breaking type errors. Developers and CI pipelines running `pnpm typecheck` receive false confidence.
- **Remediation**: Update root `typecheck` script to `"pnpm build:packages && tsc -p tsconfig.json --noEmit && pnpm --filter @manyhands/web typecheck"`.

---

#### `MH-AUDIT-INFRA-006`: End-of-Life ESLint v8 & `@typescript-eslint` v7 Toolchain
- **Location**: `package.json` (Lines 27–29), `apps/web/package.json` (Lines 54–56)
- **Severity**: **MEDIUM**
- **Category**: Supply Chain Security & Maintenance
- **Description**: The project relies on `"eslint": "^8.57.1"` and `"@typescript-eslint/*": "^7.18.0"`. ESLint 8 reached End-of-Life on October 5, 2024.
- **Impact**: Unmaintained linting engine will not receive security fixes, bug fixes, or support for newer ECMAScript / TypeScript features.
- **Remediation**: Plan migration to ESLint v9 with flat config and `@typescript-eslint` v8+.

---

#### `MH-AUDIT-INFRA-007`: Undeclared Root Dependency Usage (`puppeteer-core`) in Web Scripts
- **Location**: `package.json` (Line 31), `apps/web/scripts/ui-shots.mjs` (Line 1), `apps/web/scripts/ui-shot-crop.mjs` (Line 1)
- **Severity**: **LOW**
- **Category**: Dependency Boundaries
- **Description**: `puppeteer-core` (`^25.1.0`) is declared as a root `devDependency`, but is consumed inside `apps/web/scripts/`.
- **Impact**: Relying on phantom hoisting from root. If `apps/web` is isolated, script execution fails.
- **Remediation**: Move `puppeteer-core` into `apps/web/package.json` `devDependencies` or run scripts via root context.

---

#### `MH-AUDIT-INFRA-008`: Unused Phantom DevDependency (`ts-morph`) in Root `package.json`
- **Location**: `package.json` (Line 32)
- **Severity**: **LOW**
- **Category**: Supply Chain Security & Bloat
- **Description**: `"ts-morph": "^28.0.0"` is declared in root `package.json:32`, but zero imports exist across the entire codebase (`apps/`, `packages/`, `scripts/`, `tests/`).
- **Impact**: Unnecessary dependency bloat in `pnpm-lock.yaml`, increasing installation footprint and vulnerability surface.
- **Remediation**: Remove `ts-morph` from root `package.json`.

---

#### `MH-AUDIT-INFRA-009`: React 19 & `@types/react` Patch Version Mismatch in `apps/web`
- **Location**: `apps/web/package.json` (Lines 37–38, 52–53)
- **Severity**: **LOW**
- **Category**: Type Safety & Dependency Consistency
- **Description**: `apps/web/package.json` pins `"react": "19.2.6"`, `"react-dom": "19.2.6"`, while specifying `"@types/react": "19.2.15"` and `"@types/react-dom": "19.2.3"`.
- **Impact**: Mismatched type definition patches can cause subtle type check inconsistencies.
- **Remediation**: Align `@types/react` and `@types/react-dom` patch versions with React 19 release versions.

---

#### `MH-AUDIT-INFRA-010`: Native C++ Build Script Dependency (`node-pty`) Environment Sensitivity
- **Location**: `pnpm-workspace.yaml` (Line 6), `apps/web/package.json` (Line 36)
- **Severity**: **LOW**
- **Category**: Build Infrastructure & Environment Portability
- **Description**: `node-pty` (`^1.0.0`) requires native C++ compilation during `pnpm install` (`allowBuilds` in `pnpm-workspace.yaml`).
- **Impact**: Requires C++ compilation tooling (`node-gyp`, Python, MSVC on Windows) on host systems. Minimal CI build containers without C++ tools will fail installation.
- **Remediation**: Document native toolchain prerequisites in `README.md` / `DEVELOPMENT.md` and ensure CI runners include build-essential / MSVC.

---

## 4. Layering Boundary & Dependency Matrix

The architecture rules specify:
`apps -> specific packages -> shared`, no new deps to legacy `@manyhands/core`.

### Verified Workspace Dependency DAG:

```
[apps/web]
   │
   ├─► @manyhands/orchestrator-graph ──► [run-coordinator, scheduler, conflict-risk, task-graph, contracts]
   ├─► @manyhands/execution-core     ──► [conflict-risk, scheduler, trace-store, task-graph, repository-index, contracts, shared]
   ├─► @manyhands/decomposer         ──► [repository-index, task-graph, contracts, shared]
   ├─► @manyhands/run-store          ──► [run-coordinator, shared]
   ├─► @manyhands/scheduler          ──► [conflict-risk, task-graph, contracts]
   ├─► @manyhands/conflict-risk       ──► [repository-index, contracts, shared]
   ├─► @manyhands/run-coordinator    ──► [task-graph, shared]
   ├─► @manyhands/task-graph         ──► [contracts, shared]
   ├─► @manyhands/contracts          ──► [shared]
   ├─► @manyhands/repository-index   ──► [shared]
   ├─► @manyhands/trace-store        ──► [shared]
   └─► @manyhands/shared             ──► (leaf node, zero workspace deps)
```

- **Cycles**: **0 cycles detected**. Graph is strictly acyclic.
- **Legacy `@manyhands/core`**: **0 usages in productive code**. Guarded by `tests/architecture-baseline.test.ts:30-44`.

---

## 5. Verification Commands

To independently verify the audit conclusions, execute the following commands in order:

1. **Verify Workspace Typechecks & Layering**:
   ```bash
   pnpm typecheck
   pnpm --filter @manyhands/web exec tsc --noEmit
   ```
2. **Verify Architecture Baseline Tests**:
   ```bash
   pnpm test tests/architecture-baseline.test.ts
   ```
3. **Verify Package Builds**:
   ```bash
   pnpm build:packages
   ```
4. **Verify Web Application Build**:
   ```bash
   pnpm web:build
   ```

---

## 6. Remediation Plan & Priority Matrix

| Priority | Finding ID | Action Item | Affected File |
|---|---|---|---|
| **P0** | `MH-AUDIT-INFRA-003` | Add base `@manyhands/*` path aliases into `apps/web/tsconfig.json` | `apps/web/tsconfig.json` |
| **P0** | `MH-AUDIT-INFRA-005` | Include `apps/web` in root `typecheck` command | `package.json` |
| **P1** | `MH-AUDIT-INFRA-002` | Add `tsup` devDependency to all 12 package `package.json` files | `packages/*/package.json` |
| **P1** | `MH-AUDIT-INFRA-004` | Include `apps/web` build in root `pnpm build` script | `package.json` |
| **P2** | `MH-AUDIT-INFRA-001` | Change `"workspace:^0.1.0"` to `"workspace:*"` in `execution-core` | `packages/execution-core/package.json` |
| **P2** | `MH-AUDIT-INFRA-008` | Remove unused `ts-morph` from root `package.json` | `package.json` |
| **P2** | `MH-AUDIT-INFRA-007` | Declare `puppeteer-core` in `apps/web/package.json` | `apps/web/package.json` |
| **P3** | `MH-AUDIT-INFRA-006` | Plan ESLint v9 & `@typescript-eslint` v8 migration | `package.json`, `.eslintrc.cjs` |
| **P3** | `MH-AUDIT-INFRA-009` | Harmonize `@types/react` versions | `apps/web/package.json` |
