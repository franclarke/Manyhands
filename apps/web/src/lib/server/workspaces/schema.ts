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

export const WorkspaceFilesystemObjectIdSchema = z.object({
  version: z.literal(1),
  /** Filesystem device / volume identifier, serialized because stat bigint is not JSON-safe. */
  device: z.string().regex(/^\d+$/u),
  /** Stable inode / file id of the repository's git common directory. */
  file: z.string().regex(/^\d+$/u)
});

export type WorkspaceFilesystemObjectId = z.infer<typeof WorkspaceFilesystemObjectIdSchema>;

export const WorkspaceRepositoryIdentitySchema = z.object({
  version: z.literal(1),
  key: z.string().regex(/^[a-f0-9]{64}$/u),
  repoRealPath: z.string().min(1).max(1000),
  gitCommonDir: z.string().min(1).max(1000),
  /**
   * Stable authority when the filesystem exposes one. Optional only so files
   * persisted before physical identity v2 remain readable and can be upgraded.
   */
  filesystemObjectId: WorkspaceFilesystemObjectIdSchema.optional()
});

export type WorkspaceRepositoryIdentity = z.infer<typeof WorkspaceRepositoryIdentitySchema>;

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  color: z.string().regex(HEX_COLOR, "color must be a hex string like #cc785c").optional(),
  /** Optional hints surfaced to the LLM decomposer. Not used to execute anything yet. */
  repoPath: z.string().min(1).max(400).optional(),
  /** Stable physical Git identity; aliases share the same git common dir key. */
  repositoryIdentity: WorkspaceRepositoryIdentitySchema.optional(),
  packageManager: PackageManagerSchema.optional(),
  defaultBranch: z.string().min(1).max(120).optional(),
  allowedPaths: z.array(z.string().min(1).max(240)).max(40).optional(),
  testCommand: z.string().min(1).max(240).optional(),
  buildCommand: z.string().min(1).max(240).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMigrationConflictSchema = z.object({
  version: z.literal(1),
  repositoryKey: z.string().regex(/^[a-f0-9]{64}$/u),
  canonicalWorkspaceId: z.string().min(1),
  duplicateWorkspaceId: z.string().min(1),
  conflictingFields: z.array(z.string().min(1)),
  canonicalSnapshot: WorkspaceSchema,
  duplicateSnapshot: WorkspaceSchema,
  resolution: z.object({
    choice: z.union([z.literal("canonical"), z.literal("duplicate")]),
    resolvedAt: z.string().datetime()
  }).optional()
});

export type WorkspaceMigrationConflict = z.infer<typeof WorkspaceMigrationConflictSchema>;

export const WorkspaceFileSchema = z.object({
  version: z.literal(WORKSPACE_FILE_VERSION),
  workspaces: z.array(WorkspaceSchema).default([]),
  /** Legacy workspace id -> surviving canonical workspace id. */
  aliases: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** Full before-images for duplicate records whose configuration disagreed. */
  migrationConflicts: z.array(WorkspaceMigrationConflictSchema).optional()
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
