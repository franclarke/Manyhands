import type { GitRunner } from "../git/runner";
import type { ExecutionArtifactInput } from "./execution-base-manifest";

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
  constructor(private readonly git: GitRunner) {}

  async materialize(worktreePath: string, artifact: ExecutionArtifactInput): Promise<void> {
    if (artifact.kind === "logical") return;
    if (artifact.kind !== "commit") {
      throw new ExecutionBaseMaterializationError({
        code: "unsupported_artifact_kind",
        artifactId: artifact.artifactId,
        conflictFiles: [],
        output: `Artifact kind ${artifact.kind} requires an explicit materializer.`
      });
    }

    // A pooled or resumed execution base may already contain the source commit
    // on its physical lineage. Cherry-picking it again is a safe no-op in Git,
    // but Git reports that no-op as an empty cherry-pick; ancestry is the only
    // evidence strong enough to accept that case without masking a real clash.
    const currentHead = await this.git.head(worktreePath);
    if (await this.git.isAncestor({ cwd: worktreePath, ancestor: artifact.location, descendant: currentHead })) return;

    const outcome = await this.git.cherryPick({ cwd: worktreePath, commitSha: artifact.location });
    if (outcome.ok) return;

    await this.git.cherryPickAbort(worktreePath).catch(() => undefined);
    throw new ExecutionBaseMaterializationError({
      code: outcome.kind === "empty" ? "artifact_empty" : outcome.kind === "conflict" || outcome.conflictFiles.length > 0 ? "artifact_conflict" : "artifact_error",
      artifactId: artifact.artifactId,
      conflictFiles: outcome.conflictFiles,
      output: outcome.output
    });
  }
}
