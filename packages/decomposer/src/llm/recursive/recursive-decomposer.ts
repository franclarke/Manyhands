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
import { DecomposerLlmError } from "../errors";
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

const DEFAULT_DEPTH_BUDGET = 5;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COST_USD = 1.5;
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
  workspaceHints?: string;
  promptTemplateVersion?: string;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
}

export type RecursiveStepListener<T> = (event: T) => void | Promise<void>;

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

interface Accumulator {
  nodes: Record<string, TaskNode>;
  contracts: AgentTaskContract[];
  dependencies: TaskDependency[];
  feature: FeatureRequest;
  granularity: TaskGranularityLevel;
  callCount: number;
}

/**
 * Interface-aware recursive decomposer (thesis Artifact 1).
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
  private readonly workspaceHints?: string;
  private readonly onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  private readonly onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
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
    if (options.workspaceHints !== undefined) {
      this.workspaceHints = options.workspaceHints;
    }
    if (options.onStepStarted !== undefined) {
      this.onStepStarted = options.onStepStarted;
    }
    if (options.onStepCompleted !== undefined) {
      this.onStepCompleted = options.onStepCompleted;
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
      callCount: 0
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

    const issues = validateTaskGraph(graph).map((issue) => `${issue.code}: ${issue.message}`);
    if (issues.length > 0) {
      throw new DecomposerLlmError(
        `Recursive decomposition produced an invalid graph: ${issues.join("; ")}`,
        undefined,
        "normalize"
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

  /** Expands one node, mutating the accumulator. Returns the globs its subtree covers. */
  private async expand(
    ctx: ExpandContext,
    accum: Accumulator,
    aggressiveness: Aggressiveness
  ): Promise<string[]> {
    this.emitStepStarted(ctx);
    const step = await this.callStep(ctx, aggressiveness);
    accum.callCount += 1;
    this.emitStepCompleted(ctx, step);

    const forcedAtomic = ctx.depthBudget <= 0;

    if (step.decision === "atomic" || forcedAtomic) {
      const atomic = step.decision === "atomic" ? step : undefined;
      return this.materializeAtomic(ctx, accum, atomic);
    }

    // ── Decompose: define seams, create children, recurse ──
    const newInterfaces: InterfaceContract[] = step.sharedInterfaces.map((iface) =>
      toInterfaceContract(iface, ctx.nodeId)
    );
    const pool = [...ctx.inheritedInterfaces, ...newInterfaces];

    const childIds: string[] = [];
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

    for (const child of step.children) {
      if (accum.nodes[child.id] !== undefined) {
        throw new DecomposerLlmError(
          `Duplicate node id "${child.id}" produced during recursive decomposition`,
          undefined,
          "normalize"
        );
      }
      childIds.push(child.id);
      const childCovered = await this.expand(
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
      );
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

    const consumed = ctx.inheritedInterfaces.filter((i) => ctx.consumes.includes(i.id));
    const produced = ctx.inheritedInterfaces.filter((i) => ctx.produces.includes(i.id));

    if (ctx.isRoot) {
      // The whole feature is a single unit (single-agent baseline): root → one leaf.
      const leafId = `${ROOT_ID}-impl`;
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

  private async callStep(ctx: ExpandContext, aggressiveness: Aggressiveness): Promise<DecomposeStepOutput> {
    const { system, user } = buildStepPrompt({
      title: ctx.title,
      goal: ctx.goal,
      aggressiveness,
      inheritedInterfaces: ctx.inheritedInterfaces.map(toStepInterface),
      depthRemaining: ctx.depthBudget,
      ...(this.workspaceHints !== undefined ? { workspaceHints: this.workspaceHints } : {})
    });

    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: `${system}\n\n## Overall feature goal (for context)\n${this.userPrompt}`,
        messages: [{ role: "user", content: user }]
      });
    } catch (error) {
      throw new DecomposerLlmError(
        `Recursive decomposer request failed during step "${ctx.nodeId}": ${error instanceof Error ? error.message : String(error)}`,
        error,
        "request"
      );
    }

    const text = extractText(response.content);
    const json = extractJson(text);
    if (json === null) {
      throw new DecomposerLlmError(`No JSON object in step response for "${ctx.nodeId}"`, undefined, "parse");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new DecomposerLlmError(
        `Failed to JSON.parse step output for "${ctx.nodeId}": ${error instanceof Error ? error.message : String(error)}`,
        error,
        "parse"
      );
    }
    const result = DecomposeStepOutputSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new DecomposerLlmError(
        `Step schema validation failed for "${ctx.nodeId}": ${first?.path.join(".") ?? "?"} — ${first?.message ?? "unknown"}`,
        result.error,
        "validate"
      );
    }
    return result.data;
  }

  private emitStepStarted(ctx: ExpandContext): void {
    void emitBestEffort(this.onStepStarted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget
    });
  }

  private emitStepCompleted(ctx: ExpandContext, step: DecomposeStepOutput): void {
    void emitBestEffort(this.onStepCompleted, {
      nodeId: ctx.nodeId,
      parentId: ctx.parentId,
      title: ctx.title,
      goal: ctx.goal,
      depth: ctx.depth,
      depthBudget: ctx.depthBudget,
      decision: step.decision,
      childIds: step.decision === "decompose" ? step.children.map((child) => child.id) : []
    });
  }
}

// ── helpers ─────────────────────────────────────────────────────

function modeToAggressiveness(mode: DecompositionMode): Aggressiveness {
  if (mode === "coarse") return "low";
  if (mode === "fine") return "high";
  return "medium";
}

function aggressivenessToGranularity(aggressiveness: Aggressiveness): TaskGranularityLevel {
  if (aggressiveness === "low") return "coarse";
  if (aggressiveness === "high") return "fine";
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
    expectedOutput: {
      changedFiles: input.expectedFiles,
      producedSymbols: input.produced.map((i) => i.id),
      consumedSymbols: input.consumed.map((i) => i.id)
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

function extractJson(text: string): string | null {
  if (text.startsWith("{") && text.endsWith("}")) return text;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

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
