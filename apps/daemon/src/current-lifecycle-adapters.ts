import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import {
  PlanningEngine,
  compilePlan,
  PlanningCapacityError,
  type RepositoryEvidence
} from "@manyhands/decomposer";
import {
  buildGoalContract,
  buildProofStrategy,
  SemanticPlanMaterialSchema,
  type DigestHasher,
  type PlanningResult,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import type {
  PlanningModelInput,
  PlanningModelProposal
} from "@manyhands/decomposer";
import {
  buildAgentEnvironment,
  DeliveryRecoveryError,
  TARGET_CLEANLINESS_POLICY_ID,
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
  type RepositoryQueryAnswer,
  type RepositoryQueryBudget,
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

import { canonicalPlanningContract } from "./canonical-planning-contract.js";

import type {
  TransitionalDeliveryPort,
  TransitionalLifecycleResult,
  TransitionalPlannerPort
} from "./transitional-unsafe-profile.js";
import {
  createTransitionalUnsafeProfile,
  type CreateTransitionalUnsafeProfileOptions
} from "./transitional-unsafe-profile.js";
import type { SandboxedLiveExecutionProfile } from "./productive-daemon.js";
import { withTransitionalRepositoryLease } from "./transitional-repository-lease.js";

const execFileAsync = promisify(execFile);
const PROVIDER_CAPACITY_PATTERN = /rate.?limit|too many requests|overloaded|capacity|quota/i;

export interface CurrentLifecycleAdapterOptions {
  readonly clock?: () => string;
  readonly planningStepTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
  /**
   * Model seam that lets a gate exercise the downstream execution path from a
   * fixed canonical plan instead of spending a live planning call on it.
   *
   * Named consumer: `tests/stage8-live-codex.test.ts`. Retirement: Stage 11,
   * with the temporary adapters. Leaving it undefined keeps the productive
   * canonical planning proposal, so no productive caller depends on it.
   */
  readonly planningProposal?: (input: PlanningModelInput, view: RepositoryView) => Promise<PlanningModelProposal>;
}

export interface CreateCurrentTransitionalUnsafeProfileOptions
  extends Pick<
    CreateTransitionalUnsafeProfileOptions,
    "stateRoot" | "nodeExecutable" | "workerScriptPath" | "cwd" | "clock"
  > {
  readonly planningStepTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
  readonly planningProposal?: CurrentLifecycleAdapterOptions["planningProposal"];
}

const PRODUCTIVE_REPOSITORY_QUERY_BUDGET: RepositoryQueryBudget = {
  maxResults: 64,
  maxBytes: 64 * 1024,
  maxDepth: 1
};

const PRODUCTIVE_PLANNING_BUDGET = {
  modelCalls: 3,
  repositoryQueries: 3,
  queryBytes: PRODUCTIVE_REPOSITORY_QUERY_BUDGET.maxBytes,
  revisions: 3,
  repairs: 2,
  expansions: 0
} as const;

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface ProductiveRepositoryGrounding {
  snapshot: RepositorySnapshot;
  view: RepositoryView;
  evidence: RepositoryEvidence[];
  queryDigests: string[];
  budget: RepositoryQueryBudget;
}

export interface ProductiveRepositoryView {
  snapshot: RepositorySnapshot;
  view: RepositoryView;
}

export async function buildProductiveRepositoryView(input: {
  rootPath: string;
  targetFingerprint: string;
  baseCommit: string;
}): Promise<ProductiveRepositoryView> {
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
  return { snapshot: inspection.snapshot, view };
}

/** Stage 4 boundary: exact Git facts and bounded queries consumed by the transitional planner. */
export async function buildProductiveRepositoryGrounding(input: {
  rootPath: string;
  targetFingerprint: string;
  baseCommit: string;
  goal: string;
  acceptanceCriteria: readonly string[];
}): Promise<ProductiveRepositoryGrounding> {
  const { snapshot, view } = await buildProductiveRepositoryView(input);
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
    snapshot,
    view,
    evidence: legacyRepositoryEvidence(answers),
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
      ...(options.spawnProcess === undefined ? {} : { spawnProcess: options.spawnProcess }),
      ...(options.planningProposal === undefined ? {} : { planningProposal: options.planningProposal })
    }),
    delivery: createCurrentDeliveryPort(),
    ...(options.clock === undefined ? {} : { clock: options.clock })
  });
}

/**
 * Stage 8 composition retains the daemon effect protocol but marks the only
 * live route as sandboxed. The worker receives an explicit, brokered credential
 * source; no host HOME/USERPROFILE is passed through the process effect.
 */
export function createCurrentSandboxedLiveProfile(
  options: CreateCurrentTransitionalUnsafeProfileOptions & {
    readonly codexCredentialPath?: string;
    /** Opt-in fallback only when elevated native setup is unavailable. */
    readonly codexWindowsSandbox?: "elevated" | "unelevated";
  }
): SandboxedLiveExecutionProfile {
  const transitional = createCurrentTransitionalUnsafeProfile(options);
  return {
    ...transitional,
    kind: "sandboxed_live",
    executionProcess: (definition, context) => {
      if (context === undefined) throw new Error("Sandboxed live execution requires a process attempt identity.");
      const process = transitional.executionProcess(definition, context);
      return {
        ...process,
        env: {
          ...process.env,
          MANYHANDS_STAGE8_SANDBOX: "workspace",
          MANYHANDS_STAGE8_SANDBOX_SCOPE: context.attemptId,
          MANYHANDS_STAGE8_WINDOWS_SANDBOX: options.codexWindowsSandbox ?? "elevated",
          ...(options.codexCredentialPath === undefined
            ? {}
            : { MANYHANDS_CODEX_AUTH_PATH: options.codexCredentialPath })
        }
      };
    }
  };
}

/** Stage 6 planner composition: the daemon produces only SemanticPlan -> GraphRevision. */
export function createCurrentPlannerPort(
  options: CurrentLifecycleAdapterOptions = {}
): TransitionalPlannerPort {
  const now = options.clock ?? (() => new Date().toISOString());
  return {
    async plan({ runId, definition }): Promise<TransitionalLifecycleResult> {
      const repoPath = absoluteTargetPath(definition);
      return withTransitionalRepositoryLease({ repoRoot: repoPath, runId }, async () => {
      const grounding = await buildProductiveRepositoryView({
        rootPath: repoPath,
        targetFingerprint: stringField(definition.targetContext, "fingerprint"),
        baseCommit: stringField(definition.targetContext, "sourceBaseCommit")
      });
      const goal = productGoal(runId, definition, grounding.view);
      const proofStrategies: ReturnType<typeof productProofStrategies> = [];
      let inspection: {
        queryReceipts: readonly string[];
        evidenceRefs: readonly string[];
        repositoryQueries: number;
        queryBytes: number;
      } | undefined;
      const planner = new PlanningEngine({
        model: {
          propose: async (request): Promise<PlanningModelProposal> => {
            const proposal = options.planningProposal === undefined
              ? await canonicalPlanningProposal({
                  cwd: repoPath,
                  selection: definition.planningSelection,
                  request,
                  view: grounding.view,
                  proofStrategies,
                  ...(options.planningStepTimeoutMs === undefined
                    ? {}
                    : { timeoutMs: options.planningStepTimeoutMs }),
                  ...(options.spawnProcess === undefined ? {} : { spawnProcess: options.spawnProcess })
                })
              : await options.planningProposal(request, grounding.view);
            if (proposal.kind !== "candidate") return proposal;
            if (!SemanticPlanMaterialSchema.safeParse(proposal.material).success) return proposal;
            const bound = bindProductProofStrategies(proposal.material, request.goal, grounding.view);
            proofStrategies.splice(0, proofStrategies.length, ...bound.proofStrategies);
            return { kind: "candidate", material: bound.material };
          }
        },
        repository: {
          inspect: async ({ allowance }) => {
            inspection = inspectProductivePlanningRepository({
              rootPath: repoPath,
              view: grounding.view,
              goal: definition.userPrompt,
              acceptanceCriteria: definition.acceptanceCriteria,
              allowance
            });
            return { ...inspection, missingCapabilities: [] };
          }
        },
        hasher: sha256
      });
      const result = await planner.plan({
        goal,
        repositoryView: grounding.view,
        proofStrategies,
        budget: PRODUCTIVE_PLANNING_BUDGET
      }, new AbortController().signal);
      const baseEvents: RunEventInput[] = [
        fact(`repository:${grounding.snapshot.snapshotId}:inspection`, now(), "repository.inspected", {
          snapshotId: grounding.snapshot.snapshotId,
          disposition: grounding.snapshot.inspectionDisposition,
          snapshot: asRecord(grounding.snapshot),
          repositoryModelDigest: grounding.view.model.digest,
          repositoryView: {
            digest: grounding.view.digest,
            treeSha: grounding.view.treeSha,
            resourceCatalogDigest: grounding.view.resourceCatalogDigest
          },
          queryDigests: [...(inspection?.queryReceipts ?? [])]
        })
      ];
      if (result.kind !== "ready") {
        return {
          events: [...baseEvents, ...nonReadyPlanningEvents(runId, result, now)]
        };
      }
      const compiled = compilePlan({
        plan: result.plan,
        goal,
        proofStrategies,
        repositoryView: grounding.view,
        hasher: sha256,
        idFactory: (kind, parts) => stableId(kind, parts.join(":"))
      });
      if (!compiled.ok) {
        return {
          events: [...baseEvents, fact(`planning:${runId}:failed`, now(), "planning.failed", {
            reason: compiled.findings.map(({ code, message }) => `${code}: ${message}`).join(" | ")
          })]
        };
      }
      const graph = compiled.graph;
      const decisionId = `approve-plan:${graph.graphId}:r${graph.revision}`;
      return {
        events: [
          ...baseEvents,
          fact(`planning:${result.plan.id}:completed:${runId}`, now(), "planning.completed", {
            semanticPlan: asRecord(result.plan),
            trace: asRecord(result.trace)
          }),
          fact(`graph:${graph.graphId}:r${graph.revision}:compiled`, now(), "graph.compiled", {
            graphId: graph.graphId,
            revision: graph.revision,
            graph: asRecord(graph),
            contracts: Object.values(compiled.contracts.taskBundles).map(asRecord),
            evidenceAuthority: {
              goal: asRecord(goal),
              validationObligations: Object.values(compiled.contracts.validationObligations).map(asRecord),
              proofStrategies: Object.values(compiled.contracts.proofStrategies).map(asRecord)
            },
            review: { findings: result.trace.advisoryFindings.map(asRecord) },
            trace: asRecord(result.trace)
          }),
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
            // Recovery runs before the pre-flight inspection, so it is where a
            // target that is neither the approved head nor the delivered
            // candidate is named. Returning `undefined` there would fall
            // through to a publish attempt and report the divergence as prose.
            recover: async (request) => {
              const [branch, head] = await Promise.all([
                git(repoRoot, ["symbolic-ref", "--short", "HEAD"]),
                git(repoRoot, ["rev-parse", "HEAD"])
              ]);
              if (
                branch !== request.targetBranch
                || request.targetFingerprint !== stringField(definition.targetContext, "fingerprint")
              ) {
                return undefined;
              }
              if (head === request.finalSha) {
                await reconcileDeliveredWorkingTree(repoRoot, request);
                return deliveryReceipt(repoRoot, request, head);
              }
              if (head === request.targetHead) return undefined;
              throw new DeliveryRecoveryError({
                kind: "target_divergence",
                ref: `refs/heads/${request.targetBranch}`,
                expectedOid: request.targetHead,
                actualOid: head
              });
            },
            publish: async (request) => {
              const [branch, head, status] = await Promise.all([
                git(repoRoot, ["symbolic-ref", "--short", "HEAD"]),
                git(repoRoot, ["rev-parse", "HEAD"]),
                git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])
              ]);
              if (
                branch !== request.targetBranch
                || request.targetFingerprint !== stringField(definition.targetContext, "fingerprint")
              ) {
                throw new Error(
                  "The delivery target changed immediately before publication; nothing was published."
                );
              }
              if (!targetWorkingTreeIsClean(status)) {
                throw new Error("The delivery target is dirty; nothing was published.");
              }
              if (head !== request.targetHead) {
                throw new DeliveryRecoveryError({
                  kind: "target_divergence",
                  ref: `refs/heads/${request.targetBranch}`,
                  expectedOid: request.targetHead,
                  actualOid: head
                });
              }
              // One conditional write. `merge --ff-only` accepted any head the
              // candidate was reachable from, so a branch that advanced to an
              // ancestor nobody approved was delivered onto and the receipt
              // still claimed the approved head.
              await git(repoRoot, [
                "update-ref",
                `refs/heads/${request.targetBranch}`,
                request.finalSha,
                request.targetHead
              ]);
              await reconcileDeliveredWorkingTree(repoRoot, request);
              const deliveredHead = await git(repoRoot, ["rev-parse", "HEAD"]);
              if (deliveredHead !== request.finalSha) {
                throw new Error("Delivery did not publish the approved final SHA.");
              }
              return deliveryReceipt(repoRoot, request, deliveredHead);
            }
          }
        });
        const receipt = await publisher.publish(approval);
        return { ...receipt, destination: approval.targetBranch };
      });
    }
  };
}

/**
 * Bring the checked-out target to the delivered commit.
 *
 * The ref update moves the branch without touching the index or the working
 * tree, so between the two the checkout still holds the approved head. Only
 * that state may be absorbed: a tree carrying anything else is work this
 * delivery cannot describe, and resetting would destroy it.
 */
async function reconcileDeliveredWorkingTree(
  repoRoot: string,
  request: TransactionalDeliveryApproval
): Promise<void> {
  const status = await git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (targetWorkingTreeIsClean(status)) return;
  const drift = await git(repoRoot, ["diff", "--name-only", request.targetHead]);
  if (drift !== "") {
    throw new DeliveryRecoveryError({
      kind: "unrecoverable_external_effect",
      effectId: request.idempotencyKey,
      detail: `the working tree of ${repoRoot} holds changes that are neither the approved head nor the delivered candidate`
    });
  }
  await git(repoRoot, ["reset", "--hard", request.finalSha]);
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

/**
 * The receipt names what the target holds, not only which SHA was published.
 * The tree is read from the repository after the write rather than copied from
 * the approval, so the receipt attests an observation instead of an intention.
 */
async function deliveryReceipt(
  repoRoot: string,
  approval: TransactionalDeliveryApproval,
  targetHeadAfter: string
): Promise<TransactionalDeliveryReceipt> {
  return {
    receiptId: `delivery:${approval.idempotencyKey}`,
    requestFingerprint: deliveryRequestFingerprint(approval),
    manifestId: approval.manifestId,
    finalSha: approval.finalSha,
    targetBranch: approval.targetBranch,
    targetHeadBefore: approval.targetHead,
    targetHeadAfter,
    deliveredTreeSha: await git(repoRoot, ["rev-parse", `${targetHeadAfter}^{tree}`]),
    cleanlinessPolicyId: TARGET_CLEANLINESS_POLICY_ID,
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
    || receipt.deliveredTreeSha === undefined
    || receipt.cleanlinessPolicyId === undefined
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
    deliveredTreeSha: receipt.deliveredTreeSha,
    cleanlinessPolicyId: receipt.cleanlinessPolicyId,
    disposition: "delivered",
    confirmed: true
  };
}

function productGoal(
  runId: string,
  definition: ProductRunDefinition,
  view: RepositoryView
) {
  const criteria = definition.acceptanceCriteria.length > 0
    ? definition.acceptanceCriteria
    : [definition.userPrompt];
  return buildGoalContract({
    id: `goal:${runId}`,
    revision: 1,
    goal: definition.userPrompt,
    acceptanceCriteria: criteria.map((statement, index) => ({
      id: `criterion:${runId}:${index + 1}`,
      statement,
      required: true,
      level: "product" as const,
      protectedReferences: [],
      verification: {
        allowedProofs: [{ mode: "executable" as const, authority: "orchestrator_deterministic" as const }],
        independence: "independent_required" as const
      }
    })),
    constraints: [],
    qualityAttributes: [],
    target: {
      repositoryId: view.model.repositoryId,
      baseCommit: view.model.baseCommit,
      treeSha: view.treeSha
    }
  }, sha256);
}

function productProofStrategies(
  goal: ReturnType<typeof productGoal>,
  view: RepositoryView
) {
  return goal.acceptanceCriteria.map((criterion) => buildProofStrategy({
    id: `proof:${criterion.id}`,
    revision: 1,
    goalContractDigest: goal.digest,
    criterionId: criterion.id,
    obligationId: `validation:${criterion.id}`,
    mode: "executable",
    authority: "orchestrator_deterministic",
    repositoryViewDigest: view.digest,
    procedureRef: "command:stage6-transitional-validation",
    environmentPolicyDigest: "sha256:stage6-transitional-environment",
    independence: "independent_required"
  }, sha256));
}

/**
 * The provider may propose responsibility boundaries, never proof authority.
 * This adapter derives the exact allowed executable strategy for each declared
 * validation obligation before the PlanningEngine verifies the candidate.
 */
export function bindProductProofStrategies(
  material: SemanticPlanMaterial,
  goal: ReturnType<typeof productGoal>,
  view: RepositoryView
): { material: SemanticPlanMaterial; proofStrategies: ReturnType<typeof productProofStrategies> } {
  const normalized = structuredClone(material) as SemanticPlanMaterial;
  const criteria = new Map<string, string>();
  for (const unit of Object.values(normalized.units)) {
    for (const criterion of unit.criteria) criteria.set(criterion.criterionId, criterion.sourceCriterionId);
  }
  const rootCriterion = (criterionId: string): string | undefined => {
    const visited = new Set<string>();
    let current = criterionId;
    while (!goal.acceptanceCriteria.some(({ id }) => id === current)) {
      if (visited.has(current)) return undefined;
      visited.add(current);
      const source = criteria.get(current);
      if (source === undefined) return undefined;
      current = source;
    }
    return current;
  };
  const bindings = new Map<string, { criterionId: string; obligationId: string; selectorDigest?: string }>();
  for (const unit of Object.values(normalized.units)) {
    unit.validation.forEach((validation) => {
      validation.proofStrategyId = `proof:${validation.obligationId}`;
      const criterionId = rootCriterion(validation.criterionId);
      if (criterionId !== undefined) bindings.set(validation.obligationId, {
        criterionId,
        obligationId: validation.obligationId,
        ...(validation.evidence === undefined ? {} : { selectorDigest: selectorDigestForValidation(validation.evidence.references) })
      });
    });
    if (unit.integration !== undefined) {
      unit.integration.proofStrategyId = `proof:${unit.integration.obligationId}`;
      const criterionId = unit.integration.criterionIds.map(rootCriterion).find((value) => value !== undefined);
      // The verifier requires the integration obligation to also be one of the
      // unit's validation obligations, so the loop above has already bound it
      // together with the evidence selectors that make its proof exact.
      // Rebinding it here dropped that selector digest and left the composite
      // unable to bind exact evidence.
      if (criterionId !== undefined && !bindings.has(unit.integration.obligationId)) {
        bindings.set(unit.integration.obligationId, { criterionId, obligationId: unit.integration.obligationId });
      }
    }
  }
  const proofStrategies = [...bindings.values()]
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId))
    .map(({ criterionId, obligationId, selectorDigest }) => buildProofStrategy({
      id: `proof:${obligationId}`,
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId,
      obligationId,
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: view.digest,
      procedureRef: "command:stage6-transitional-validation",
      ...(selectorDigest === undefined ? {} : { selectorDigest }),
      environmentPolicyDigest: "sha256:stage6-transitional-environment",
      independence: "independent_required"
    }, sha256));
  return { material: normalized, proofStrategies };
}

function selectorDigestForValidation(references: readonly string[]): string {
  return sha256(JSON.stringify([...references].sort()));
}

function inspectProductivePlanningRepository(input: {
  rootPath: string;
  view: RepositoryView;
  goal: string;
  acceptanceCriteria: readonly string[];
  allowance: { repositoryQueries: number; queryBytes: number };
}) {
  const query = createRepositoryQuery({ rootPath: input.rootPath, view: input.view });
  const count = Math.min(3, input.allowance.repositoryQueries);
  const budget: RepositoryQueryBudget = {
    maxResults: PRODUCTIVE_REPOSITORY_QUERY_BUDGET.maxResults,
    maxBytes: Math.max(1, Math.floor(input.allowance.queryBytes / count)),
    maxDepth: PRODUCTIVE_REPOSITORY_QUERY_BUDGET.maxDepth
  };
  const anchor = input.view.model.packages.find(({ rootPath }) => rootPath === "")
    ?? input.view.model.packages[0];
  const answers = [
    query.searchGoalTerms(repositoryGoalTerms([input.goal, ...input.acceptanceCriteria]), budget),
    ...(count < 2 || anchor === undefined ? [] : [query.inspectBoundary(`package:${anchor.rootPath || "."}`, budget)]),
    ...(count < 3 ? [] : [query.validationCapabilities(budget)])
  ];
  return {
    queryReceipts: answers.map(({ digest }) => digest),
    evidenceRefs: [...new Set(answers.flatMap(({ evidenceRefs }) => evidenceRefs))].sort(),
    repositoryQueries: answers.length,
    queryBytes: answers.reduce((total, answer) => total + answer.cost.bytes, 0)
  };
}

async function canonicalPlanningProposal(input: {
  cwd: string;
  selection: ProductRunDefinition["planningSelection"];
  request: PlanningModelInput;
  view: RepositoryView;
  proofStrategies: ReturnType<typeof productProofStrategies>;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}): Promise<PlanningModelProposal> {
  const output = await invokePlanningCli({
    cwd: input.cwd,
    selection: input.selection,
    prompt: canonicalPlanningPrompt(input.request, input.view),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.spawnProcess === undefined ? {} : { spawnProcess: input.spawnProcess })
  });
  const proposal = parseCanonicalPlanningProposal(output, input.request, input.view);
  if (proposal.kind === "candidate") {
    // The PlanningEngine owns schema-invalid proposal repair. Binding proof
    // strategies first would dereference model-shaped data and turn a normal
    // repairable finding into a daemon effect crash.
    if (!SemanticPlanMaterialSchema.safeParse(proposal.material).success) return proposal;
    const bound = bindProductProofStrategies(proposal.material, input.request.goal, input.view);
    input.proofStrategies.splice(0, input.proofStrategies.length, ...bound.proofStrategies);
    return { kind: "candidate", material: bound.material };
  }
  return proposal;
}

/**
 * Exported for the regression that pins non-JSON handling.
 *
 * A model that answers in prose is a protocol violation, not a crash. The
 * PlanningEngine already rejects a non-conforming proposal as
 * `model_protocol_invalid` and records it as a terminal finding; throwing here
 * skipped that path entirely and escaped as an effect-adapter exception.
 */
export function parseCanonicalPlanningProposal(
  output: string,
  request: PlanningModelInput,
  view: RepositoryView
): PlanningModelProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(output)) as unknown;
  } catch {
    // Deliberately not a PlanningModelProposal: the engine turns an
    // unsupported result kind into `model_protocol_invalid` with the model's
    // own output preserved in the trace.
    return { kind: "model_protocol_invalid", output: output.slice(0, 2_000) } as unknown as PlanningModelProposal;
  }
  const envelope = objectRecord(parsed);
  const proposal = envelope.kind === "candidate" && "material" in envelope
    ? envelope.material
    : envelope.canonicalMaterialJson !== undefined && typeof envelope.canonicalMaterialJson === "string"
      ? JSON.parse(envelope.canonicalMaterialJson) as unknown
      : parsed;
  if (envelope.kind === "needs_input" && Array.isArray(envelope.decisions)) {
    return { kind: "needs_input", decisions: envelope.decisions as never };
  }
  if (envelope.kind === "ambiguous" && Array.isArray(envelope.decisions) && Array.isArray(envelope.alternatives)) {
    return {
      kind: "ambiguous",
      decisions: envelope.decisions as never,
      alternatives: envelope.alternatives as never
    };
  }
  const material = bindSystemOwnedProofStrategies(objectRecord(proposal));
  return {
    kind: "candidate",
    material: {
      ...material,
      id: `plan:${request.goal.id}`,
      revision: 1,
      goalContract: { id: request.goal.id, revision: request.goal.revision, digest: request.goal.digest },
      repositorySnapshot: { ...view.model.snapshot },
      repositoryView: {
        digest: view.digest,
        treeSha: view.treeSha,
        resourceCatalogDigest: view.catalog.digest
      },
      evidence: structuredClone(view.model.evidence)
    } as SemanticPlanMaterial
  };
}

/**
 * Exported for `tests/planning-prompt-canonical-contract.test.ts`, which proves
 * the embedded example is a plan the schema accepts.
 */
/**
 * `bindProductProofStrategies` rewrites every `proofStrategyId` to
 * `proof:<obligationId>` regardless of what the model proposed, so the field is
 * the system's, not the model's. Demanding it only adds an invented identifier
 * that the schema can reject before the binding ever runs.
 */
function bindSystemOwnedProofStrategies(material: Record<string, unknown>): Record<string, unknown> {
  const units = material.units;
  if (typeof units !== "object" || units === null) return material;
  for (const unit of Object.values(units as Record<string, unknown>)) {
    if (typeof unit !== "object" || unit === null) continue;
    const record = unit as Record<string, unknown>;
    if (Array.isArray(record.validation)) for (const obligation of record.validation) bindProofStrategyId(obligation);
    bindProofStrategyId(record.integration);
  }
  return material;
}

function bindProofStrategyId(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record.obligationId !== "string") return;
  record.proofStrategyId = `proof:${record.obligationId}`;
}

export function canonicalPlanningPrompt(request: PlanningModelInput, view: RepositoryView): string {
  const resources = Object.values(view.catalog.resources)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 64)
    .map((resource) => `${resource.id} ${resource.canonicalLocator}`)
    .join("\n");
  const validationCommands = view.model.commands
    .filter(({ name }) => /^(?:test|typecheck|lint|build|check|verify)(?::|$)/u.test(name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, command }) => `${name}: ${command}`)
    .join("\n");
  const criteria = request.goal.acceptanceCriteria.map((criterion) =>
    `${criterion.id}: ${criterion.statement}`
  ).join("\n");
  return [
    "Decompose the goal into a canonical plan. Answer with JSON only, no prose and no code fence.",
    canonicalPlanningContract(),
    `Goal:\n${request.goal.goal}`,
    `Criteria:\n${criteria}`,
    `Resources:\n${resources}`,
    `Validation commands:\n${validationCommands}`,
    `Evidence references:\n${request.evidenceRefs.join("\n")}`,
    request.previousFindings.length === 0 ? "" : `Repair findings:\n${request.previousFindings.map(({ code, message }) => `${code}: ${message}`).join("\n")}`
  ].filter(Boolean).join("\n\n");
}

function nonReadyPlanningEvents(
  runId: string,
  result: Exclude<PlanningResult, { kind: "ready" }>,
  now: () => string
): RunEventInput[] {
  if (result.kind === "needs_input" || result.kind === "ambiguous") {
    return result.decisions.map((decision) => fact(`planning:${runId}:decision:${decision.id}`, now(), "decision.raised", {
      decision: {
        id: decision.id,
        kind: "resolve_conflict",
        question: decision.question,
        options: decision.options.map((option) => ({ id: option.id, label: option.label })),
        affectedNodeIds: [],
        evidenceRefs: [...decision.evidenceRefs],
        impact: "acceptance"
      }
    }));
  }
  const findings = result.kind === "unsupported" || result.kind === "rejected" ? result.findings : [];
  return [fact(`planning:${runId}:failed`, now(), "planning.failed", {
    // The sentence stays: anything that only knows how to show a reason still
    // works. The findings travel beside it so a reader does not have to parse
    // prose to learn which of seven things went wrong.
    reason: findings.map(({ code, message }) => `${code}: ${message}`).join(" | ") || result.kind,
    ...(findings.length === 0 ? {} : {
      findings: findings.map(({ code, message, severity, evidenceRefs }) => ({
        code,
        message,
        severity: severity === "error" ? "error" as const : severity === "warning" ? "warning" as const : "advisory" as const,
        evidenceRefs: [...evidenceRefs]
      }))
    })
  })];
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Planning model must return a JSON object.");
  }
  return value as Record<string, unknown>;
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

async function invokePlanningCli(input: {
  cwd: string;
  selection: ProductRunDefinition["planningSelection"];
  prompt: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}): Promise<string> {
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
    child.stdin?.end(input.prompt);
  });
}

function legacyRepositoryEvidence(answers: readonly RepositoryQueryAnswer[]): RepositoryEvidence[] {
  const evidence = new Map<string, RepositoryEvidence>();
  for (const answer of answers) {
    const confidence = legacyEvidenceConfidence(answer.epistemic);
    for (const item of answer.items) {
      for (const evidenceRef of item.evidenceRefs) {
        const candidate: RepositoryEvidence = {
          id: evidenceRef,
          kind: legacyEvidenceKind(item),
          reference: legacyEvidenceReference(item),
          observation: item.summary,
          confidence
        };
        const existing = evidence.get(evidenceRef);
        if (existing === undefined || candidate.confidence < existing.confidence) {
          evidence.set(evidenceRef, candidate);
        }
      }
    }
  }
  return [...evidence.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function legacyEvidenceConfidence(epistemic: RepositoryQueryAnswer["epistemic"]): number {
  if (epistemic.state === "known") return epistemic.confidence === "high" ? 1 : epistemic.confidence === "medium" ? 0.8 : 0.6;
  if (epistemic.state === "partial") return epistemic.confidence === "high" ? 0.7 : epistemic.confidence === "medium" ? 0.5 : 0.3;
  if (epistemic.state === "conflicting") return 0.2;
  return 0;
}

function legacyEvidenceKind(item: RepositoryQueryAnswer["items"][number]): RepositoryEvidence["kind"] {
  if (item.kind === "symbol") return "symbol";
  if (item.kind === "command") return "script";
  if (item.kind === "diagnostic") return "diagnostic";
  return "path";
}

function legacyEvidenceReference(item: RepositoryQueryAnswer["items"][number]): string {
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

function codexPlanningArgs(selection: ProductRunDefinition["planningSelection"]): string[] {
  return [
    "exec", "--model", selection.model,
    "--sandbox", "read-only",
    "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
    ...(selection.effort === undefined ? [] : ["-c", `model_reasoning_effort="${selection.effort}"`]),
    "-"
  ];
}

/**
 * The object inside a markdown code fence, when the model formatted its answer.
 *
 * Claude Code answers with fenced JSON often enough that rejecting a fence made
 * planning fail intermittently against an otherwise correct proposal. Only the
 * first fenced block is considered, and unfenced output is returned untouched
 * so a genuine protocol violation still reads as one.
 */
function unfence(output: string): string {
  const fenced = /```[a-zA-Z0-9_-]*([\s\S]*?)```/u.exec(output);
  return fenced?.[1]?.trim() ?? output;
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
  const { stdout } = await execFileAsync("git", safeGitArgs(repoRoot, args, "delivery_target"), {
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
