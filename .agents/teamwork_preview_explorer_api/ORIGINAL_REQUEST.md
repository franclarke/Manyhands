## 2026-07-21T23:51:38Z
You are teamwork_preview_explorer (API, SSE & Web UI Specialist).
Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_api

Task:
Audit `apps/web` and API endpoints across ManyHands.
1. Inspect SvelteKit / Next.js / API routes, SSE (Server-Sent Events) streaming, state sync, decision queue UI, React Flow canvas behavior against product UI rules in `AGENTS.md` and `docs/design/`.
2. Check rules & invariants:
   - Canvas never recenters automatically on events.
   - Decision queue blocks only affected readiness, non-blocked work continues running.
   - SSE connection lifecycle, heartbeat, reconnect logic, event buffer memory limits.
   - API authentication/authorization, input validation, CSRF/CORS.
3. Identify all UI/API bugs, state drift issues, race conditions, memory leaks with line numbers and severity (`MH-AUDIT-API-xxx`).

Write your complete report to `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\teamwork_preview_explorer_api\report.md`.
Send a completion message when done via send_message.
