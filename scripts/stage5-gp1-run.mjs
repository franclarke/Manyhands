import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const contracts = await import(pathToFileUrl(path.join(repositoryRoot, "packages/contracts/dist/index.js")));
const decomposer = await import(pathToFileUrl(path.join(repositoryRoot, "packages/decomposer/dist/index.js")));
const repositoryIndex = await import(pathToFileUrl(path.join(repositoryRoot, "packages/repository-index/dist/index.js")));

const [caseName, targetRootInput, runLabel = "initial", causalChange = ""] = process.argv.slice(2);
if (!caseName || !targetRootInput) {
  throw new Error("Usage: node scripts/stage5-gp1-run.mjs <manyhands|express> <target-root> [run-label] [causal-change]");
}
if (!/^[a-z0-9-]+$/u.test(caseName)) throw new Error(`Unsafe case name ${caseName}.`);
if (!/^[a-z0-9-]+$/u.test(runLabel)) throw new Error(`Unsafe run label ${runLabel}.`);
if (runLabel !== "initial" && causalChange.trim() === "") throw new Error("A repeated session requires a recorded causal change.");

const targetRoot = path.resolve(targetRootInput);
const preregistrationPath = path.join(repositoryRoot, "docs/audits/stage-5/preregistration", `${caseName}.json`);
const preregistration = JSON.parse(await readFile(preregistrationPath, "utf8"));
const evidenceDirectory = path.join(repositoryRoot, "docs/audits/stage-5/evidence/gp1", caseName, runLabel);
await mkdir(evidenceDirectory, { recursive: true });
assertGitIdentity(targetRoot, preregistration.repository.baseCommit, preregistration.repository.treeSha);

const inspection = await repositoryIndex.inspectRepositoryModelWithSnapshot({
  rootPath: targetRoot,
  repositoryId: preregistration.repository.id,
  targetFingerprint: `stage5:${preregistration.repository.baseCommit}`,
  baseCommit: preregistration.repository.baseCommit,
  capturedAt: "1970-01-01T00:00:00.000Z"
});
const repositoryView = await repositoryIndex.composeRepositoryView({ rootPath: targetRoot, inspection, overlays: [] });
assertEqual(repositoryView.treeSha, preregistration.repository.treeSha, "tree SHA");
assertEqual(inspection.model.digest, preregistration.repository.modelDigest, "model digest");
assertEqual(repositoryView.digest, preregistration.repository.viewDigest, "view digest");
assertEqual(repositoryView.catalog.digest, preregistration.repository.catalogDigest, "catalog digest");

const query = repositoryIndex.createRepositoryQuery({ rootPath: targetRoot, view: repositoryView });
const queryAnswer = query.searchGoalTerms(preregistration.inspection.queryTerms, preregistration.inspection.budget);
const excerptRefs = preregistration.inspection.excerptPaths.map((item) => `path:${item}`);
const excerptAnswer = await query.readExcerpts(excerptRefs, preregistration.inspection.budget);
if (excerptAnswer.items.length !== excerptRefs.length) {
  const observed = new Set(excerptAnswer.items.map(({ locator }) => locator));
  const missing = excerptRefs.filter((item) => !observed.has(item));
  throw new Error(`Pre-registered excerpts did not resolve: ${missing.join(", ")}`);
}

const goal = contracts.buildGoalContract(withoutDigest(preregistration.goal), sha256);
assertEqual(goal.digest, preregistration.goal.digest, "goal digest");
const proofStrategies = preregistration.proofStrategies.map((item) => contracts.buildProofStrategy({
  id: item.id,
  revision: 1,
  goalContractDigest: goal.digest,
  criterionId: item.criterionId,
  obligationId: item.obligationId,
  mode: item.mode,
  authority: item.authority,
  repositoryViewDigest: repositoryView.digest,
  procedureRef: item.procedureRef,
  selectorDigest: sha256(`${preregistration.caseId}\0${item.procedureRef}`),
  environmentPolicyDigest: sha256("stage5-gp1-offline-v1:read-only:no-daemon"),
  independence: item.independence
}, sha256));

const evidence = excerptAnswer.items.map((item) => ({
  id: item.evidenceRefs[0] ?? `evidence:${item.id}`,
  kind: "path",
  reference: item.locator.slice("path:".length),
  observation: `Exact Git blob at ${item.locator}; ${item.truncated ? "truncated by the registered byte budget" : "complete within the registered byte budget"}.`,
  confidence: item.epistemic.state === "known" ? 1 : 0.65
}));
const resourceMap = excerptAnswer.items.map((item) => {
  const resolved = repositoryView.catalog.resolve(item.locator);
  if (resolved.state !== "known") throw new Error(`Excerpt resource ${item.locator} is ${resolved.state}.`);
  return {
    path: item.locator.slice("path:".length),
    resourceId: resolved.resource.id,
    evidenceRefs: resolved.evidenceRefs,
    epistemic: resolved.resource.epistemic,
    generated: resolved.resource.generated
  };
});
const prompt = buildPrompt({ preregistration, goal, proofStrategies, repositoryView, resourceMap, queryAnswer, excerptAnswer, evidence });
const promptPath = path.join(evidenceDirectory, "prompt.txt");
const outputPath = path.join(evidenceDirectory, "provider-output.json");
const providerLogPath = path.join(evidenceDirectory, "provider-events.jsonl");
await writeFile(promptPath, prompt, "utf8");

const candidateSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
const candidateTree = git(repositoryRoot, ["show", "-s", "--format=%T", candidateSha]);
const preregistrationCommit = git(repositoryRoot, ["rev-list", "-1", "HEAD", "--", relative(repositoryRoot, preregistrationPath)]);
const invocation = [
  "exec",
  "-",
  "--model", preregistration.provider.model,
  "-c", `model_reasoning_effort=\"${preregistration.provider.reasoningEffort}\"`,
  "--sandbox", "read-only",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--skip-git-repo-check",
  "--output-schema", path.join(repositoryRoot, "scripts/stage5-gp1-output.schema.json"),
  "--output-last-message", outputPath,
  "--json",
  "--color", "never"
];
const providerReceipt = await runProvider({ invocation, prompt, logPath: providerLogPath, cwd: evidenceDirectory });
const providerEnvelope = JSON.parse(await readFile(outputPath, "utf8"));
const canonicalMaterial = JSON.parse(providerEnvelope.canonicalMaterialJson);
const currentDraft = JSON.parse(providerEnvelope.currentDraftJson);
const criticFindings = JSON.parse(providerEnvelope.criticFindingsJson);

const planningEngine = new decomposer.PlanningEngine({
  model: { propose: async () => ({ kind: "candidate", material: canonicalMaterial }) },
  repository: {
    inspect: async () => ({
      queryReceipts: [queryAnswer.digest, excerptAnswer.digest],
      evidenceRefs: [...new Set([...queryAnswer.evidenceRefs, ...excerptAnswer.evidenceRefs])].sort(),
      repositoryQueries: 2,
      queryBytes: queryAnswer.cost.bytes + excerptAnswer.cost.bytes,
      missingCapabilities: []
    })
  },
  hasher: sha256,
  critic: {
    review: async () => criticFindings.map((item) => ({
      code: item.code,
      message: item.message,
      evidenceRefs: item.evidenceRefs,
      resolution: item.resolution
    }))
  }
});
const planningResult = await planningEngine.plan({
  goal,
  repositoryView,
  proofStrategies,
  budget: preregistration.planningBudget
}, new AbortController().signal);

let stage5Candidate;
let compilation;
if (planningResult.kind === "ready") {
  compilation = decomposer.compilePlan({
    plan: planningResult.plan,
    goal,
    proofStrategies,
    repositoryView,
    hasher: sha256,
    idFactory: (kind, parts) => [kind, ...parts].join(":")
  });
  if (compilation.ok) {
    stage5Candidate = {
      label: "stage5",
      plan: planningResult.plan,
      graph: compilation.graph,
      contracts: compilation.contracts
    };
  }
}

const currentPlanner = new decomposer.PlanningModule({
  model: { generate: async () => currentDraft },
  maxAttempts: 1,
  retryDelayMs: 0
});
const currentResult = await currentPlanner.plan({
  goal: goal.goal,
  acceptanceCriteria: goal.acceptanceCriteria.map(({ statement }) => statement),
  constraints: goal.constraints,
  repositorySnapshot: {
    snapshotId: inspection.model.snapshot.id,
    inspectionDisposition: inspection.model.coverage.disposition === "unknown" ? "unavailable" : "partial",
    evidence
  },
  granularityBrief: {
    profile: "balanced",
    candidateCount: 1,
    guidance: "Prefer cohesive responsibility boundaries with explicit integration seams."
  },
  candidateCount: 1
});
const currentCandidate = currentResult.kind === "ready"
  ? { label: "current", observedTopology: decomposer.observeCurrentPlannerTopology(currentResult.plan) }
  : { label: "current", unavailableReason: `Current planner returned ${currentResult.kind}.` };

const topologyEvaluation = decomposer.evaluatePlanningCandidates({
  oracle: preregistration.topologyOracle,
  candidates: [
    stage5Candidate ?? { label: "stage5", unavailableReason: planningResult.kind === "ready" ? "Compilation failed." : `Planning returned ${planningResult.kind}.` },
    currentCandidate
  ]
});

if (stage5Candidate !== undefined) {
  const preview = decomposer.renderOfflinePlanningPreview({
    title: goal.goal,
    repository: `${preregistration.repository.id} @ ${preregistration.repository.baseCommit.slice(0, 12)}`,
    candidateSha,
    plan: stage5Candidate.plan,
    graph: stage5Candidate.graph,
    contracts: stage5Candidate.contracts,
    topology: topologyEvaluation.candidates.find(({ candidate }) => candidate === "stage5"),
    findings: planningResult.trace.advisoryFindings
  });
  await writeFile(path.join(evidenceDirectory, "preview.html"), preview, "utf8");
}

const receipt = {
  schemaVersion: 1,
  caseId: preregistration.caseId,
  runLabel,
  causalChange: causalChange || null,
  candidate: { sha: candidateSha, tree: candidateTree },
  preregistration: { commit: preregistrationCommit, path: relative(repositoryRoot, preregistrationPath) },
  repository: {
    root: targetRoot,
    baseCommit: preregistration.repository.baseCommit,
    treeSha: repositoryView.treeSha,
    snapshot: inspection.model.snapshot,
    modelDigest: inspection.model.digest,
    viewDigest: repositoryView.digest,
    catalogDigest: repositoryView.catalog.digest
  },
  provider: {
    cli: preregistration.provider.cli,
    cliVersion: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
    model: preregistration.provider.model,
    reasoningEffort: preregistration.provider.reasoningEffort,
    profile: preregistration.provider.profile,
    invocation,
    exitCode: providerReceipt.exitCode,
    promptDigest: sha256(prompt),
    outputDigest: sha256(await readFile(outputPath, "utf8")),
    eventLogDigest: sha256(await readFile(providerLogPath, "utf8"))
  },
  query: {
    searchDigest: queryAnswer.digest,
    excerptDigest: excerptAnswer.digest,
    results: queryAnswer.cost.results + excerptAnswer.cost.results,
    bytes: queryAnswer.cost.bytes + excerptAnswer.cost.bytes,
    viewDigest: queryAnswer.viewDigest
  },
  planningResult,
  compilation: compilation ?? null,
  currentComparator: currentResult,
  topologyEvaluation,
  browser: { status: stage5Candidate === undefined ? "not_run" : "pending", preview: "preview.html" }
};
await writeJson(path.join(evidenceDirectory, "receipt.json"), receipt);
await writeJson(path.join(evidenceDirectory, "canonical-material.json"), canonicalMaterial);
await writeJson(path.join(evidenceDirectory, "current-draft.json"), currentDraft);
await writeJson(path.join(evidenceDirectory, "repository-evidence.json"), {
  query: queryAnswer,
  excerpts: excerptAnswer,
  resources: resourceMap
});

console.log(JSON.stringify({
  caseId: preregistration.caseId,
  planningKind: planningResult.kind,
  compilationOk: compilation?.ok ?? false,
  stage5Oracle: topologyEvaluation.candidates.find(({ candidate }) => candidate === "stage5")?.passed ?? false,
  currentOracle: topologyEvaluation.candidates.find(({ candidate }) => candidate === "current")?.passed ?? false,
  evidenceDirectory
}));

function buildPrompt(input) {
  const canonicalShape = `Return canonicalMaterialJson as a JSON string containing exactly one SemanticPlanMaterial:
{ id, revision:1, goalContract:{id,revision,digest}, repositorySnapshot:{id,digest}, repositoryView:{digest,treeSha,resourceCatalogDigest}, rootUnitId, units:Record, seams:Record, artifacts:Record, decisions:[], evidence:[], status:"ready" }.
Each unit is {id,parentId?,role:"leaf"|"composite",title,objective,boundary:{kind,evidenceRefs},outcomes:[{id,statement}],criteria:[{criterionId,statement,sourceCriterionId}],repositorySurface:{resourceRefs,pathHints},resourceIntents,consumes,produces,seamRefs,validation,uncertainty:[],granularity,expansion,integration?}.
Root criteria sourceCriterionId values are exact GoalContract criterion ids. Every child criterion sourceCriterionId must instead equal one criterionId declared by its direct parent (for example the root declares criterionId "criterion-ref:route" sourced from "criterion:route", then a child declares criterionId "criterion-ref:child-route" sourced from "criterion-ref:route").
An observe intent is {resourceId,access:"observe",inputArtifactId?,evidenceRefs,epistemic}. A modify intent is {resourceId,access:"modify",ownerPhase:"implementation"|"integration",inputArtifactId?,outputArtifactId,evidenceRefs,epistemic}.
Validation is ALWAYS a JSON array, even when it has one element: [{obligationId,criterionId,proofStrategyId,layer,severity,acceptableEvidence,baselinePolicy,negativeControl,flakyPolicy}]. The validation criterionId should be the unit's local criterionId; its refinement chain must resolve to the exact registered ProofStrategy criterionId. Use every registered ProofStrategy exactly once: proof:root on the root integration and every other strategy on one distinct leaf. Do not attach two validation obligations to one unit.
Granularity leaf requires disposition:"leaf" and all feasibility yes/true/false as appropriate. Composite requires disposition:"split", at least one splitReason/evidenceRef, integrationObligationId, and integration {obligationId,objective,criterionIds,proofStrategyId,artifactIds,seamIds}.
Artifact is {id,producerUnitId,consumerUnitIds,artifactType,mediaType?,materialization:"commit"|"patch"|"files"|"manifest"|"logical",expectedPaths}. Every consumed artifact names the consumer and every produced artifact names the producer. Every consumed artifact must be output by a modify resource intent of its producer.
Seam is {id,kind,specification,producerUnitId,consumerUnitIds,semanticFacts,compatibility:{mode,rules},artifactId,validationObligationIds}. semanticFacts is ALWAYS a JSON object whose keys and values are non-empty strings, for example {"payload":"SemanticPlan","authority":"deterministic verifier"}; never use an array. Producer and consumers must all list seamRefs. Seam artifact must flow producer to every seam consumer.
Use only listed resourceId values and their exact paths. One path has one modifying leaf owner. Root/composites may describe broad surfaces but should not modify child-owned resources.`;
  const exactEnums = `Closed enums (copy these exact string values; never invent semantic aliases):
- boundary.kind: application | package | module | domain | vertical_slice | cross_cutting
- resourceIntent.access: observe | modify
- ownerPhase: implementation | integration
- validation.layer: static | unit | integration | e2e | security | accessibility | manual
- validation.severity: required | advisory
- acceptableEvidence: static_analysis | test_result | runtime_observation | artifact_inspection | manual_attestation
- baselinePolicy: required | optional | not_required
- negativeControl: required | when_feasible | not_required
- flakyPolicy: forbid | allow_with_warning
- seam.kind: api | type | event | data | ui | command
- compatibility.mode: exact | backward_compatible
- artifact.materialization: commit | patch | files | manifest | logical
- granularity.disposition: leaf | split | frontier
- splitReasons: capacity | independent_delivery | parallelism | risk_isolation | integration_boundary | specialization
- expansion: leaf | expanded | frontier
- epistemic known form: {"state":"known","confidence":"high"|"medium"|"low","evidenceRefs":[non-empty ids]}; partial/conflicting have the same confidence/evidence shape; unknown is {"state":"unknown","reason":"...","evidenceRefs":[]}.
Recommended executable validation defaults are layer:"integration", severity:"required", acceptableEvidence:["test_result"], baselinePolicy:"required", negativeControl:"when_feasible", flakyPolicy:"forbid". Static proof uses layer:"static" and acceptableEvidence:["static_analysis"].`;
  const currentShape = `Return currentDraftJson as a JSON string containing the current planner draft {root,seams,repositoryEvidence,uncertainties:[],questions:[]}.
Current units use {key,kind,title,objective,concerns,evidenceIds,plannedPaths?,writePaths?,outcomes}; composite also has cut:{criterion,rationale},children. Every outcome is exactly {id,description,criterionIds,verification:{kind:"existing"|"author_test"|"manual",references:[non-empty strings],rationale?}}; never use "statement" in the current draft. Use criterionIds "criterion-1", "criterion-2", ... in the same order as GoalContract acceptanceCriteria. Each leaf must cite an exact supplied evidence id and declare exact writePaths. Seams use {id,producerUnitKey,consumerUnitKeys,purpose,paths,interface:{kind,promise,compatibility,materialization,verification},evidenceIds}. Current seam interface.materialization is exactly "logical"|"files"|"manifest"|"commit" (never "patch"), and interface.verification is the same verification OBJECT used by outcomes, never a string. repositoryEvidence must be the exact supplied current evidence array.`;
  const criticShape = `Return criticFindingsJson as a JSON string containing an array of zero or more advisory findings {code,message,evidenceRefs,resolution}. resolution is deterministic_check, repository_query or human_decision. These findings cannot approve or reject.`;
  return [
    "You are producing two offline planning proposals for a pre-registered ManyHands Stage 5 evaluation.",
    "Do not call tools. Do not inspect the filesystem. Use only the exact GoalContract, RepositoryView evidence, resource map and oracle below.",
    "Return the three required JSON-string fields through the provided outer response schema. No prose outside those fields.",
    "A proposal is not implementation and must not claim runtime success.",
    canonicalShape,
    exactEnums,
    currentShape,
    criticShape,
    `Pre-registration:\n${JSON.stringify(input.preregistration, null, 2)}`,
    `Canonical GoalContract:\n${JSON.stringify(input.goal, null, 2)}`,
    `Allowed ProofStrategies:\n${JSON.stringify(input.proofStrategies, null, 2)}`,
    `Exact RepositoryView ref:\n${JSON.stringify({ digest: input.repositoryView.digest, treeSha: input.repositoryView.treeSha, resourceCatalogDigest: input.repositoryView.catalog.digest }, null, 2)}`,
    `Allowed writable/observable resources:\n${JSON.stringify(input.resourceMap, null, 2)}`,
    `Bounded repository search answer:\n${JSON.stringify(input.queryAnswer.items, null, 2)}`,
    `Exact bounded excerpts:\n${JSON.stringify(input.excerptAnswer.items.map(({ locator, text, truncated, evidenceRefs, epistemic }) => ({ locator, text, truncated, evidenceRefs, epistemic })), null, 2)}`,
    `Current planner canonical evidence array:\n${JSON.stringify(input.evidence, null, 2)}`
  ].join("\n\n");
}

function runProvider({ invocation, prompt, logPath, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", invocation, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let events = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { events += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", async (exitCode) => {
      await writeFile(logPath, events + (stderr === "" ? "" : `\n${JSON.stringify({ type: "provider.stderr", text: stderr })}\n`), "utf8");
      if (exitCode !== 0) reject(new Error(`Codex GP1 session failed with exit ${exitCode}: ${stderr}`));
      else resolve({ exitCode });
    });
    child.stdin.end(prompt);
  });
}

function assertGitIdentity(root, commit, tree) {
  assertEqual(git(root, ["rev-parse", commit]), commit, "base commit");
  assertEqual(git(root, ["show", "-s", "--format=%T", commit]), tree, "base tree");
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function withoutDigest(value) {
  const { digest: _digest, ...material } = value;
  return material;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
}

function relative(root, target) {
  return path.relative(root, target).replaceAll("\\", "/");
}

function pathToFileUrl(target) {
  return new URL(`file:///${target.replaceAll("\\", "/")}`).href;
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
