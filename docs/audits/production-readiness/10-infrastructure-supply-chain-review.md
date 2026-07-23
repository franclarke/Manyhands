# 10 — Infrastructure & Supply Chain Audit

**Audit Date**: 2026-07-21  
**Target Manifests**: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` across `packages/*` and `apps/*`  
**Auditor**: Teamwork Explorer (Infrastructure & Supply Chain Specialist)  

---

## 1. Infrastructure & Workspace Topology Summary

ManyHands uses pnpm workspace topology (`pnpm-workspace.yaml`) with Turborepo/tsup build orchestration.

The audit verified that internal package dependencies strictly obey layering boundaries (`apps -> specific packages -> shared`) with 0 legacy `@manyhands/core` leaks and 0 circular package dependencies. However, **10 infrastructure issues** were cataloged in build configuration, workspace protocols, and dependency versions.

---

## 2. Audit Findings Inventory (`MH-AUDIT-INFRA-xxx`)

| Issue ID | Severity | Location | Short Description |
|---|---|---|---|
| `MH-AUDIT-INFRA-001` | **P1 (High)** | `packages/execution-core/package.json:18-28` | Internal dependencies use explicit version numbers instead of pnpm `workspace:*` specifiers. |
| `MH-AUDIT-INFRA-002` | **P2 (Medium)** | `packages/task-graph/package.json:12` | Missing explicit `tsup` devDependency in package manifest while relying on root `tsup` binary. |
| `MH-AUDIT-INFRA-003` | **P2 (Medium)** | `apps/web/tsconfig.json:15-30` | `apps/web/tsconfig.json` path overrides force TypeScript to compile package source files directly instead of consuming built dist types. |
| `MH-AUDIT-INFRA-004` | **P2 (Medium)** | `package.json:8` (root) | Root build and typecheck scripts exclude `apps/web` from root `pnpm build` pipeline. |
| `MH-AUDIT-INFRA-005` | **P2 (Medium)** | `package.json:42` (root) | Monorepo uses EOL ESLint v8 toolchain with deprecated configuration format. |
| `MH-AUDIT-INFRA-006` | **P2 (Medium)** | `packages/repository-index/package.json:22` | Phantom dependency on `ts-morph` referenced in code comments but omitted from `package.json`. |
| `MH-AUDIT-INFRA-007` | **P2 (Medium)** | `apps/web/package.json:35` | React type definition mismatch (`@types/react@18` vs `react@19` runtime). |
| `MH-AUDIT-INFRA-008` | **P2 (Medium)** | `package.json:15` (root) | Missing pnpm lockfile frozen lockfile check in CI pipeline configuration. |
| `MH-AUDIT-INFRA-009` | **P3 (Low)** | `packages/shared/tsconfig.json:5` | Inconsistent `target` ECMAScript compilation target (`ES2022` vs `ESNext`). |
| `MH-AUDIT-INFRA-010` | **P3 (Low)** | `package.json:50` (root) | Unused root devDependency `@types/node` version mismatch. |

---

## 3. Detailed Remediation Actions

1. **Standardize Workspace Specifiers (`MH-AUDIT-INFRA-001`)**: Change all monorepo internal dependencies in `package.json` files to `"@manyhands/<pkg>": "workspace:*"`.
2. **Fix Web TSConfig Path Overrides (`MH-AUDIT-INFRA-003`)**: Remove direct `src/*` path mappings in `apps/web/tsconfig.json` so `apps/web` consumes built package declarations from `dist/`.
3. **Harmonize React Definitions (`MH-AUDIT-INFRA-007`)**: Upgrade `@types/react` and `@types/react-dom` to match React 19 versioning across `apps/web`.
