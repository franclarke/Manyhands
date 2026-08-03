import type { PlanningContext } from "./model.js";
import { parseJsonObjectCandidates } from "../llm/recursive/json.js";

export interface SemanticPlanningPromptInput {
  goal: PlanningContext["goal"];
  repositorySnapshot: PlanningContext["repositorySnapshot"];
  resolvedDecisions: unknown[];
  constraints: string[];
}

export interface SemanticPlanningPrompt {
  system: string;
  user: string;
}

export function buildSemanticPlanningPrompt(input: SemanticPlanningPromptInput): SemanticPlanningPrompt {
  const files = input.repositorySnapshot.index?.files.map((file) => file.path).sort() ?? [];
  const repository = {
    snapshotDisposition: input.repositorySnapshot.inspectionDisposition,
    files,
    scripts: Object.keys(input.repositorySnapshot.capabilities.scripts).sort(),
    stack: input.repositorySnapshot.capabilities.stack.map((item) => item.name).sort()
  };
  return {
    system: [
      "You are the semantic planner for a software coordination system.",
      "Return exactly one JSON object and no prose or markdown.",
      "Describe semantic ownership, repository surfaces, observable outcomes, and cross-module seams.",
      "Do not author persistent IDs, hashes, snapshot IDs, revisions, event IDs, shell commands, package commands, budgets, scores, or execution status.",
      "Use short local handles only for references inside this one proposal.",
      "Every required criterion must be covered by exactly one leaf outcome; never repeat a criterion ID on another leaf.",
      "Every leaf must have at least one outcome and every outcome must cover at least one criterion; assign the supplied criteria across leaves rather than leaving covers empty.",
      "Every leaf surface must include both existingPaths and plannedPaths arrays; use [] when one side is empty.",
      "Keep each leaf surface concise: declare at most 6 total paths across existingPaths and plannedPaths; group additional evidence through verification references instead of widening the leaf surface.",
      "Every composite must include at least one child; do not emit empty conceptual grouping nodes.",
      "The top-level object has root, seams, and uncertainties as siblings; seams and uncertainties must never be nested inside root.",
      "root is only the composite tree with kind, handle, title, objective, and children; do not put seams, uncertainties, or rationale inside root.",
      "Every existingPath and every verification reference for an existing artifact must appear in the supplied repository files; a verification reference may instead be one of the owning leaf's plannedPaths when the goal creates that artifact.",
      "When the goal explicitly names a new file or script, include that planned path in the owning leaf's surface and verification references; a missing study:<name> script requires a new planned implementation path containing its name, not an existing analogous script.",
      "Use only supplied script names as repository_capability values.",
      "A seam must name one producer and one or more consumers and keep specification, compatibility, materialization, verification, and evidence together.",
      "Every seam producer and consumer must be a handle of a leaf module in the plan; do not attach seams to composites or invent conceptual participants.",
      "For a files or manifest seam, every artifactPath must belong to the producer's existingPaths or plannedPaths; use a logical seam when no producer-owned artifact is materialized.",
      "The seam's evidencePaths is a sibling of interface, never a field inside interface.",
      "Do not report an uncertainty for an implementation choice already resolved by the goal, even when the repository does not have that file or script yet; plan the required addition instead.",
      "Do not add fields outside the output shape; in particular, do not add notes to seam interfaces."
    ].join("\n"),
    user: JSON.stringify({
      task: {
        goal: input.goal.statement,
        requiredCriteria: input.goal.requiredCriteria,
        constraints: input.constraints,
        resolvedDecisions: input.resolvedDecisions
      },
      repository,
      outputShape: {
        rationale: "optional string",
        root: {
          kind: "composite",
          handle: "local-handle",
          title: "string",
          objective: "string",
          children: [{
            kind: "leaf",
            handle: "local-handle",
            title: "string",
            objective: "string",
            surface: {
              existingPaths: ["repo/relative/path"],
              plannedPaths: ["repo/relative/new/path"]
            },
            outcomes: [{
              statement: "observable result",
              covers: ["required-criterion-id"],
              verification: {
                kind: "repository_capability",
                capability: "supplied-script-name",
                references: ["repo/relative/test/path"]
              }
            }]
          }, {
            kind: "composite",
            handle: "local-handle",
            title: "string",
            objective: "string",
            children: ["leaf-or-composite objects using these exact variants"]
          }]
        },
        seams: [{
          handle: "local-seam-handle",
          producer: "module-handle",
          consumers: ["module-handle"],
          interface: {
            kind: "api | type | event | data | ui | command",
            specification: "precise semantic contract",
            compatibility: "exact | backward_compatible",
            materialization: "logical | files | manifest | commit",
            artifactPaths: ["empty for logical; required produced paths for files or manifest"],
            verification: "observable compatibility proof"
          },
          evidencePaths: ["repo/relative/path"]
        }],
        uncertainties: ["include only when the semantic decision cannot be made; a non-empty list makes the proposal unsafe"]
      }
    })
  };
}

export class InvalidSemanticProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSemanticProposalError";
  }
}

export function parseSemanticPlanningModelOutput(output: string): unknown {
  const parsed = parseJsonObjectCandidates(output);
  if (!parsed.ok) throw new InvalidSemanticProposalError(parsed.message);
  const documents = parsed.candidates
    .flatMap((candidate) => unwrapCliResponse(candidate.value))
    .filter((candidate) => !isProgressEnvelope(candidate));
  if (documents.length === 0) throw new InvalidSemanticProposalError("Model emitted no SemanticPlanDraft JSON object.");
  return documents[0];
}

function unwrapCliResponse(candidate: unknown): unknown[] {
  if (typeof candidate === "string") {
    const variants = [candidate];
    let normalized = candidate;
    for (let pass = 0; pass < 3; pass += 1) {
      normalized = normalized.split('\\"').join('"');
      variants.push(normalized);
    }
    try {
      const decoded = JSON.parse(candidate);
      if (typeof decoded === "string") variants.unshift(decoded);
    } catch {
      // Fall through to the escaped-object recovery below.
    }
    const values = variants.flatMap((variant) => {
      const nested = parseJsonObjectCandidates(variant);
      return nested.ok ? nested.candidates.map((item) => item.value) : [];
    });
    const semantic = values.find((value) => isRecord(value) && "root" in value && "seams" in value);
    return semantic === undefined ? values : [semantic];
  }
  if (isRecord(candidate)) {
    const response = typeof candidate.response === "string" ? candidate.response : undefined;
    if (response !== undefined) {
      const nested = unwrapCliResponse(response);
      if (nested.length > 0) return nested;
    }
    const embedded = Object.values(candidate)
      .filter((value): value is string => typeof value === "string" && value.includes("{"))
      .flatMap((value) => unwrapCliResponse(value));
    if (embedded.length > 0) return embedded;
  }
  return [candidate];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProgressEnvelope(candidate: unknown): boolean {
  return typeof candidate === "object"
    && candidate !== null
    && !Array.isArray(candidate)
    && (candidate as { type?: unknown }).type === "planning.node";
}
