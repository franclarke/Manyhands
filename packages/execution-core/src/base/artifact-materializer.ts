import type { GitRunner } from "../git/runner";
import { ExactGitManifestMaterializer } from "../git/exact-manifest-materializer";
import type { ExecutionArtifactInput } from "./execution-base-manifest";
import type { DigestHasher } from "@manyhands/contracts";

export interface ExecutionBaseMaterializationEvidence {
  code: "artifact_conflict" | "artifact_empty" | "artifact_error" | "unsupported_artifact_kind";
  artifactId: string;
  conflictFiles: string[];
  output: string;
}

export class ExecutionBaseMaterializationError extends Error {
  readonly evidence: ExecutionBaseMaterializationEvidence;

  constructor(evidence: ExecutionBaseMaterializationEvidence) {
    super(`Could not materialize artifact ${evidence.artifactId}: ${evidence.code}.`);
    this.name = "ExecutionBaseMaterializationError";
    this.evidence = evidence;
  }
}

export class ArtifactMaterializer {
  private readonly exact: ExactGitManifestMaterializer;

  constructor(private readonly git: GitRunner, hasher?: DigestHasher) {
    this.exact = new ExactGitManifestMaterializer(git, hasher);
  }

  async materialize(worktreePath: string, artifact: ExecutionArtifactInput): Promise<void> {
    if (artifact.kind === "logical") return;
    if (artifact.kind === "manifest") {
      const manifest = artifact.manifest;
      if (manifest === undefined || manifest.kind !== "change_set") {
        throw new ExecutionBaseMaterializationError({
          code: "unsupported_artifact_kind",
          artifactId: artifact.artifactId,
          conflictFiles: [],
          output: "Only exact change-set manifests are materializable as execution-base overlays."
        });
      }
      try {
        await this.exact.materialize({
          cwd: worktreePath,
          baseCommit: await this.git.head(worktreePath),
          manifest,
          allowedPaths: [...new Set(manifest.entries.flatMap((entry) => [entry.oldPath, entry.newPath]).filter((path): path is string => path !== undefined))]
        });
        return;
      } catch (error) {
        throw new ExecutionBaseMaterializationError({
          code: "artifact_error",
          artifactId: artifact.artifactId,
          conflictFiles: [],
          output: error instanceof Error ? error.message : String(error)
        });
      }
    }
    throw new ExecutionBaseMaterializationError({
      // Commit artifacts are retained only for historical replay readers. A
      // productive execution base is always an exact Git-native manifest.
      code: "unsupported_artifact_kind",
      artifactId: artifact.artifactId,
      conflictFiles: [],
      output: `Artifact kind ${artifact.kind} is not materializable on the productive route.`
    });
  }
}
