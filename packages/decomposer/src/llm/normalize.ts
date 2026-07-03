import type {
  AcceptanceCriterion,
  AgentTaskContract
} from "@manyhands/contracts";
import type {
  TaskGraph,
  TaskNode,
  TaskGranularityLevel
} from "@manyhands/task-graph";
import { executionScopeFromAllowed } from "../scope";
import {
  DecomposerLlmError
} from "./errors";
import type { DecomposerLlmOutput } from "./output-schema";
import type {
  DecompositionMetadata,
  DecompositionMode,
  DecompositionOptions,
  DecompositionResult,
  FeatureRequest
} from "../index";

const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COST_USD = 1.5;

/** Convert a validated LLM output into the internal DecompositionResult shape. */
export function normalizeLlmDecomposition(input: {
  feature: FeatureRequest;
  output: DecomposerLlmOutput;
  mode: DecompositionMode;
  generatedAt: string;
  decomposerLabel: string;
  baseBranch: string;
  baseCommit: string;
  repo: string;
}): DecompositionResult {
  const granularity = granularityForMode(input.mode);
  const planId = `${input.feature.id}:${input.mode}:plan`;

  const childrenByParent = new Map<string, string[]>();
  for (const node of input.output.nodes) {
    if (node.parentId !== null) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node.id);
      childrenByParent.set(node.parentId, list);
    }
  }

  const rootCandidate = input.output.nodes.find((node) => node.parentId === null);
  if (rootCandidate === undefined) {
    throw new DecomposerLlmError("no root node after validation; this should not happen", undefined, "normalize");
  }

  const nodes: Record<string, TaskNode> = {};
  const contracts: AgentTaskContract[] = [];

  for (const llmNode of input.output.nodes) {
    const children = childrenByParent.get(llmNode.id) ?? [];
    const nodeKind = llmNode.parentId === null ? "root" as const : llmNode.kind;
    const node: TaskNode = {
      id: llmNode.id,
      parentId: llmNode.parentId,
      kind: nodeKind,
      title: llmNode.title,
      goal: llmNode.goal,
      status: "planned",
      granularity,
      depth: llmNode.depth,
      childrenIds: children,
      dependencies: [],
      metadata: {
        authoredBy: "ai"
      }
    };

    if (llmNode.kind === "leaf") {
      const contract = buildContract(input.feature, llmNode);
      node.contract = contract;
      contracts.push(contract);
    }

    nodes[llmNode.id] = node;
  }

  const graph: TaskGraph = {
    id: `${input.feature.id}:${input.mode}:graph`,
    planId,
    repo: input.repo,
    baseBranch: input.baseBranch,
    baseCommit: input.baseCommit,
    featureRequest: input.feature.title,
    nodes,
    dependencies: input.output.dependencies.map((dependency) => ({
      fromTaskId: dependency.fromTaskId,
      toTaskId: dependency.toTaskId,
      type: dependency.type,
      inferred: false,
      ...(dependency.rationale !== undefined ? { rationale: dependency.rationale } : {})
    })),
    rootId: rootCandidate.id,
    createdAt: input.generatedAt
  };

  const metadata: DecompositionMetadata = {
    mode: input.mode,
    generatedAt: input.generatedAt,
    decomposer: input.decomposerLabel,
    deterministic: false
  };

  return {
    feature: input.feature,
    graph,
    contracts,
    metadata,
    validation: {
      graphValid: true,
      contractValid: true,
      issues: []
    }
  };
}

function granularityForMode(mode: DecompositionMode): TaskGranularityLevel {
  switch (mode) {
    case "coarse":
      return "coarse";
    case "balanced":
      return "medium";
    case "fine":
      return "fine";
    case "auto":
      // Adaptive only inside the recursive decomposer; for normalization metadata
      // it records as the neutral middle level.
      return "medium";
  }
}

function buildContract(feature: FeatureRequest, llmNode: {
  id: string;
  title: string;
  goal: string;
  objective?: string | undefined;
  allowedPaths: string[];
  forbiddenPaths: string[];
  expectedFiles: string[];
  acceptanceCriteria: string[];
}): AgentTaskContract {
  const acceptance: AcceptanceCriterion[] = llmNode.acceptanceCriteria.map((description) => ({
    kind: "custom" as const,
    description
  }));
  const allowedPaths = llmNode.allowedPaths.length > 0
    ? llmNode.allowedPaths
    : [feature.repositoryPath ?? "src/**"];
  const objective = llmNode.objective !== undefined && llmNode.objective.length > 0
    ? llmNode.objective
    : llmNode.goal;
  return {
    taskId: llmNode.id,
    objective,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: feature.constraints,
      upstreamArtifacts: []
    },
    allowed: { paths: allowedPaths },
    forbidden: { paths: llmNode.forbiddenPaths },
    // V2 execution-time scope, derived from the same resolved paths so the
    // executor's ScopeChecker actually enforces (allowedPaths is non-empty here).
    executionScope: executionScopeFromAllowed(allowedPaths),
    forbiddenPaths: llmNode.forbiddenPaths,
    relevantSymbols: [],
    dependencies: [],
    acceptance: acceptance.length > 0 ? acceptance : [{ kind: "custom", description: `Complete: ${llmNode.title}` }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: llmNode.expectedFiles,
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
      maxCostUsd: DEFAULT_MAX_COST_USD
    },
    knownRisks: [],
    definitionOfDone: llmNode.acceptanceCriteria[0] ?? `Complete: ${llmNode.title}`
  };
}

export function _testOnlyOptionsHook(options?: DecompositionOptions): void {
  void options;
}
