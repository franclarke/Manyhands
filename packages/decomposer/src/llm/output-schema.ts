import { z } from "zod";

/**
 * Schema canónico que el LLM debe respetar. NO es el TaskGraph interno;
 * `normalize.ts` lo traduce. Mantenido permissivo en strings para tolerar
 * descripciones largas, pero estricto en estructura (IDs, depth, kind).
 */
export const DecomposerLlmNodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_-]*$/, "id must be lowercase, start with a letter, and contain only [a-z0-9_-]"),
  parentId: z.string().nullable(),
  title: z.string().min(1).max(160),
  goal: z.string().min(1).max(600),
  kind: z.union([z.literal("composite"), z.literal("leaf")]),
  depth: z.number().int().min(0).max(10),
  objective: z.string().max(800).optional(),
  allowedPaths: z.array(z.string().min(1)).max(60).default([]),
  forbiddenPaths: z.array(z.string().min(1)).max(60).default([]),
  expectedFiles: z.array(z.string().min(1)).max(60).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(400)).max(20).default([])
});

export type DecomposerLlmNode = z.infer<typeof DecomposerLlmNodeSchema>;

export const DecomposerLlmDependencySchema = z.object({
  fromTaskId: z.string().min(1),
  toTaskId: z.string().min(1),
  type: z.union([
    z.literal("contractual"),
    z.literal("structural"),
    z.literal("logical")
  ]),
  rationale: z.string().max(400).optional()
});

export type DecomposerLlmDependency = z.infer<typeof DecomposerLlmDependencySchema>;

export const DecomposerLlmOutputSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1200),
  assumptions: z.array(z.string().min(1).max(400)).max(20).default([]),
  risks: z.array(z.string().min(1).max(400)).max(20).default([]),
  nodes: z.array(DecomposerLlmNodeSchema).min(1).max(40),
  dependencies: z.array(DecomposerLlmDependencySchema).max(80).default([])
});

export type DecomposerLlmOutput = z.infer<typeof DecomposerLlmOutputSchema>;
