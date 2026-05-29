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
  description: string;
  minNodes: number;
  maxNodes: number;
  maxDepth: number;
}

export const GRANULARITY_PROFILES: Record<DecompositionMode, GranularityProfile> = {
  coarse: {
    label: "coarse",
    description: "Few large tasks; surface-level breakdown; good for spikes and quick checks.",
    minNodes: 3,
    maxNodes: 8,
    maxDepth: 2
  },
  balanced: {
    label: "balanced",
    description: "Default delegability/clarity tradeoff. Mix of composites and leaves.",
    minNodes: 5,
    maxNodes: 12,
    maxDepth: 3
  },
  fine: {
    label: "fine",
    description: "Many atomic leaves; high parallelism potential; more coordination overhead.",
    minNodes: 9,
    maxNodes: 18,
    maxDepth: 4
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
    "## Target granularity",
    "",
    `- level: \`${profile.label}\``,
    `- description: ${profile.description}`,
    `- node count target: between **${profile.minNodes}** and **${profile.maxNodes}** nodes total`,
    `- depth target: at most **${profile.maxDepth}** (root has depth 0)`,
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
