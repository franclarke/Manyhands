# Handoff Report: Infrastructure & Supply Chain Audit

**Agent**: teamwork_preview_explorer (Infrastructure & Supply Chain Specialist)  
**Working Directory**: `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_infra`  
**Date**: 2026-07-21  

---

## 1. Observation

Direct inspections of configuration files and code paths:
- **`packages/execution-core/package.json:23`**: Contains `"@manyhands/repository-index": "workspace:^0.1.0"`, whereas all other 11 workspace packages use `"workspace:*"`.
- **`packages/*/package.json`**: All 12 packages define `"build": "tsup ..."` under `scripts`, but zero packages declare `"tsup"` under `"devDependencies"`.
- **`apps/web/tsconfig.json:26-30`**: Defines a local `"paths"` block containing only `"@/*": ["./src/*"]`, overriding and discarding the 13 base `@manyhands/*` path mappings from `tsconfig.base.json:20-35`.
- **`package.json:9-10`**: `"build"` points to `"build:packages"` which only targets `"./packages/*"`, omitting `apps/web`.
- **`package.json:17` & `tsconfig.json:8`**: `"typecheck"` executes `tsc -p tsconfig.json --noEmit`, which includes `packages/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`, but excludes `apps/web`.
- **`package.json:27-29`**: Uses `"eslint": "^8.57.1"` and `"@typescript-eslint/*": "^7.18.0"`. ESLint v8 reached EOL on October 5, 2024.
- **`package.json:32`**: Contains `"ts-morph": "^28.0.0"`. Search across all codebase files returned 0 productive imports.
- **`package.json:31` & `apps/web/scripts/ui-shots.mjs:1`**: `puppeteer-core` is declared in root `package.json:31` but imported in `apps/web/scripts/ui-shots.mjs`.
- **Architecture baseline test**: `tests/architecture-baseline.test.ts` passes and enforces 0 usages of legacy `@manyhands/core`. Dependency tree is acyclic.

---

## 2. Logic Chain

1. **Workspace Version Consistency**:
   - Observation: `packages/execution-core/package.json:23` uses `workspace:^0.1.0` while 11 other packages use `workspace:*`.
   - Inference: This inconsistency risks drift during pnpm resolution or publishing. Unifying to `workspace:*` ensures deterministic workspace linking.

2. **Build Hermeticity**:
   - Observation: All 12 packages call `tsup` in `scripts.build`, but lack `tsup` in their own `devDependencies`.
   - Inference: Package builds rely on root hoisting. Running a package build in an isolated environment without root devDependencies will fail.

3. **TypeScript Module Resolution**:
   - Observation: `apps/web/tsconfig.json` overrides `"paths"`. In TypeScript, child `"paths"` completely replace parent `"paths"`.
   - Inference: `apps/web` cannot resolve TypeScript sources directly and relies on built `dist/` outputs in `node_modules`, creating build coupling (`pnpm build:packages` mandatory before `apps/web` typecheck).

4. **Monorepo Script Completeness**:
   - Observation: `package.json` `"build"` and `"typecheck"` omit `apps/web`.
   - Inference: Developers and CI running standard `pnpm build` or `pnpm typecheck` will miss build or type errors in the primary application.

---

## 3. Caveats

- **External CVE Vulnerability Scanning**: Operating in `CODE_ONLY` network mode prevents running remote vulnerability databases (e.g. `pnpm audit` against npm registry). Audit evaluated package versions against known EOL dates and local dependency tree structures.
- **Native Addon Build Environment**: `node-pty` native compilation behavior depends on host C++ compiler availability (MSVC on Windows, GCC/Clang on Linux/macOS).

---

## 4. Conclusion

The ManyHands monorepo has a clean, acyclic dependency architecture that strictly enforces layering boundaries (`apps -> specific packages -> shared`) with 0 legacy `@manyhands/core` leaks. However, build infrastructure and script configuration require targeted fixes (`MH-AUDIT-INFRA-001` through `MH-AUDIT-INFRA-010`) to achieve hermetic build reproducibility, full typecheck coverage, and supply chain health.

Full detailed report written to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_infra\report.md`.

---

## 5. Verification Method

Independent verification steps:

1. **Verify TypeScript typecheck & path resolution**:
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
