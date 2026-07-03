import { z } from "zod";

export const WORKSPACE_FILE_VERSION = 1;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const PackageManagerSchema = z.union([
  z.literal("pnpm"),
  z.literal("npm"),
  z.literal("yarn"),
  z.literal("bun")
]);

export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  color: z.string().regex(HEX_COLOR, "color must be a hex string like #cc785c").optional(),
  /** Optional hints surfaced to the LLM decomposer. Not used to execute anything yet. */
  repoPath: z.string().min(1).max(400).optional(),
  packageManager: PackageManagerSchema.optional(),
  defaultBranch: z.string().min(1).max(120).optional(),
  allowedPaths: z.array(z.string().min(1).max(240)).max(40).optional(),
  testCommand: z.string().min(1).max(240).optional(),
  buildCommand: z.string().min(1).max(240).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceFileSchema = z.object({
  version: z.literal(WORKSPACE_FILE_VERSION),
  workspaces: z.array(WorkspaceSchema).default([])
});

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

const WorkspaceMutableShape = {
  name: z.string().trim().min(1, "name is required").max(80, "name must be ≤80 chars"),
  description: z.string().trim().max(400, "description must be ≤400 chars").optional(),
  color: z.string().regex(HEX_COLOR, "color must be a hex string").optional(),
  repoPath: z.string().trim().min(1).max(400).optional(),
  packageManager: PackageManagerSchema.optional(),
  defaultBranch: z.string().trim().min(1).max(120).optional(),
  allowedPaths: z.array(z.string().trim().min(1).max(240)).max(40).optional(),
  testCommand: z.string().trim().min(1).max(240).optional(),
  buildCommand: z.string().trim().min(1).max(240).optional()
};

export const WorkspaceCreateInputSchema = z.object(WorkspaceMutableShape);

export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInputSchema>;

export const WorkspaceUpdateInputSchema = z.object({
  ...WorkspaceMutableShape,
  name: WorkspaceMutableShape.name.optional()
});

export type WorkspaceUpdateInput = z.infer<typeof WorkspaceUpdateInputSchema>;
