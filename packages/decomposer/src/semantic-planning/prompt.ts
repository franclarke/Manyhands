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
      "Every required criterion must be covered by at least one leaf outcome.",
      "Every existingPath and verification reference must appear in the supplied repository files.",
      "Use only supplied script names as repository_capability values.",
      "A seam must name one producer and one or more consumers and keep specification, compatibility, materialization, verification, and evidence together."
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
    .map((candidate) => candidate.value)
    .filter((candidate) => !isProgressEnvelope(candidate));
  if (documents.length === 0) throw new InvalidSemanticProposalError("Model emitted no SemanticPlanDraft JSON object.");
  return documents[0];
}

function isProgressEnvelope(candidate: unknown): boolean {
  return typeof candidate === "object"
    && candidate !== null
    && !Array.isArray(candidate)
    && (candidate as { type?: unknown }).type === "planning.node";
}
