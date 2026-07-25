import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../repo-root";
import { atomicWriteJson } from "./atomic-write";
import {
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  WorkspaceConflictError
} from "./errors";
import { defaultWorkspaceIdFactory, type WorkspaceIdFactory } from "./id";
import { withWorkspaceFileLock, type WorkspaceFileLockOptions } from "./file-lock";
import { resolveWorkspaceRepositoryIdentity } from "./repository-identity";
import { slugify, uniqueSlug } from "./slug";
import {
  WORKSPACE_FILE_VERSION,
  WorkspaceCreateInputSchema,
  WorkspaceFileSchema,
  WorkspaceUpdateInputSchema,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceFile,
  type WorkspaceMigrationConflict,
  type WorkspaceRepositoryIdentity
} from "./schema";

export type WorkspaceMigrationResolutionChoice = "canonical" | "duplicate";

export interface WorkspaceRepositorySnapshot {
  workspaces: Workspace[];
  migrationConflicts: WorkspaceMigrationConflict[];
}

export interface WorkspaceMigrationResolution {
  workspace: Workspace;
  migrationConflict: WorkspaceMigrationConflict;
}

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  snapshot(): Promise<WorkspaceRepositorySnapshot>;
  get(id: string): Promise<Workspace>;
  getBySlug(slug: string): Promise<Workspace | null>;
  create(input: unknown): Promise<Workspace>;
  update(id: string, input: unknown): Promise<Workspace>;
  delete(id: string): Promise<void>;
  /** Canonical id plus every legacy id migrated to it. */
  equivalentIds(id: string): Promise<string[]>;
  /**
   * Every id — canonical and legacy alias alike — mapped to its workspace, in a
   * single locked read. Callers resolving a batch of arbitrary workspace ids
   * must use this instead of one `equivalentIds` per workspace: each read takes
   * the cross-process file lock, so the per-workspace form is an N+1 over a
   * mutex and dominates the request it belongs to.
   */
  indexById(): Promise<Map<string, Workspace>>;
  resolveMigrationConflict(
    duplicateWorkspaceId: string,
    choice: WorkspaceMigrationResolutionChoice
  ): Promise<WorkspaceMigrationResolution>;
}

export interface JsonWorkspaceRepositoryOptions {
  filePath: string;
  seeds?: ReadonlyArray<WorkspaceCreateInput>;
  idFactory?: WorkspaceIdFactory;
  clock?: () => string;
  lockOptions?: WorkspaceFileLockOptions;
}

const DEFAULT_SEEDS: ReadonlyArray<WorkspaceCreateInput> = [
  { name: "ManyHands", description: "Visual orchestration workspace · this repo" },
  { name: "Aprobado", description: "Demo workspace for product walkthroughs" }
];

export class JsonWorkspaceRepository implements WorkspaceRepository {
  private readonly filePath: string;
  private readonly seeds: ReadonlyArray<WorkspaceCreateInput>;
  private readonly idFactory: WorkspaceIdFactory;
  private readonly clock: () => string;
  private readonly lockOptions: WorkspaceFileLockOptions;
  private writeChain: Promise<unknown> = Promise.resolve();
  private initialized = false;

  constructor(options: JsonWorkspaceRepositoryOptions) {
    this.filePath = options.filePath;
    this.seeds = options.seeds ?? DEFAULT_SEEDS;
    this.idFactory = options.idFactory ?? defaultWorkspaceIdFactory;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.lockOptions = options.lockOptions ?? {};
  }

  async list(): Promise<Workspace[]> {
    return (await this.snapshot()).workspaces;
  }

  async snapshot(): Promise<WorkspaceRepositorySnapshot> {
    return this.withLock(async () => {
      const file = await this.ensureSeeded();
      const workspaces = [...file.workspaces].sort((left, right) => {
        const compare = right.updatedAt.localeCompare(left.updatedAt);
        if (compare !== 0) return compare;
        return left.name.localeCompare(right.name);
      });
      return {
        workspaces,
        migrationConflicts: (file.migrationConflicts ?? []).map(cloneMigrationConflict)
      };
    });
  }

  async get(id: string): Promise<Workspace> {
    return this.withLock(async () => {
      const file = await this.readOrEmpty();
      const canonicalId = resolveAlias(file.aliases, id);
      const workspace = file.workspaces.find((entry) => entry.id === canonicalId);
      if (workspace === undefined) throw new WorkspaceNotFoundError(id);
      return workspace;
    });
  }

  async getBySlug(slug: string): Promise<Workspace | null> {
    return this.withLock(async () => {
      const file = await this.readOrEmpty();
      return file.workspaces.find((entry) => entry.slug === slug) ?? null;
    });
  }

  async indexById(): Promise<Map<string, Workspace>> {
    return this.withLock(async () => {
      const file = await this.ensureSeeded();
      const byCanonicalId = new Map(file.workspaces.map((entry) => [entry.id, entry]));
      const index = new Map(byCanonicalId);
      for (const alias of Object.keys(file.aliases ?? {})) {
        const workspace = byCanonicalId.get(resolveAlias(file.aliases, alias));
        if (workspace !== undefined) index.set(alias, workspace);
      }
      return index;
    });
  }

  async equivalentIds(id: string): Promise<string[]> {
    return this.withLock(async () => {
      const file = await this.readOrEmpty();
      const canonicalId = resolveAlias(file.aliases, id);
      if (!file.workspaces.some((entry) => entry.id === canonicalId)) return [id];
      const aliases = Object.entries(file.aliases ?? {})
        .filter(([, target]) => resolveAlias(file.aliases, target) === canonicalId)
        .map(([alias]) => alias);
      return [canonicalId, ...aliases];
    });
  }

  async resolveMigrationConflict(
    duplicateWorkspaceId: string,
    choice: WorkspaceMigrationResolutionChoice
  ): Promise<WorkspaceMigrationResolution> {
    return this.withLock(async () => {
      const file = await this.ensureSeeded();
      const conflictIndex = (file.migrationConflicts ?? []).findIndex(
        (entry) => entry.duplicateWorkspaceId === duplicateWorkspaceId
      );
      const conflict = file.migrationConflicts?.[conflictIndex];
      if (conflictIndex < 0 || conflict === undefined) {
        throw new WorkspaceNotFoundError(`migration-conflict:${duplicateWorkspaceId}`);
      }
      const canonicalIndex = file.workspaces.findIndex(
        (entry) => entry.id === conflict.canonicalWorkspaceId
      );
      const current = file.workspaces[canonicalIndex];
      if (canonicalIndex < 0 || current === undefined) {
        throw new WorkspaceConflictError(
          `Migration conflict ${duplicateWorkspaceId} refers to missing canonical workspace ${conflict.canonicalWorkspaceId}`
        );
      }
      if (conflict.resolution !== undefined) {
        if (conflict.resolution.choice !== choice) {
          throw new WorkspaceConflictError(
            `Migration conflict ${duplicateWorkspaceId} was already resolved as ${conflict.resolution.choice}`
          );
        }
        return { workspace: current, migrationConflict: cloneMigrationConflict(conflict) };
      }

      const chosen = choice === "canonical" ? conflict.canonicalSnapshot : conflict.duplicateSnapshot;
      const now = this.clock();
      const workspace = applyConfigurationSnapshot(current, chosen, now);
      const migrationConflict: WorkspaceMigrationConflict = {
        ...cloneMigrationConflict(conflict),
        resolution: { choice, resolvedAt: now }
      };
      const next: WorkspaceFile = {
        version: WORKSPACE_FILE_VERSION,
        workspaces: file.workspaces.map((entry, index) => index === canonicalIndex ? workspace : entry),
        ...(file.aliases !== undefined ? { aliases: file.aliases } : {}),
        migrationConflicts: (file.migrationConflicts ?? []).map((entry, index) =>
          index === conflictIndex ? migrationConflict : entry
        )
      };
      await atomicWriteJson(this.filePath, next);
      return { workspace, migrationConflict };
    });
  }

  async create(input: unknown): Promise<Workspace> {
    return this.withLock(async () => {
      const parsed = WorkspaceCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new WorkspaceValidationError(parsed.error.issues[0]?.message ?? "Invalid workspace input");
      }
      const file = await this.ensureSeeded();
      const repositoryIdentity = parsed.data.repoPath === undefined
        ? undefined
        : await requireRepositoryIdentity(parsed.data.repoPath);
      assertUniqueRepository(file, repositoryIdentity);
      const slug = uniqueSlug(slugify(parsed.data.name), new Set(file.workspaces.map((w) => w.slug)));
      const now = this.clock();
      const workspace: Workspace = {
        id: this.idFactory(),
        slug,
        name: parsed.data.name,
        createdAt: now,
        updatedAt: now
      };
      applyOptionalFields(workspace, parsed.data);
      applyRepositoryIdentity(workspace, parsed.data.repoPath, repositoryIdentity);
      const next: WorkspaceFile = {
        version: WORKSPACE_FILE_VERSION,
        workspaces: [...file.workspaces, workspace],
        ...(file.aliases !== undefined ? { aliases: file.aliases } : {}),
        ...(file.migrationConflicts !== undefined ? { migrationConflicts: file.migrationConflicts } : {})
      };
      await atomicWriteJson(this.filePath, next);
      return workspace;
    });
  }

  async update(id: string, input: unknown): Promise<Workspace> {
    return this.withLock(async () => {
      const parsed = WorkspaceUpdateInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new WorkspaceValidationError(parsed.error.issues[0]?.message ?? "Invalid workspace update");
      }
      const file = await this.ensureSeeded();
      const canonicalId = resolveAlias(file.aliases, id);
      const index = file.workspaces.findIndex((entry) => entry.id === canonicalId);
      if (index === -1) {
        throw new WorkspaceNotFoundError(id);
      }
      const current = file.workspaces[index];
      if (current === undefined) {
        throw new WorkspaceNotFoundError(id);
      }
      const repositoryIdentity = parsed.data.repoPath === undefined
        ? current.repositoryIdentity
        : await requireRepositoryIdentity(parsed.data.repoPath);
      assertUniqueRepository(file, repositoryIdentity, current.id);
      const merged: Workspace = {
        id: current.id,
        slug: current.slug,
        name: parsed.data.name ?? current.name,
        createdAt: current.createdAt,
        updatedAt: this.clock()
      };
      // Preserve previously-set fields then overlay any updates from the PATCH.
      applyOptionalFields(merged, current);
      applyOptionalFields(merged, parsed.data);
      if (parsed.data.repoPath !== undefined) {
        applyRepositoryIdentity(merged, parsed.data.repoPath, repositoryIdentity);
      }
      const next: WorkspaceFile = {
        version: WORKSPACE_FILE_VERSION,
        workspaces: file.workspaces.map((entry, idx) => (idx === index ? merged : entry)),
        ...(file.aliases !== undefined ? { aliases: file.aliases } : {}),
        ...(file.migrationConflicts !== undefined ? { migrationConflicts: file.migrationConflicts } : {})
      };
      await atomicWriteJson(this.filePath, next);
      return merged;
    });
  }

  async delete(id: string): Promise<void> {
    await this.withLock(async () => {
      const file = await this.ensureSeeded();
      if (file.aliases?.[id] !== undefined) {
        throw new WorkspaceConflictError(`Workspace ${id} is a legacy alias and cannot be deleted directly`);
      }
      const next = file.workspaces.filter((entry) => entry.id !== id);
      if (next.length === file.workspaces.length) {
        throw new WorkspaceNotFoundError(id);
      }
      if (next.length === 0) {
        throw new WorkspaceConflictError("Cannot delete the last workspace");
      }
      const remainingMigrationConflicts = (file.migrationConflicts ?? []).filter(
        (conflict) => conflict.canonicalWorkspaceId !== id
      );
      await atomicWriteJson(this.filePath, {
        version: WORKSPACE_FILE_VERSION,
        workspaces: next,
        ...(file.aliases !== undefined
          ? { aliases: Object.fromEntries(Object.entries(file.aliases).filter(([, target]) => target !== id)) }
          : {}),
        ...(remainingMigrationConflicts.length > 0
          ? { migrationConflicts: remainingMigrationConflicts }
          : {})
      } satisfies WorkspaceFile);
    });
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const execute = () => withWorkspaceFileLock(this.filePath, fn, this.lockOptions);
    const next = this.writeChain.then(execute, execute);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async ensureSeeded(): Promise<WorkspaceFile> {
    const file = await this.readOrEmpty();
    if (this.initialized) {
      return file;
    }
    if (file.workspaces.length > 0 || this.seeds.length === 0) {
      this.initialized = true;
      return file;
    }
    const now = this.clock();
    const seeded: Workspace[] = [];
    const slugs = new Set<string>();
    for (const seed of this.seeds) {
      const slug = uniqueSlug(slugify(seed.name), slugs);
      slugs.add(slug);
      const workspace: Workspace = {
        id: this.idFactory(),
        slug,
        name: seed.name,
        createdAt: now,
        updatedAt: now
      };
      if (seed.description !== undefined) {
        workspace.description = seed.description;
      }
      if (seed.color !== undefined) {
        workspace.color = seed.color;
      }
      seeded.push(workspace);
    }
    const next: WorkspaceFile = {
      version: WORKSPACE_FILE_VERSION,
      workspaces: seeded
    };
    await atomicWriteJson(this.filePath, next);
    this.initialized = true;
    return next;
  }

  private async readOrEmpty(): Promise<WorkspaceFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, { encoding: "utf8" });
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") {
        return { version: WORKSPACE_FILE_VERSION, workspaces: [] };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WorkspaceValidationError(`Workspaces file at ${this.filePath} is not valid JSON`);
    }
    const result = WorkspaceFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new WorkspaceValidationError(
        `Workspaces file at ${this.filePath} failed validation: ${result.error.issues[0]?.message ?? "unknown error"}`
      );
    }
    if (result.data.version !== WORKSPACE_FILE_VERSION) {
      throw new WorkspaceValidationError(
        `Unsupported workspaces file version: ${result.data.version}`
      );
    }
    const migrated = await migrateWorkspaceFile(result.data);
    if (migrated.changed) await atomicWriteJson(this.filePath, migrated.file);
    return migrated.file;
  }
}

interface NodeErrnoException {
  code?: string;
}

function isErrno(value: unknown): value is NodeErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}

interface OptionalWorkspaceFields {
  description?: string | undefined;
  color?: string | undefined;
  repoPath?: string | undefined;
  packageManager?: Workspace["packageManager"] | undefined;
  defaultBranch?: string | undefined;
  allowedPaths?: string[] | undefined;
  testCommand?: string | undefined;
  buildCommand?: string | undefined;
  repositoryIdentity?: WorkspaceRepositoryIdentity | undefined;
}

function applyOptionalFields(target: Workspace, source: OptionalWorkspaceFields): void {
  if (source.description !== undefined && source.description !== "") target.description = source.description;
  if (source.color !== undefined) target.color = source.color;
  if (source.repoPath !== undefined && source.repoPath !== "") target.repoPath = source.repoPath;
  if (source.packageManager !== undefined) target.packageManager = source.packageManager;
  if (source.defaultBranch !== undefined && source.defaultBranch !== "") target.defaultBranch = source.defaultBranch;
  if (source.allowedPaths !== undefined && source.allowedPaths.length > 0) target.allowedPaths = [...source.allowedPaths];
  if (source.testCommand !== undefined && source.testCommand !== "") target.testCommand = source.testCommand;
  if (source.buildCommand !== undefined && source.buildCommand !== "") target.buildCommand = source.buildCommand;
  if (source.repositoryIdentity !== undefined) target.repositoryIdentity = source.repositoryIdentity;
}

function applyRepositoryIdentity(
  workspace: Workspace,
  requestedPath: string | undefined,
  identity: WorkspaceRepositoryIdentity | undefined
): void {
  if (requestedPath === undefined) return;
  workspace.repoPath = identity?.repoRealPath ?? requestedPath;
  if (identity === undefined) delete workspace.repositoryIdentity;
  else workspace.repositoryIdentity = identity;
}

async function requireRepositoryIdentity(repoPath: string): Promise<WorkspaceRepositoryIdentity> {
  const identity = await resolveWorkspaceRepositoryIdentity(repoPath);
  if (identity !== undefined) return identity;
  throw new WorkspaceValidationError(
    `Cannot resolve the physical Git identity for repository ${path.resolve(repoPath)}. ` +
      "Verify that the path is an accessible Git repository and that Git permissions are valid, then retry."
  );
}

function assertUniqueRepository(
  file: WorkspaceFile,
  identity: WorkspaceRepositoryIdentity | undefined,
  exceptWorkspaceId?: string
): void {
  if (identity === undefined) return;
  const existing = file.workspaces.find(
    (workspace) => workspace.id !== exceptWorkspaceId && workspace.repositoryIdentity?.key === identity.key
  );
  if (existing !== undefined) {
    throw new WorkspaceConflictError(
      `Repository ${identity.repoRealPath} already belongs to workspace "${existing.name}" (${existing.id})`
    );
  }
}

async function migrateWorkspaceFile(file: WorkspaceFile): Promise<{ file: WorkspaceFile; changed: boolean }> {
  const candidateAliases: Record<string, string> = { ...(file.aliases ?? {}) };
  const canonical: Workspace[] = [];
  const ownerByRepositoryKey = new Map<string, Workspace>();
  const conflictsByDuplicateId = new Map(
    (file.migrationConflicts ?? []).map((conflict) => [conflict.duplicateWorkspaceId, conflict])
  );
  const ordered = [...file.workspaces].sort((left, right) => {
    const byCreated = left.createdAt.localeCompare(right.createdAt);
    return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
  });

  for (const original of ordered) {
    const workspace: Workspace = {
      ...original,
      ...(original.allowedPaths !== undefined ? { allowedPaths: [...original.allowedPaths] } : {})
    };
    // Persisted identity is a cache, never authority. Re-resolve every
    // accessible path so moves followed by a symlink/junction cannot leave a
    // stale common-dir key that admits a second workspace for the same repo.
    const currentIdentity = workspace.repoPath === undefined
      ? undefined
      : await resolveWorkspaceRepositoryIdentity(workspace.repoPath);
    // Legacy reads are the sole tolerant path: an offline/missing historical
    // repo remains visible with its last persisted identity. New create/update
    // mutations use requireRepositoryIdentity and fail closed instead.
    const identity = currentIdentity ?? workspace.repositoryIdentity;
    if (identity !== undefined) {
      workspace.repoPath = identity.repoRealPath;
      workspace.repositoryIdentity = identity;
      const owner = ownerByRepositoryKey.get(identity.key);
      if (owner !== undefined) {
        candidateAliases[workspace.id] = owner.id;
        const conflictingFields = conflictingWorkspaceFields(owner, workspace);
        if (conflictingFields.length > 0 && !conflictsByDuplicateId.has(workspace.id)) {
          conflictsByDuplicateId.set(workspace.id, {
            version: 1,
            repositoryKey: identity.key,
            canonicalWorkspaceId: owner.id,
            duplicateWorkspaceId: workspace.id,
            conflictingFields,
            canonicalSnapshot: cloneWorkspace(owner),
            duplicateSnapshot: cloneWorkspace(workspace)
          });
        }
        fillMissingLegacyFields(owner, workspace);
        continue;
      }
      ownerByRepositoryKey.set(identity.key, workspace);
    }
    canonical.push(workspace);
  }

  const liveIds = new Set(canonical.map((workspace) => workspace.id));
  const aliases: Record<string, string> = {};
  for (const alias of Object.keys(candidateAliases).sort()) {
    if (liveIds.has(alias)) continue;
    const target = resolveAlias(candidateAliases, candidateAliases[alias]!);
    if (target !== alias && liveIds.has(target)) aliases[alias] = target;
  }

  const migrated: WorkspaceFile = {
    version: WORKSPACE_FILE_VERSION,
    workspaces: canonical,
    ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
    ...(conflictsByDuplicateId.size > 0
      ? { migrationConflicts: [...conflictsByDuplicateId.values()].sort((left, right) =>
          left.duplicateWorkspaceId.localeCompare(right.duplicateWorkspaceId)) }
      : {})
  };
  return { file: migrated, changed: JSON.stringify(migrated) !== JSON.stringify(file) };
}

const MIGRATED_CONFIGURATION_FIELDS = [
  "name",
  "description",
  "color",
  "packageManager",
  "defaultBranch",
  "allowedPaths",
  "testCommand",
  "buildCommand"
] as const satisfies ReadonlyArray<keyof Workspace>;

function conflictingWorkspaceFields(target: Workspace, source: Workspace): string[] {
  return MIGRATED_CONFIGURATION_FIELDS.filter((field) => {
    const targetValue = target[field];
    const sourceValue = source[field];
    if (targetValue === undefined || sourceValue === undefined) return false;
    return JSON.stringify(targetValue) !== JSON.stringify(sourceValue);
  });
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    ...(workspace.allowedPaths !== undefined ? { allowedPaths: [...workspace.allowedPaths] } : {}),
    ...(workspace.repositoryIdentity !== undefined
      ? {
          repositoryIdentity: {
            ...workspace.repositoryIdentity,
            ...(workspace.repositoryIdentity.filesystemObjectId !== undefined
              ? { filesystemObjectId: { ...workspace.repositoryIdentity.filesystemObjectId } }
              : {})
          }
        }
      : {})
  };
}

function cloneMigrationConflict(conflict: WorkspaceMigrationConflict): WorkspaceMigrationConflict {
  return {
    ...conflict,
    conflictingFields: [...conflict.conflictingFields],
    canonicalSnapshot: cloneWorkspace(conflict.canonicalSnapshot),
    duplicateSnapshot: cloneWorkspace(conflict.duplicateSnapshot),
    ...(conflict.resolution !== undefined ? { resolution: { ...conflict.resolution } } : {})
  };
}

function applyConfigurationSnapshot(
  current: Workspace,
  chosen: Workspace,
  updatedAt: string
): Workspace {
  return {
    id: current.id,
    slug: current.slug,
    name: chosen.name,
    createdAt: current.createdAt,
    updatedAt,
    ...(current.repoPath !== undefined ? { repoPath: current.repoPath } : {}),
    ...(current.repositoryIdentity !== undefined
      ? { repositoryIdentity: cloneWorkspace(current).repositoryIdentity }
      : {}),
    ...(chosen.description !== undefined ? { description: chosen.description } : {}),
    ...(chosen.color !== undefined ? { color: chosen.color } : {}),
    ...(chosen.packageManager !== undefined ? { packageManager: chosen.packageManager } : {}),
    ...(chosen.defaultBranch !== undefined ? { defaultBranch: chosen.defaultBranch } : {}),
    ...(chosen.allowedPaths !== undefined ? { allowedPaths: [...chosen.allowedPaths] } : {}),
    ...(chosen.testCommand !== undefined ? { testCommand: chosen.testCommand } : {}),
    ...(chosen.buildCommand !== undefined ? { buildCommand: chosen.buildCommand } : {})
  };
}

function fillMissingLegacyFields(target: Workspace, source: Workspace): void {
  if (target.description === undefined && source.description !== undefined) target.description = source.description;
  if (target.color === undefined && source.color !== undefined) target.color = source.color;
  if (target.packageManager === undefined && source.packageManager !== undefined) target.packageManager = source.packageManager;
  if (target.defaultBranch === undefined && source.defaultBranch !== undefined) target.defaultBranch = source.defaultBranch;
  if (target.allowedPaths === undefined && source.allowedPaths !== undefined) target.allowedPaths = [...source.allowedPaths];
  if (target.testCommand === undefined && source.testCommand !== undefined) target.testCommand = source.testCommand;
  if (target.buildCommand === undefined && source.buildCommand !== undefined) target.buildCommand = source.buildCommand;
}

function resolveAlias(aliases: Record<string, string> | undefined, id: string): string {
  let current = id;
  const seen = new Set<string>();
  while (aliases?.[current] !== undefined && !seen.has(current)) {
    seen.add(current);
    current = aliases[current]!;
  }
  return current;
}

export function resolveWorkspacesFilePath(): string {
  const override = process.env.MANYHANDS_WORKSPACES_FILE;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(resolveRepoRoot(), ".manyhands", "workspaces.json");
}
