import { z } from "zod";
import { validationCommandSafetyIssues } from "@manyhands/contracts";

/**
 * Output schema for a SINGLE recursive-decomposition step (one node).
 *
 * Unlike the single-pass decomposer (which emits the whole tree at once), the
 * recursive decomposer asks the LLM one local question per node: *given this
 * goal and the seams already in scope, is it atomic, or should it be split?* —
 * and, if split, what shared interfaces (seams) do the children share. The
 * discriminated union on `decision` makes the two outcomes explicit and
 * strictly validatable. See docs/design/decomposer-composer-redesign.md.
 */

/** Interface seam as authored by the LLM (we fill `definedAtNodeId` ourselves). */
export const StepInterfaceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "interface id must start with a letter and be alphanumeric/underscore"),
  kind: z.union([z.literal("type"), z.literal("function"), z.literal("module")]),
  signature: z.string().min(1).max(2000),
  description: z.string().min(1).max(600)
});

export type StepInterface = z.infer<typeof StepInterfaceSchema>;

const StepChildSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_-]*$/, "id must be lowercase, start with a letter, and contain only [a-z0-9_-]"),
  title: z.string().min(1).max(160),
  goal: z.string().min(1).max(600),
  kind: z.union([z.literal("composite"), z.literal("leaf")]).optional(),
  /** Interface ids (from sharedInterfaces or inherited) this child builds against. */
  consumes: z.array(z.string().min(1)).max(40).default([]),
  /** Interface ids this child must expose. */
  produces: z.array(z.string().min(1)).max(40).default([])
});

export type StepChild = z.infer<typeof StepChildSchema>;

const StepDependencySchema = z.object({
  fromTaskId: z.string().min(1),
  toTaskId: z.string().min(1),
  type: z.union([z.literal("contractual"), z.literal("structural"), z.literal("logical")]),
  rationale: z.string().max(400).optional()
});

export type StepDependency = z.infer<typeof StepDependencySchema>;

// Unsafe commands fail the parse so the model's retry loop (stricter JSON
// instructions) gets a chance to fix them, instead of reaching the runner.
const StepValidationCommandSchema = z
  .object({
    command: z.string().min(1).max(200),
    args: z.array(z.string()).max(40).default([])
  })
  .superRefine((value, ctx) => {
    for (const issue of validationCommandSafetyIssues(value.command, value.args)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unsafe validation command: ${issue}` });
    }
  });

const AtomicStepSchema = z.object({
  decision: z.literal("atomic"),
  reasoning: z.string().min(1).max(800),
  allowedPaths: z.array(z.string().min(1)).max(60).default([]),
  forbiddenPaths: z.array(z.string().min(1)).max(60).default([]),
  expectedFiles: z.array(z.string().min(1)).max(60).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(400)).min(1).max(20)
});

const DecomposeStepSchema = z.object({
  decision: z.literal("decompose"),
  reasoning: z.string().min(1).max(800),
  sharedInterfaces: z.array(StepInterfaceSchema).max(40).default([]),
  children: z.array(StepChildSchema).min(2).max(12),
  dependencies: z.array(StepDependencySchema).max(60).default([]),
  parentValidationCommands: z.array(StepValidationCommandSchema).max(20).default([])
});

const QuestionStepSchema = z.object({
  decision: z.literal("question"),
  reasoning: z.string().min(1).max(800),
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(100)).min(2).max(10)
});

export const DecomposeStepOutputSchema = z.discriminatedUnion("decision", [
  AtomicStepSchema,
  DecomposeStepSchema,
  QuestionStepSchema
]);

export type DecomposeStepOutput = z.infer<typeof DecomposeStepOutputSchema>;
export type AtomicStep = z.infer<typeof AtomicStepSchema>;
export type DecomposeStep = z.infer<typeof DecomposeStepSchema>;
export type QuestionStep = z.infer<typeof QuestionStepSchema>;

