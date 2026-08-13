import type { PlanningFinding, SemanticPlan } from "@manyhands/contracts";
import type { GraphRevision } from "@manyhands/task-graph";
import type { CompiledPlanContracts } from "../compiler/direct-plan-compiler.js";
import { flattenSemanticWorkUnits, type SemanticPlan as CurrentSemanticPlan } from "../planner/semantic-plan.js";

export interface ResponsibilityOracle {
  id: string;
  terms: string[];
}

export interface SeamOracle {
  id: string;
  producerTerms: string[];
  consumerTerms: string[];
  semanticTerms: string[];
}

export interface OwnershipOracle {
  id: string;
  path: string;
  ownerTerms: string[];
}

export interface PlanningTopologyOracle {
  id: string;
  repositoryId: string;
  goalDigest: string;
  repositoryViewDigest: string;
  requiredResponsibilities: ResponsibilityOracle[];
  forbiddenResponsibilities: ResponsibilityOracle[];
  requiredSeams: SeamOracle[];
  requiredOwnership: OwnershipOracle[];
  requiredCriterionIds: string[];
  acceptableAlternatives: string[];
}

export interface PlanningCandidate {
  label: "stage5" | "current";
  plan?: SemanticPlan;
  graph?: GraphRevision;
  contracts?: CompiledPlanContracts;
  observedTopology?: ObservedPlanningTopology;
  unavailableReason?: string;
}

export interface ObservedPlanningTopology {
  responsibilities: Array<{ id: string; text: string }>;
  seams: Array<{ producerText: string; consumerTexts: string[]; semantics: string }>;
  ownership: Array<{ ownerText: string; paths: string[] }>;
  criterionIds: string[];
}

export function observeCurrentPlannerTopology(
  plan: CurrentSemanticPlan,
  canonicalCriterionIds?: readonly string[]
): ObservedPlanningTopology {
  const units = flattenSemanticWorkUnits(plan.root);
  const byId = new Map(units.map((unit) => [unit.key, unit]));
  return {
    responsibilities: units.map((unit) => ({ id: unit.key, text: `${unit.title} ${unit.objective} ${unit.concerns.join(" ")}` })),
    seams: plan.seams.map((seam) => ({
      producerText: unitText(byId.get(seam.producerUnitKey)),
      consumerTexts: seam.consumerUnitKeys.map((id) => unitText(byId.get(id))),
      semantics: `${seam.purpose} ${seam.interface.promise} ${seam.interface.compatibility}`
    })),
    ownership: units.map((unit) => ({ ownerText: unitText(unit), paths: [...new Set([...(unit.writePaths ?? []), ...(unit.plannedPaths ?? [])])].sort() })),
    criterionIds: [...new Set(canonicalCriterionIds ?? plan.criteria.map(({ id }) => id))].sort()
  };
}

export interface TopologyEvaluation {
  candidate: PlanningCandidate["label"];
  passed: boolean;
  issues: Array<{ code: string; oracleId?: string; message: string }>;
  observations: {
    nodes: number;
    leaves: number;
    seams: number;
    resourceClaims: number;
  };
}

export interface DifferentialEvaluation {
  oracleId: string;
  candidates: TopologyEvaluation[];
}

export function evaluatePlanningCandidates(input: {
  oracle: PlanningTopologyOracle;
  candidates: readonly PlanningCandidate[];
}): DifferentialEvaluation {
  return {
    oracleId: input.oracle.id,
    candidates: input.candidates.map((candidate) => evaluateCandidate(candidate, input.oracle))
  };
}

function evaluateCandidate(candidate: PlanningCandidate, oracle: PlanningTopologyOracle): TopologyEvaluation {
  const issues: TopologyEvaluation["issues"] = [];
  const plan = candidate.plan;
  const graph = candidate.graph;
  const contracts = candidate.contracts;
  if (candidate.observedTopology !== undefined) {
    return evaluateObserved(candidate.label, candidate.observedTopology, oracle);
  }
  if (plan === undefined || graph === undefined || contracts === undefined) {
    issues.push({ code: "candidate_unavailable", message: candidate.unavailableReason ?? "Candidate has no compileable graph." });
    return evaluation(candidate.label, issues, graph);
  }
  if (plan.goalContract.digest !== oracle.goalDigest) {
    issues.push({ code: "goal_mismatch", message: "Candidate uses a different GoalContract." });
  }
  if (plan.repositoryView.digest !== oracle.repositoryViewDigest) {
    issues.push({ code: "view_mismatch", message: "Candidate uses a different RepositoryView." });
  }
  for (const responsibility of oracle.requiredResponsibilities) {
    if (!Object.values(graph.nodes).some((node) => matches(nodeText(node), responsibility.terms))) {
      issues.push({
        code: "missing_responsibility",
        oracleId: responsibility.id,
        message: `No unit expresses responsibility ${responsibility.id}.`
      });
    }
  }
  for (const responsibility of oracle.forbiddenResponsibilities) {
    if (Object.values(graph.nodes).some((node) => matches(nodeText(node), responsibility.terms))) {
      issues.push({
        code: "forbidden_responsibility",
        oracleId: responsibility.id,
        message: `A unit expresses forbidden responsibility ${responsibility.id}.`
      });
    }
  }
  for (const seamOracle of oracle.requiredSeams) {
    const matched = Object.values(contracts.seams).some((seam) => {
      const producer = graph.nodes[seam.producerNodeId];
      const consumers = seam.consumerNodeIds.map((id) => graph.nodes[id]).filter((node) => node !== undefined);
      const semantics = `${seam.specification} ${Object.values(seam.semanticFacts).join(" ")} ${seam.compatibility.rules.join(" ")}`;
      return producer !== undefined && matches(nodeText(producer), seamOracle.producerTerms)
        && consumers.some((consumer) => matches(nodeText(consumer), seamOracle.consumerTerms))
        && matches(semantics, seamOracle.semanticTerms);
    });
    if (!matched) {
      issues.push({ code: "missing_seam", oracleId: seamOracle.id, message: `No seam satisfies ${seamOracle.id}.` });
    }
  }
  for (const ownership of oracle.requiredOwnership) {
    const writerIds = new Set(graph.resourceClaims.filter(({ access }) => access === "modify").map(({ nodeId }) => nodeId));
    const owners = Object.entries(contracts.taskBundles).filter(([unitId, bundle]) =>
      writerIds.has(unitId) && bundle.scope.allowedPaths.some((path) => path === ownership.path || path.startsWith(`${ownership.path}/`))
    );
    if (owners.length !== 1 || !matches(nodeText(graph.nodes[owners[0]![0]]!), ownership.ownerTerms)) {
      issues.push({
        code: "ownership_mismatch",
        oracleId: ownership.id,
        message: `Expected one matching owner for ${ownership.path}; observed ${owners.length}.`
      });
    }
  }
  const coveredCriteria = new Set(Object.entries(contracts.taskBundles).flatMap(([unitId, { validation }]) => {
    const unit = plan.units[unitId];
    return unit === undefined
      ? []
      : validation.obligations.map(({ criterionId }) => rootCriterionFor(plan, unit.id, criterionId));
  }));
  for (const criterionId of oracle.requiredCriterionIds) {
    if (!coveredCriteria.has(criterionId)) {
      issues.push({ code: "missing_proof_criterion", oracleId: criterionId, message: `Criterion ${criterionId} is not represented.` });
    }
  }
  return evaluation(candidate.label, issues, graph);
}

function evaluateObserved(label: PlanningCandidate["label"], observed: ObservedPlanningTopology, oracle: PlanningTopologyOracle): TopologyEvaluation {
  const issues: TopologyEvaluation["issues"] = [];
  for (const responsibility of oracle.requiredResponsibilities) {
    if (!observed.responsibilities.some(({ text }) => matches(text, responsibility.terms))) {
      issues.push({ code: "missing_responsibility", oracleId: responsibility.id, message: `No unit expresses responsibility ${responsibility.id}.` });
    }
  }
  for (const responsibility of oracle.forbiddenResponsibilities) {
    if (observed.responsibilities.some(({ text }) => matches(text, responsibility.terms))) {
      issues.push({ code: "forbidden_responsibility", oracleId: responsibility.id, message: `A unit expresses forbidden responsibility ${responsibility.id}.` });
    }
  }
  for (const seam of oracle.requiredSeams) {
    if (!observed.seams.some((candidate) => matches(candidate.producerText, seam.producerTerms)
      && candidate.consumerTexts.some((text) => matches(text, seam.consumerTerms))
      && matches(candidate.semantics, seam.semanticTerms))) {
      issues.push({ code: "missing_seam", oracleId: seam.id, message: `No seam satisfies ${seam.id}.` });
    }
  }
  for (const ownership of oracle.requiredOwnership) {
    const owners = observed.ownership.filter(({ paths }) => paths.includes(ownership.path));
    if (owners.length !== 1 || !matches(owners[0]!.ownerText, ownership.ownerTerms)) {
      issues.push({ code: "ownership_mismatch", oracleId: ownership.id, message: `Expected one matching owner for ${ownership.path}; observed ${owners.length}.` });
    }
  }
  for (const criterionId of oracle.requiredCriterionIds) {
    if (!observed.criterionIds.includes(criterionId)) issues.push({ code: "missing_proof_criterion", oracleId: criterionId, message: `Criterion ${criterionId} is not represented.` });
  }
  return {
    candidate: label,
    passed: issues.length === 0,
    issues: issues.sort((left, right) => `${left.code}\0${left.oracleId ?? ""}`.localeCompare(`${right.code}\0${right.oracleId ?? ""}`)),
    observations: { nodes: observed.responsibilities.length, leaves: 0, seams: observed.seams.length, resourceClaims: observed.ownership.reduce((sum, item) => sum + item.paths.length, 0) }
  };
}

function evaluation(label: PlanningCandidate["label"], issues: TopologyEvaluation["issues"], graph: GraphRevision | undefined): TopologyEvaluation {
  const nodes = Object.values(graph?.nodes ?? {});
  return {
    candidate: label,
    passed: issues.length === 0,
    issues: [...issues].sort((left, right) => `${left.code}\0${left.oracleId ?? ""}`.localeCompare(`${right.code}\0${right.oracleId ?? ""}`)),
    observations: {
      nodes: nodes.length,
      leaves: nodes.filter(({ kind }) => kind === "leaf").length,
      seams: graph?.seamBindings.length ?? 0,
      resourceClaims: graph?.resourceClaims.length ?? 0
    }
  };
}

function matches(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLocaleLowerCase("en");
  return terms.every((term) => normalized.includes(term.toLocaleLowerCase("en")));
}

function nodeText(node: GraphRevision["nodes"][string]): string {
  return `${node.title} ${node.goal}`;
}

function unitText(unit: { title: string; objective: string; concerns: string[] } | undefined): string {
  return unit === undefined ? "" : `${unit.title} ${unit.objective} ${unit.concerns.join(" ")}`;
}

function rootCriterionFor(plan: SemanticPlan, unitId: string, criterionId: string): string {
  let current = plan.units[unitId];
  let currentCriterion = criterionId;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    const refinement = current.criteria.find(({ criterionId: id }) => id === currentCriterion);
    if (refinement === undefined) return currentCriterion;
    currentCriterion = refinement.sourceCriterionId;
    current = current.parentId === undefined ? undefined : plan.units[current.parentId];
  }
  return currentCriterion;
}

export interface OfflinePreviewInput {
  title: string;
  repository: string;
  candidateSha: string;
  plan: SemanticPlan;
  graph: GraphRevision;
  contracts: CompiledPlanContracts;
  topology: TopologyEvaluation;
  findings: readonly PlanningFinding[];
}

export function renderOfflinePlanningPreview(input: OfflinePreviewInput): string {
  const children = new Map<string | null, string[]>();
  for (const node of Object.values(input.graph.nodes)) {
    const bucket = children.get(node.parentId) ?? [];
    bucket.push(node.id);
    children.set(node.parentId, bucket);
  }
  const renderNode = (id: string): string => {
    const node = input.graph.nodes[id]!;
    const bundle = input.contracts.taskBundles[id];
    const childHtml = (children.get(id) ?? []).sort().map(renderNode).join("");
    const paths = bundle?.scope.allowedPaths ?? [];
    return `<li class="node node-${escapeHtml(node.kind)}"><article><span class="kind">${escapeHtml(node.kind)}</span><h3>${escapeHtml(node.title)}</h3><p>${escapeHtml(node.goal)}</p><div class="chips">${paths.map((path) => `<span>${escapeHtml(path)}</span>`).join("")}</div></article>${childHtml === "" ? "" : `<ol>${childHtml}</ol>`}</li>`;
  };
  const seams = Object.values(input.contracts.seams).map((seam) => `<tr><td>${escapeHtml(input.graph.nodes[seam.producerNodeId]?.title ?? seam.producerNodeId)}</td><td>${escapeHtml(seam.consumerNodeIds.map((id) => input.graph.nodes[id]?.title ?? id).join(", "))}</td><td>${escapeHtml(seam.specification)}</td><td>${escapeHtml(seam.compatibility.mode)}</td></tr>`).join("");
  const proofs = Object.values(input.contracts.taskBundles).flatMap(({ validation }) => validation.obligations).map((obligation) => `<li><strong>${escapeHtml(obligation.criterionId)}</strong><span>${escapeHtml(obligation.layer)} · ${escapeHtml(obligation.severity)}</span></li>`).join("");
  const findings = input.findings.length === 0
    ? "<p class=empty>No advisory findings.</p>"
    : `<ul>${input.findings.map((item) => `<li><strong>${escapeHtml(item.code)}</strong> ${escapeHtml(item.message)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>${previewCss()}</style></head><body><main><header><div><p class="eyebrow">ManyHands · Stage 5 offline preview</p><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.repository)} · candidate ${escapeHtml(input.candidateSha.slice(0, 12))}</p></div><div class="verdict ${input.topology.passed ? "pass" : "fail"}"><strong>${input.topology.passed ? "ORACLE PASS" : "ORACLE FAIL"}</strong><span>${input.topology.observations.nodes} responsibilities · ${input.topology.observations.seams} seams</span></div></header><section><h2>Responsibility hierarchy</h2><ol class="tree">${renderNode(input.graph.rootId)}</ol></section><section><h2>Explicit seams</h2><div class="table-wrap"><table><thead><tr><th>Producer</th><th>Consumer</th><th>Observable contract</th><th>Compatibility</th></tr></thead><tbody>${seams}</tbody></table></div></section><div class="grid"><section><h2>Proof coverage</h2><ul class="proofs">${proofs}</ul></section><section><h2>Advisory findings</h2>${findings}</section></div><footer>Read-only artifact. No daemon, command endpoint or browser capability is present.</footer></main></body></html>`;
}

function previewCss(): string {
  return `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#080b12;color:#edf3ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#17315a 0,transparent 32rem),#080b12}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:42px 0 70px}header{display:flex;justify-content:space-between;gap:30px;align-items:flex-start;border-bottom:1px solid #263449;padding-bottom:28px}h1{font-size:clamp(2rem,5vw,4.3rem);line-height:.95;max-width:850px;margin:.3rem 0 1rem;letter-spacing:-.05em}h2{font-size:1.05rem;text-transform:uppercase;letter-spacing:.12em;color:#9eb4d2;margin:0 0 18px}.eyebrow{color:#6ee7b7;text-transform:uppercase;letter-spacing:.14em;font-weight:700;font-size:.75rem}.verdict{min-width:220px;border:1px solid;border-radius:16px;padding:18px;display:grid;gap:7px}.verdict.pass{border-color:#38d39f;background:#0e2b26}.verdict.fail{border-color:#fb7185;background:#32151d}.verdict span{color:#a9b8cc;font-size:.85rem}section{margin-top:34px;background:#101621;border:1px solid #253044;border-radius:20px;padding:24px}.tree,.tree ol{list-style:none;margin:0;padding:0}.tree ol{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:14px 0 0 22px}.node article{background:#151e2c;border:1px solid #2b3a50;border-radius:15px;padding:17px;height:100%}.node-root>article{border-color:#60a5fa;background:linear-gradient(135deg,#162844,#151e2c)}.node h3{margin:7px 0;font-size:1rem}.node p{margin:0;color:#b8c5d8;line-height:1.45;font-size:.9rem}.kind{font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:#6ee7b7}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.chips span{font:11px ui-monospace,monospace;color:#adc7ed;background:#0b111b;border:1px solid #26364d;padding:5px 7px;border-radius:7px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{text-align:left;border-bottom:1px solid #293449;padding:12px 10px;vertical-align:top}th{color:#8fa8c9}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.proofs{list-style:none;padding:0;display:grid;gap:8px}.proofs li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #283448}.proofs span,.empty{color:#9fb0c6}footer{color:#71839b;margin-top:30px;text-align:center;font-size:.8rem}@media(max-width:720px){header{display:grid}.grid{grid-template-columns:1fr}.tree ol{margin-left:8px}}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
