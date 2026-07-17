/**
 * golden-subscriptions-billing-saas — a LedgerCloud SaaS product slice.
 *
 * Complements SupportFlow with a different operating story: a business-rule
 * clarification during planning, four scheduler-selected waves capped at three
 * tasks, and an auto-resolved structural conflict during billing integration.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-subscriptions-billing-saas";
const PLAN = "seam-billing-plan";
const SUBSCRIPTION = "seam-subscription";
const INVOICE = "seam-invoice";

export const goldenSubscriptionsBillingSaas = fixture(RUN_ID, [
  // Planning: a business decision is recorded before the graph is completed.
  ev("system", "run.created", {
    intent: "Implementar suscripciones multi-tenant con checkout, facturación, webhooks y métricas de revenue para LedgerCloud.",
    workspaceId: "ws-ledgercloud-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "ledgercloud-saas", baseCommit: "9f7bd4a", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "LedgerCloud: suscripciones", goal: "Entregar el flujo de contratación y facturación completo.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "c-pricing", parentId: "root", role: "composite", title: "Catálogo y precios", goal: "Integrar planes y reglas de prorrateo.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-checkout", parentId: "root", role: "composite", title: "Checkout", goal: "Integrar la API y el formulario de contratación.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-plan-catalog", parentId: "c-pricing", role: "leaf", title: "Catálogo de planes", goal: "Definir planes, moneda y períodos de cobro.", depth: 2 }),
  ev("system", "decision.raised", {
    decisionId: "d-proration-rounding",
    kind: "clarify",
    blocking: true,
    context: {
      nodeIds: ["n-plan-catalog"],
      question: "¿Cómo debe redondearse el prorrateo al cambiar de plan?",
      options: ["Redondeo bancario a centavos", "Siempre a favor del cliente", "Siempre a favor de la plataforma"]
    }
  }),
  ev("human", "decision.resolved", { decisionId: "d-proration-rounding", choice: { answer: "Redondeo bancario a centavos, visible en la factura." }, actor: "human" }),
  ev("system", "plan.node.proposed", { nodeId: "n-price-policy", parentId: "c-pricing", role: "leaf", title: "Política de prorrateo", goal: "Calcular créditos y cargos prorrateados con redondeo bancario.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-checkout-api", parentId: "c-checkout", role: "leaf", title: "API de checkout", goal: "Crear la suscripción y devolver su estado inicial.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-checkout-ui", parentId: "c-checkout", role: "leaf", title: "Formulario de checkout", goal: "Elegir un plan y confirmar la contratación.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "c-billing", parentId: "root", role: "composite", title: "Facturación y eventos", goal: "Integrar webhooks, motor y portal de facturas.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-webhook", parentId: "c-billing", role: "leaf", title: "Webhook de pagos", goal: "Normalizar eventos de pago del proveedor.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-invoice-engine", parentId: "c-billing", role: "leaf", title: "Motor de facturas", goal: "Generar facturas a partir de suscripciones y pagos.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-invoice-api", parentId: "c-billing", role: "leaf", title: "Portal de facturas", goal: "Listar y descargar facturas de la organización.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-email", parentId: "root", role: "leaf", title: "Emails transaccionales", goal: "Confirmar contratación y cobro exitoso.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-revenue", parentId: "root", role: "leaf", title: "Revenue analytics", goal: "Calcular MRR, churn y conversión por plan.", depth: 1 }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-plan-catalog", toTaskId: "n-price-policy", type: "contractual", inferred: false, rationale: "El cálculo usa períodos y moneda del plan." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-plan-catalog", toTaskId: "n-checkout-api", type: "contractual", inferred: false, rationale: "Checkout crea una suscripción sobre un plan existente." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-checkout-api", toTaskId: "n-webhook", type: "logical", inferred: false, rationale: "Los webhooks actualizan una suscripción creada por checkout." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-invoice-engine", toTaskId: "n-invoice-api", type: "structural", inferred: false, rationale: "El portal consulta facturas materializadas." }),
  ev("system", "plan.seam.proposed", {
    seamId: PLAN,
    name: "BillingPlan",
    producerNodeId: "n-plan-catalog",
    consumerNodeIds: ["n-price-policy", "n-checkout-api", "n-checkout-ui", "n-invoice-engine"],
    draftSignature: "BillingPlan { id, currency, interval, amountCents }"
  }),
  ev("system", "plan.seam.proposed", {
    seamId: SUBSCRIPTION,
    name: "Subscription",
    producerNodeId: "n-checkout-api",
    consumerNodeIds: ["n-webhook", "n-email", "n-revenue"],
    draftSignature: "Subscription { id, organizationId, planId, status, currentPeriodEnd }"
  }),
  ev("system", "plan.seam.proposed", {
    seamId: INVOICE,
    name: "Invoice",
    producerNodeId: "n-invoice-engine",
    consumerNodeIds: ["n-invoice-api", "n-revenue"],
    draftSignature: "Invoice { id, subscriptionId, totalCents, status, issuedAt }"
  }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 13, seamCount: 3, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve-plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-approve-plan", choice: { action: "approve" }, actor: "human" }),

  // Grounding and explicit wave plan.
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "packages/billing/src/plan.ts", kind: "impl-stub" }),
  ev("system", "skeleton.file.committed", { path: "packages/billing/src/subscription.ts", kind: "impl-stub" }),
  ev("system", "skeleton.file.committed", { path: "packages/billing/src/invoice.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", { seamId: PLAN, revision: 1, frozenSignature: "BillingPlan { id, currency, interval, amountCents }", extractedFrom: "packages/billing/src/plan.ts" }),
  ev("system", "seam.frozen", { seamId: SUBSCRIPTION, revision: 1, frozenSignature: "Subscription { id, organizationId, planId, status, currentPeriodEnd }", extractedFrom: "packages/billing/src/subscription.ts" }),
  ev("system", "seam.frozen", { seamId: INVOICE, revision: 1, frozenSignature: "Invoice { id, subscriptionId, totalCents, status, issuedAt }", extractedFrom: "packages/billing/src/invoice.ts" }),
  ev("system", "scope.derived", { nodeId: "n-plan-catalog", paths: ["packages/billing/src/plan.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-price-policy", paths: ["packages/billing/src/proration.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-checkout-api", paths: ["apps/web/src/app/api/checkout/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-checkout-ui", paths: ["apps/web/src/app/settings/billing/page.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-webhook", paths: ["apps/web/src/app/api/webhooks/payments/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-invoice-engine", paths: ["packages/billing/src/invoice.ts", "packages/billing/src/event-order.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-invoice-api", paths: ["apps/web/src/app/api/invoices/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-email", paths: ["packages/notifications/src/billing-email.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-revenue", paths: ["packages/analytics/src/revenue.ts"] }),
  ev("system", "wave.planned", { waves: [
    { waveId: "w-catalog", index: 0, nodeIds: ["n-plan-catalog", "n-price-policy"], unlockedBySeams: [PLAN] },
    { waveId: "w-contract", index: 1, nodeIds: ["n-checkout-api", "n-checkout-ui", "n-invoice-engine"], unlockedBySeams: [PLAN, SUBSCRIPTION, INVOICE] },
    { waveId: "w-delivery", index: 2, nodeIds: ["n-webhook", "n-invoice-api", "n-email"], unlockedBySeams: [SUBSCRIPTION, INVOICE] },
    { waveId: "w-insights", index: 3, nodeIds: ["n-revenue"], unlockedBySeams: [SUBSCRIPTION, INVOICE] }
  ] }),
  ev("system", "grounding.completed", { skeletonCommit: "ledgercloud-skeleton" }),

  // Wave 1.
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-catalog", source: "execution-host", waveIndex: 0, waveOrdinal: 1, maxParallel: 3, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-plan-catalog", "n-price-policy"], selectedTaskIds: ["n-plan-catalog", "n-price-policy"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-catalog", nodeIds: ["n-plan-catalog", "n-price-policy"] }),
  ev("agent", "node.execution.started", { nodeId: "n-plan-catalog", agent: "claude-code-cli", model: "sonnet", waveId: "w-catalog" }),
  ev("agent", "node.execution.started", { nodeId: "n-price-policy", agent: "claude-code-cli", model: "sonnet", waveId: "w-catalog" }),
  ev("agent", "node.verify.passed", { nodeId: "n-plan-catalog", waveId: "w-catalog", commit: "plan-1", changedFiles: ["packages/billing/src/plan.ts"], builtAgainst: [], produces: { seamId: PLAN, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-price-policy", waveId: "w-catalog", commit: "proration-1", changedFiles: ["packages/billing/src/proration.ts"], builtAgainst: [{ seamId: PLAN, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-catalog" }),
  ev("system", "integration.started", { compositeNodeId: "c-pricing", childNodeIds: ["n-plan-catalog", "n-price-policy"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-pricing", testsPass: 10, testsTotal: 10, passed: true, builtAgainst: [{ seamId: PLAN, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-pricing", commit: "pricing-1", status: "success" }),

  // Wave 2.
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-contract", source: "execution-host", waveIndex: 1, waveOrdinal: 2, maxParallel: 3, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-checkout-api", "n-checkout-ui", "n-invoice-engine"], selectedTaskIds: ["n-checkout-api", "n-checkout-ui", "n-invoice-engine"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 1, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-contract", nodeIds: ["n-checkout-api", "n-checkout-ui", "n-invoice-engine"] }),
  ev("agent", "node.execution.started", { nodeId: "n-checkout-api", agent: "claude-code-cli", model: "sonnet", waveId: "w-contract" }),
  ev("agent", "node.execution.started", { nodeId: "n-checkout-ui", agent: "claude-code-cli", model: "sonnet", waveId: "w-contract" }),
  ev("agent", "node.execution.started", { nodeId: "n-invoice-engine", agent: "claude-code-cli", model: "sonnet", waveId: "w-contract" }),
  ev("agent", "node.verify.passed", { nodeId: "n-checkout-api", waveId: "w-contract", commit: "checkout-api-1", changedFiles: ["apps/web/src/app/api/checkout/route.ts"], builtAgainst: [{ seamId: PLAN, revision: 1 }], produces: { seamId: SUBSCRIPTION, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-checkout-ui", waveId: "w-contract", commit: "checkout-ui-1", changedFiles: ["apps/web/src/app/settings/billing/page.tsx"], builtAgainst: [{ seamId: PLAN, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-invoice-engine", waveId: "w-contract", commit: "invoice-engine-1", changedFiles: ["packages/billing/src/invoice.ts", "packages/billing/src/event-order.ts"], builtAgainst: [{ seamId: PLAN, revision: 1 }], produces: { seamId: INVOICE, revision: 1 } }),
  ev("system", "wave.closed", { waveId: "w-contract" }),
  ev("system", "integration.started", { compositeNodeId: "c-checkout", childNodeIds: ["n-checkout-api", "n-checkout-ui"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-checkout", testsPass: 12, testsTotal: 12, passed: true, builtAgainst: [{ seamId: PLAN, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-checkout", commit: "checkout-1", status: "success" }),

  // Wave 3.
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-delivery", source: "execution-host", waveIndex: 2, waveOrdinal: 3, maxParallel: 3, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-webhook", "n-invoice-api", "n-email"], selectedTaskIds: ["n-webhook", "n-invoice-api", "n-email"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 0, high: 1, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-delivery", nodeIds: ["n-webhook", "n-invoice-api", "n-email"] }),
  ev("agent", "node.execution.started", { nodeId: "n-webhook", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.execution.started", { nodeId: "n-invoice-api", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.execution.started", { nodeId: "n-email", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.verify.passed", { nodeId: "n-webhook", waveId: "w-delivery", commit: "webhook-1", changedFiles: ["apps/web/src/app/api/webhooks/payments/route.ts"], builtAgainst: [{ seamId: SUBSCRIPTION, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-invoice-api", waveId: "w-delivery", commit: "invoice-api-1", changedFiles: ["apps/web/src/app/api/invoices/route.ts"], builtAgainst: [{ seamId: INVOICE, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-email", waveId: "w-delivery", commit: "email-1", changedFiles: ["packages/notifications/src/billing-email.ts"], builtAgainst: [{ seamId: SUBSCRIPTION, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-delivery" }),
  ev("system", "integration.started", { compositeNodeId: "c-billing", childNodeIds: ["n-webhook", "n-invoice-engine", "n-invoice-api"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-billing", testsPass: 21, testsTotal: 22, passed: false, builtAgainst: [{ seamId: SUBSCRIPTION, revision: 1 }, { seamId: INVOICE, revision: 1 }], failuresRef: "blob://golden-subscriptions-billing-saas/integration/billing-event-order" }),
  ev("system", "conflict.detected", { conflictId: "cf-billing-event-order", dimension: "structural", status: "detected", nodeIds: ["n-webhook", "n-invoice-engine"], files: ["packages/billing/src/event-order.ts"], autoResolvable: true, diagnosisRef: "blob://golden-subscriptions-billing-saas/conflicts/billing-event-order" }),
  ev("system", "conflict.resolved", { conflictId: "cf-billing-event-order", by: "system", resolutionId: "order-payment-before-invoice" }),
  ev("system", "integration.validated", { compositeNodeId: "c-billing", testsPass: 22, testsTotal: 22, passed: true, builtAgainst: [{ seamId: SUBSCRIPTION, revision: 1 }, { seamId: INVOICE, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-billing", commit: "billing-1", status: "success" }),

  // Wave 4, final integration, evidence and acceptance.
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-insights", source: "execution-host", waveIndex: 3, waveOrdinal: 4, maxParallel: 3, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-revenue"], selectedTaskIds: ["n-revenue"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-insights", nodeIds: ["n-revenue"] }),
  ev("agent", "node.execution.started", { nodeId: "n-revenue", agent: "claude-code-cli", model: "sonnet", waveId: "w-insights" }),
  ev("agent", "node.verify.passed", { nodeId: "n-revenue", waveId: "w-insights", commit: "revenue-1", changedFiles: ["packages/analytics/src/revenue.ts"], builtAgainst: [{ seamId: SUBSCRIPTION, revision: 1 }, { seamId: INVOICE, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-insights" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-pricing", "c-checkout", "c-billing", "n-email", "n-revenue"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 38, testsTotal: 38, passed: true, builtAgainst: [{ seamId: PLAN, revision: 1 }, { seamId: SUBSCRIPTION, revision: 1 }, { seamId: INVOICE, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "ledgercloud-1", status: "success" }),
  ev("system", "run.evidence.ready", { aggregateDiffRef: "blob://golden-subscriptions-billing-saas/diff", tests: { pass: 38, total: 38 }, narrativeRef: "blob://golden-subscriptions-billing-saas/narrative", integrationCommit: "ledgercloud-1" }),
  ev("system", "decision.raised", { decisionId: "d-merge", kind: "approve_merge", blocking: true, context: { diffRef: "blob://golden-subscriptions-billing-saas/diff", nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-merge", choice: { action: "accept" }, actor: "human" }),
  ev("system", "run.completed", { status: "success" }),
  ev("system", "run.metrics.ready", {
    metrics: {
      depth: 2,
      leafCount: 9,
      compositeCount: 4,
      avgLeafDepth: 1.67,
      maxLeafDepth: 2,
      dependencyCount: 4,
      avgAcceptanceCriteriaPerLeaf: 3,
      estimatedTokensPerLeaf: 2900,
      integrationSuccessRate: 1,
      leafSuccessRate: 1,
      conflictRate: 0.11,
      totalDurationMs: 211000,
      linesChanged: 1024,
      unexpectedCommitCount: 0,
      scopeViolationCount: 0,
      totalCostUsd: 2.17,
      testsPassedRate: 1
    }
  })
]);
