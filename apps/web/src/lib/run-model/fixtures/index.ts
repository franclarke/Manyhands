import type { FixtureMilestone, RunEvent, RunFixture } from "../types";

const START = Date.parse("2026-07-18T14:00:00.000Z");
const REV = "fixture-password-recovery-r1";

const ARTIFACTS = {
  "artifact-token-service": {
    producerNodeId: "token",
    consumerNodeIds: ["reset-api"],
    expectedPaths: ["packages/auth/src/password-reset/**"]
  },
  "artifact-session-policy": {
    producerNodeId: "session-policy",
    consumerNodeIds: ["reset-api"],
    expectedPaths: ["packages/auth/src/sessions/**"]
  }
} as const;

const SEAMS = {
  "seam-request-recovery": {
    producerNodeId: "request-api",
    consumerNodeIds: ["request-ui"],
    specification: "POST /api/auth/password-recovery acepta email y siempre responde 202"
  },
  "seam-confirm-recovery": {
    producerNodeId: "reset-api",
    consumerNodeIds: ["reset-ui"],
    specification: "POST /api/auth/password-recovery/confirm acepta token y nueva contraseña"
  }
} as const;

function event(
  runId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  actor: RunEvent["actor"] = "system"
): RunEvent {
  return {
    eventId: `${runId}:${sequence}`,
    runId,
    seq: sequence,
    at: new Date(START + sequence * 30_000).toISOString(),
    actor,
    type,
    payload
  };
}

function node(
  id: string,
  parentId: string | null,
  kind: "root" | "composite" | "leaf",
  title: string,
  goal: string
) {
  return { id, parentId, kind, title, goal };
}

function contract(
  nodeId: string,
  goal: string,
  paths: string[],
  consumes: Array<keyof typeof ARTIFACTS> = [],
  produces: Array<keyof typeof ARTIFACTS> = [],
  seamIds: Array<keyof typeof SEAMS> = []
) {
  const ref = (id: string) => ({ id, revision: REV });
  const criterionId = `criterion-${nodeId}`;
  const artifactIds = [...new Set([...consumes, ...produces])];
  return {
    schemaVersion: 2,
    task: {
      schemaVersion: 2,
      id: `task-${nodeId}`,
      revision: REV,
      provenance: "compiled",
      nodeId,
      goal,
      acceptanceCriteria: [{
        id: criterionId,
        kind: "integration",
        description: `${goal} y queda demostrado con pruebas observables.`,
        required: true
      }],
      scope: ref(`scope-${nodeId}`),
      consumes: consumes.map(ref),
      produces: produces.map(ref),
      seams: seamIds.map(ref),
      validation: ref(`validation-${nodeId}`),
      constraints: ["No modificar trabajo fuera del alcance declarado"]
    },
    scope: {
      schemaVersion: 2,
      id: `scope-${nodeId}`,
      revision: REV,
      provenance: "compiled",
      nodeId,
      allowedPaths: paths,
      forbiddenPaths: [".env", "**/production-secrets/**"],
      coordinationPaths: []
    },
    seams: seamIds.map((id) => ({
      schemaVersion: 2,
      id,
      revision: REV,
      provenance: "compiled",
      kind: "api",
      specification: SEAMS[id].specification,
      producerNodeId: SEAMS[id].producerNodeId,
      consumerNodeIds: [...SEAMS[id].consumerNodeIds],
      semanticFacts: { version: "v1", enumerationSafe: true },
      compatibility: {
        mode: "exact",
        rules: ["No revelar si el email pertenece a una cuenta", "Errores usan códigos estables"]
      }
    })),
    artifacts: artifactIds.map((id) => ({
      schemaVersion: 2,
      id,
      revision: REV,
      provenance: "compiled",
      producerNodeId: ARTIFACTS[id].producerNodeId,
      consumerNodeIds: [...ARTIFACTS[id].consumerNodeIds],
      artifactType: "git-commit",
      materialization: "commit",
      expectedPaths: [...ARTIFACTS[id].expectedPaths]
    })),
    validation: {
      schemaVersion: 2,
      id: `validation-${nodeId}`,
      revision: REV,
      provenance: "compiled",
      nodeId,
      obligations: [{
        id: `obligation-${nodeId}`,
        criterionId,
        layer: "integration",
        severity: "required",
        acceptableEvidence: ["test_result", "security_review"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid"
      }]
    }
  };
}

function matrix(id: string, commit: string, nodeId = "run", justification?: string) {
  return {
    matrixId: id,
    candidateCommit: commit,
    validationContract: { id: `validation-${nodeId}`, revision: REV },
    criteria: [{
      criterionId: `criterion-${nodeId}`,
      obligationId: `obligation-${nodeId}`,
      status: "satisfied",
      justification: justification ?? "Pruebas de integración y seguridad completadas sobre el commit exacto.",
      evidenceRefs: [`test:${commit}`]
    }],
    outcome: "verified"
  };
}

function passwordRecoveryFixture(): RunFixture {
  const runId = "fixture-password-recovery-v2";
  const nodes = {
    root: node("root", null, "root", "Recuperación de contraseña", "Entregar un flujo seguro y completo de recuperación de contraseña"),
    security: node("security", "root", "composite", "Seguridad de la cuenta", "Proteger tokens y sesiones durante la recuperación"),
    token: node("token", "security", "leaf", "Token de un solo uso", "Emitir tokens opacos, con expiración y consumo único"),
    "session-policy": node("session-policy", "security", "leaf", "Política de sesiones", "Aplicar la decisión de seguridad sobre sesiones activas"),
    server: node("server", "root", "composite", "Flujo del servidor", "Exponer el proceso sin filtrar información de cuentas"),
    "request-api": node("request-api", "server", "leaf", "Solicitud de recuperación", "Aceptar el email y enviar un enlace sin permitir enumeración de usuarios"),
    "reset-api": node("reset-api", "server", "leaf", "Confirmación de contraseña", "Validar el token y actualizar la contraseña de forma atómica"),
    experience: node("experience", "root", "composite", "Experiencia del usuario", "Guiar la solicitud y el cambio con mensajes claros y accesibles"),
    "request-ui": node("request-ui", "experience", "leaf", "Formulario de solicitud", "Solicitar el email y confirmar el envío sin revelar cuentas"),
    "reset-ui": node("reset-ui", "experience", "leaf", "Nueva contraseña", "Validar y confirmar una contraseña nueva desde el enlace recibido")
  };

  const graph = {
    schemaVersion: 2,
    graphId: "graph-password-recovery",
    revision: 1,
    rootId: "root",
    baseCommit: "base-auth-portal",
    repositorySnapshotId: "snapshot-auth-portal",
    nodes,
    artifactRequirements: [
      {
        id: "require-token-service",
        artifactContract: { id: "artifact-token-service", revision: REV },
        producerNodeId: "token",
        consumerNodeId: "reset-api",
        requiredFor: "execution"
      },
      {
        id: "require-session-policy",
        artifactContract: { id: "artifact-session-policy", revision: REV },
        producerNodeId: "session-policy",
        consumerNodeId: "reset-api",
        requiredFor: "execution"
      }
    ],
    seamBindings: [
      {
        id: "binding-request-recovery",
        seamContract: { id: "seam-request-recovery", revision: REV },
        producerNodeId: "request-api",
        consumerNodeId: "request-ui",
        producerRevision: REV,
        consumerRevision: REV
      },
      {
        id: "binding-confirm-recovery",
        seamContract: { id: "seam-confirm-recovery", revision: REV },
        producerNodeId: "reset-api",
        consumerNodeId: "reset-ui",
        producerRevision: REV,
        consumerRevision: REV
      }
    ],
    conflictConstraints: [{
      id: "conflict-auth-routes",
      leftNodeId: "request-api",
      rightNodeId: "reset-api",
      reason: "Ambos modifican el router público de autenticación",
      risk: "high"
    }],
    legacyOrderingConstraints: [],
    createdAt: new Date(START).toISOString()
  };

  const contracts = [
    contract("token", nodes.token.goal, ["packages/auth/src/password-reset/**"], [], ["artifact-token-service"]),
    contract("session-policy", nodes["session-policy"].goal, ["packages/auth/src/sessions/**"], [], ["artifact-session-policy"]),
    contract("request-api", nodes["request-api"].goal, ["apps/api/src/routes/password-recovery.ts", "apps/api/tests/password-recovery.request.test.ts"], [], [], ["seam-request-recovery"]),
    contract("reset-api", nodes["reset-api"].goal, ["apps/api/src/routes/password-recovery-confirm.ts", "apps/api/tests/password-recovery.confirm.test.ts"], ["artifact-token-service", "artifact-session-policy"], [], ["seam-confirm-recovery"]),
    contract("request-ui", nodes["request-ui"].goal, ["apps/web/src/app/forgot-password/**"], [], [], ["seam-request-recovery"]),
    contract("reset-ui", nodes["reset-ui"].goal, ["apps/web/src/app/reset-password/**"], [], [], ["seam-confirm-recovery"])
  ];

  const approvePlan = {
    id: "decision-approve-password-plan",
    kind: "approve_plan",
    question: "¿Aprobamos este plan para implementar la recuperación de contraseña?",
    options: [
      { id: "approve", label: "Aprobar plan", description: "Comienza la ejecución con estos contratos y alcances." },
      { id: "revise", label: "Pedir cambios", description: "Vuelve a planificación antes de modificar código." }
    ],
    affectedNodeIds: ["root"],
    evidenceRefs: ["graph-password-recovery@1"],
    impact: "architecture"
  };
  const sessionDecision = {
    id: "decision-active-sessions",
    kind: "clarify_goal",
    question: "¿El cambio de contraseña debe cerrar las sesiones activas de la cuenta?",
    options: [
      { id: "revoke-all", label: "Cerrar todas", description: "Prioriza seguridad ante una posible cuenta comprometida." },
      { id: "keep-current", label: "Conservar la actual", description: "Reduce fricción, pero mantiene una sesión ya emitida." }
    ],
    affectedNodeIds: ["session-policy", "reset-api"],
    evidenceRefs: ["security-review:session-revocation"],
    impact: "behavior"
  };

  const events: RunEvent[] = [];
  const milestones: FixtureMilestone[] = [];
  const push = (type: string, payload: Record<string, unknown>, actor: RunEvent["actor"] = "system") => {
    events.push(event(runId, events.length + 1, type, payload, actor));
  };
  const mark = (id: string, title: string, description: string) => {
    milestones.push({ id, title, description, eventIndex: events.length });
  };
  const startAttempt = (nodeId: string, attempt = 1, retryOfAttemptId?: string) => {
    push("attempt.started", {
      attemptId: `attempt-${nodeId}-${attempt}`,
      nodeId,
      inputFingerprint: `fingerprint-${nodeId}-r1`,
      ...(retryOfAttemptId === undefined ? {} : { retryOfAttemptId }),
      executorProfile: { id: "codex-cli", revision: REV }
    });
  };
  const adopt = (nodeId: string, attempt = 1, artifactId = `artifact-${nodeId}-result`) => {
    const attemptId = `attempt-${nodeId}-${attempt}`;
    const commit = `commit-${nodeId}${attempt === 1 ? "" : `-repair-${attempt}`}`;
    push("attempt.candidate_created", {
      attemptId,
      nodeId,
      candidateCommit: commit,
      outputDigest: `digest-${nodeId}-${attempt}`,
      changedFiles: [`src/${nodeId}.ts`]
    });
    push("validation.completed", { attemptId, nodeId, matrix: matrix(`matrix-${nodeId}`, commit, nodeId) });
    push("artifact.adopted", {
      artifact: {
        schemaVersion: 1,
        artifactId,
        runId,
        nodeId,
        digest: `digest-${nodeId}-${attempt}`,
        producerAttemptId: attemptId,
        contract: { id: artifactId, revision: REV },
        kind: "commit",
        location: commit,
        adoptedAt: new Date(START + (events.length + 1) * 30_000).toISOString()
      }
    });
  };
  const integrate = (nodeId: string, requiredArtifactIds: string[], justification: string) => {
    const attemptId = `integration-${nodeId}-1`;
    const commit = `commit-${nodeId}-integrated`;
    const artifactId = `artifact-${nodeId}-integrated`;
    push("integration.started", {
      attemptId,
      nodeId,
      inputFingerprint: `fingerprint-${nodeId}-integration-r1`,
      executorProfile: { id: "codex-cli", revision: REV },
      requiredArtifactIds
    });
    push("integration.completed", {
      attemptId,
      nodeId,
      manifestId: `manifest-${nodeId}`,
      candidateCommit: commit,
      matrix: matrix(`matrix-integration-${nodeId}`, commit, nodeId, justification)
    });
    push("artifact.adopted", {
      artifact: {
        schemaVersion: 1,
        artifactId,
        runId,
        nodeId,
        digest: `digest-${nodeId}-integrated`,
        producerAttemptId: attemptId,
        contract: { id: artifactId, revision: REV },
        kind: "commit",
        location: commit,
        adoptedAt: new Date(START + (events.length + 1) * 30_000).toISOString()
      }
    });
  };

  push("run.created", { goal: "Agregar recuperación segura de contraseña al portal existente" });
  mark("goal", "1. Objetivo", "El run fija el cambio solicitado y comienza en planning.");

  push("repository.inspected", {
    snapshotId: "snapshot-auth-portal",
    disposition: "complete",
    snapshot: {
      repository: "customer-portal",
      stack: "Next.js, Node.js, PostgreSQL y TypeScript",
      auth: "sesiones persistidas y email transaccional existentes",
      tests: "Vitest y Playwright"
    }
  });
  mark("repository", "2. Repositorio", "ManyHands descubre las fronteras reales antes de dividir el trabajo.");

  push("planning.attempt_started", { attempt: 1 });
  for (const item of Object.values(nodes)) {
    const siblings = Object.values(nodes).filter((candidate) => candidate.parentId === item.parentId);
    push("planning.node_discovered", {
      attempt: 1,
      node: {
        nodeId: item.id,
        parentNodeId: item.parentId,
        key: item.id,
        parentKey: item.parentId,
        kind: item.kind === "leaf" ? "leaf" : "composite",
        title: item.title,
        objective: item.goal,
        siblingIndex: siblings.findIndex((candidate) => candidate.id === item.id),
        siblingCount: siblings.length
      }
    });
  }
  push("planning.completed", {
    breakdownId: "breakdown-password-recovery",
    breakdown: { units: ["security", "server", "experience"], rationale: "Límites existentes del repositorio" }
  });
  push("graph.compiled", {
    graphId: graph.graphId,
    revision: 1,
    graph,
    contracts,
    review: { outcome: "approved_for_human_review", critics: ["scope", "security", "validation"] },
    trace: { source: "repository-grounded-work-breakdown" }
  });
  push("graph.revision.proposed", { graphId: graph.graphId, revision: 1 });
  push("decision.raised", { decision: approvePlan });
  push("decision.resolved", { decisionId: approvePlan.id, optionId: "approve" }, "operator");
  push("graph.revision.approved", { graphId: graph.graphId, revision: 1 });
  mark("plan", "3. Plan aprobado", "El Graph Compiler congela scopes, seams, artefactos y obligaciones de validación.");

  push("decision.raised", { decision: sessionDecision });
  push("readiness.observed", {
    readyNodeIds: ["token", "request-api", "request-ui"],
    pendingDecisionIds: [sessionDecision.id]
  });
  push("wave.selected", {
    waveId: "wave-independent-work",
    nodeIds: ["token", "request-api", "request-ui"],
    maxParallel: 3
  });
  for (const nodeId of ["token", "request-api", "request-ui"]) startAttempt(nodeId);
  mark("execution", "4. Trabajo paralelo", "La decisión pendiente bloquea solo dos nodos; tres tareas independientes comienzan juntas.");

  adopt("request-api");
  adopt("request-ui");
  push("attempt.failed", {
    attemptId: "attempt-token-1",
    nodeId: "token",
    reason: "La prueba de seguridad demuestra que un token consumido todavía podía reutilizarse."
  });
  push("failure.classified", {
    nodeId: "token",
    failureClass: "code_test",
    observation: {
      source: "validation",
      code: "password_reset_token_reuse",
      exitCode: 1,
      message: "El segundo consumo del mismo token devolvió 200 en lugar de 401"
    },
    allowedActions: ["repair_code"],
    automaticRetryBudget: 1,
    discardCandidate: false
  });
  startAttempt("token", 2, "attempt-token-1");
  mark("repair", "5. Reparación automática", "El fallo es local y reproducible; se crea un nuevo intento sin pedir intervención humana.");

  adopt("token", 2, "artifact-token-service");
  mark("decision", "6. Decisión humana", "El trabajo independiente se conserva mientras el operador decide qué hacer con las sesiones activas.");
  push("decision.resolved", { decisionId: sessionDecision.id, optionId: "revoke-all" }, "operator");

  push("readiness.observed", { readyNodeIds: ["session-policy", "reset-ui"], pendingDecisionIds: [] });
  push("wave.selected", { waveId: "wave-after-decision", nodeIds: ["session-policy", "reset-ui"], maxParallel: 2 });
  startAttempt("session-policy");
  startAttempt("reset-ui");
  adopt("session-policy", 1, "artifact-session-policy");
  adopt("reset-ui");

  push("readiness.observed", { readyNodeIds: ["reset-api"], pendingDecisionIds: [] });
  push("wave.selected", { waveId: "wave-materialized-inputs", nodeIds: ["reset-api"], maxParallel: 2 });
  startAttempt("reset-api");
  adopt("reset-api");

  integrate(
    "security",
    ["artifact-token-service", "artifact-session-policy"],
    "Tokens de un solo uso y revocación de sesiones cumplen juntos el límite de seguridad."
  );
  integrate(
    "server",
    ["artifact-request-api-result", "artifact-reset-api-result"],
    "Los endpoints públicos conservan contratos compatibles y no permiten enumerar cuentas."
  );
  integrate(
    "experience",
    ["artifact-request-ui-result", "artifact-reset-ui-result"],
    "Los dos formularios componen un recorrido accesible y consistente."
  );

  push("integration.started", {
    attemptId: "integration-root-1",
    nodeId: "root",
    inputFingerprint: "fingerprint-root-integration-r1",
    executorProfile: { id: "codex-cli", revision: REV },
    requiredArtifactIds: ["artifact-security-integrated", "artifact-server-integrated", "artifact-experience-integrated"]
  });
  push("integration.completed", {
    attemptId: "integration-root-1",
    nodeId: "root",
    manifestId: "manifest-password-recovery",
    candidateCommit: "commit-password-recovery-integrated",
    matrix: matrix(
      "matrix-integration-root",
      "commit-password-recovery-integrated",
      "root",
      "API, UI, token de un solo uso y revocación de sesiones funcionan juntos."
    )
  });
  mark("integration", "7. Integración", "El árbol se integra de abajo hacia arriba usando únicamente artefactos adoptados.");

  push("evidence.matrix_recorded", {
    matrix: matrix(
      "matrix-final",
      "commit-password-recovery-final",
      "run",
      "Expiración, consumo único, no enumeración, revocación y recorrido end-to-end están satisfechos."
    )
  });
  push("final_candidate.verified", {
    manifestId: "manifest-password-recovery",
    commit: "commit-password-recovery-final",
    evidenceMatrixId: "matrix-final",
    evidenceEligible: true,
    executionSucceeded: true,
    sourceTargetFingerprint: "customer-portal@base-auth-portal",
    targetBranch: "main",
    targetHead: "base-auth-portal"
  });
  mark("evidence", "8. Resultado verificado", "La Evidence Matrix conecta cada criterio con evidencia observada sobre el commit exacto.");

  const approval = {
    manifestId: "manifest-password-recovery",
    finalSha: "commit-password-recovery-final",
    targetBranch: "main",
    targetHead: "base-auth-portal",
    targetFingerprint: "customer-portal@base-auth-portal",
    actor: "operator-demo",
    idempotencyKey: "fixture-password-recovery-delivery"
  };
  push("delivery.started", { approval }, "operator");
  push("delivery.published", {
    receipt: {
      receiptId: "delivery-password-recovery",
      manifestId: approval.manifestId,
      finalSha: approval.finalSha,
      targetBranch: approval.targetBranch,
      targetHeadBefore: approval.targetHead,
      targetHeadAfter: approval.finalSha,
      disposition: "delivered",
      destination: "main",
      confirmed: true
    }
  });
  mark("delivery", "9. Entrega", "El mismo candidato verificado se publica y el run termina en completed.");

  return {
    seed: {
      id: runId,
      title: "Recuperación segura de contraseña",
      goal: "Agregar recuperación segura de contraseña al portal existente",
      lifecycle: "planning",
      eventSequence: 0
    },
    events,
    milestones,
    intervalMs: 2_400
  };
}

export const GOLDEN_FIXTURES = {
  "golden-password-recovery": passwordRecoveryFixture()
} satisfies Record<string, RunFixture>;

export type GoldenFixtureName = keyof typeof GOLDEN_FIXTURES;
export const GOLDEN_FIXTURE_NAMES = Object.keys(GOLDEN_FIXTURES) as GoldenFixtureName[];

export interface FixtureCatalogEntry {
  name: GoldenFixtureName;
  title: string;
  description: string;
}

export const FIXTURE_CATALOG: readonly FixtureCatalogEntry[] = [{
  name: "golden-password-recovery",
  title: "Recuperación de contraseña",
  description: "Run completo para entrevistas: planificación, paralelismo, decisión local, reparación, integración, evidencia y entrega."
}];
