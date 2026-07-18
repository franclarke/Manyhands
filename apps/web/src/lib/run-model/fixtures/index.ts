import type { RunEvent, RunFixture } from "../types";

const START = Date.parse("2026-07-17T14:00:00.000Z");
const REV = "fixture-r1";

function event(runId: string, sequence: number, type: string, payload: Record<string, unknown>): RunEvent {
  return { eventId: `${runId}:${sequence}`, runId, seq: sequence, at: new Date(START + sequence * 35_000).toISOString(), actor: "system", type, payload };
}

function node(id: string, parentId: string | null, kind: "root" | "composite" | "leaf" | "integrator", title: string, goal: string) {
  return { id, parentId, kind, title, goal };
}

function contract(nodeId: string, goal: string, paths: string[], consumes: string[] = [], produces: string[] = [], seamIds: string[] = []) {
  const ref = (id: string) => ({ id, revision: REV });
  const criterionId = `criterion-${nodeId}`;
  const artifactIds = [...new Set([...consumes, ...produces])];
  return {
    schemaVersion: 2,
    task: {
      schemaVersion: 2, id: `task-${nodeId}`, revision: REV, provenance: "compiled", nodeId, goal,
      acceptanceCriteria: [{ id: criterionId, kind: "integration", description: `El comportamiento de ${goal.toLowerCase()} funciona y queda cubierto por pruebas.`, required: true }],
      scope: ref(`scope-${nodeId}`), consumes: consumes.map(ref), produces: produces.map(ref), seams: seamIds.map(ref), validation: ref(`validation-${nodeId}`), constraints: ["No modificar trabajo fuera del alcance declarado"]
    },
    scope: { schemaVersion: 2, id: `scope-${nodeId}`, revision: REV, provenance: "compiled", nodeId, allowedPaths: paths, forbiddenPaths: [".env"], coordinationPaths: [] },
    seams: seamIds.map((id) => ({ schemaVersion: 2, id, revision: REV, provenance: "compiled", kind: "api", specification: `${id} mantiene un request y response versionado`, producerNodeId: id === "seam-availability" ? "availability" : "reservations", consumerNodeIds: id === "seam-availability" ? ["booking-ui"] : ["confirmation"], semanticFacts: { version: "v1" }, compatibility: { mode: "exact", rules: ["Los campos requeridos no cambian"] } })),
    artifacts: artifactIds.map((id) => ({ schemaVersion: 2, id, revision: REV, provenance: "compiled", producerNodeId: id === "artifact-reservation" ? "reservations" : nodeId, consumerNodeIds: id === "artifact-reservation" ? ["confirmation"] : [], artifactType: "git-commit", materialization: "commit", expectedPaths: [] })),
    validation: { schemaVersion: 2, id: `validation-${nodeId}`, revision: REV, provenance: "compiled", nodeId, obligations: [{ id: `obligation-${nodeId}`, criterionId, layer: "integration", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "required", negativeControl: "when_feasible", flakyPolicy: "forbid" }] }
  };
}

function matrix(id: string, commit: string, nodeId = "run") {
  return { matrixId: id, candidateCommit: commit, validationContract: { id: `validation-${nodeId}`, revision: REV }, criteria: [{ criterionId: `criterion-${nodeId}`, obligationId: `obligation-${nodeId}`, status: "satisfied", justification: "Pruebas de integraciÃ³n y comportamiento completadas sobre el commit exacto.", evidenceRefs: [`test:${commit}`] }], outcome: "verified" };
}

function appointmentFixture(): RunFixture {
  const runId = "fixture-appointment-booking-v2";
  const nodes = {
    root: node("root", null, "root", "AgendaFÃ¡cil", "Entregar una aplicaciÃ³n sencilla para reservar turnos"),
    experience: node("experience", "root", "composite", "Experiencia de reserva", "Permitir que una persona encuentre y confirme un turno"),
    journey: node("journey", "experience", "composite", "Flujo del cliente", "Reunir bÃºsqueda y confirmaciÃ³n en una experiencia coherente"),
    "booking-ui": node("booking-ui", "journey", "leaf", "Pantalla de turnos", "Mostrar fechas y horarios disponibles de forma accesible"),
    confirmation: node("confirmation", "journey", "leaf", "ConfirmaciÃ³n", "Confirmar la reserva y explicar el siguiente paso"),
    scheduling: node("scheduling", "root", "composite", "Motor de agenda", "Garantizar disponibilidad y reservas sin duplicados"),
    core: node("core", "scheduling", "composite", "Reglas de agenda", "Concentrar las reglas que protegen cada turno"),
    availability: node("availability", "core", "leaf", "Disponibilidad", "Calcular horarios libres segÃºn agenda y duraciÃ³n"),
    reservations: node("reservations", "core", "leaf", "Reserva segura", "Crear una reserva idempotente y evitar dobles turnos"),
    operations: node("operations", "root", "composite", "OperaciÃ³n confiable", "Dar visibilidad y seguimiento al negocio"),
    reliability: node("reliability", "operations", "composite", "ComunicaciÃ³n y control", "Notificar cambios y permitir supervisar reservas"),
    notifications: node("notifications", "reliability", "leaf", "Recordatorios", "Enviar confirmaciones y recordatorios sin duplicarlos"),
    admin: node("admin", "reliability", "leaf", "Panel diario", "Mostrar los turnos del dÃ­a y sus estados")
  };
  const graph = {
    schemaVersion: 2, graphId: "graph-appointment", revision: 1, rootId: "root", baseCommit: "base-appointment", repositorySnapshotId: "snapshot-appointment", nodes,
    artifactRequirements: [{ id: "require-reservation", artifactContract: { id: "artifact-reservation", revision: REV }, producerNodeId: "reservations", consumerNodeId: "confirmation", requiredFor: "execution" }],
    seamBindings: [
      { id: "binding-availability", seamContract: { id: "seam-availability", revision: REV }, producerNodeId: "availability", consumerNodeId: "booking-ui", producerRevision: REV, consumerRevision: REV },
      { id: "binding-reservation", seamContract: { id: "seam-reservation", revision: REV }, producerNodeId: "reservations", consumerNodeId: "confirmation", producerRevision: REV, consumerRevision: REV }
    ],
    conflictConstraints: [{ id: "conflict-booking-admin", leftNodeId: "reservations", rightNodeId: "admin", reason: "Ambos tocan la proyecciÃ³n de estado de una reserva", risk: "high" }], legacyOrderingConstraints: [], createdAt: new Date(START).toISOString()
  };
  const contracts = [
    contract("booking-ui", nodes["booking-ui"].goal, ["apps/web/src/booking/**"], [], [], ["seam-availability"]),
    contract("confirmation", nodes.confirmation.goal, ["apps/web/src/confirmation/**"], ["artifact-reservation"], [], ["seam-reservation"]),
    contract("availability", nodes.availability.goal, ["packages/scheduling/src/availability/**"], [], [], ["seam-availability"]),
    contract("reservations", nodes.reservations.goal, ["packages/scheduling/src/reservations/**"], [], ["artifact-reservation"], ["seam-reservation"]),
    contract("notifications", nodes.notifications.goal, ["apps/worker/src/reminders/**"]),
    contract("admin", nodes.admin.goal, ["apps/web/src/admin/**"])
  ];
  const approval = { id: "decision-approve-plan", kind: "approve_plan", question: "Â¿Aprobamos este plan para construir AgendaFÃ¡cil?", options: [{ id: "approve", label: "Aprobar plan", description: "Comienza la ejecuciÃ³n con estos contratos." }, { id: "revise", label: "Pedir cambios", description: "Vuelve a planificar antes de escribir cÃ³digo." }], affectedNodeIds: ["root"], evidenceRefs: ["graph-appointment@1"], impact: "architecture" };
  const local = { id: "decision-reminder-channel", kind: "clarify_goal", question: "Â¿El recordatorio principal debe ser por email o por WhatsApp?", options: [{ id: "email", label: "Email", description: "Canal universal y sin proveedor adicional." }, { id: "whatsapp", label: "WhatsApp", description: "Mayor inmediatez, requiere integraciÃ³n externa." }], affectedNodeIds: ["notifications"], evidenceRefs: ["requirement:reminder-channel"], impact: "behavior" };
  const events: RunEvent[] = [];
  const push = (type: string, payload: Record<string, unknown>) => events.push(event(runId, events.length + 1, type, payload));
  push("run.created", { goal: "Crear AgendaFÃ¡cil, una aplicaciÃ³n para reservar turnos" });
  push("repository.inspected", { snapshotId: "snapshot-appointment", disposition: "complete", snapshot: { stack: "Next.js + TypeScript", tests: "Vitest + Playwright" } });
  push("planning.completed", { breakdownId: "breakdown-appointment", breakdown: { units: ["experience", "scheduling", "operations"] } });
  push("graph.compiled", { graphId: graph.graphId, revision: 1, graph, contracts, review: { outcome: "approved_for_human_review" }, trace: { source: "work-breakdown" } });
  push("graph.revision.proposed", { graphId: graph.graphId, revision: 1 });
  push("decision.raised", { decision: approval });
  push("decision.resolved", { decisionId: approval.id, optionId: "approve" });
  push("graph.revision.approved", { graphId: graph.graphId, revision: 1 });
  push("decision.raised", { decision: local });
  push("readiness.observed", { readyNodeIds: ["availability", "reservations", "admin"], pendingDecisionIds: [local.id] });
  push("wave.selected", { waveId: "wave-1", nodeIds: ["availability", "reservations", "admin"], maxParallel: 3 });
  for (const id of ["availability", "reservations", "admin"]) push("attempt.started", { attemptId: `attempt-${id}-1`, nodeId: id, inputFingerprint: `fingerprint-${id}-1`, executorProfile: { id: "codex-cli", revision: REV } });
  push("attempt.candidate_created", { attemptId: "attempt-availability-1", nodeId: "availability", candidateCommit: "commit-availability", outputDigest: "digest-availability", changedFiles: ["packages/scheduling/src/availability/index.ts"] });
  push("validation.completed", { attemptId: "attempt-availability-1", nodeId: "availability", matrix: matrix("matrix-availability", "commit-availability", "availability") });
  push("artifact.adopted", { artifact: { schemaVersion: 1, artifactId: "artifact-availability-result", runId, nodeId: "availability", digest: "digest-availability", producerAttemptId: "attempt-availability-1", contract: { id: "artifact-availability-result", revision: REV }, kind: "commit", location: "commit-availability", adoptedAt: new Date(START + 16 * 35_000).toISOString() } });
  push("attempt.failed", { attemptId: "attempt-admin-1", nodeId: "admin", reason: "La prueba detectÃ³ que dos estados usaban el mismo color." });
  push("failure.classified", { nodeId: "admin", failureClass: "code_test", observation: { source: "validation", code: "accessibility_contrast", exitCode: 1, message: "Contraste insuficiente" }, allowedActions: ["repair_code"], automaticRetryBudget: 1, discardCandidate: false });
  push("attempt.started", { attemptId: "attempt-admin-2", nodeId: "admin", inputFingerprint: "fingerprint-admin-1", retryOfAttemptId: "attempt-admin-1", executorProfile: { id: "codex-cli", revision: REV } });
  push("attempt.candidate_created", { attemptId: "attempt-admin-2", nodeId: "admin", candidateCommit: "commit-admin-fixed", outputDigest: "digest-admin", changedFiles: ["apps/web/src/admin/dashboard.tsx"] });
  push("validation.completed", { attemptId: "attempt-admin-2", nodeId: "admin", matrix: matrix("matrix-admin", "commit-admin-fixed", "admin") });
  push("artifact.adopted", { artifact: { schemaVersion: 1, artifactId: "artifact-admin-result", runId, nodeId: "admin", digest: "digest-admin", producerAttemptId: "attempt-admin-2", contract: { id: "artifact-admin-result", revision: REV }, kind: "commit", location: "commit-admin-fixed", adoptedAt: new Date(START + 22 * 35_000).toISOString() } });
  push("attempt.candidate_created", { attemptId: "attempt-reservations-1", nodeId: "reservations", candidateCommit: "commit-reservations", outputDigest: "digest-reservations", changedFiles: ["packages/scheduling/src/reservations/service.ts"] });
  push("validation.completed", { attemptId: "attempt-reservations-1", nodeId: "reservations", matrix: matrix("matrix-reservations", "commit-reservations", "reservations") });
  push("artifact.adopted", { artifact: { schemaVersion: 1, artifactId: "artifact-reservation", runId, nodeId: "reservations", digest: "digest-reservations", producerAttemptId: "attempt-reservations-1", contract: { id: "artifact-reservation", revision: REV }, kind: "commit", location: "commit-reservations", adoptedAt: new Date(START + 25 * 35_000).toISOString() } });
  push("decision.resolved", { decisionId: local.id, optionId: "email" });
  push("readiness.observed", { readyNodeIds: ["booking-ui", "confirmation", "notifications"], pendingDecisionIds: [] });
  push("wave.selected", { waveId: "wave-2", nodeIds: ["booking-ui", "confirmation", "notifications"], maxParallel: 3 });
  for (const id of ["booking-ui", "confirmation", "notifications"]) {
    push("attempt.started", { attemptId: `attempt-${id}-1`, nodeId: id, inputFingerprint: `fingerprint-${id}-1`, executorProfile: { id: "codex-cli", revision: REV } });
    push("attempt.candidate_created", { attemptId: `attempt-${id}-1`, nodeId: id, candidateCommit: `commit-${id}`, outputDigest: `digest-${id}`, changedFiles: [`src/${id}.ts`] });
    push("validation.completed", { attemptId: `attempt-${id}-1`, nodeId: id, matrix: matrix(`matrix-${id}`, `commit-${id}`, id) });
    push("artifact.adopted", { artifact: { schemaVersion: 1, artifactId: `artifact-${id}-result`, runId, nodeId: id, digest: `digest-${id}`, producerAttemptId: `attempt-${id}-1`, contract: { id: `artifact-${id}-result`, revision: REV }, kind: "commit", location: `commit-${id}`, adoptedAt: new Date(START + events.length * 35_000).toISOString() } });
  }
  push("evidence.matrix_recorded", { matrix: matrix("matrix-final", "commit-final", "run") });
  push("final_candidate.verified", { manifestId: "manifest-final", commit: "commit-final", evidenceMatrixId: "matrix-final", evidenceEligible: true, executionSucceeded: true, sourceTargetFingerprint: "target-fixture", targetBranch: "main", targetHead: "base-appointment" });
  return { seed: { id: runId, title: "AgendaFÃ¡cil: reservas de turnos", goal: "Crear una aplicaciÃ³n simple para reservar turnos", lifecycle: "planning", eventSequence: 0 }, events, intervalMs: 2_200 };
}

export const GOLDEN_FIXTURES = { "golden-appointment-booking": appointmentFixture() } satisfies Record<string, RunFixture>;
export type GoldenFixtureName = keyof typeof GOLDEN_FIXTURES;
export const GOLDEN_FIXTURE_NAMES = Object.keys(GOLDEN_FIXTURES) as GoldenFixtureName[];
export interface FixtureCatalogEntry { name: GoldenFixtureName; title: string; description: string; }
export const FIXTURE_CATALOG: readonly FixtureCatalogEntry[] = [{ name: "golden-appointment-booking", title: "AgendaFÃ¡cil: run completo V2", description: "Fixture estrella: grafo hÃ­brido, contratos, dependencia materializada, conflicto de alcance, decisiÃ³n local, fallo verificable, reparaciÃ³n y resultado final." }];
