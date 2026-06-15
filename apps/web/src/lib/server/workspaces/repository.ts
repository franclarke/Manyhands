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
import { slugify, uniqueSlug } from "./slug";
import {
  WORKSPACE_FILE_VERSION,
  WorkspaceCreateInputSchema,
  WorkspaceFileSchema,
  WorkspaceUpdateInputSchema,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceFile
} from "./schema";

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace>;
  getBySlug(slug: string): Promise<Workspace | null>;
  create(input: unknown): Promise<Workspace>;
  update(id: string, input: unknown): Promise<Workspace>;
  delete(id: string): Promise<void>;
}

export interface JsonWorkspaceRepositoryOptions {
  filePath: string;
  seeds?: ReadonlyArray<WorkspaceCreateInput>;
  idFactory?: WorkspaceIdFactory;
  clock?: () => string;
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
  private writeChain: Promise<unknown> = Promise.resolve();
  private initialized = false;

  constructor(options: JsonWorkspaceRepositoryOptions) {
    this.filePath = options.filePath;
    this.seeds = options.seeds ?? DEFAULT_SEEDS;
    this.idFactory = options.idFactory ?? defaultWorkspaceIdFactory;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async list(): Promise<Workspace[]> {
    const file = await this.ensureSeeded();
    return [...file.workspaces].sort((left, right) => {
      const compare = right.updatedAt.localeCompare(left.updatedAt);
      if (compare !== 0) return compare;
      return left.name.localeCompare(right.name);
    });
  }

  async get(id: string): Promise<Workspace> {
    const file = await this.readOrEmpty();
    const workspace = file.workspaces.find((entry) => entry.id === id);
    if (workspace === undefined) {
      throw new WorkspaceNotFoundError(id);
    }
    return workspace;
  }

  async getBySlug(slug: string): Promise<Workspace | null> {
    const file = await this.readOrEmpty();
    return file.workspaces.find((entry) => entry.slug === slug) ?? null;
  }

  async create(input: unknown): Promise<Workspace> {
    return this.withLock(async () => {
      const parsed = WorkspaceCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new WorkspaceValidationError(parsed.error.issues[0]?.message ?? "Invalid workspace input");
      }
      const file = await this.ensureSeeded();
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
      const next: WorkspaceFile = {
        version: WORKSPACE_FILE_VERSION,
        workspaces: [...file.workspaces, workspace]
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
      const index = file.workspaces.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new WorkspaceNotFoundError(id);
      }
      const current = file.workspaces[index];
      if (current === undefined) {
        throw new WorkspaceNotFoundError(id);
      }
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
      const next: WorkspaceFile = {
        version: WORKSPACE_FILE_VERSION,
        workspaces: file.workspaces.map((entry, idx) => (idx === index ? merged : entry))
      };
      await atomicWriteJson(this.filePath, next);
      return merged;
    });
  }

  async delete(id: string): Promise<void> {
    await this.withLock(async () => {
      const file = await this.ensureSeeded();
      const next = file.workspaces.filter((entry) => entry.id !== id);
      if (next.length === file.workspaces.length) {
        throw new WorkspaceNotFoundError(id);
      }
      if (next.length === 0) {
        throw new WorkspaceConflictError("Cannot delete the last workspace");
      }
      await atomicWriteJson(this.filePath, {
        version: WORKSPACE_FILE_VERSION,
        workspaces: next
      } satisfies WorkspaceFile);
    });
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
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
    return result.data;
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
}

export function resolveWorkspacesFilePath(): string {
  const override = process.env.MANYHANDS_WORKSPACES_FILE;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(resolveRepoRoot(), ".manyhands", "workspaces.json");
}
