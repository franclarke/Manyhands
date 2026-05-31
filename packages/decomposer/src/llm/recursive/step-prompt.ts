import type { StepInterface } from "./step-schema";

export const RECURSIVE_DECOMPOSER_PROMPT_VERSION = "manyhands.recursive-decomposer-prompt.v1";

export type Aggressiveness = "low" | "medium" | "high";

export interface StepPromptInputs {
  /** Title of the node being judged. */
  title: string;
  /** Goal of the node being judged. */
  goal: string;
  /** How aggressively to decompose (biases the atomicity threshold). */
  aggressiveness: Aggressiveness;
  /** Seams already defined by ancestors that this node may consume. */
  inheritedInterfaces: StepInterface[];
  /** Recursion levels still allowed below this node (0 forces atomic). */
  depthRemaining: number;
  /** Optional repo/stack hints to ground path and interface decisions. */
  workspaceHints?: string;
}

/** Per-level meaning of "a single cohesive unit" — the only knob aggressiveness turns. */
const COHESIVE_UNIT: Record<Aggressiveness, string> = {
  low: "a whole module or file (a group of related functions that ship together)",
  medium: "a small group of closely-related functions",
  high: "a single function"
};

export function buildStepPrompt(inputs: StepPromptInputs): { system: string; user: string } {
  const system = SYSTEM_PROMPT.replace("{{outputSchema}}", OUTPUT_SCHEMA_LITERAL);

  const interfacesBlock = inputs.inheritedInterfaces.length > 0
    ? inputs.inheritedInterfaces
        .map((i) => `- ${i.id} (${i.kind}): ${i.signature}\n    ${i.description}`)
        .join("\n")
    : "(none — this node is at or near the top of the tree)";

  const user = [
    "## Node to judge",
    "",
    `- title: ${inputs.title}`,
    `- goal: ${inputs.goal}`,
    "",
    "## Decomposition aggressiveness",
    "",
    `- level: \`${inputs.aggressiveness}\``,
    `- At this level, "a single cohesive unit" means: **${COHESIVE_UNIT[inputs.aggressiveness]}**.`,
    `- recursion levels remaining below this node: **${inputs.depthRemaining}** ` +
      `${inputs.depthRemaining === 0 ? "(you MUST return decision=\"atomic\")" : ""}`,
    "",
    "## Interfaces already in scope (you may have children consume these)",
    "",
    interfacesBlock,
    "",
    "## Workspace hints",
    "",
    inputs.workspaceHints ?? "(none)",
    "",
    "## Your task",
    "",
    "Apply the atomicity rubric to the node above and return STRICTLY valid JSON",
    "matching the schema. If you decompose, define the shared interfaces (seams)",
    "the children build against, and wire each child's `consumes`/`produces` to",
    "those interface ids. No prose outside the JSON."
  ].join("\n");

  return { system, user };
}

const OUTPUT_SCHEMA_LITERAL = `// One of these two shapes (discriminated by "decision"):

// ATOMIC — the node is a single implementable unit:
{
  "decision": "atomic",
  "reasoning": "string (why it is atomic at this aggressiveness)",
  "allowedPaths": ["glob", "..."],
  "forbiddenPaths": ["glob", "..."],
  "expectedFiles": ["concrete/file/path.ts", "..."],
  "acceptanceCriteria": ["string", "..."]   // at least one
}

// DECOMPOSE — split into children sharing explicit seams:
{
  "decision": "decompose",
  "reasoning": "string (why it must be split)",
  "sharedInterfaces": [
    {
      "id": "PascalOrCamel identifier",
      "kind": "type | function | module",
      "signature": "the real TS signature/definition, not just the name",
      "description": "what it does and the guarantees it offers"
    }
  ],
  "children": [
    {
      "id": "kebab-or-snake [a-z][a-z0-9_-]*",
      "title": "string",
      "goal": "string",
      "kind": "composite | leaf (optional hint)",
      "consumes": ["interfaceId", "..."],
      "produces": ["interfaceId", "..."]
    }
  ],
  "dependencies": [
    { "fromTaskId": "childId", "toTaskId": "childId", "type": "contractual | structural | logical", "rationale": "string (optional)" }
  ],
  "parentValidationCommands": [
    { "command": "npm", "args": ["test"] }
  ]
}`;

const SYSTEM_PROMPT = [
  "You are a senior software architect acting as the recursive planning agent inside ManyHands.",
  "",
  "You judge ONE node at a time. Your decision: is this node a single implementable unit",
  "(`atomic`), or must it be split into children that smaller subagents implement in isolation",
  "(`decompose`)?",
  "",
  "## Atomicity rubric — a node is ATOMIC when ALL of these hold:",
  "1. It maps to a single cohesive unit of implementation (the size of that unit is set by the",
  "   aggressiveness level given in the user message).",
  "2. Its acceptance criteria are verifiable by a focused test.",
  "3. It is self-contained given only: its goal, the interfaces it consumes, and the current",
  "   contents of its target files.",
  "4. It does NOT need to define a new shared abstraction that sibling tasks would depend on.",
  "   If it does, that abstraction belongs in this node's `sharedInterfaces` and the node must",
  "   DECOMPOSE so the abstraction becomes an explicit seam.",
  "",
  "## Absolute floor (regardless of aggressiveness):",
  "A leaf is NEVER smaller than a single coherent function. Do not split a single function into",
  "sub-steps (e.g. 'validate input' + 'run logic' + 'return'). That would create artificial",
  "coordination and conflicts. If the smallest sensible unit is one function, the node is atomic.",
  "",
  "## When you decompose — design the seams:",
  "- `sharedInterfaces` are the contracts (types, function signatures) the children share. Define",
  "  them with REAL signatures so each child can be built independently against the same seam.",
  "- Each child declares which interface ids it `consumes` (built by siblings/ancestors) and which",
  "  it `produces` (exposes for others). This is what lets the children run in parallel safely.",
  "- Add `dependencies` only when execution order truly matters.",
  "- Add `parentValidationCommands` that verify the integrated children honour the seams",
  "  (typically the project's test command).",
  "",
  "## Lowering variance:",
  "Reason locally about THIS node only. Do not plan the whole tree — you will be asked about each",
  "child separately. Keep ids stable and descriptive.",
  "",
  "The output is consumed by a strict JSON validator. Any deviation breaks planning.",
  "",
  "Output JSON schema (must match exactly):",
  "",
  "{{outputSchema}}"
].join("\n");
