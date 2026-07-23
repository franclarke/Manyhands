import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

import type { GitRunner } from "../git/runner";
import type { WorktreeRecord } from "../types";
import type { WorktreeManager } from "../worktree/manager";
import type {
  ExecutionWorkspaceHandle,
  ExecutionWorkspaceProvider
} from "../worktree/execution-workspace";
import type { WorktreeReleaseOutcome } from "../worktree/worktree-pool";
import { ArtifactMaterializer } from "./artifact-materializer";
import {
  ExecutionArtifactInputSchema,
  ExecutionBaseManifestSchema,
  InputFingerprintSchema,
  type ExecutionBaseManifest
} from "./execution-base-manifest";

export const ExecutionBaseRequestSchema = z.object({
  runId: EntityIdSchema,
  nodeId: EntityIdSchema,
  baseCommit: NonEmptyStringSchema,
  contractBaseline: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  artifacts: z.array(ExecutionArtifactInputSchema),
  inputFingerprint: InputFingerprintSchema
}).strict().superRefine((input, context) => {
  const ids = input.artifacts.map((artifact) => artifact.artifactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifacts"], message: "Artifact ids must be unique." });
  }
});

export type ExecutionBaseRequest = z.infer<typeof ExecutionBaseRequestSchema>;

export interface BuiltExecutionBase {
  worktree: WorktreeRecord;
  manifest: ExecutionBaseManifest;
  release?: (outcome?: WorktreeReleaseOutcome) => Promise<void>;
}

export interface ExecutionBaseBuilderDeps {
  git: GitRunner;
  worktreeManager?: WorktreeManager;
  workspaceProvider?: ExecutionWorkspaceProvider;
  materializer?: ArtifactMaterializer;
  now?: () => string;
}

/** Builds a physical execution base from only the artifacts named by the request. */
export class ExecutionBaseBuilder {
  private readonly git: GitRunner;
  private readonly worktreeManager: WorktreeManager | undefined;
  private readonly workspaceProvider: ExecutionWorkspaceProvider | undefined;
  private readonly materializer: ArtifactMaterializer;
  private readonly now: () => string;

  constructor(deps: ExecutionBaseBuilderDeps) {
    if (deps.worktreeManager === undefined && deps.workspaceProvider === undefined) {
      throw new Error("ExecutionBaseBuilder requires a worktree manager or workspace provider.");
    }
    this.git = deps.git;
    this.worktreeManager = deps.worktreeManager;
    this.workspaceProvider = deps.workspaceProvider;
    this.materializer = deps.materializer ?? new ArtifactMaterializer(deps.git);
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async build(raw: ExecutionBaseRequest): Promise<BuiltExecutionBase> {
    const request = ExecutionBaseRequestSchema.parse(raw);
    const createParams = {
      taskId: request.nodeId,
      runId: request.runId,
      kind: "leaf",
      baseCommit: request.baseCommit
    } as const;
    let workspace: ExecutionWorkspaceHandle | undefined;
    const worktree = this.workspaceProvider !== undefined
      ? (workspace = await this.workspaceProvider.acquire(createParams)).worktree
      : await this.worktreeManager!.create(createParams);

    const materializedArtifacts: ExecutionBaseManifest["materializedArtifacts"] = [];
    try {
      for (const artifact of request.artifacts) {
        const beforeCommit = await this.git.head(worktree.path);
        await this.materializer.materialize(worktree.path, artifact);
        const resultingCommit = await this.git.head(worktree.path);
        materializedArtifacts.push({ ...artifact, beforeCommit, resultingCommit });
      }
      const resultingCommit = await this.git.head(worktree.path);
      const manifest = ExecutionBaseManifestSchema.parse({
        schemaVersion: 1,
        runId: request.runId,
        nodeId: request.nodeId,
        baseCommit: request.baseCommit,
        contractBaseline: request.contractBaseline,
        materializedArtifacts,
        resultingCommit,
        inputFingerprint: request.inputFingerprint,
        createdAt: this.now()
      });
      return {
        // Result recording must diff against the fully materialized base, not
        // the repository base from which the worktree was first created.
        worktree: { ...worktree, baseCommit: resultingCommit },
        manifest,
        ...(workspace !== undefined ? { release: workspace.release } : {})
      };
    } catch (error) {
      if (workspace !== undefined) {
        await workspace.release({ kind: "discard" }).catch(() => undefined);
      } else {
        await this.worktreeManager!.clean(worktree).catch(() => undefined);
      }
      throw error;
    }
  }
}
