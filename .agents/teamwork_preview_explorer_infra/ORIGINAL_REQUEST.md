## 2026-07-21T23:51:39Z
Audit monorepo configuration, build infrastructure, pnpm workspace setup, dependency tree, and supply chain security.
1. Inspect root `package.json`, `pnpm-workspace.yaml`, package `package.json` files, tsconfig files, build scripts.
2. Check rules:
   - Layering boundary (`apps -> specific packages -> shared`, no new deps to legacy `@manyhands/core`).
   - Deprecated or vulnerable packages.
   - Circular package dependencies.
   - Build script reproducibility and environment dependencies.
3. Identify build failures, illegal dependency directions, security vulnerabilities in dependencies with exact line numbers and severity (`MH-AUDIT-INFRA-xxx`).

Write your complete report to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_infra\report.md`.
Send a completion message when done via send_message.
