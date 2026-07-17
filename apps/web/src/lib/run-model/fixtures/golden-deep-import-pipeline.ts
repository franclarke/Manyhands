/**
 * golden-deep-import-pipeline — the presentation fixture.
 *
 * A deliberately narrow B2B customer migration: 15 tasks across depths 0–8,
 * five explicit contracts, two human gates, a signature amendment, and
 * bottom-up integration back to the root.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-deep-import-pipeline";
const UPLOAD = "seam-upload-policy";
const PARSED = "seam-parsed-rows";
const VALIDATED = "seam-validated-record";
const NORMALIZED = "seam-normalized-batch";
const RECEIPT = "seam-import-receipt";

const assembled = fixture(RUN_ID, [
  ev("system", "run.created", { intent: "Migrar cuentas B2B desde CSV de forma segura, trazable e idempotente.", workspaceId: "ws-import-presentation", config: demoConfig }),
  ev("system", "run.context.resolved", { repo: "atlas-importer", baseCommit: "c7f4a21", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Migración de cuentas B2B", goal: "Entregar una migración CSV segura de punta a punta.", depth: 0 }),
  ev("system", "plan.node.status", { nodeId: "root", state: "generating", attempt: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-import", parentId: "root", role: "composite", title: "Preparar la migración", goal: "Alinear el ingreso de datos con el contrato de cuentas B2B.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-ingestion", parentId: "c-import", role: "composite", title: "Ingreso del lote", goal: "Aceptar un CSV de cliente y conservar su procedencia.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-upload", parentId: "c-ingestion", role: "leaf", title: "Resguardar la carga", goal: "Validar tamaño, codificación, tenant y procedencia del archivo.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "c-schema", parentId: "c-ingestion", role: "composite", title: "Interpretar el archivo", goal: "Convertir filas del proveedor en una representación diagnosticable.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-dialect", parentId: "c-schema", role: "leaf", title: "Leer encabezados reales", goal: "Detectar delimitador, encabezados y columnas originales para explicar errores.", depth: 4 }),
  ev("system", "plan.node.proposed", { nodeId: "c-validation", parentId: "c-schema", role: "composite", title: "Asegurar calidad de datos", goal: "Validar datos de cuentas antes de modificar el sistema destino.", depth: 4 }),
  ev("system", "plan.node.proposed", { nodeId: "n-schema-contract", parentId: "c-validation", role: "leaf", title: "Validar identidad de cuenta", goal: "Comprobar tipos, campos obligatorios y claves de negocio por fila.", depth: 5 }),
  ev("system", "plan.node.proposed", { nodeId: "c-normalization", parentId: "c-validation", role: "composite", title: "Preparar cambios canónicos", goal: "Transformar registros válidos al modelo estable de cuentas.", depth: 5 }),
  ev("system", "plan.node.proposed", { nodeId: "n-normalizer", parentId: "c-normalization", role: "leaf", title: "Normalizar datos de negocio", goal: "Normalizar fechas, moneda, país y referencias externas.", depth: 6 }),
  ev("system", "plan.node.proposed", { nodeId: "c-persistence", parentId: "c-normalization", role: "composite", title: "Aplicar la migración", goal: "Persistir el lote sin duplicar ni perder cuentas existentes.", depth: 6 }),
  ev("system", "plan.node.proposed", { nodeId: "n-idempotency", parentId: "c-persistence", role: "leaf", title: "Resolver duplicados", goal: "Aplicar upsert por clave externa y organización con auditoría.", depth: 7 }),
  ev("system", "decision.raised", { decisionId: "d-duplicates", kind: "clarify", blocking: true, context: { nodeIds: ["n-idempotency"], question: "¿Qué hacemos ante una clave externa ya importada?", options: ["Actualizar idempotentemente", "Rechazar toda la importación", "Crear un duplicado marcado"] } }),
  ev("human", "decision.resolved", { decisionId: "d-duplicates", choice: { answer: "Actualizar idempotentemente dentro de la misma organización y registrar el cambio." }, actor: "human" }),
  ev("system", "plan.node.proposed", { nodeId: "c-delivery", parentId: "c-persistence", role: "composite", title: "Cerrar el lote con evidencia", goal: "Publicar estado y trazabilidad para que Operaciones pueda actuar.", depth: 7 }),
  ev("system", "plan.node.proposed", { nodeId: "n-status-api", parentId: "c-delivery", role: "leaf", title: "Informar resultado al operador", goal: "Exponer progreso, errores accionables y resumen del lote.", depth: 8 }),
  ev("system", "plan.node.proposed", { nodeId: "n-observability", parentId: "c-delivery", role: "leaf", title: "Auditar cada aplicación", goal: "Emitir métricas y auditoría por lote para soporte y cumplimiento.", depth: 8 }),
  ev("system", "plan.node.status", { nodeId: "root", state: "generated", attempt: 1 }),
  ev("system", "plan.seam.proposed", { seamId: UPLOAD, name: "UploadPolicy", producerNodeId: "n-upload", consumerNodeIds: ["n-dialect"], draftSignature: "UploadPolicy { encoding:'utf8'; maxBytes:number; tenantId:string }" }),
  ev("system", "plan.seam.proposed", { seamId: PARSED, name: "ParsedRows", producerNodeId: "n-dialect", consumerNodeIds: ["n-schema-contract"], draftSignature: "ParsedRow { rowNumber:number; values:Record<string,string> }" }),
  ev("system", "plan.seam.proposed", { seamId: VALIDATED, name: "ValidatedRecord", producerNodeId: "n-schema-contract", consumerNodeIds: ["n-normalizer"], draftSignature: "ValidatedRecord { sourceRow:number; externalKey:string; payload:Record<string,unknown> }" }),
  ev("system", "plan.seam.proposed", { seamId: NORMALIZED, name: "NormalizedBatch", producerNodeId: "n-normalizer", consumerNodeIds: ["n-idempotency"], draftSignature: "NormalizedBatch { tenantId:string; records:ValidatedRecord[] }" }),
  ev("system", "plan.seam.proposed", { seamId: RECEIPT, name: "ImportReceipt", producerNodeId: "n-idempotency", consumerNodeIds: ["n-status-api", "n-observability"], draftSignature: "ImportReceipt { importId:string; inserted:number; updated:number; rejected:number }" }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 15, seamCount: 5, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve-plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-approve-plan", choice: { action: "approve" }, actor: "human" }),

  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "packages/imports/src/contracts.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", { seamId: UPLOAD, revision: 1, frozenSignature: "UploadPolicy { encoding:'utf8'; maxBytes:number; tenantId:string }", extractedFrom: "packages/imports/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: PARSED, revision: 1, frozenSignature: "ParsedRow { rowNumber:number; values:Record<string,string> }", extractedFrom: "packages/imports/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: VALIDATED, revision: 1, frozenSignature: "ValidatedRecord { sourceRow:number; externalKey:string; payload:Record<string,unknown> }", extractedFrom: "packages/imports/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: NORMALIZED, revision: 1, frozenSignature: "NormalizedBatch { tenantId:string; records:ValidatedRecord[] }", extractedFrom: "packages/imports/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: RECEIPT, revision: 1, frozenSignature: "ImportReceipt { importId:string; inserted:number; updated:number; rejected:number }", extractedFrom: "packages/imports/src/contracts.ts" }),
  ev("system", "scope.derived", { nodeId: "n-upload", paths: ["apps/web/src/app/api/imports/upload/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-dialect", paths: ["packages/imports/src/dialect.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-schema-contract", paths: ["packages/imports/src/schema.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-normalizer", paths: ["packages/imports/src/normalize.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-idempotency", paths: ["packages/imports/src/persist.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-status-api", paths: ["apps/web/src/app/api/imports/[id]/route.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-observability", paths: ["packages/telemetry/src/imports.ts"] }),
  ev("system", "wave.planned", { waves: [
    { waveId: "w-upload", index: 0, nodeIds: ["n-upload"], unlockedBySeams: [UPLOAD] },
    { waveId: "w-dialect", index: 1, nodeIds: ["n-dialect"], unlockedBySeams: [PARSED] },
    { waveId: "w-validate", index: 2, nodeIds: ["n-schema-contract"], unlockedBySeams: [VALIDATED] },
    { waveId: "w-normalize", index: 3, nodeIds: ["n-normalizer"], unlockedBySeams: [NORMALIZED] },
    { waveId: "w-persist", index: 4, nodeIds: ["n-idempotency"], unlockedBySeams: [RECEIPT] },
    { waveId: "w-deliver", index: 5, nodeIds: ["n-status-api", "n-observability"], unlockedBySeams: [RECEIPT] }
  ] }),
  ev("system", "grounding.completed", { skeletonCommit: "import-skeleton" }),

  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-upload", source: "execution-host", waveIndex: 0, waveOrdinal: 1, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-upload"], selectedTaskIds: ["n-upload"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-upload", nodeIds: ["n-upload"] }),
  ev("agent", "node.execution.started", { nodeId: "n-upload", agent: "claude-code-cli", model: "sonnet", waveId: "w-upload" }),
  ev("agent", "node.verify.passed", { nodeId: "n-upload", waveId: "w-upload", commit: "upload-1", changedFiles: ["apps/web/src/app/api/imports/upload/route.ts"], builtAgainst: [], produces: { seamId: UPLOAD, revision: 1 } }),
  ev("system", "wave.closed", { waveId: "w-upload" }),
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-dialect", source: "execution-host", waveIndex: 1, waveOrdinal: 2, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-dialect"], selectedTaskIds: ["n-dialect"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-dialect", nodeIds: ["n-dialect"] }),
  ev("agent", "node.execution.started", { nodeId: "n-dialect", agent: "claude-code-cli", model: "sonnet", waveId: "w-dialect" }),
  ev("agent", "node.verify.passed", { nodeId: "n-dialect", waveId: "w-dialect", commit: "dialect-1", changedFiles: ["packages/imports/src/dialect.ts"], builtAgainst: [{ seamId: UPLOAD, revision: 1 }], produces: { seamId: PARSED, revision: 1 } }),
  ev("system", "amendment.proposed", { amendmentId: "am-header-locations", nodeId: "n-dialect", kind: "seam", changeKind: "signature", detail: { seamId: PARSED, fromRevision: 1, toRevision: 2, newSignature: "ParsedRow { rowNumber:number; headerLocations:Record<string,number>; values:Record<string,string> }" }, affects: ["n-dialect", "n-schema-contract", "n-normalizer", "n-idempotency", "n-status-api", "n-observability", "c-validation", "c-normalization", "c-persistence", "c-delivery", "c-schema", "c-ingestion", "c-import", "root"], diagnosisRef: "blob://golden-deep-import-pipeline/amendments/header-locations" }),
  ev("system", "decision.raised", { decisionId: "d-header-locations", kind: "approve_amendment", blocking: true, context: { amendmentId: "am-header-locations", seamId: PARSED, nodeIds: ["n-dialect", "n-schema-contract"] } }),
  ev("human", "decision.resolved", { decisionId: "d-header-locations", choice: { action: "approve" }, actor: "human" }),
  ev("system", "seam.amended", { seamId: PARSED, revision: 2, changeKind: "signature", signature: "ParsedRow { rowNumber:number; headerLocations:Record<string,number>; values:Record<string,string> }" }),
  ev("system", "amendment.applied", { amendmentId: "am-header-locations" }),
  ev("agent", "node.execution.started", { nodeId: "n-dialect", agent: "claude-code-cli", model: "sonnet", reason: "amendment:header-locations" }),
  ev("agent", "node.verify.passed", { nodeId: "n-dialect", commit: "dialect-2", changedFiles: ["packages/imports/src/dialect.ts"], builtAgainst: [{ seamId: UPLOAD, revision: 1 }], produces: { seamId: PARSED, revision: 2 } }),

  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-validate", source: "execution-host", waveIndex: 2, waveOrdinal: 3, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-schema-contract"], selectedTaskIds: ["n-schema-contract"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("agent", "node.execution.started", { nodeId: "n-schema-contract", agent: "claude-code-cli", model: "sonnet", waveId: "w-validate" }),
  ev("agent", "node.verify.passed", { nodeId: "n-schema-contract", waveId: "w-validate", commit: "schema-1", changedFiles: ["packages/imports/src/schema.ts"], builtAgainst: [{ seamId: PARSED, revision: 2 }], produces: { seamId: VALIDATED, revision: 1 } }),
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-normalize", source: "execution-host", waveIndex: 3, waveOrdinal: 4, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-normalizer"], selectedTaskIds: ["n-normalizer"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("agent", "node.execution.started", { nodeId: "n-normalizer", agent: "claude-code-cli", model: "sonnet", waveId: "w-normalize" }),
  ev("agent", "node.verify.passed", { nodeId: "n-normalizer", waveId: "w-normalize", commit: "normalizer-1", changedFiles: ["packages/imports/src/normalize.ts"], builtAgainst: [{ seamId: VALIDATED, revision: 1 }], produces: { seamId: NORMALIZED, revision: 1 } }),
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-persist", source: "execution-host", waveIndex: 4, waveOrdinal: 5, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-idempotency"], selectedTaskIds: ["n-idempotency"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 1, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("agent", "node.execution.started", { nodeId: "n-idempotency", agent: "claude-code-cli", model: "sonnet", waveId: "w-persist" }),
  ev("agent", "node.verify.passed", { nodeId: "n-idempotency", waveId: "w-persist", commit: "persist-1", changedFiles: ["packages/imports/src/persist.ts"], builtAgainst: [{ seamId: NORMALIZED, revision: 1 }], produces: { seamId: RECEIPT, revision: 1 } }),
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-deliver", source: "execution-host", waveIndex: 5, waveOrdinal: 6, maxParallel: 2, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-status-api", "n-observability"], selectedTaskIds: ["n-status-api", "n-observability"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 0, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-deliver", nodeIds: ["n-status-api", "n-observability"] }),
  ev("agent", "node.execution.started", { nodeId: "n-status-api", agent: "claude-code-cli", model: "sonnet", waveId: "w-deliver" }),
  ev("agent", "node.execution.started", { nodeId: "n-observability", agent: "claude-code-cli", model: "sonnet", waveId: "w-deliver" }),
  ev("agent", "node.verify.passed", { nodeId: "n-status-api", waveId: "w-deliver", commit: "status-1", changedFiles: ["apps/web/src/app/api/imports/[id]/route.ts"], builtAgainst: [{ seamId: RECEIPT, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-observability", waveId: "w-deliver", commit: "telemetry-1", changedFiles: ["packages/telemetry/src/imports.ts"], builtAgainst: [{ seamId: RECEIPT, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-deliver" }),

  ev("system", "integration.started", { compositeNodeId: "c-delivery", childNodeIds: ["n-status-api", "n-observability"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-delivery", testsPass: 6, testsTotal: 6, passed: true, builtAgainst: [{ seamId: RECEIPT, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-delivery", commit: "delivery-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-persistence", childNodeIds: ["n-idempotency", "c-delivery"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-persistence", testsPass: 11, testsTotal: 11, passed: true, builtAgainst: [{ seamId: NORMALIZED, revision: 1 }, { seamId: RECEIPT, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-persistence", commit: "persistence-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-normalization", childNodeIds: ["n-normalizer", "c-persistence"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-normalization", testsPass: 16, testsTotal: 16, passed: true, builtAgainst: [{ seamId: VALIDATED, revision: 1 }, { seamId: NORMALIZED, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-normalization", commit: "normalization-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-validation", childNodeIds: ["n-schema-contract", "c-normalization"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-validation", testsPass: 21, testsTotal: 21, passed: true, builtAgainst: [{ seamId: PARSED, revision: 2 }, { seamId: VALIDATED, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-validation", commit: "validation-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-schema", childNodeIds: ["n-dialect", "c-validation"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-schema", testsPass: 25, testsTotal: 25, passed: true, builtAgainst: [{ seamId: UPLOAD, revision: 1 }, { seamId: PARSED, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-schema", commit: "schema-tree-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-ingestion", childNodeIds: ["n-upload", "c-schema"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-ingestion", testsPass: 28, testsTotal: 28, passed: true, builtAgainst: [{ seamId: UPLOAD, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-ingestion", commit: "ingestion-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-import", childNodeIds: ["c-ingestion"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-import", testsPass: 30, testsTotal: 30, passed: true, builtAgainst: [{ seamId: PARSED, revision: 2 }, { seamId: RECEIPT, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-import", commit: "import-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-import"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 31, testsTotal: 31, passed: true, builtAgainst: [{ seamId: UPLOAD, revision: 1 }, { seamId: PARSED, revision: 2 }, { seamId: VALIDATED, revision: 1 }, { seamId: NORMALIZED, revision: 1 }, { seamId: RECEIPT, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "import-pipeline-1", status: "success" }),
  ev("system", "run.evidence.ready", { aggregateDiffRef: "blob://golden-deep-import-pipeline/diff", tests: { pass: 31, total: 31 }, narrativeRef: "blob://golden-deep-import-pipeline/narrative", integrationCommit: "import-pipeline-1", invalidationTrace: [{ seamId: PARSED, from: 1, to: 2, cause: "Header provenance required for duplicate-column diagnostics", reExecuted: ["n-dialect"], reIntegrated: ["c-schema", "c-ingestion", "c-import", "root"], preserved: ["n-upload"] }] }),
  ev("system", "decision.raised", { decisionId: "d-merge", kind: "approve_merge", blocking: true, context: { diffRef: "blob://golden-deep-import-pipeline/diff", nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-merge", choice: { action: "accept" }, actor: "human" }),
  ev("system", "run.completed", { status: "success" }),
  ev("system", "run.metrics.ready", { metrics: { depth: 8, leafCount: 7, compositeCount: 8, avgLeafDepth: 5.86, maxLeafDepth: 8, dependencyCount: 7, avgAcceptanceCriteriaPerLeaf: 4, estimatedTokensPerLeaf: 3200, integrationSuccessRate: 1, leafSuccessRate: 1, conflictRate: 0, totalDurationMs: 294000, linesChanged: 1180, unexpectedCommitCount: 0, scopeViolationCount: 0, totalCostUsd: 2.94, testsPassedRate: 1 } })
]);

export const goldenDeepImportPipeline = {
  ...assembled,
  playback: {
    delaysMs: assembled.events.map((event) => {
      if (event.type === "decision.raised") return 3200;
      if (event.type === "plan.node.proposed") return 1150;
      if (event.type.startsWith("integration.")) return 1350;
      if (event.type === "seam.amended" || event.type === "amendment.proposed") return 1800;
      return 850;
    })
  }
};
