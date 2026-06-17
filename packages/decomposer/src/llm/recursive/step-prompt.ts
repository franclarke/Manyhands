import type { StepInterface } from "./step-schema";

export const RECURSIVE_DECOMPOSER_PROMPT_VERSION = "manyhands.recursive-decomposer-prompt.v2";

export type Aggressiveness = "low" | "medium" | "high" | "auto";

export interface StepPromptInputs {
  /** Title of the node being judged. */
  title: string;
  /** Goal of the node being judged. */
  goal: string;
  /** How aggressively to decompose (biases the atomicity threshold). */
  aggressiveness: Aggressiveness;
  /** Seams already defined by ancestors that this node may consume. */
  inheritedInterfaces: StepInterface[];
  /**
   * True only when the recursion safety rail has been reached and the node MUST
   * be returned atomic. This is an anti-runaway guard, NOT a planning signal:
   * the model never sees a target depth or a "levels remaining" count, so it
   * cannot steer toward a uniform tree shape. The stop criterion is local
   * atomicity, not depth.
   */
  atDepthLimit: boolean;
  /** Optional repo/stack hints to ground path and interface decisions. */
  workspaceHints?: string;
  /** Optional question previously asked to the user on this node. */
  userQuestion?: string;
  /** Optional response provided by the user to the previous question. */
  userAnswer?: string;
}

/**
 * Per-level meaning of "a single cohesive unit" — the only knob aggressiveness
 * turns. It sets how much pressure there is to keep splitting, i.e. how small a
 * leaf must be before the node is considered atomic. It does NOT set depth or
 * node count: a branch keeps splitting until its leaves reach this size, so
 * complex branches go deeper than simple ones and the tree is asymmetric.
 */
const COHESIVE_UNIT: Record<Aggressiveness, string> = {
  low: "a whole module or file (a group of related functions that ship together). Low pressure to split: only decompose nodes that are clearly composite.",
  medium: "a small group of closely-related functions. Balanced pressure: split until each leaf is a reasonably executable unit.",
  high: "a single function or a tightly-scoped pair of functions. High pressure: keep splitting until every leaf is small, concrete, assignable and verifiable.",
  // Adaptive: the model sets the threshold for THIS node from its own complexity.
  auto: "whatever size matches THIS node's complexity — you choose. First judge how complex this specific node is: a simple, self-contained node should stay a larger leaf (a whole module or file) and go atomic sooner; a complex, multi-concern node should split into smaller leaves (down to closely-related functions, or a single function when the concern is genuinely fine-grained). Calibrate the split pressure per branch, not uniformly across the tree."
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
    "- Decide locally: split only if this node is NOT yet a single cohesive unit at the level above.",
    "  Do not aim for any particular tree depth or node count — sibling branches may end at different",
    "  depths, and that is expected.",
    ...(inputs.atDepthLimit
      ? [
          "- NOTE: a recursion safety limit has been reached for this branch. Return",
          "  `decision: \"atomic\"` now even if you would otherwise split."
        ]
      : []),
    "",
    ...(inputs.userQuestion !== undefined && inputs.userAnswer !== undefined
      ? [
          "## User feedback on this node",
          "",
          `- You previously asked: "${inputs.userQuestion}"`,
          `- The user responded: "${inputs.userAnswer}"`,
          "- Use this feedback to resolve the ambiguity and make your final decision (do NOT output a question decision again for this node).",
          ""
        ]
      : []),
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

const OUTPUT_SCHEMA_LITERAL = `// One of these three shapes (discriminated by "decision"):

// ATOMIC — the node is a single implementable unit:
{
  "decision": "atomic",
  "reasoning": "string (why it is atomic at this aggressiveness)",
  "allowedPaths": ["glob", "..."],
  "forbiddenPaths": ["glob", "..."],
  "expectedFiles": ["concrete/file/path.ts", "..."],
  "acceptanceCriteria": ["string", "..."],   // at least one
  "leafValidationCommands": [
    { "command": "npm", "args": ["test", "--", "src/x.test.ts"] }
  ]  // optional focused commands that verify this leaf after implementation
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
  ],  // default to [] unless real execution order is required
  "parentValidationCommands": [
    { "command": "npm", "args": ["test"] }
  ]
}

// QUESTION — ask a clarifying question before deciding (only for true ambiguity or design forks):
{
  "decision": "question",
  "reasoning": "string (why you need clarification)",
  "question": "string (clear, direct multiple-choice question to the user)",
  "options": ["option 1 string", "option 2 string", "..."] // 2 to 10 options
}`;

const SYSTEM_PROMPT = [
  "You are a senior software architect acting as the recursive planning agent inside ManyHands.",
  "",
  "You judge ONE node at a time. Your decision: is this node a single implementable unit",
  "(`atomic`), or must it be split into children that smaller subagents implement in isolation",
  "(`decompose`)? Or, if there is a major architectural/scope ambiguity or a design fork that",
  "you must resolve before deciding, you can ask the user a clarifying question (`question`).",
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
  "## Clarifying questions to the user:",
  "Use `decision: \"question\"` very sparingly, only when you face true design forks or ambiguity",
  "(such as choice of library, state management strategy, database vs localStorage persistency) that",
  "significantly alters the graph decomposition structure. State your query clearly as a",
  "multiple-choice question with 2 to 10 options in `options`. Keep each option a concise",
  "label (well under 240 characters) — put any rationale in `reasoning`, not in the options.",
  "List the single most reasonable default option FIRST: an unattended (autonomous) run",
  "picks options[0], so it must be the safe, sensible default.",
  "",
  "## When you decompose — design the seams:",
  "- `sharedInterfaces` are the contracts (types, function signatures) the children share. Define",
  "  them with REAL signatures so each child can be built independently against the same seam.",
  "- Each child declares which interface ids it `consumes` (built by siblings/ancestors) and which",
  "  it `produces` (exposes for others). This is what lets the children run in parallel safely.",
  "- `consumes`/`produces` are interface contracts, not execution dependencies. A child can build",
  "  against a shared interface without waiting for another child to finish.",
  "- Default `dependencies` to [] for siblings. Add one only when the target child truly cannot",
  "  start until the source child's concrete files or side effects already exist in the worktree",
  "  (for example: generated schema before codegen, migration before repository wiring).",
  "- Do not create dependency chains just because UI consumes state/types, tests use production",
  "  code, or multiple leaves touch related concepts. Those are normal parallel leaves.",
  "- Add `parentValidationCommands` that verify the integrated children honour the seams",
  "  (typically the project's test command).",
  "- NO crees nodos cuyo único propósito sea correr tests/typecheck/build/lint o verificar",
  "  la integración. La verificación se expresa como `leafValidationCommands` en la hoja",
  "  que produce el código, o como `parentValidationCommands` en el composite.",
  "- Crear una hoja solo cuando produce o modifica código fuente/tests como entregable.",
  "",
  "## Lowering variance:",
  "Reason locally about THIS node only. Do not plan the whole tree — you will be asked about each",
  "child separately. Keep ids stable and descriptive.",
  "",
  "## Tree shape:",
  "The stop criterion is local atomicity, never a target depth or node count. A simple branch may",
  "be atomic immediately (depth 1) while a complex sibling keeps splitting several levels deeper.",
  "An asymmetric, irregular tree that mirrors real complexity is the correct outcome — do not try to",
  "balance branches or hit a uniform depth.",
  "",
  "The output is consumed by a strict JSON validator. Any deviation breaks planning.",
  "",
  "Output JSON schema (must match exactly):",
  "",
  "{{outputSchema}}"
].join("\n");
