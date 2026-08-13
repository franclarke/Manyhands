import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_GRANULARITY_POLICY,
  PLAN_CRITIC_KINDS,
  PlanningCapacityError,
  RecursivePlanner,
  applyGranularitySelection,
  compileGraphRevision,
  createSemanticPlan,
  projectPlannedTree,
  projectSemanticPlanForLegacyCompiler,
  resolveGranularityCondition,
  selectGranularityStrategy,
  type CutRequest,
  type GoalCriterion,
  type RepositoryEvidence,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";
import {
  buildAgentEnvironment,
  deliveryRequestFingerprint,
  resolveCliBinaryPath,
  safeGitArgs,
  targetWorkingTreeIsClean,
  TransactionalDeliveryPublisher,
  type TransactionalDeliveryApproval,
  type TransactionalDeliveryReceipt
} from "@manyhands/execution-core";
import {
  composeRepositoryView,
  createRepositoryQuery,
  inspectRepositoryModelWithSnapshot,
  type RepositoryQueryBudget,
  type RepositoryQueryItem,
  type RepositorySnapshot,
  type RepositoryView
} from "@manyhands/repository-index";
import type {
  DeliveryReceipt,
  ProductRunDefinition,
  RunEventInput,
  RunProjection
} from "@manyhands/run-coordinator";
import { resolveCliProcessInvocation } from "@manyhands/shared/node-cli-process";

import type {
  TransitionalDeliveryPort,
  TransitionalLifecycleResult,
  TransitionalPlannerPort
} from "./transitional-unsafe-profile.js";
import {
  createTransitionalUnsafeProfile,
  type CreateTransitionalUnsafeProfileOptions
} from "./transitional-unsafe-profile.js";
import { withTransitionalRepositoryLease } from "./transitional-repository-lease.js";

const execFileAsync = promisify(execFile);
const PROVIDER_CAPACITY_PATTERN = /rate.?limit|too many requests|overloaded|capacity|quota/i;

export interface CurrentLifecycleAdapterOptions {
  readonly clock?: () => string;
  readonly planningStepTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
}

export interface CreateCurrentTransitionalUnsafeProfileOptions
  extends Pick<
    CreateTransitionalUnsafeProfileOptions,
    "stateRoot" | "nodeExecutable" | "workerScriptPath" | "cwd" | "clock"
  > {
  readonly planningStepTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
}

const PRODUCTIVE_REPOSITORY_QUERY_BUDGET: RepositoryQueryBudget = {
  maxResults: 64,
  maxBytes: 64 * 1024,
  maxDepth: 1
};

export interface ProductiveRepositoryGrounding {
  snapshot: RepositorySnapshot;
  view: RepositoryView;
  evidence: RepositoryEvidence[];
  queryDigests: string[];
  budget: RepositoryQueryBudget;
}

/** Stage 4 boundary: exact Git facts and bounded queries consumed by the transitional planner. */
export async function buildProductiveRepositoryGrounding(input: {
  rootPath: string;
  targetFingerprint: string;
  baseCommit: string;
  goal: string;
  acceptanceCriteria: readonly string[];
}): Promise<ProductiveRepositoryGrounding> {
  const inspection = await inspectRepositoryModelWithSnapshot({
    rootPath: input.rootPath,
    targetFingerprint: input.targetFingerprint,
    baseCommit: input.baseCommit
  });
  const view = await composeRepositoryView({
    rootPath: input.rootPath,
    inspection,
    overlays: []
  });
  const query = createRepositoryQuery({ rootPath: input.rootPath, view });
  const budget = { ...PRODUCTIVE_REPOSITORY_QUERY_BUDGET };
  const terms = repositoryGoalTerms([input.goal, ...input.acceptanceCriteria]);
  const anchorPackage = view.model.packages.find((boundary) => boundary.rootPath === "")
    ?? view.model.packages[0];
  const answers = [
    query.searchGoalTerms(terms, budget),
    ...(anchorPackage === undefined
      ? []
      : [query.inspectBoundary(`package:${anchorPackage.rootPath || "."}`, budget)]),
    query.validationCapabilities(budget)
  ];
  return {
    snapshot: inspection.snapshot,
    view,
    evidence: legacyRepositoryEvidence(answers.flatMap((answer) => answer.items)),
    queryDigests: answers.map((answer) => answer.digest),
    budget
  };
}

/** Concrete composition used by the explicit productive CLI profile. */
export function createCurrentTransitionalUnsafeProfile(
  options: CreateCurrentTransitionalUnsafeProfileOptions
) {
  return createTransitionalUnsafeProfile({
    stateRoot: options.stateRoot,
    nodeExecutable: options.nodeExecutable,
    workerScriptPath: options.workerScriptPath,
    cwd: options.cwd,
    planner: createCurrentPlannerPort({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.planningStepTimeoutMs === undefined
        ? {}
        : { planningStepTimeoutMs: options.planningStepTimeoutMs }),
      ...(options.spawnProcess === undefined ? {} : { spawnProcess: options.spawnProcess })
    }),
    delivery: createCurrentDeliveryPort(),
    ...(options.clock === undefined ? {} : { clock: options.clock })
  });
}

/** Current Stage 3 planner composition, moved out of Next and behind the daemon effect seam. */
export function createCurrentPlannerPort(
  options: CurrentLifecycleAdapterOptions = {}
): TransitionalPlannerPort {
  const now = options.clock ?? (() => new Date().toISOString());
  return {
    async plan({ runId, definition }): Promise<TransitionalLifecycleResult> {
      const repoPath = absoluteTargetPath(definition);
      return withTransitionalRepositoryLease({ repoRoot: repoPath, runId }, async () => {
      const grounding = await buildProductiveRepositoryGrounding({
        rootPath: repoPath,
        targetFingerprint: stringField(definition.targetContext, "fingerprint"),
        baseCommit: stringField(definition.targetContext, "sourceBaseCommit"),
        goal: definition.userPrompt,
        acceptanceCriteria: definition.acceptanceCriteria
      });
      const { snapshot } = grounding;
      const criteria = goalCriteria(definition);
      const { evidence } = grounding;
      const planner = new RecursivePlanner({
        model: {
          proposeCut: (request) => invokeCurrentPlanningCli({
            runId,
            cwd: repoPath,
            selection: definition.planningSelection,
            request,
            ...(options.planningStepTimeoutMs === undefined
              ? {}
              : { timeoutMs: options.planningStepTimeoutMs }),
            ...(options.spawnProcess === undefined ? {} : { spawnProcess: options.spawnProcess })
          })
        },
        budget: { maxScopePaths: DEFAULT_GRANULARITY_POLICY.maxLeafScopePaths },
        maxAttemptsPerUnit: positiveIntegerField(definition.executionConfig, "maxPlanningAttempts") ?? 2
      });
      const plan = await planner.plan({
        root: {
          key: "root",
          objective: definition.userPrompt,
          criteria,
          reads: evidence.filter((item) => item.kind === "path").map((item) => item.reference),
          writes: []
        },
        criteria,
        evidence
      });
      if (plan.unresolved.length > 0) {
        throw new Error(`no_safe_cut: ${plan.unresolved
          .map((unit) => `${unit.unit.key}: ${unit.diagnostics.join("; ")}`)
          .join(" | ")}`);
      }
      const projected = projectPlannedTree({
        tree: plan.root,
        goal: definition.userPrompt,
        criteria,
        evidence,
        repositorySnapshotId: snapshot.snapshotId
      });
      const semanticPlan = createSemanticPlan({
        goal: definition.userPrompt,
        repositorySnapshotId: snapshot.snapshotId,
        criteria: [...projected.criteria],
        draft: projected.draft
      });
      const candidateBreakdown = projectSemanticPlanForLegacyCompiler(semanticPlan).breakdown;
      const strategy = selectGranularityStrategy({
        condition: resolveGranularityCondition(definition.granularityCondition),
        breakdown: candidateBreakdown,
        repositorySnapshot: snapshot,
        config: DEFAULT_GRANULARITY_POLICY
      });
      if (strategy.requiresSemanticReplan) {
        throw new Error(
          "no_executable_frontier: the current granularity policy requires a semantic replan."
        );
      }
      const selected = applyGranularitySelection({
        plan: semanticPlan,
        assessments: strategy.assessments
      });
      const selectedBreakdown = projectSemanticPlanForLegacyCompiler(selected.plan).breakdown;
      const compiled = compileGraphRevision({
        semanticPlan: selected.plan,
        repositorySnapshot: snapshot,
        sourceContract: {
          goal: definition.userPrompt,
          acceptanceCriteria: criteria.map((criterion) => criterion.description),
          constraints: []
        }
      }, { idFor: stableId, now });
      const graph = compiled.graph;
      const decisionId = `approve-plan:${graph.graphId}:r${graph.revision}`;
      return {
        events: [
          fact(`repository:${snapshot.snapshotId}:inspection`, now(), "repository.inspected", {
            snapshotId: snapshot.snapshotId,
            disposition: snapshot.inspectionDisposition,
            snapshot: asRecord(snapshot),
            repositoryModelDigest: grounding.view.model.digest,
            repositoryView: {
              digest: grounding.view.digest,
              treeSha: grounding.view.treeSha,
              resourceCatalogDigest: grounding.view.resourceCatalogDigest
            },
            queryDigests: grounding.queryDigests
          }),
          fact(`planning:${selected.plan.planId}:completed:${runId}`, now(), "planning.completed", {
            breakdownId: selected.plan.planId,
            breakdown: asRecord(selected.plan)
          }),
          fact(`graph:${graph.graphId}:r${graph.revision}:compiled`, now(), "graph.compiled", {
            graphId: graph.graphId,
            revision: graph.revision,
            graph: asRecord(graph),
            contracts: compiled.contracts.map(asRecord),
            review: asRecord(compiled.review),
            trace: asRecord(compiled.trace)
          }),
          ...PLAN_CRITIC_KINDS.map((critic) => fact(
            `graph:${graph.graphId}:r${graph.revision}:critic:${critic}`,
            now(),
            "planning.critic_recorded",
            {
              critic,
              findings: compiled.review.findings
                .filter((finding) => finding.critic === critic)
                .map(asRecord)
            }
          )),
          strategyEvent(runId, strategy, candidateBreakdown, selectedBreakdown, now),
          fact(`graph:${graph.graphId}:r${graph.revision}:proposed`, now(), "graph.revision.proposed", {
            graphId: graph.graphId,
            revision: graph.revision
          }),
          fact(decisionId, now(), "decision.raised", {
            decision: {
              id: decisionId,
              kind: "approve_plan",
              question: `Approve graph revision ${graph.revision}?`,
              options: [
                { id: "approve", label: "Approve plan" },
                { id: "request_changes", label: "Request changes" }
              ],
              affectedNodeIds: [graph.rootId],
              evidenceRefs: [`graph:${graph.graphId}:r${graph.revision}`],
              impact: "acceptance"
            }
          })
        ]
      };
      });
    }
  };
}

/** Current compare-and-publish delivery semantics, now invoked only by the daemon adapter. */
export function createCurrentDeliveryPort(): TransitionalDeliveryPort {
  return {
    async publish({ runId, definition, approval, projection }): Promise<DeliveryReceipt> {
      const repoRoot = absoluteTargetPath(definition);
      return withTransitionalRepositoryLease({ repoRoot, runId }, async () => {
        const publisher = new TransactionalDeliveryPublisher({
          validate: (request) => validateCanonicalDelivery(
            projection,
            request,
            repoRoot,
            stringField(definition.targetContext, "fingerprint")
          ),
          journal: {
            claim: async (_idempotencyKey, requestFingerprint) => {
              if (!sameApproval(projection.deliveryApproval, approval)) {
                throw new Error("The canonical delivery journal belongs to a different approval.");
              }
              const receipt = projection.deliveryReceipt === undefined
                ? undefined
                : transactionalReceipt(projection.deliveryReceipt);
              return {
                requestFingerprint,
                ...(receipt === undefined ? {} : { receipt })
              };
            },
            // The daemon actor records delivery.published after this physical
            // result returns; the adapter never writes lifecycle state itself.
            complete: async () => undefined
          },
          repository: {
            inspect: async () => ({
              branch: await git(repoRoot, ["symbolic-ref", "--short", "HEAD"]),
              head: await git(repoRoot, ["rev-parse", "HEAD"]),
              fingerprint: stringField(definition.targetContext, "fingerprint"),
              clean: targetWorkingTreeIsClean(await git(
                repoRoot,
                ["status", "--porcelain=v1", "--untracked-files=all"]
              ))
            }),
            recover: async (request) => {
              const [branch, head, status] = await Promise.all([
                git(repoRoot, ["symbolic-ref", "--short", "HEAD"]),
                git(repoRoot, ["rev-parse", "HEAD"]),
                git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
              ]);
              if (
                branch !== request.targetBranch
                || head !== request.finalSha
                || !targetWorkingTreeIsClean(status)
                || request.targetFingerprint !== stringField(definition.targetContext, "fingerprint")
              ) {
                return undefined;
              }
              return deliveryReceipt(request, head);
            },
            publish: async (request) => {
              const [branch, head, status] = await Promise.all([
                git(repoRoot, ["symbolic-ref", "--short", "HEAD"]),
                git(repoRoot, ["rev-parse", "HEAD"]),
                git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
              ]);
              if (
                branch !== request.targetBranch
                || head !== request.targetHead
                || !targetWorkingTreeIsClean(status)
                || request.targetFingerprint !== stringField(definition.targetContext, "fingerprint")
              ) {
                throw new Error(
                  "The delivery target changed immediately before publication; nothing was published."
                );
              }
              await git(repoRoot, ["merge", "--ff-only", request.finalSha]);
              const deliveredHead = await git(repoRoot, ["rev-parse", "HEAD"]);
              if (deliveredHead !== request.finalSha) {
                throw new Error("Delivery did not publish the approved final SHA.");
              }
              return deliveryReceipt(request, deliveredHead);
            }
          }
        });
        const receipt = await publisher.publish(approval);
        return { ...receipt, destination: approval.targetBranch };
      });
    }
  };
}

async function validateCanonicalDelivery(
  projection: RunProjection,
  approval: TransactionalDeliveryApproval,
  repoRoot: string,
  targetFingerprint: string
): Promise<void> {
  const candidate = projection.finalCandidate;
  const manifest = candidate?.finalManifest;
  if (candidate === undefined || manifest === undefined) {
    throw new Error("Delivery requires the complete final artifact manifest.");
  }
  if (
    targetFingerprint !== approval.targetFingerprint
    || candidate.manifestId !== approval.manifestId
    || candidate.commit !== approval.finalSha
    || candidate.sourceTargetFingerprint !== approval.targetFingerprint
    || candidate.targetBranch !== approval.targetBranch
    || candidate.targetHead !== approval.targetHead
    || manifest.commitSha !== approval.finalSha
    || manifest.deliveryTarget !== approval.targetBranch
  ) {
    throw new Error("Delivery approval does not match the durable final artifact manifest.");
  }
  const matrix = projection.evidenceMatrixSummaries[manifest.evidenceMatrixId];
  const adoptedContractIds = new Set(
    Object.values(projection.adoptedArtifacts).map((artifact) => artifact.contract.id)
  );
  if (
    manifest.graphRevision !== projection.approvedGraphRevision
    || manifest.evidenceMatrixId !== candidate.evidenceMatrixId
    || matrix?.candidateCommit !== approval.finalSha
    || matrix.outcome !== "verified"
    || matrix.validationRecipeDigest !== manifest.validationRecipeDigest
    || manifest.artifactIds.some((artifactId) => !adoptedContractIds.has(artifactId))
  ) {
    throw new Error(
      "Delivery metadata does not match the canonical graph, evidence, or adopted artifacts."
    );
  }
  const treeSha = await git(repoRoot, ["rev-parse", `${approval.finalSha}^{tree}`]);
  if (treeSha !== manifest.treeSha) {
    throw new Error("The final artifact manifest tree no longer matches the candidate commit.");
  }
}

function deliveryReceipt(
  approval: TransactionalDeliveryApproval,
  targetHeadAfter: string
): TransactionalDeliveryReceipt {
  return {
    receiptId: `delivery:${approval.idempotencyKey}`,
    requestFingerprint: deliveryRequestFingerprint(approval),
    manifestId: approval.manifestId,
    finalSha: approval.finalSha,
    targetBranch: approval.targetBranch,
    targetHeadBefore: approval.targetHead,
    targetHeadAfter,
    disposition: "delivered",
    confirmed: true
  };
}

function transactionalReceipt(receipt: DeliveryReceipt): TransactionalDeliveryReceipt {
  if (
    receipt.requestFingerprint === undefined
    || receipt.finalSha === undefined
    || receipt.targetBranch === undefined
    || receipt.targetHeadBefore === undefined
    || receipt.targetHeadAfter === undefined
    || receipt.disposition !== "delivered"
    || receipt.confirmed !== true
  ) {
    throw new Error("The persisted delivery receipt is incomplete.");
  }
  return {
    receiptId: receipt.receiptId,
    requestFingerprint: receipt.requestFingerprint,
    manifestId: receipt.manifestId,
    finalSha: receipt.finalSha,
    targetBranch: receipt.targetBranch,
    targetHeadBefore: receipt.targetHeadBefore,
    targetHeadAfter: receipt.targetHeadAfter,
    disposition: "delivered",
    confirmed: true
  };
}

function sameApproval(
  left: RunProjection["deliveryApproval"],
  right: TransactionalDeliveryApproval
): boolean {
  return left !== undefined
    && left.manifestId === right.manifestId
    && left.finalSha === right.finalSha
    && left.targetBranch === right.targetBranch
    && left.targetHead === right.targetHead
    && left.targetFingerprint === right.targetFingerprint
    && left.actor === right.actor
    && left.idempotencyKey === right.idempotencyKey;
}

async function invokeCurrentPlanningCli(input: {
  runId: string;
  cwd: string;
  selection: ProductRunDefinition["planningSelection"];
  request: Pick<CutRequest, "system" | "user" | "attempt" | "repairIssues">;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}): Promise<string> {
  const repair = input.request.repairIssues.length === 0
    ? ""
    : `\n\nRepair every issue from the previous invalid response:\n- ${input.request.repairIssues.join("\n- ")}`;
  const prompt = `${input.request.system}\n\n${input.request.user}${repair}`;
  const isCodex = input.selection.executorId === "codex-cli";
  if (!isCodex && input.selection.executorId !== "claude-code-cli") {
    throw new Error(`Current planning does not support executor ${input.selection.executorId}.`);
  }
  const binary = resolveCliBinaryPath(isCodex
    ? process.env.MANYHANDS_CODEX_BIN ?? "codex"
    : process.env.MANYHANDS_CLAUDE_BIN ?? "claude");
  const args = isCodex
    ? codexPlanningArgs(input.selection)
    : ["-p", "-", "--model", input.selection.model, "--output-format", "json", "--permission-mode", "plan"];
  const invocation = resolveCliProcessInvocation(binary, args);
  const spawnProcess = input.spawnProcess ?? spawn;
  const timeoutMs = positive(input.timeoutMs ?? Number(process.env.MANYHANDS_PLANNING_STEP_TIMEOUT_MS ?? 600_000));
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      cwd: input.cwd,
      env: buildAgentEnvironment() as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
      ...(invocation.windowsVerbatimArguments === undefined
        ? {}
        : { windowsVerbatimArguments: invocation.windowsVerbatimArguments })
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      void terminateTree(child).finally(() => finish(() => reject(
        new Error(`${input.selection.executorId} planning timed out after ${timeoutMs}ms.`)
      )));
    }, timeoutMs);
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete();
    };
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-16_384); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (code !== 0) {
        const message = `${stderr}\n${stdout}`.trim();
        reject(PROVIDER_CAPACITY_PATTERN.test(message)
          ? new PlanningCapacityError(`${input.selection.executorId} was throttled by the provider.`)
          : new Error(`${input.selection.executorId} planning failed with exit code ${code}: ${message}`));
        return;
      }
      try {
        resolve(isCodex ? stdout : claudeResult(stdout));
      } catch (error) {
        reject(error);
      }
    }));
    child.stdin?.end(prompt);
  });
}

function strategyEvent(
  runId: string,
  strategy: ReturnType<typeof selectGranularityStrategy>,
  candidate: WorkBreakdown,
  selected: WorkBreakdown,
  now: () => string
): RunEventInput {
  return fact(`planning:${candidate.breakdownId}:strategy:${runId}`, now(), "planning.granularity_strategy_selected", {
    policyVersion: strategy.policyVersion,
    condition: strategy.condition,
    candidateTreeHash: strategy.candidateTreeHash,
    candidateTree: {
      root: asRecord(candidate.root),
      candidateArtifacts: candidate.candidateArtifacts.map(asRecord),
      candidateSeams: candidate.candidateSeams.map(asRecord)
    },
    config: {
      maxLeafContextTokens: strategy.config.maxLeafContextTokens,
      maxLeafScopePaths: strategy.config.maxLeafScopePaths,
      maxLeafPlannedPaths: strategy.config.maxLeafPlannedPaths
    },
    assessments: Object.values(strategy.assessments).map((assessment) => ({
      unitKey: assessment.unitKey,
      nodeId: stableId("node", assessment.unitKey),
      selected: assessment.selected,
      leafFeasible: assessment.leafFeasible,
      splitViable: assessment.splitViable,
      reasons: { ...assessment.reasons },
      evidenceRefs: assessment.evidenceRefs,
      rationale: assessment.rationale
    })),
    metrics: structuralMetrics(selected.root)
  });
}

function legacyRepositoryEvidence(items: readonly RepositoryQueryItem[]): RepositoryEvidence[] {
  const evidence = new Map<string, RepositoryEvidence>();
  for (const item of items) {
    for (const evidenceRef of item.evidenceRefs) {
      if (evidence.has(evidenceRef)) continue;
      evidence.set(evidenceRef, {
        id: evidenceRef,
        kind: legacyEvidenceKind(item),
        reference: legacyEvidenceReference(item),
        observation: item.summary,
        confidence: 1
      });
    }
  }
  return [...evidence.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function legacyEvidenceKind(item: RepositoryQueryItem): RepositoryEvidence["kind"] {
  if (item.kind === "symbol") return "symbol";
  if (item.kind === "command") return "script";
  if (item.kind === "diagnostic") return "diagnostic";
  return "path";
}

function legacyEvidenceReference(item: RepositoryQueryItem): string {
  if (item.kind === "command") return item.name ?? item.locator;
  if (item.locator.startsWith("path:")) return item.locator.slice("path:".length);
  if (item.locator.startsWith("module:")) return item.locator.slice("module:".length);
  if (item.locator.startsWith("package:")) {
    const packagePath = item.locator.slice("package:".length);
    return packagePath === "." ? "." : packagePath;
  }
  return item.locator;
}

function repositoryGoalTerms(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => value.toLocaleLowerCase("en-US").match(/[a-z0-9][a-z0-9_-]{2,}/gu) ?? []))]
    .sort();
}

function goalCriteria(definition: ProductRunDefinition): GoalCriterion[] {
  const source = definition.acceptanceCriteria.length > 0
    ? definition.acceptanceCriteria
    : [definition.userPrompt];
  return source.map((description, index) => ({
    id: `criterion-${index + 1}`,
    description,
    required: true
  }));
}

function structuralMetrics(root: WorkUnit) {
  const units = flatten(root);
  const composites = units.filter((unit): unit is Extract<WorkUnit, { kind: "composite" }> =>
    unit.kind === "composite");
  const depth = (unit: WorkUnit): number => unit.kind === "leaf"
    ? 0
    : 1 + Math.max(...unit.children.map(depth));
  return {
    maxGraphDepth: depth(root),
    totalLeafCount: units.filter((unit) => unit.kind === "leaf").length,
    averageBranchingFactor: composites.length === 0
      ? 0
      : composites.reduce((sum, unit) => sum + unit.children.length, 0) / composites.length
  };
}

function flatten(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flatten)];
}

function codexPlanningArgs(selection: ProductRunDefinition["planningSelection"]): string[] {
  return [
    "exec", "--model", selection.model,
    "--sandbox", "read-only",
    "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
    ...(selection.effort === undefined ? [] : ["-c", `model_reasoning_effort="${selection.effort}"`]),
    "-"
  ];
}

function claudeResult(stdout: string): string {
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed === "object" && parsed !== null && "result" in parsed && typeof parsed.result === "string") {
    return parsed.result;
  }
  throw new Error("Claude planning output did not contain a string result.");
}

async function terminateTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true })
      .catch(() => child.kill("SIGKILL"));
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, args), {
    cwd: repoRoot,
    windowsHide: true,
    encoding: "utf8"
  });
  return stdout.trim();
}

function fact<T extends RunEventInput["type"]>(
  eventId: string,
  occurredAt: string,
  type: T,
  payload: Extract<RunEventInput, { type: T }>["payload"]
): Extract<RunEventInput, { type: T }> {
  return { eventId, occurredAt, type, payload } as Extract<RunEventInput, { type: T }>;
}

function stableId(kind: string, key: string): string {
  const readable = key.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 48);
  return `${kind}-${readable}-${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 10)}`;
}

function absoluteTargetPath(definition: ProductRunDefinition): string {
  const value = stringField(definition.targetContext, "sourceRealPath");
  if (!path.isAbsolute(value)) throw new Error("The captured target path must be absolute.");
  return path.resolve(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Target context ${key} is required.`);
  return value;
}

function positiveIntegerField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 600_000;
}

function asRecord<T>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}
