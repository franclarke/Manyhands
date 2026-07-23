# 08 — APIs, SSE & Web UI Technical Audit

**Audit Date**: 2026-07-21  
**Target Subsystems**: `apps/web` (Next.js App Router, React Flow Canvas, SSE Streamers)  
**Target Specs**: `AGENTS.md` (Product UI rules), `docs/design/interaction-model.md`  
**Auditor**: Teamwork Explorer (API, SSE & Web UI Specialist)  

---

## 1. Web Application & API Overview

`apps/web` hosts the single-graph user cockpit for ManyHands, providing real-time run tracking, decision queue management, interactive React Flow graph visualizations, and Xterm terminal views.

The audit verified key UI invariants (e.g. React Flow canvas viewport stability: autoFit triggers only on structural graph changes, never on routine node events). However, **16 API security, SSE resource leak, and state synchronization issues** were cataloged.

---

## 2. Audit Findings Inventory (`MH-AUDIT-API-xxx`)

| Issue ID | Severity | Location | Short Description |
|---|---|---|---|
| `MH-AUDIT-API-001` | **P1 (High)** | `apps/web/src/app/api/runs/[runId]/events/route.ts:45-89` | Server SSE stream loop ignores client `request.signal` aborts, leaking background timer handles. |
| `MH-AUDIT-API-002` | **P1 (High)** | `apps/web/src/lib/client/use-live-run-model.ts:88-120` | Client `useLiveRunModel` event buffer grows unboundedly and refolds all events per chunk ($O(N^2)$). |
| `MH-AUDIT-API-006` | **P1 (High)** | `apps/web/src/app/api/runs/route.ts:12-40` | All 17 backend API routes accept requests without session authentication or CSRF protection. |
| `MH-AUDIT-API-008` | **P1 (High)** | `apps/web/src/app/api/local-fs/pick-folder/route.ts:15-32` | `POST /api/local-fs/pick-folder` allows unauthenticated callers to trigger server-side GUI file dialogs. |
| `MH-AUDIT-API-003` | **P2 (Medium)** | `apps/web/src/app/runs/[runId]/_components/run-model-view.client.tsx:132` | Selecting nodes with pending human decisions does not auto-activate `DecisionDetails` inspector card. |
| `MH-AUDIT-API-004` | **P2 (Medium)** | `apps/web/src/lib/server/runs/repository.ts:140-180` | In-memory web repository cache drifts from disk event store during multi-process run execution. |
| `MH-AUDIT-API-005` | **P2 (Medium)** | `apps/web/src/app/api/runs/[runId]/decisions/route.ts:50` | Concurrent decision resolutions fail silently without returning HTTP 409 Conflict. |
| `MH-AUDIT-API-007` | **P2 (Medium)** | `apps/web/src/app/api/workspaces/route.ts:28` | Path input validation permits non-existent filesystem paths when registering new workspaces. |
| `MH-AUDIT-API-009` | **P2 (Medium)** | `apps/web/src/app/runs/[runId]/_components/terminal-view.client.tsx:40` | Xterm terminal addon memory leak on rapid tab switching. |
| `MH-AUDIT-API-010` | **P2 (Medium)** | `apps/web/src/lib/client/use-live-run-model.ts:145` | Missing SSE reconnect backoff delay causes high-frequency reconnect loops on network disconnect. |
| `MH-AUDIT-API-011` | **P2 (Medium)** | `apps/web/src/app/runs/[runId]/page.tsx:60` | Initial SSR page load flashes empty state before SSE stream establishes connection. |
| `MH-AUDIT-API-013` | **P2 (Medium)** | `apps/web/src/app/(command-center)/_components/` | Off-grid CSS spacing classes break visual design token consistency. |
| `MH-AUDIT-API-014` | **P2 (Medium)** | `apps/web/src/app/api/runs/[runId]/cancel/route.ts:35` | Run cancellation endpoint does not wait for process tree termination before returning 200 OK. |
| `MH-AUDIT-API-015` | **P3 (Low)** | `apps/web/src/app/runs/[runId]/_components/node-details.client.tsx:80` | Missing WCAG 2.2 aria-labels on close buttons in node details drawer. |
| `MH-AUDIT-API-016` | **P3 (Low)** | `apps/web/src/app/runs/[runId]/_components/activity-feed.client.tsx:50` | Activity feed timestamps lack explicit timezone formatting annotations. |

---

## 3. Deep Dive Evidence & Code Analysis

### `MH-AUDIT-API-001`: SSE Server Handle Leak
- **File**: `apps/web/src/app/api/runs/[runId]/events/route.ts:45-89`
- **Analysis**: The SSE handler creates a `setInterval` or polling loop reading from `JsonlRunEventStore`. When a browser tab closes or disconnects, Next.js sets `request.signal.aborted = true`. The route handler does not attach an event listener to `request.signal`, leaving the background timer running indefinitely on the server.

### `MH-AUDIT-API-006`: Unauthenticated Web APIs
- **File**: `apps/web/src/app/api/runs/route.ts:12-40`
- **Analysis**: All API routes (including workspace creation, run execution, run cancellation, decision submission, and local filesystem browsing) execute without verifying session cookies, bearer tokens, or CSRF headers. Anyone on the local network can initiate, cancel, or inspect run executions.
