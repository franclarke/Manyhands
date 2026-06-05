/**
 * golden-planning-question — a human clarification during planning, modeled as
 * the unified Decision{kind:"clarify"}. Planning continues after the answer, then
 * the approve_plan gate is raised. Does NOT proceed to execution.
 * See docs/design/golden-fixtures.md.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-planning-question";

export const goldenPlanningQuestion = fixture(RUN_ID, [
  ev("system", "run.created", {
    intent: "Agregar exportación de reportes (formato a definir).",
    workspaceId: "ws-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "reports-app", baseCommit: "b0", readiness: "ok" }),

  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Exportar reportes", goal: "Coordinar la exportación.", depth: 0 }),
  ev("system", "plan.node.proposed", { nodeId: "n-export", parentId: "root", role: "leaf", title: "Exportador", goal: "Generar el archivo.", depth: 1 }),

  // Clarification gate (unified Decision)
  ev("system", "decision.raised", {
    decisionId: "d-clarify",
    kind: "clarify",
    blocking: true,
    context: { nodeIds: ["n-export"], question: "¿Formato de exportación?", options: ["CSV", "PDF"] }
  }),
  ev("human", "decision.resolved", { decisionId: "d-clarify", choice: { answer: "CSV" }, actor: "human" }),

  // Planning continues with the answer in hand
  ev("system", "plan.node.proposed", { nodeId: "n-csv", parentId: "root", role: "leaf", title: "Serializador CSV", goal: "Escribir filas CSV.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "n-download", parentId: "root", role: "leaf", title: "Descarga", goal: "Entregar el archivo.", depth: 1 }),

  ev("system", "plan.ready", { rootId: "root", nodeCount: 4, seamCount: 0, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve", kind: "approve_plan", blocking: true, context: {} })
]);
