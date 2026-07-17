/**
 * golden-support-desk-saas — an end-to-end SupportFlow SaaS feature delivery.
 *
 * The scenario is intentionally closer to a product slice than the small
 * regression fixtures: it has a nested DAG, two contracts, bounded parallel
 * waves, an autonomous verification repair, a human semantic decision, and a
 * selective re-execution before the final evidence and merge approval.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-support-desk-saas";
const SESSION = "seam-session";
const TICKET = "seam-ticket";

export const goldenSupportDeskSaas = fixture(RUN_ID, [
  // Framing + proposal
  ev("system", "run.created", {
    intent: "Incorporar a SupportFlow un flujo de tickets con roles, comentarios, notificaciones de SLA y métricas operativas.",
    workspaceId: "ws-supportflow-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "supportflow-saas", baseCommit: "8a1c9d2", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "SupportFlow: tickets con SLA", goal: "Entregar el flujo completo de soporte con evidencia integrada.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "c-access", parentId: "root", role: "composite", title: "Identidad y permisos", goal: "Integrar sesión y autorización por rol.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-tickets", parentId: "root", role: "composite", title: "Ciclo de vida de tickets", goal: "Integrar dominio, API, inbox y comentarios.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-auth", parentId: "c-access", role: "leaf", title: "Sesión del agente", goal: "Exponer identidad y organización de la persona autenticada.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-roles", parentId: "c-access", role: "leaf", title: "Autorización por rol", goal: "Permitir acciones de ticket según el rol de soporte.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-ticket-domain", parentId: "c-tickets", role: "leaf", title: "Dominio de tickets", goal: "Modelar estado, prioridad, SLA y transición de tickets.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-ticket-api", parentId: "c-tickets", role: "leaf", title: "API de tickets", goal: "Crear, listar y actualizar tickets para la organización actual.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-inbox-ui", parentId: "c-tickets", role: "leaf", title: "Inbox de soporte", goal: "Mostrar la cola de tickets con filtros y prioridad.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-comments", parentId: "c-tickets", role: "leaf", title: "Comentarios internos", goal: "Agregar notas internas y refrescar el detalle del ticket.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-notifications", parentId: "root", role: "leaf", title: "Alertas de SLA", goal: "Notificar antes de que un ticket incumpla su SLA.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-analytics", parentId: "root", role: "leaf", title: "Métricas de soporte", goal: "Registrar volumen, primera respuesta y cumplimiento de SLA.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-audit", parentId: "root", role: "leaf", title: "Auditoría de cambios", goal: "Guardar eventos de cambio sin depender del flujo de tickets.", depth: 1 }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-auth", toTaskId: "n-roles", type: "contractual", inferred: false, rationale: "Los permisos requieren una sesión válida." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-ticket-domain", toTaskId: "n-ticket-api", type: "contractual", inferred: false, rationale: "La API expone el contrato del dominio." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-ticket-api", toTaskId: "n-inbox-ui", type: "structural", inferred: false, rationale: "El inbox consume la API de tickets." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-ticket-domain", toTaskId: "n-comments", type: "contractual", inferred: false, rationale: "Los comentarios se adjuntan a la entidad ticket." }),
  ev("system", "plan.seam.proposed", {
    seamId: SESSION,
    name: "CurrentSupportSession",
    producerNodeId: "n-auth",
    consumerNodeIds: ["n-roles", "n-ticket-api", "n-inbox-ui", "n-comments"],
    draftSignature: "getSession(): { userId:string; organizationId:string; role:'agent'|'manager' }"
  }),
  ev("system", "plan.seam.proposed", {
    seamId: TICKET,
    name: "TicketContract",
    producerNodeId: "n-ticket-domain",
    consumerNodeIds: ["n-ticket-api", "n-inbox-ui", "n-comments", "n-notifications", "n-analytics"],
    draftSignature: "Ticket { id, status, priority, dueAt, organizationId }"
  }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 12, seamCount: 2, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve-plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-approve-plan", choice: { action: "approve" }, actor: "human" }),

  // Foundation: freeze the two real boundaries and derive precise scope.
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "packages/domain/src/tickets.ts", kind: "impl-stub" }),
  ev("system", "skeleton.file.committed", { path: "apps/web/src/lib/auth/session.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", { seamId: SESSION, revision: 1, frozenSignature: "getSession(): { userId:string; organizationId:string; role:'agent'|'manager' }", extractedFrom: "apps/web/src/lib/auth/session.ts" }),
  ev("system", "seam.frozen", { seamId: TICKET, revision: 1, frozenSignature: "Ticket { id, status, priority, dueAt, organizationId }", extractedFrom: "packages/domain/src/tickets.ts" }),
  ev("system", "scope.derived", { nodeId: "n-auth", paths: ["apps/web/src/lib/auth/session.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-roles", paths: ["apps/web/src/lib/auth/permissions.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-ticket-domain", paths: ["packages/domain/src/tickets.ts", "packages/domain/src/ticket-events.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-ticket-api", paths: ["apps/web/src/app/api/tickets/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-inbox-ui", paths: ["apps/web/src/app/inbox/page.tsx", "apps/web/src/components/ticket-list.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-comments", paths: ["apps/web/src/app/api/tickets/[id]/comments/route.ts", "apps/web/src/components/ticket-comments.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-notifications", paths: ["packages/notifications/src/sla-alerts.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-analytics", paths: ["packages/analytics/src/support-metrics.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-audit", paths: ["packages/audit/src/ticket-audit.ts"] }),
  ev("system", "wave.planned", { waves: [
    { waveId: "w-foundation", index: 0, nodeIds: ["n-auth", "n-ticket-domain", "n-audit"], unlockedBySeams: [SESSION, TICKET] },
    { waveId: "w-experience", index: 1, nodeIds: ["n-roles", "n-ticket-api", "n-inbox-ui", "n-comments", "n-notifications", "n-analytics"], unlockedBySeams: [SESSION, TICKET] }
  ] }),
  ev("system", "grounding.completed", { skeletonCommit: "supportflow-skeleton" }),

  // Wave 1: independent foundations run in parallel. The domain repairs itself.
  ev("system", "wave.opened", { waveId: "w-foundation", nodeIds: ["n-auth", "n-ticket-domain", "n-audit"] }),
  ev("agent", "node.execution.started", { nodeId: "n-auth", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.execution.started", { nodeId: "n-ticket-domain", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.execution.started", { nodeId: "n-audit", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.verify.iteration", { nodeId: "n-auth", waveId: "w-foundation", iteration: 1, maxIterations: 3, build: "pass", testsPass: 6, testsTotal: 6 }),
  ev("agent", "node.verify.passed", { nodeId: "n-auth", waveId: "w-foundation", commit: "auth-1", changedFiles: ["apps/web/src/lib/auth/session.ts"], builtAgainst: [], produces: { seamId: SESSION, revision: 1 } }),
  ev("agent", "node.verify.iteration", { nodeId: "n-ticket-domain", waveId: "w-foundation", iteration: 1, maxIterations: 3, build: "fail", testsPass: 5, testsTotal: 8 }),
  ev("agent", "node.verify.failed", { nodeId: "n-ticket-domain", iteration: 1, cause: "La transición de estado closed → open no restablece dueAt." }),
  ev("agent", "node.repair.started", { nodeId: "n-ticket-domain", reason: "Restablecer SLA al reabrir un ticket." }),
  ev("agent", "node.verify.iteration", { nodeId: "n-ticket-domain", waveId: "w-foundation", iteration: 2, maxIterations: 3, build: "pass", testsPass: 8, testsTotal: 8 }),
  ev("agent", "node.verify.passed", { nodeId: "n-ticket-domain", waveId: "w-foundation", commit: "tickets-1", changedFiles: ["packages/domain/src/tickets.ts", "packages/domain/src/ticket-events.ts"], builtAgainst: [], produces: { seamId: TICKET, revision: 1 } }),
  ev("agent", "node.verify.iteration", { nodeId: "n-audit", waveId: "w-foundation", iteration: 1, maxIterations: 3, build: "pass", testsPass: 4, testsTotal: 4 }),
  ev("agent", "node.verify.passed", { nodeId: "n-audit", waveId: "w-foundation", commit: "audit-1", changedFiles: ["packages/audit/src/ticket-audit.ts"], builtAgainst: [] }),
  ev("system", "wave.closed", { waveId: "w-foundation" }),

  // Wave 2: all product consumers can now move in parallel.
  ev("system", "wave.opened", { waveId: "w-experience", nodeIds: ["n-roles", "n-ticket-api", "n-inbox-ui", "n-comments", "n-notifications", "n-analytics"] }),
  ev("agent", "node.execution.started", { nodeId: "n-roles", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.execution.started", { nodeId: "n-ticket-api", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.execution.started", { nodeId: "n-inbox-ui", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.execution.started", { nodeId: "n-comments", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.execution.started", { nodeId: "n-notifications", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.execution.started", { nodeId: "n-analytics", agent: "claude-code-cli", model: "sonnet", waveId: "w-experience" }),
  ev("agent", "node.verify.passed", { nodeId: "n-roles", waveId: "w-experience", commit: "roles-1", changedFiles: ["apps/web/src/lib/auth/permissions.ts"], builtAgainst: [{ seamId: SESSION, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-ticket-api", waveId: "w-experience", commit: "api-1", changedFiles: ["apps/web/src/app/api/tickets/route.ts"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-inbox-ui", waveId: "w-experience", commit: "inbox-1", changedFiles: ["apps/web/src/app/inbox/page.tsx", "apps/web/src/components/ticket-list.tsx"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-comments", waveId: "w-experience", commit: "comments-1", changedFiles: ["apps/web/src/app/api/tickets/[id]/comments/route.ts", "apps/web/src/components/ticket-comments.tsx"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-notifications", waveId: "w-experience", commit: "alerts-1", changedFiles: ["packages/notifications/src/sla-alerts.ts"], builtAgainst: [{ seamId: TICKET, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-analytics", waveId: "w-experience", commit: "metrics-1", changedFiles: ["packages/analytics/src/support-metrics.ts"], builtAgainst: [{ seamId: TICKET, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-experience" }),

  // Bottom-up integration discovers a semantic SLA mismatch not captured by the initial contract.
  ev("system", "integration.started", { compositeNodeId: "c-access", childNodeIds: ["n-auth", "n-roles"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-access", testsPass: 12, testsTotal: 12, passed: true, builtAgainst: [{ seamId: SESSION, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-access", commit: "access-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-tickets", childNodeIds: ["n-ticket-domain", "n-ticket-api", "n-inbox-ui", "n-comments"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-tickets", testsPass: 27, testsTotal: 27, passed: true, builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-tickets", commit: "tickets-ui-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-access", "c-tickets", "n-notifications", "n-analytics", "n-audit"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 41, testsTotal: 43, passed: false, builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 1 }], failuresRef: "blob://golden-support-desk-saas/integration/sla-timezone-failure" }),
  ev("system", "conflict.detected", {
    conflictId: "cf-sla-timezone",
    dimension: "behavioral",
    status: "detected",
    nodeIds: ["n-ticket-domain", "n-notifications", "n-analytics"],
    seamId: TICKET,
    files: ["packages/domain/src/tickets.ts", "packages/notifications/src/sla-alerts.ts", "packages/analytics/src/support-metrics.ts"],
    autoResolvable: false,
    diagnosisRef: "blob://golden-support-desk-saas/conflicts/sla-timezone"
  }),
  ev("system", "amendment.proposed", {
    amendmentId: "am-sla-timezone",
    nodeId: "n-ticket-domain",
    kind: "seam",
    changeKind: "contract",
    detail: { seamId: TICKET, fromRevision: 1, toRevision: 2, contract: { "ticket.dueAt.timezone": "UTC", "ticket.dueAt.serialization": "ISO-8601" } },
    affects: ["n-ticket-domain", "n-ticket-api", "n-inbox-ui", "n-comments", "n-notifications", "n-analytics", "c-tickets", "root"],
    diagnosisRef: "blob://golden-support-desk-saas/amendments/sla-timezone"
  }),
  ev("system", "decision.raised", { decisionId: "d-sla-timezone", kind: "approve_amendment", blocking: true, context: { amendmentId: "am-sla-timezone", seamId: TICKET, nodeIds: ["n-ticket-domain", "n-notifications", "n-analytics"] } }),
  ev("human", "decision.resolved", { decisionId: "d-sla-timezone", choice: { action: "approve" }, actor: "human" }),
  ev("system", "seam.amended", { seamId: TICKET, revision: 2, changeKind: "contract", contract: { "ticket.dueAt.timezone": "UTC", "ticket.dueAt.serialization": "ISO-8601" } }),
  ev("system", "amendment.applied", { amendmentId: "am-sla-timezone" }),

  // Selective recovery: identity and audit stay intact; only ticket consumers re-run.
  ev("agent", "node.execution.started", { nodeId: "n-ticket-domain", agent: "claude-code-cli", model: "sonnet", reason: "amendment:ticket SLA timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-ticket-domain", commit: "tickets-2", changedFiles: ["packages/domain/src/tickets.ts"], builtAgainst: [], produces: { seamId: TICKET, revision: 2 } }),
  ev("agent", "node.execution.started", { nodeId: "n-ticket-api", agent: "claude-code-cli", model: "sonnet", reason: "stale:seam-ticket@2" }),
  ev("agent", "node.execution.started", { nodeId: "n-inbox-ui", agent: "claude-code-cli", model: "sonnet", reason: "stale:seam-ticket@2" }),
  ev("agent", "node.execution.started", { nodeId: "n-comments", agent: "claude-code-cli", model: "sonnet", reason: "stale:seam-ticket@2" }),
  ev("agent", "node.execution.started", { nodeId: "n-notifications", agent: "claude-code-cli", model: "sonnet", reason: "stale:seam-ticket@2" }),
  ev("agent", "node.execution.started", { nodeId: "n-analytics", agent: "claude-code-cli", model: "sonnet", reason: "stale:seam-ticket@2" }),
  ev("agent", "node.verify.passed", { nodeId: "n-ticket-api", commit: "api-2", changedFiles: ["apps/web/src/app/api/tickets/route.ts"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 2 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-inbox-ui", commit: "inbox-2", changedFiles: ["apps/web/src/components/ticket-list.tsx"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 2 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-comments", commit: "comments-2", changedFiles: ["apps/web/src/components/ticket-comments.tsx"], builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 2 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-notifications", commit: "alerts-2", changedFiles: ["packages/notifications/src/sla-alerts.ts"], builtAgainst: [{ seamId: TICKET, revision: 2 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-analytics", commit: "metrics-2", changedFiles: ["packages/analytics/src/support-metrics.ts"], builtAgainst: [{ seamId: TICKET, revision: 2 }] }),
  ev("system", "integration.started", { compositeNodeId: "c-tickets", childNodeIds: ["n-ticket-domain", "n-ticket-api", "n-inbox-ui", "n-comments"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-tickets", testsPass: 29, testsTotal: 29, passed: true, builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-tickets", commit: "tickets-ui-2", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-access", "c-tickets", "n-notifications", "n-analytics", "n-audit"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 43, testsTotal: 43, passed: true, builtAgainst: [{ seamId: SESSION, revision: 1 }, { seamId: TICKET, revision: 2 }] }),
  ev("system", "conflict.resolved", { conflictId: "cf-sla-timezone", by: "human", resolutionId: "utc-ticket-deadlines" }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "supportflow-1", status: "success" }),

  // Disposition: durable evidence, human merge approval, and recorded metrics.
  ev("system", "run.evidence.ready", {
    aggregateDiffRef: "blob://golden-support-desk-saas/diff",
    tests: { pass: 43, total: 43 },
    narrativeRef: "blob://golden-support-desk-saas/narrative",
    integrationCommit: "supportflow-1",
    invalidationTrace: [{
      seamId: TICKET,
      from: 1,
      to: 2,
      cause: "SLA dueAt timezone was ambiguous",
      reExecuted: ["n-ticket-domain", "n-ticket-api", "n-inbox-ui", "n-comments", "n-notifications", "n-analytics"],
      reIntegrated: ["c-tickets", "root"],
      preserved: ["n-auth", "n-roles", "c-access", "n-audit"]
    }]
  }),
  ev("system", "decision.raised", { decisionId: "d-merge", kind: "approve_merge", blocking: true, context: { diffRef: "blob://golden-support-desk-saas/diff", nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-merge", choice: { action: "accept" }, actor: "human" }),
  ev("system", "run.completed", { status: "success" }),
  ev("system", "run.metrics.ready", {
    metrics: {
      depth: 2,
      leafCount: 9,
      compositeCount: 3,
      avgLeafDepth: 1.67,
      maxLeafDepth: 2,
      dependencyCount: 4,
      avgAcceptanceCriteriaPerLeaf: 3,
      estimatedTokensPerLeaf: 2600,
      integrationSuccessRate: 1,
      leafSuccessRate: 1,
      conflictRate: 0.11,
      totalDurationMs: 188000,
      linesChanged: 864,
      unexpectedCommitCount: 0,
      scopeViolationCount: 0,
      totalCostUsd: 1.84,
      testsPassedRate: 1
    }
  })
]);
