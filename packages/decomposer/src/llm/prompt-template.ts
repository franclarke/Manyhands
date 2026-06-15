import type { DecompositionMode } from "../index";

export const DECOMPOSER_PROMPT_TEMPLATE_VERSION = "manyhands.decomposer-prompt.v1";

export interface PromptInputs {
  userPrompt: string;
  granularity: DecompositionMode;
  workspaceHints?: WorkspaceHints;
}

export interface WorkspaceHints {
  name: string;
  repoPath?: string;
  packageManager?: string;
  defaultBranch?: string;
  allowedPaths?: ReadonlyArray<string>;
  testCommand?: string;
  buildCommand?: string;
}

interface GranularityProfile {
  label: string;
  /** How aggressively to keep splitting — the pressure to decompose, not a shape. */
  aggressiveness: string;
  /** Size of the smallest sensible leaf ("a single cohesive unit") at this level. */
  cohesiveUnit: string;
}

/**
 * Granularity is an aggressiveness control, not a depth/count target. Each level
 * only sets how small a leaf must become before a node is considered atomic; the
 * planner then splits each branch independently until its leaves reach that size.
 * Different branches reach different depths — the tree is expected to be
 * asymmetric. No level fixes a node count or a maximum depth.
 */
export const GRANULARITY_PROFILES: Record<DecompositionMode, GranularityProfile> = {
  coarse: {
    label: "coarse",
    aggressiveness:
      "Low pressure to split. Decompose only nodes that are clearly composite; leave naturally cohesive work as a single leaf.",
    cohesiveUnit: "a whole module or file (a group of related functions that ship together)"
  },
  balanced: {
    label: "balanced",
    aggressiveness:
      "Balanced pressure. Split tasks and subtasks as needed until each leaf is a reasonably executable unit.",
    cohesiveUnit: "a small group of closely-related functions"
  },
  fine: {
    label: "fine",
    aggressiveness:
      "High pressure to split. Keep decomposing until every leaf is small, concrete, assignable and verifiable.",
    cohesiveUnit: "a single function or a tightly-scoped pair of functions"
  },
  // Single-pass prompting cannot adapt per-branch, so "auto" maps to the
  // balanced profile here. True adaptive behaviour lives in the recursive
  // decomposer's per-node step prompt.
  auto: {
    label: "auto",
    aggressiveness:
      "Balanced pressure. Split tasks and subtasks as needed until each leaf is a reasonably executable unit.",
    cohesiveUnit: "a small group of closely-related functions"
  }
};

export function buildDecomposerPrompt(inputs: PromptInputs): { system: string; user: string } {
  const profile = GRANULARITY_PROFILES[inputs.granularity];

  const workspaceHintsBlock = inputs.workspaceHints !== undefined
    ? formatWorkspaceHints(inputs.workspaceHints)
    : "No workspace hints provided.";

  const system = SYSTEM_PROMPT.replace("{{outputSchema}}", OUTPUT_SCHEMA_LITERAL);

  const user = [
    "## User goal (free text from developer)",
    "",
    inputs.userPrompt.length > 0 ? inputs.userPrompt : "(empty prompt; use workspace hints to propose a small generic feature)",
    "",
    "## Decomposition aggressiveness",
    "",
    `- level: \`${profile.label}\``,
    `- ${profile.aggressiveness}`,
    `- A leaf is "a single cohesive unit" = ${profile.cohesiveUnit}. Keep splitting a branch until its`,
    "  leaves reach that size, then stop.",
    "- Decide per task by complexity: a simple branch may be a single leaf while a complex one nests",
    "  several levels deeper. Do NOT aim for a fixed node count or a uniform depth — an asymmetric,",
    "  irregular tree that mirrors real complexity is the correct outcome.",
    "",
    "## Workspace hints",
    "",
    workspaceHintsBlock,
    "",
    "## Output requirements",
    "",
    "- Return STRICTLY valid JSON matching the schema above. No prose, no markdown, no backticks.",
    "- Exactly one root node with `parentId: null` and `depth: 0`.",
    "- Each `parentId` must reference an existing node `id`.",
    "- `dependencies` may not include cycles. They reference task `id`s.",
    "- Each `leaf` node must have at least one `acceptanceCriteria` item.",
    "- IDs must be lowercase, start with a letter, contain only [a-z0-9_-].",
    "- Prefer concrete, scoped tasks. Avoid generic placeholders like \"build feature\"."
  ].join("\n");

  return { system, user };
}

function formatWorkspaceHints(hints: WorkspaceHints): string {
  const lines = [`- name: ${hints.name}`];
  if (hints.repoPath !== undefined) lines.push(`- repoPath: ${hints.repoPath}`);
  if (hints.packageManager !== undefined) lines.push(`- packageManager: ${hints.packageManager}`);
  if (hints.defaultBranch !== undefined) lines.push(`- defaultBranch: ${hints.defaultBranch}`);
  if (hints.allowedPaths !== undefined && hints.allowedPaths.length > 0) {
    lines.push(`- allowedPaths: ${hints.allowedPaths.slice(0, 12).join(", ")}`);
  }
  if (hints.testCommand !== undefined) lines.push(`- testCommand: ${hints.testCommand}`);
  if (hints.buildCommand !== undefined) lines.push(`- buildCommand: ${hints.buildCommand}`);
  return lines.join("\n");
}

const OUTPUT_SCHEMA_LITERAL = `{
  "title": "string (max 160)",
  "summary": "string (max 1200)",
  "assumptions": ["string (max 400)", "..."],
  "risks": ["string (max 400)", "..."],
  "nodes": [
    {
      "id": "kebab-or-snake string [a-z][a-z0-9_-]*",
      "parentId": "string | null",
      "kind": "composite | leaf",
      "depth": 0,
      "title": "string",
      "goal": "string",
      "objective": "string (optional)",
      "allowedPaths": ["string", "..."],
      "forbiddenPaths": ["string", "..."],
      "expectedFiles": ["string", "..."],
      "acceptanceCriteria": ["string", "..."]
    }
  ],
  "dependencies": [
    {
      "fromTaskId": "string",
      "toTaskId": "string",
      "type": "contractual | structural | logical",
      "rationale": "string (optional)"
    }
  ]
}`;

const SYSTEM_PROMPT = [
  "You are a senior software engineer acting as a planning agent inside ManyHands, a multi-agent orchestration tool.",
  "",
  "Your job: decompose a free-text developer goal into a hierarchical DAG of atomic tasks that smaller subagents can implement in isolation.",
  "",
  "Rules:",
  "- Produce a tree of composite + leaf nodes. Leaves are the unit of subagent work.",
  "- Prefer narrow scopes per leaf: a focused file/module change with clear acceptance criteria.",
  "- Include explicit `allowedPaths` and `forbiddenPaths` per leaf when the workspace hints suggest a structure.",
  "- Add `dependencies` only when execution order matters (e.g., DB migration must precede repository layer).",
  "- Do NOT hallucinate file paths if no workspace hints exist; leave arrays empty.",
  "- The output is consumed by a strict JSON validator. Any deviation breaks the canvas; the system will fall back to a deterministic decomposer.",
  "",
  "Output JSON schema (must match exactly):",
  "",
  "{{outputSchema}}"
].join("\n");
