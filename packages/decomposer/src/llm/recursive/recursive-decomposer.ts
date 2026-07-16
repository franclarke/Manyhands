import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentTaskContract,
  ExecutionValidationCommand,
  InterfaceContract
} from "@manyhands/contracts";
import {
  getLeafNodes,
  validateTaskGraph,
  type TaskDependency,
  type TaskGraph,
  type TaskGranularityLevel,
  type TaskNode
} from "@manyhands/task-graph";
import type { ZodError, ZodIssue } from "zod";

import { executionScopeFromAllowed } from "../../scope";
import {
  DecompositionOptionsSchema,
  FeatureRequestSchema,
  type Decomposer,
  type DecompositionMetadata,
  type DecompositionMode,
  type DecompositionOptions,
  type DecompositionResult,
  type FeatureRequest
} from "../../index";
import type { AnthropicLike } from "../anthropic-decomposer";
import {
  DecomposerLlmError,
  DecomposerQuestionError,
  classifyGraphGenerationError,
  type GraphGenerationErrorDetails,
  type GraphGenerationErrorKind
} from "../errors";
import {
  RECURSIVE_DECOMPOSER_PROMPT_VERSION,
  buildStepPrompt,
  type Aggressiveness
} from "./step-prompt";
import {
  DecomposeStepOutputSchema,
  type DecomposeStepOutput,
  type StepInterface
} from "./step-schema";
import { parseJsonObjectCandidates, type ParsedJsonObjectCandidate } from "./json";

/**
 * Mirror the canonical edge list onto each node's `dependencies` shortcut.
 * `graph.dependencies` stays canonical; consumers that read `node.dependencies`
 * (UI, readiness, schedulers) require it to match. The edge from→to means `from`
 * is the prerequisite, so it is appended to `node[to].dependencies`.
 */
function syncNodeDependencyShortcuts(
  nodes: Record<string, TaskNode>,
  dependencies: readonly TaskDependency[]
): void {
  for (const dep of dependencies) {
    const target = nodes[dep.toTaskId];
    if (target !== undefined && !target.dependencies.includes(dep.fromTaskId)) {
      target.dependencies.push(dep.fromTaskId);
    }
  }
}

const DEFAULT_DEPTH_BUDGET = 5;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_PARALLEL_STEPS = 3;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COST_USD = 1.5;
const DEFAULT_STEP_MAX_ATTEMPTS = 3;
const DEFAULT_STEP_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_STEP_RETRY_MAX_DELAY_MS = 2_000;
const ROOT_ID = "root";

export interface RecursiveDecomposerOptions {
  apiKey?: string;
  model: string;
  /** Inject a custom client (tests). */
  client?: AnthropicLike;
  maxTokens?: number;
  userPrompt: string;
  /** Bias on the atomicity threshold. Defaults from the run granularity if omitted. */
  aggressiveness?: Aggressiveness;
  /** Safety rail against runaway recursion (NOT the experimental variable). */
  depthBudget?: number;
  /** Maximum recursive child planning calls that may run at once. Defaults to 3. */
  maxParallelSteps?: number;
  maxChildrenPerNode?: number;
  maxDecomposerCalls?: number;
  workspaceHints?: string;
  promptTemplateVersion?: string;
  /** Total attempts per node, including the first call. Defaults to 3. */
  maxStepAttempts?: number;
  /** Base delay for bounded exponential backoff between failed attempts. */
  stepRetryBaseDelayMs?: number;
  /** Maximum retry delay for a single node attempt. */
  stepRetryMaxDelayMs?: number;
  /**
   * Opt-in only: materialize failed non-root nodes as generic atomic leaves.
   * Product runs keep this false to preserve D3 (LLM failure fails the run).
   */
  allowNonRootFallback?: boolean;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  onStepStatus?: RecursiveStepListener<RecursiveStepStatusEvent>;
}

export type RecursiveStepListener<T> = (event: T) => void | Promise<void>;

export type RecursiveStepPlanningState =
  | "pending"
  | "generating"
  | "generated"
  | "failed"
  | "retrying"
  | "fallback";

export interface RecursiveStepStartedEvent {
  nodeId: string;
  parentId: string | null;
  title: string;
  goal: string;
  depth: number;
  depthBudget: number;
}

export interface RecursiveStepCompletedEvent extends RecursiveStepStartedEvent {
  decision: DecomposeStepOutput["decision"];
  childIds: string[];
  children: RecursiveStepChildEvent[];
  attemptCount: number;
  state: Extract<RecursiveStepPlanningState, "generated" | "fallback">;
  error?: GraphGenerationErrorDetails | undefined;
}

export interface RecursiveStepStatusEvent extends RecursiveStepStartedEvent {
  state: RecursiveStepPlanningState;
  attempt?: number | undefined;
  maxAttempts?: number | undefined;
  durationMs?: number | undefined;
  error?: GraphGenerationErrorDetails | undefined;
}

export interface RecursiveStepChildEvent {
  nodeId: string;
  parentId: string;
  title: string;
  goal: string;
  depth: number;
  depthBudget: number;
}

interface ExpandContext {
  nodeId: string;
  parentId: string | null;
  title: string;
  goal: string;
  depth: number;
  depthBudget: number;
  /** Seams in scope this node may consume (defined by ancestors). */
  inheritedInterfaces: InterfaceContract[];
  /** Interface ids this node consumes / produces (from the parent's wiring). */
  consumes: string[];
  produces: string[];
  isRoot: boolean;
}

export interface StepResolution {
  step: DecomposeStepOutput;
  attemptCount: number;
  state: Extract<RecursiveStepPlanningState, "generated" | "fallback">;
  error?: GraphGenerationErrorDetails | undefined;
}


interface Accumulator {
  nodes: Record<string, TaskNode>;
  contracts: AgentTaskContract[];
  dependencies: TaskDependency[];
  feature: FeatureRequest;
  granularity: TaskGranularityLevel;
  callCount: number;
  reservedNodeIds: Set<string>;
  questionAnswers?: Record<string, string> | undefined;
  stepCache?: Record<string, any> | undefined;
}

/**
 * Interface-aware recursive decomposer.
 *
 * Walks the task top-down, asking the LLM one local question per node: is it
 * atomic, or should it split? When it splits, the LLM also defines the shared
 * interfaces (seams) the children build against, and wires each child's
 * consumes/produces to those seams. Different branches reach different depths
 * — the tree mirrors real complexity rather than a uniform target. Compared to
 * the single-pass `AnthropicDecomposer`, the local decisions reduce variance
 * and the explicit seams let parallel leaves compose without colliding. See
 * docs/design/decomposer-composer-redesign.md.
 */
export class RecursiveDecomposer implements Decomposer {
  private readonly client: AnthropicLike;
  public readonly model: string;
  private readonly maxTokens: number;
  private readonly userPrompt: string;
  private readonly aggressivenessOverride?: Aggressiveness;
  private readonly depthBudget: number;
  private readonly maxParallelSteps: number;
  private readonly maxChildrenPerNode: number;
  private readonly maxDecomposerCalls: number;
  private readonly workspaceHints?: string;
  private readonly maxStepAttempts: number;
  private readonly stepRetryBaseDelayMs: number;
  private readonly stepRetryMaxDelayMs: number;
  private readonly allowNonRootFallback: boolean;
  private readonly onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  private readonly onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  private readonly onStepStatus?: RecursiveStepListener<RecursiveStepStatusEvent>;
  public readonly promptTemplateVersion: string;

  constructor(options: RecursiveDecomposerOptions) {
    if (options.client === undefined && (options.apiKey === undefined || options.apiKey.length === 0)) {
      throw new DecomposerLlmError("RecursiveDecomposer requires an apiKey or an injected client", undefined, "request");
    }
    this.client = options.client ?? createAnthropicClient(options.apiKey as string);
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.userPrompt = options.userPrompt;
    if (options.aggressiveness !== undefined) {
      this.aggressivenessOverride = options.aggressiveness;
    }
    this.depthBudget = options.depthBudget ?? DEFAULT_DEPTH_BUDGET;
    this.maxParallelSteps = normalizeParallelism(options.maxParallelSteps);
    this.maxChildrenPerNode = normalizePositiveInteger(options.maxChildrenPerNode, 24);
    this.maxDecomposerCalls = normalizePositiveInteger(options.maxDecomposerCalls, 500);
    if (options.workspaceHints !== undefined) {
      this.workspaceHints = options.workspaceHints;
    }
    this.maxStepAttempts = normalizePositiveInteger(options.maxStepAttempts, DEFAULT_STEP_MAX_ATTEMPTS);
    this.stepRetryBaseDelayMs = normalizeNonNegativeInteger(
      options.stepRetryBaseDelayMs,
      DEFAULT_STEP_RETRY_BASE_DELAY_MS
    );
    this.stepRetryMaxDelayMs = normalizeNonNegativeInteger(
      options.stepRetryMaxDelayMs,
      DEFAULT_STEP_RETRY_MAX_DELAY_MS
    );
    this.allowNonRootFallback = options.allowNonRootFallback === true;
    if (options.onStepStarted !== undefined) {
      this.onStepStarted = options.onStepStarted;
    }
    if (options.onStepCompleted !== undefined) {
      this.onStepCompleted = options.onStepCompleted;
    }
    if (options.onStepStatus !== undefined) {
      this.onStepStatus = options.onStepStatus;
    }
    this.promptTemplateVersion = options.promptTemplateVersion ?? RECURSIVE_DECOMPOSER_PROMPT_VERSION;
  }

  async decompose(input: FeatureRequest, options: DecompositionOptions = {}): Promise<DecompositionResult> {
    const feature = FeatureRequestSchema.parse(input);
    const parsedOptions = DecompositionOptionsSchema.parse(options);
    const mode: DecompositionMode = parsedOptions.mode;
    const aggressiveness = this.aggressivenessOverride ?? modeToAggressiveness(mode);
    const generatedAt = parsedOptions.generatedAt ?? new Date().toISOString();

    const accum: Accumulator = {
      nodes: {},
      contracts: [],
      dependencies: [],
      feature,
      granularity: aggressivenessToGranularity(aggressiveness),
      callCount: 0,
      reservedNodeIds: new Set([ROOT_ID]),
      questionAnswers: options.questionAnswers,
      stepCache: options.stepCache ? { ...options.stepCache } : {}
    };

    await this.expand(
      {
        nodeId: ROOT_ID,
        parentId: null,
        title: feature.title,
        goal: feature.description,
        depth: 0,
        depthBudget: this.depthBudget,
        inheritedInterfaces: [],
        consumes: [],
        produces: [],
        isRoot: true
      },
      accum,
      aggressiveness
    );

    const graph: TaskGraph = {
      id: `${feature.id}:${aggressiveness}:graph`,
      planId: `${feature.id}:${aggressiveness}:plan`,
      repo: parsedOptions.repo ?? feature.repositoryPath ?? "manyhands-workspace",
      baseBranch: parsedOptions.baseBranch,
      baseCommit: parsedOptions.baseCommit,
      featureRequest: feature.title,
      nodes: accum.nodes,
      dependencies: accum.dependencies,
      rootId: ROOT_ID,
      createdAt: generatedAt
    };

    syncNodeDependencyShortcuts(graph.nodes, graph.dependencies);

    const issues = validateTaskGraph(graph).map((issue) => `${issue.code}: ${issue.message}`);
    if (issues.length > 0) {
      const details: GraphGenerationErrorDetails = {
        kind: "graph_invalid",
        stage: "normalize",
        recoverable: false,
        message: `Recursive decomposition produced an invalid graph: ${issues.join("; ")}`
      };
      throw new DecomposerLlmError(
        details.message,
        undefined,
        "normalize",
        details
      );
    }

    const metadata: DecompositionMetadata = {
      mode,
      generatedAt,
      decomposer: `recursive:${this.model}:${aggressiveness}`,
      deterministic: false
    };

    return {
      feature,
      graph,
      contracts: accum.contracts,
      metadata,
      validation: { graphValid: true, contractValid: true, issues: [] }
    };
  }

  /**
   * Run a single step of the recursive decomposer for a specific node context.
   */
  public async executeStep(
    ctx: {
      nodeId: string;
      parentId: string | null;
      title: string;
      goal: string;
      depth: number;
      depthBudget: number;
      inheritedInterfaces: InterfaceContract[];
      consumes: string[];
      produces: string[];
      isRoot: boolean;
    },
    aggressiveness: Aggressiveness,
    accum: {
      stepCache?: Record<string, any>;
      questionAnswers?: Record<string, string>;
      callCount: number;
    }
  ): Promise<StepResolution> {
    return this.callStep(ctx, aggressiveness, accum as Accumulator);
  }

  /**
   * Reconstructs the TaskGraph and AgentTaskContracts from a stepCache.
   */
  public reconstructGraph(
    feature: FeatureRequest,
    stepCache: Record<string, any>,
    questionAnswers?: Record<string, string>,
    repoSpec?: { repo: string; baseBranch?: string; baseCommit?: string; createdAt?: string }
  ): { graph: TaskGraph; contracts: AgentTaskContract[] } {
    const aggressiveness = this.aggressivenessOverride ?? "medium";
    const accum: Accumulator = {
      nodes: {},
      contracts: [],
      dependencies: [],
      feature,
      granularity: aggressivenessToGranularity(aggressiveness),
      callCount: 0,
      reservedNodeIds: new Set([ROOT_ID]),
      questionAnswers,
      stepCache
    };

    const traverse = (ctx: ExpandContext) => {
      const step = stepCache[ctx.nodeId];
      if (!step) {
        // Not yet decomposed/atomic — materialize as a planned leaf placeholder
        this.materializeAtomic(ctx, accum, undefined);
        return;
      }

      if (step.decision === "question") {
        // Materialize as planned leaf placeholder since it's waiting for clarification
        this.materializeAtomic(ctx, accum, undefined);
        return;
      }

      if (step.decision === "atomic") {
        this.materializeAtomic(ctx, accum, step);
        return;
      }

      // decision === "decompose"
      const newInterfaces = step.sharedInterfaces.map((iface: any) =>
        toInterfaceContract(iface, ctx.nodeId)
      );
      const pool = [...ctx.inheritedInterfaces, ...newInterfaces];
      const childIds = step.children.map((child: any) => child.id);
      
      // Register self node
      const selfNode: TaskNode = {
        id: ctx.nodeId,
        parentId: ctx.parentId,
        kind: ctx.isRoot ? "root" : "composite",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: ctx.depth,
        childrenIds: childIds,
        dependencies: [],
        metadata: { authoredBy: "ai" }
      };
      accum.nodes[ctx.nodeId] = selfNode;

      for (const child of step.children) {
        traverse({
          nodeId: child.id,
          parentId: ctx.nodeId,
          title: child.title,
          goal: child.goal,
          depth: ctx.depth + 1,
          depthBudget: ctx.depthBudget - 1,
          inheritedInterfaces: pool,
          consumes: child.consumes || [],
          produces: child.produces || [],
          isRoot: false
        });
      }

      for (const dep of step.dependencies) {
        accum.dependencies.push({
          fromTaskId: dep.fromTaskId,
          toTaskId: dep.toTaskId,
          type: dep.type,
          inferred: false,
          ...(dep.rationale !== undefined ? { rationale: dep.rationale } : {})
        });
      }

      const compositeScope = step.children.flatMap((c: any) => c.allowedPaths || []);
      selfNode.contract = buildCompositeContract({
        taskId: ctx.nodeId,
        title: ctx.title,
        goal: ctx.goal,
        coveredPaths: compositeScope.length > 0 ? compositeScope : ["src/**", "tests/**"],
        sharedInterfaces: newInterfaces,
        parentValidationCommands: step.parentValidationCommands.map(toExecutionValidationCommand)
      });
    };

    traverse({
      nodeId: ROOT_ID,
      parentId: null,
      title: feature.title,
      goal: feature.description,
      depth: 0,
      depthBudget: this.depthBudget,
      inheritedInterfaces: [],
      consumes: [],
      produces: [],
      isRoot: true
    });

    const graph: TaskGraph = {
      id: `${feature.id}:${aggressiveness}:graph`,
      planId: `${feature.id}:${aggressiveness}:plan`,
      repo: repoSpec?.repo ?? feature.repositoryPath ?? "manyhands-workspace",
      baseBranch: repoSpec?.baseBranch ?? "main",
      baseCommit: repoSpec?.baseCommit ?? "base-commit-placeholder",
      featureRequest: feature.title,
      nodes: accum.nodes,
      dependencies: accum.dependencies,
      rootId: ROOT_ID,
      createdAt: repoSpec?.createdAt ?? new Date().toISOString()
    };

    syncNodeDependencyShortcuts(graph.nodes, graph.dependencies);

    return { graph, contracts: accum.contracts };
  }

  private async expand(
    ctx: ExpandContext,
    accum: Accumulator,
    aggressiveness: Aggressiveness
  ): Promise<string[]> {
    if (accum.callCount >= this.maxDecomposerCalls) {
      throw new DecomposerLlmError(`Planning decomposer-call budget (${this.maxDecomposerCalls}) was exhausted.`, undefined, "request");
    }
    await this.emitStepStarted(ctx);
    await this.emitStepStatus(ctx, { state: "generating", maxAttempts: this.maxStepAttempts });

    let resolution: StepResolution;
    try {
      resolution = await this.callStep(ctx, aggressiveness, accum);
    } catch (error) {
      const failure = this.toStepError(error, ctx);
      await this.emitStepStatus(ctx, {
        state: "failed",
        error: failure.details,
        attempt: failure.details?.attempt,
        maxAttempts: failure.details?.maxAttempts,
        durationMs: failure.details?.durationMs
      });
      if (!ctx.isRoot && this.allowNonRootFallback) {
        const fallback = this.materializeFallbackAtomic(ctx, accum, failure.details);
        await this.emitStepStatus(ctx, { state: "fallback", error: failure.details });
        await this.emitStepCompleted(ctx, fallback.step, fallback);
        return fallback.coveredPaths;
      }
      if (accum.stepCache !== undefined) {
        failure.stepCache = accum.stepCache;
      }
      throw failure;
    }

    const step = resolution.step;
    accum.callCount += resolution.attemptCount;

    // Cache every resolved step (not just questions) as soon as it's known, so
    // a terminal failure elsewhere in the tree can carry this node's already-
    // generated result forward — a retry resumes instead of regenerating
    // already-successful siblings from scratch.
    if (accum.stepCache !== undefined) {
      accum.stepCache[ctx.nodeId] = step;
    }

    if (step.decision === "question") {
      await this.emitStepStatus(ctx, {
        state: resolution.state,
        attempt: resolution.attemptCount,
        maxAttempts: this.maxStepAttempts,
        error: resolution.error
      });
      await this.emitStepCompleted(ctx, step, resolution);
      throw new DecomposerQuestionError(
        ctx.nodeId,
        step.question,
        step.options,
        accum.stepCache ?? {},
        step.reasoning
      );
    }

    const forcedAtomic = ctx.depthBudget <= 0;

    if (step.decision === "atomic" || forcedAtomic) {
      await this.emitStepStatus(ctx, {
        state: resolution.state,
        attempt: resolution.attemptCount,
        maxAttempts: this.maxStepAttempts,
        error: resolution.error
      });
      await this.emitStepCompleted(ctx, step, resolution);
      const atomic = step.decision === "atomic" ? step : undefined;
      return this.materializeAtomic(ctx, accum, atomic);
    }

    if (step.children.length > this.maxChildrenPerNode) {
      throw new DecomposerLlmError(`Planning child budget (${this.maxChildrenPerNode}) was exceeded for ${ctx.nodeId}.`, undefined, "normalize");
    }

    // ── Decompose: define seams, create children, recurse ──
    const newInterfaces: InterfaceContract[] = step.sharedInterfaces.map((iface) =>
      toInterfaceContract(iface, ctx.nodeId)
    );
    const pool = [...ctx.inheritedInterfaces, ...newInterfaces];

    const childIds = step.children.map((child) => child.id);
    try {
      reserveNodeIds(accum, childIds);
    } catch (error) {
      const failure = this.toStepError(error, ctx);
      await this.emitStepStatus(ctx, { state: "failed", error: failure.details });
      if (!ctx.isRoot && this.allowNonRootFallback) {
        const fallback = this.materializeFallbackAtomic(ctx, accum, failure.details);
        await this.emitStepStatus(ctx, { state: "fallback", error: failure.details });
        await this.emitStepCompleted(ctx, fallback.step, fallback);
        return fallback.coveredPaths;
      }
      if (accum.stepCache !== undefined) {
        failure.stepCache = accum.stepCache;
      }
      throw failure;
    }
    await this.emitStepStatus(ctx, {
      state: resolution.state,
      attempt: resolution.attemptCount,
      maxAttempts: this.maxStepAttempts,
      error: resolution.error
    });
    await this.emitStepCompleted(ctx, step, resolution);
    const coveredPaths: string[] = [];

    // Register THIS node (root or composite) before recursing so children resolve their parent.
    const selfNode: TaskNode = {
      id: ctx.nodeId,
      parentId: ctx.parentId,
      kind: ctx.isRoot ? "root" : "composite",
      title: ctx.title,
      goal: ctx.goal,
      status: "planned",
      granularity: accum.granularity,
      depth: ctx.depth,
      childrenIds: childIds,
      dependencies: [],
      metadata: { authoredBy: "ai" }
    };
    accum.nodes[ctx.nodeId] = selfNode;

    const childResults = await mapWithConcurrency(step.children, this.maxParallelSteps, (child) =>
      this.expand(
        {
          nodeId: child.id,
          parentId: ctx.nodeId,
          title: child.title,
          goal: child.goal,
          depth: ctx.depth + 1,
          depthBudget: ctx.depthBudget - 1,
          inheritedInterfaces: pool,
          consumes: child.consumes,
          produces: child.produces,
          isRoot: false
        },
        accum,
        aggressiveness
      )
    );
    for (const childCovered of childResults) {
      coveredPaths.push(...childCovered);
    }

    for (const dep of step.dependencies) {
      accum.dependencies.push({
        fromTaskId: dep.fromTaskId,
        toTaskId: dep.toTaskId,
        type: dep.type,
        inferred: false,
        ...(dep.rationale !== undefined ? { rationale: dep.rationale } : {})
      });
    }

    // Attach a minimal composite contract carrying the integration seam + validation, so the
    // Composer can validate the integrated tree against the parent's commands and scope.
    const compositeScope = uniqueStrings(coveredPaths.length > 0 ? coveredPaths : ["src/**", "tests/**"]);
    selfNode.contract = buildCompositeContract({
      taskId: ctx.nodeId,
      title: ctx.title,
      goal: ctx.goal,
      coveredPaths: compositeScope,
      sharedInterfaces: newInterfaces,
      parentValidationCommands: step.parentValidationCommands.map(toExecutionValidationCommand)
    });

    return compositeScope;
  }

  /** Creates a leaf for an atomic node. The root, if atomic, becomes a root with one leaf child. */
  private materializeAtomic(
    ctx: ExpandContext,
    accum: Accumulator,
    atomic: Extract<DecomposeStepOutput, { decision: "atomic" }> | undefined
  ): string[] {
    const allowedPaths = resolveAllowedPaths(atomic?.allowedPaths ?? [], accum.feature);
    const acceptance = atomic?.acceptanceCriteria ?? [`Complete: ${ctx.title}`];
    const expectedFiles = atomic?.expectedFiles ?? [];
    const forbiddenPaths = atomic?.forbiddenPaths ?? [];
    const leafValidationCommands = (atomic?.leafValidationCommands ?? []).map(toExecutionValidationCommand);

    const consumed = ctx.inheritedInterfaces.filter((i) => ctx.consumes.includes(i.id));
    const produced = ctx.inheritedInterfaces.filter((i) => ctx.produces.includes(i.id));

    if (ctx.isRoot) {
      // The whole feature is a single unit (single-agent baseline): root → one leaf.
      const leafId = `${ROOT_ID}-impl`;
      reserveNodeIds(accum, [leafId]);
      accum.nodes[ROOT_ID] = {
        id: ROOT_ID,
        parentId: null,
        kind: "root",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: 0,
        childrenIds: [leafId],
        dependencies: [],
        metadata: { authoredBy: "ai" }
      };
      const contract = buildLeafContract({
        taskId: leafId,
        title: ctx.title,
        goal: ctx.goal,
        allowedPaths,
        forbiddenPaths,
        expectedFiles,
        acceptance,
        leafValidationCommands,
        consumed,
        produced,
        feature: accum.feature
      });
      accum.nodes[leafId] = {
        id: leafId,
        parentId: ROOT_ID,
        kind: "leaf",
        title: ctx.title,
        goal: ctx.goal,
        status: "planned",
        granularity: accum.granularity,
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract,
        metadata: { authoredBy: "ai" }
      };
      accum.contracts.push(contract);
      return allowedPaths;
    }

    const contract = buildLeafContract({
      taskId: ctx.nodeId,
      title: ctx.title,
      goal: ctx.goal,
      allowedPaths,
      forbiddenPaths,
      expectedFiles,
      acceptance,
      leafValidationCommands,
      consumed,
      produced,
      feature: accum.feature
    });
    accum.nodes[ctx.nodeId] = {
      id: ctx.nodeId,
      parentId: ctx.parentId,
      kind: "leaf",
      title: ctx.title,
      goal: ctx.goal,
      status: "planned",
      granularity: accum.granularity,
      depth: ctx.depth,
      childrenIds: [],
      dependencies: [],
      contract,
      metadata: { authoredBy: "ai" }
    };
    accum.contracts.push(contract);
    return allowedPaths;
  }

  private materializeFallbackAtomic(
    ctx: ExpandContext,
    accum: Accumulator,
    error: GraphGenerationErrorDetails | undefined
  ): StepResolution & { coveredPaths: string[] } {
    const coveredPaths = this.materializeAtomic(ctx, accum, undefined);
    const node = accum.nodes[ctx.isRoot ? ROOT_ID : ctx.nodeId];
    if (node !== undefined) {
      node.metadata = {
        ...node.metadata,
        authoredBy: "ai",
        planningState: "fallback",
        planningError: error
      };
      node.metrics = {
        ...node.metrics,
        retries: Math.max(0, (error?.attempt ?? this.maxStepAttempts) - 1)
      };
    }
    return {
      step: {
        decision: "atomic",
        reasoning: "Fallback atomic leaf after non-root planning failure.",
        allowedPaths: coveredPaths,
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: [`Complete: ${ctx.title}`],
        leafValidationCommands: []
      },
      attemptCount: error?.attempt ?? this.maxStepAttempts,
      state: "fallback",
      error,
      coveredPaths
    };
  }

  private async callStep(
    ctx: ExpandContext,
    aggressiveness: Aggressiveness,
    accum: Accumulator
  ): Promise<StepResolution> {
    const cacheKey = ctx.nodeId;
    const cachedStep = accum.stepCache?.[cacheKey];
    const answer = accum.questionAnswers?.[cacheKey];

    if (cachedStep !== undefined && cachedStep.decision !== "question") {
      return { step: cachedStep, attemptCount: 0, state: "generated" };
    }

    const hasUserAnswer = cachedStep !== undefined && cachedStep.decision === "question" && answer !== undefined;

    const { system, user } = buildStepPrompt({
      title: ctx.title,
      goal: ctx.goal,
      aggressiveness,
      inheritedInterfaces: ctx.inheritedInterfaces.map(toStepInterface),
      atDepthLimit: ctx.depthBudget <= 0,
      ...(this.workspaceHints !== undefined ? { workspaceHints: this.workspaceHints } : {}),
      ...(hasUserAnswer
        ? {
            userQuestion: cachedStep.question,
            userAnswer: answer
          }
        : {})
    });

    const stepSystem = `${system}\n\n## Overall feature goal (for context)\n${this.userPrompt}`;
    let stepUser = user;

    for (let attempt = 1; attempt <= this.maxStepAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      let response;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: stepSystem,
          messages: [{ role: "user", content: stepUser }],
          nodeId: ctx.nodeId
        } as any);
      } catch (error) {
        const failure = this.toAttemptError(error, ctx, attempt, Date.now() - attemptStartedAt, "request");
        if (await this.shouldRetry(ctx, failure, attempt, user)) {
          stepUser = appendStepRecoveryFeedback(user, failure.details as GraphGenerationErrorDetails);
          continue;
        }
        throw failure;
      }

      const text = extractText(response.content);
      try {
        const parsed = parseStepOutputCandidates(ctx, accum, text);
        return { step: parsed, attemptCount: attempt, state: "generated" };
      } catch (error) {
        const failure = this.toAttemptError(error, ctx, attempt, Date.now() - attemptStartedAt);
        if (await this.shouldRetry(ctx, failure, attempt, user)) {
          stepUser = appendStepRecoveryFeedback(user, failure.details as GraphGenerationErrorDetails);
          continue;
        }
        throw failure;
      }
    }

    const details: GraphGenerationErrorDetails = {
      kind: "unknown",
      stage: "request",
      recoverable: false,
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      maxAttempts: this.maxStepAttempts,
      message: `Step generation failed for "${ctx.nodeId}" after ${this.maxStepAttempts} attempt(s)`
    };
    throw new DecomposerLlmError(details.message, undefined, details.stage, details);
  }

  private emitStepStarted(ctx: ExpandContext): Promise<void> {
    return emitBestEffort(this.onStepStarted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget
    });
  }

  private emitStepCompleted(
    ctx: ExpandContext,
    step: DecomposeStepOutput,
    resolution: Pick<StepResolution, "attemptCount" | "state" | "error">
  ): Promise<void> {
    return emitBestEffort(this.onStepCompleted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget,
      decision: step.decision,
      childIds: step.decision === "decompose" ? step.children.map((child) => child.id) : [],
      attemptCount: resolution.attemptCount,
      state: resolution.state,
      ...(resolution.error !== undefined ? { error: resolution.error } : {}),
      children:
        step.decision === "decompose"
          ? step.children.map((child) => ({
              nodeId: child.id,
              parentId: ctx.nodeId,
              title: child.title,
              goal: child.goal,
              depth: ctx.depth + 1,
              depthBudget: Math.max(0, ctx.depthBudget - 1)
            }))
          : []
    });
  }

  private emitStepStatus(
    ctx: ExpandContext,
    event: Omit<RecursiveStepStatusEvent, keyof RecursiveStepStartedEvent>
  ): Promise<void> {
    return emitBestEffort(this.onStepStatus, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget,
      ...event
    });
  }

  private async shouldRetry(
    ctx: ExpandContext,
    error: DecomposerLlmError,
    attempt: number,
    _originalUserPrompt: string
  ): Promise<boolean> {
    const details = error.details;
    if (details === undefined || !details.recoverable || attempt >= this.maxStepAttempts) {
      return false;
    }

    console.warn(
      `[RecursiveDecomposer] Step "${ctx.nodeId}" attempt ${attempt}/${this.maxStepAttempts} failed ` +
        `(${details.kind}): ${details.message}. Retrying with stricter JSON instructions.` +
        (details.responseExcerpt !== undefined ? ` Raw response: ${details.responseExcerpt}` : "")
    );
    await this.emitStepStatus(ctx, {
      state: "retrying",
      attempt,
      maxAttempts: this.maxStepAttempts,
      durationMs: details.durationMs,
      error: details
    });
    const delayMs = retryDelayMs(attempt, this.stepRetryBaseDelayMs, this.stepRetryMaxDelayMs);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    return true;
  }

  private toAttemptError(
    error: unknown,
    ctx: ExpandContext,
    attempt: number,
    durationMs: number,
    stage?: "request" | "parse" | "validate" | "normalize"
  ): DecomposerLlmError {
    const details = classifyGraphGenerationError(error, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      attempt,
      maxAttempts: this.maxStepAttempts,
      durationMs,
      ...(stage !== undefined ? { stage } : {})
    });
    const message =
      `Graph generation failed for node "${ctx.nodeId}" ` +
      `(attempt ${attempt}/${this.maxStepAttempts}, ${details.kind}): ${details.message}`;
    return new DecomposerLlmError(message, error, details.stage, { ...details, message });
  }

  private toStepError(error: unknown, ctx: ExpandContext): DecomposerLlmError {
    if (error instanceof DecomposerLlmError && error.details !== undefined) {
      return error;
    }
    const details = classifyGraphGenerationError(error, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      maxAttempts: this.maxStepAttempts
    });
    const message = `Graph generation failed for node "${ctx.nodeId}" (${details.kind}): ${details.message}`;
    return new DecomposerLlmError(message, error, details.stage, { ...details, message });
  }
}

function normalizeParallelism(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_PARALLEL_STEPS;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

const RESPONSE_EXCERPT_MAX_CHARS = 400;

/** Compact, single-line evidence of a non-JSON model response for diagnostics. */
function responseExcerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > RESPONSE_EXCERPT_MAX_CHARS
    ? `${collapsed.slice(0, RESPONSE_EXCERPT_MAX_CHARS)}…`
    : collapsed;
}

function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  if (baseDelayMs <= 0 || maxDelayMs <= 0) {
    return 0;
  }
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStepOutputCandidates(
  ctx: ExpandContext,
  accum: Accumulator,
  text: string
): DecomposeStepOutput {
  const parsed = parseJsonObjectCandidates(text);
  if (!parsed.ok) {
    throw new DecomposerLlmError(
      `${parsed.message} for step "${ctx.nodeId}"`,
      undefined,
      "parse",
      {
        kind: parsed.kind,
        stage: "parse",
        recoverable: true,
        nodeId: ctx.nodeId,
        parentId: ctx.parentId,
        message: `${parsed.message} for step "${ctx.nodeId}"`,
        responseExcerpt: responseExcerptOf(text)
      }
    );
  }

  let firstFailure: DecomposerLlmError | undefined;
  for (const candidate of prioritizeStepCandidates(parsed.candidates)) {
    const result = DecomposeStepOutputSchema.safeParse(candidate.value);
    if (!result.success) {
      firstFailure ??= stepSchemaFailure(ctx, candidate, result.error);
      continue;
    }

    const semanticIssues = validateStepSemantics(ctx, accum, result.data);
    if (semanticIssues.length > 0) {
      firstFailure ??= stepSemanticFailure(ctx, semanticIssues);
      continue;
    }

    return result.data;
  }

  throw firstFailure ?? new DecomposerLlmError(
    `No parsed JSON candidate matched the step schema for "${ctx.nodeId}"`,
    undefined,
    "validate",
    {
      kind: "schema_invalid",
      stage: "validate",
      recoverable: true,
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      message: `No parsed JSON candidate matched the step schema for "${ctx.nodeId}"`
    }
  );
}

function prioritizeStepCandidates(candidates: ParsedJsonObjectCandidate[]): ParsedJsonObjectCandidate[] {
  return [...candidates].sort((left, right) => {
    const scoreDelta = stepCandidateScore(right.value) - stepCandidateScore(left.value);
    return scoreDelta !== 0 ? scoreDelta : left.index - right.index;
  });
}

function stepCandidateScore(value: unknown): number {
  if (!isRecord(value)) return 0;
  return typeof value.decision === "string" ? 2 : 1;
}

function stepSchemaFailure(
  ctx: ExpandContext,
  candidate: ParsedJsonObjectCandidate,
  error: ZodError
): DecomposerLlmError {
  const detail = describeStepSchemaFailure(ctx.nodeId, candidate.value, error);
  return new DecomposerLlmError(detail, error, "validate", {
    kind: "schema_invalid",
    stage: "validate",
    recoverable: true,
    nodeId: ctx.nodeId,
    parentId: ctx.parentId,
    message: detail
  });
}

function stepSemanticFailure(ctx: ExpandContext, issues: string[]): DecomposerLlmError {
  const detail = `Step semantic validation failed for "${ctx.nodeId}": ${issues.join("; ")}`;
  return new DecomposerLlmError(detail, undefined, "validate", {
    kind: classifyStepSemanticIssues(issues),
    stage: "validate",
    recoverable: true,
    nodeId: ctx.nodeId,
    parentId: ctx.parentId,
    message: detail
  });
}

function validateStepSemantics(
  ctx: ExpandContext,
  accum: Accumulator,
  step: DecomposeStepOutput
): string[] {
  if (step.decision !== "decompose") {
    return [];
  }

  const issues: string[] = [];
  const childIds = new Set<string>();
  for (const child of step.children) {
    if (childIds.has(child.id)) {
      issues.push(`duplicate child id "${child.id}"`);
    }
    if (accum.reservedNodeIds.has(child.id) || accum.nodes[child.id] !== undefined) {
      issues.push(`duplicate node id "${child.id}" already exists in the recursive graph`);
    }
    childIds.add(child.id);
  }

  const interfaceIds = new Set(ctx.inheritedInterfaces.map((iface) => iface.id));
  for (const iface of step.sharedInterfaces) {
    if (interfaceIds.has(iface.id)) {
      issues.push(`duplicate interface id "${iface.id}" already exists in scope`);
    }
    interfaceIds.add(iface.id);
  }

  for (const child of step.children) {
    for (const ifaceId of [...child.consumes, ...child.produces]) {
      if (!interfaceIds.has(ifaceId)) {
        issues.push(`child "${child.id}" references unknown interface "${ifaceId}"`);
      }
    }
  }

  const producersByInterface = new Map<string, string[]>();
  for (const child of step.children) {
    for (const ifaceId of child.produces) {
      producersByInterface.set(ifaceId, [...(producersByInterface.get(ifaceId) ?? []), child.id]);
    }
  }

  for (const [ifaceId, producerIds] of producersByInterface) {
    if (producerIds.length > 1) {
      issues.push(
        `interface "${ifaceId}" is produced by multiple children: ${producerIds.join(", ")}; ` +
          `assign each shared interface to exactly one producer child`
      );
    }
  }

  // Every seam defined at this step must be produced by some child; otherwise a
  // consumer downstream is left with an orphaned interface that no leaf supplies,
  // which the executable graph validation later rejects after the plan is built.
  const producedHere = new Set(producersByInterface.keys());
  for (const iface of step.sharedInterfaces) {
    if (!producedHere.has(iface.id)) {
      issues.push(
        `interface "${iface.id}" is defined at this step but no child produces it; ` +
          `assign it to the "produces" of the child that builds it`
      );
    }
  }

  // A production obligation inherited from the parent (this node was assigned to
  // produce a seam) must be carried by some child so it keeps propagating down
  // until a leaf actually produces it. Only leaves count as producers at the
  // executable boundary, so a node that DECOMPOSES without re-assigning its
  // obligation silently drops it: no descendant leaf produces the seam, while a
  // consumer elsewhere still expects it. That orphan is invisible to the
  // step-level seam check above (which only inspects locally-defined seams) and
  // surfaces only later as orphan_consumed_interface after the whole plan is
  // built — exactly the deeply-nested case the step-level check failed to cover.
  for (const obligation of ctx.produces) {
    if (!producedHere.has(obligation)) {
      issues.push(
        `this node must produce interface "${obligation}" (assigned by its parent) but no child produces it; ` +
          `assign it to the "produces" of the child that builds it`
      );
    }
  }

  for (const dependency of step.dependencies) {
    if (!childIds.has(dependency.fromTaskId)) {
      issues.push(`dependency references unknown fromTaskId "${dependency.fromTaskId}"`);
    }
    if (!childIds.has(dependency.toTaskId)) {
      issues.push(`dependency references unknown toTaskId "${dependency.toTaskId}"`);
    }
    if (dependency.fromTaskId === dependency.toTaskId) {
      issues.push(`dependency self-loop on "${dependency.fromTaskId}"`);
    }
  }

  const cycle = findDependencyCycle(Array.from(childIds), step.dependencies);
  if (cycle.length > 0) {
    issues.push(`dependency cycle detected: ${cycle.join(" -> ")}`);
  }

  return issues;
}

function classifyStepSemanticIssues(issues: readonly string[]): GraphGenerationErrorKind {
  const text = issues.join("; ").toLowerCase();
  if (text.includes("duplicate child id") || text.includes("duplicate node id")) return "duplicate_node_id";
  if (text.includes("unknown") || text.includes("self-loop")) return "dangling_dependency";
  if (text.includes("cycle")) return "cycle_detected";
  return "graph_invalid";
}

function findDependencyCycle(
  nodeIds: string[],
  dependencies: Extract<DecomposeStepOutput, { decision: "decompose" }>["dependencies"]
): string[] {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const dependency of dependencies) {
    if (adjacency.has(dependency.fromTaskId) && adjacency.has(dependency.toTaskId)) {
      adjacency.get(dependency.fromTaskId)?.push(dependency.toTaskId);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): string[] => {
    if (visiting.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(Math.max(start, 0)), nodeId];
    }
    if (visited.has(nodeId)) {
      return [];
    }
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      const cycle = visit(nextId);
      if (cycle.length > 0) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return [];
  };

  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle.length > 0) {
      return cycle;
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reserveNodeIds(accum: Accumulator, nodeIds: readonly string[]): void {
  for (const nodeId of nodeIds) {
    if (accum.reservedNodeIds.has(nodeId) || accum.nodes[nodeId] !== undefined) {
      throw new DecomposerLlmError(
        `Duplicate node id "${nodeId}" produced during recursive decomposition`,
        undefined,
        "normalize"
      );
    }
  }
  for (const nodeId of nodeIds) {
    accum.reservedNodeIds.add(nodeId);
  }
}

function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    let active = 0;
    let completed = 0;
    let failed = false;
    let firstError: unknown;

    const launch = (): void => {
      if (failed && active === 0) {
        reject(firstError);
        return;
      }
      if (completed === items.length) {
        resolve(results);
        return;
      }

      while (!failed && active < limit && nextIndex < items.length) {
        const index = nextIndex;
        const item = items[index] as T;
        nextIndex += 1;
        active += 1;
        void mapper(item, index)
          .then((result) => {
            results[index] = result;
          })
          .catch((error) => {
            if (!failed) {
              failed = true;
              firstError = error;
            }
          })
          .finally(() => {
            active -= 1;
            completed += 1;
            launch();
          });
      }
    };

    launch();
  });
}

function describeStepSchemaFailure(nodeId: string, parsed: unknown, error: ZodError): string {
  const first = error.issues[0];
  const path = first?.path.join(".") ?? "?";
  const message = first?.message ?? "unknown";
  const received = first !== undefined ? formatRejectedValue(valueAtPath(parsed, first.path)) : undefined;
  const suffix = received !== undefined ? ` (received ${received})` : "";
  return `Step schema validation failed for "${nodeId}": ${path} - ${message}${suffix}`;
}

function appendStepRecoveryFeedback(userPrompt: string, detail: GraphGenerationErrorDetails): string {
  return [
    userPrompt,
    "",
    "## Previous attempt was rejected",
    "",
    `- kind: ${detail.kind}`,
    `- stage: ${detail.stage}`,
    `- detail: ${detail.message}`,
    "",
    "Return a corrected JSON object for the same node.",
    "Return exactly one complete JSON object. Do not include prose, markdown, code fences, or logs.",
    "If a prior attempt timed out, make the JSON concise while preserving the required fields.",
    "Preserve the same decomposition unless a field must change to satisfy validation.",
    "For child ids, use lowercase kebab-case matching `^[a-z][a-z0-9_-]*$`.",
    "Dependencies must reference only child ids declared in this same JSON object and must not form cycles."
  ].join("\n");
}

function valueAtPath(value: unknown, path: ZodIssue["path"]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function formatRejectedValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── helpers ─────────────────────────────────────────────────────

function modeToAggressiveness(mode: DecompositionMode): Aggressiveness {
  if (mode === "coarse") return "low";
  if (mode === "fine") return "high";
  if (mode === "auto") return "auto";
  return "medium";
}

function aggressivenessToGranularity(aggressiveness: Aggressiveness): TaskGranularityLevel {
  if (aggressiveness === "low") return "coarse";
  if (aggressiveness === "high") return "fine";
  // "auto" is adaptive per-node; the recorded granularity metadata is neutral.
  return "medium";
}

function toInterfaceContract(iface: StepInterface, definedAtNodeId: string): InterfaceContract {
  return {
    id: iface.id,
    kind: iface.kind,
    signature: iface.signature,
    description: iface.description,
    definedAtNodeId
  };
}

function toStepInterface(iface: InterfaceContract): StepInterface {
  return { id: iface.id, kind: iface.kind, signature: iface.signature, description: iface.description };
}

function toExecutionValidationCommand(input: { command: string; args: string[] }): ExecutionValidationCommand {
  return { command: input.command, args: input.args, timeoutMs: 60_000, cwd: "worktree" };
}

function resolveAllowedPaths(allowedPaths: string[], feature: FeatureRequest): string[] {
  return allowedPaths.length > 0 ? allowedPaths : [feature.repositoryPath ?? "src/**"];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildLeafContract(input: {
  taskId: string;
  title: string;
  goal: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  expectedFiles: string[];
  acceptance: string[];
  leafValidationCommands: ExecutionValidationCommand[];
  consumed: InterfaceContract[];
  produced: InterfaceContract[];
  feature: FeatureRequest;
}): AgentTaskContract {
  return {
    taskId: input.taskId,
    objective: input.goal,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: input.feature.constraints,
      upstreamArtifacts: []
    },
    allowed: { paths: input.allowedPaths },
    forbidden: { paths: input.forbiddenPaths },
    executionScope: executionScopeFromAllowed(input.allowedPaths),
    forbiddenPaths: input.forbiddenPaths,
    relevantSymbols: [],
    dependencies: [],
    acceptance: input.acceptance.map((description) => ({ kind: "custom" as const, description })),
    validationCommands: [],
    leafValidationCommands: input.leafValidationCommands,
    expectedOutput: {
      changedFiles: input.expectedFiles,
      // Interface ids are compatibility seams, not concrete symbols produced
      // by another isolated worktree. Keep them solely in the explicit
      // consumed/produced interface fields so risk-aware scheduling can use
      // the seam as positive parallelism evidence.
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: { maxDurationMs: DEFAULT_MAX_DURATION_MS, maxCostUsd: DEFAULT_MAX_COST_USD },
    knownRisks: [],
    definitionOfDone: input.acceptance[0] ?? `Complete: ${input.title}`,
    ...(input.consumed.length > 0 ? { consumedInterfaces: input.consumed } : {}),
    ...(input.produced.length > 0 ? { producedInterfaces: input.produced } : {})
  };
}

function buildCompositeContract(input: {
  taskId: string;
  title: string;
  goal: string;
  coveredPaths: string[];
  sharedInterfaces: InterfaceContract[];
  parentValidationCommands: ExecutionValidationCommand[];
}): AgentTaskContract {
  return {
    taskId: input.taskId,
    objective: input.goal,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: input.coveredPaths },
    forbidden: { paths: [] },
    executionScope: executionScopeFromAllowed(input.coveredPaths),
    forbiddenPaths: [],
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: `Integrate the children of: ${input.title}` }],
    validationCommands: [],
    expectedOutput: { changedFiles: [], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: DEFAULT_MAX_DURATION_MS, maxCostUsd: DEFAULT_MAX_COST_USD },
    knownRisks: [],
    definitionOfDone: `The children of "${input.title}" integrate and honour their shared interfaces.`,
    ...(input.parentValidationCommands.length > 0
      ? { parentValidationCommands: input.parentValidationCommands }
      : {}),
    ...(input.sharedInterfaces.length > 0 ? { producedInterfaces: input.sharedInterfaces } : {})
  };
}

function createAnthropicClient(apiKey: string): AnthropicLike {
  return new Anthropic({ apiKey, timeout: 60_000 }) as unknown as AnthropicLike;
}

function extractText(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
}

export { extractJson } from "./json";

async function emitBestEffort<T>(
  listener: RecursiveStepListener<T> | undefined,
  event: T
): Promise<void> {
  if (listener === undefined) return;
  try {
    await listener(event);
  } catch {
    // Live planning telemetry must never fail graph generation.
  }
}
