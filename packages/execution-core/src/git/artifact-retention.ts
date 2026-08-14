import { createHash } from "node:crypto";

import type { GitRunner } from "./runner.js";

export interface RetainedGitArtifact {
  ref: string;
  candidateCommit: string;
  candidateTree: string;
}

/** Durable journal authorization; it binds the exact retained candidate to one terminal release decision. */
export interface ArtifactRetentionReleaseDecision {
  decisionId: string;
  artifactId: string;
  retainedByRef: string;
  candidateCommit: string;
  authorizedAt: string;
}

/**
 * Keeps the Git objects behind an adopted manifest reachable without treating
 * the source commit as the transported artifact. The ref is an ownership
 * receipt only; consumers still receive a manifest of exact objects.
 */
export class GitArtifactRetainer {
  constructor(private readonly git: GitRunner) {}

  async retain(input: {
    cwd: string;
    runId: string;
    attemptId: string;
    artifactId: string;
    manifestDigest: string;
    candidateCommit: string;
    candidateTree: string;
  }): Promise<RetainedGitArtifact> {
    const [observedCommit, observedTree] = await Promise.all([
      this.git.revParse(input.cwd, `${input.candidateCommit}^{commit}`),
      this.git.revParse(input.cwd, `${input.candidateCommit}^{tree}`)
    ]);
    if (observedCommit !== input.candidateCommit) {
      throw new Error(`Artifact candidate commit did not resolve exactly: ${input.candidateCommit}.`);
    }
    if (observedTree !== input.candidateTree) {
      throw new Error(`Artifact candidate tree did not resolve exactly: ${input.candidateTree}.`);
    }

    const ref = retainedArtifactRef(input.runId, input.attemptId, input.artifactId);
    try {
      await this.git.updateRef({
        cwd: input.cwd,
        ref,
        target: input.candidateCommit,
        expectedOldOid: "0".repeat(input.candidateCommit.length)
      });
    } catch (error) {
      const [existingCommit, existingTree] = await Promise.all([
        this.git.revParse(input.cwd, ref),
        this.git.revParse(input.cwd, `${ref}^{tree}`)
      ]).catch(() => {
        throw error;
      });
      if (existingCommit !== input.candidateCommit || existingTree !== input.candidateTree) {
        throw new Error(`Retained artifact ref ${ref} already names a different candidate.`);
      }
    }
    const [retainedCommit, retainedTree] = await Promise.all([
      this.git.revParse(input.cwd, ref),
      this.git.revParse(input.cwd, `${ref}^{tree}`)
    ]);
    if (retainedCommit !== input.candidateCommit || retainedTree !== input.candidateTree) {
      throw new Error(`Retained artifact ref ${ref} does not resolve to the declared candidate.`);
    }
    return { ref, candidateCommit: retainedCommit, candidateTree: retainedTree };
  }

  async release(input: {
    cwd: string;
    retained: RetainedGitArtifact;
    decision: ArtifactRetentionReleaseDecision;
  }): Promise<void> {
    const decision = input.decision;
    if (
      decision.decisionId.length === 0 ||
      decision.artifactId.length === 0 ||
      decision.retainedByRef !== input.retained.ref ||
      decision.candidateCommit !== input.retained.candidateCommit
    ) {
      throw new Error(`Retention release ${decision.decisionId} is not authorized for this retained artifact.`);
    }
    await this.git.updateRef({
      cwd: input.cwd,
      ref: input.retained.ref,
      target: "0".repeat(input.retained.candidateCommit.length),
      expectedOldOid: input.retained.candidateCommit
    });
  }
}

export function retainedArtifactRef(runId: string, attemptId: string, artifactId: string): string {
  return [
    "refs",
    "manyhands",
    "runs",
    refSegment(runId),
    "attempts",
    refSegment(attemptId),
    "artifacts",
    refSegment(artifactId)
  ].join("/");
}

function refSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (normalized.length === 0) throw new Error("Git artifact retention ref segment is empty.");
  const readable = normalized.slice(0, 36);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}
