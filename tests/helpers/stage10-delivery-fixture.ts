import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ProductRunDefinition, RunProjection } from "@manyhands/run-coordinator";

const execFileAsync = promisify(execFile);

export const stage10At = "2026-08-15T00:00:00.000Z";
export const STAGE10_FINGERPRINT = "target:stage10-delivery";

const PACKAGE_JSON = `${JSON.stringify(
  { name: "stage10-delivery-target", private: true, type: "module", scripts: { test: "node --test" } },
  null,
  2
)}\n`;

/** The delivered claim, expressed as a command a clone can run. */
const RESULT_TEST = [
  'import { readFileSync } from "node:fs";',
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  "",
  'test("the delivered result is the candidate", () => {',
  '  assert.equal(readFileSync("result.txt", "utf8").trim(), "candidate");',
  "});",
  ""
].join("\n");

export interface Stage10DeliveryTarget {
  /** Repository root, checked out on `main` at `baseSha`. */
  root: string;
  /** The approved target head. */
  baseSha: string;
  /**
   * A commit between the base and the candidate. Advancing `main` here still
   * fast-forwards to the candidate, which is exactly what `merge --ff-only`
   * could not refuse and a compare-and-swap can.
   */
  midSha: string;
  /** The approved final candidate, a descendant of `midSha`. */
  candidateSha: string;
  /** Its tree, which the final manifest must name. */
  treeSha: string;
  /** A commit on an unrelated history, for the diverged case. */
  unrelatedSha: string;
}

/**
 * A real Git target for the delivery transaction.
 *
 * `base -> mid -> candidate` is deliberate: `mid` is an ancestor of the
 * candidate, so a target that advanced there is still fast-forwardable. The
 * point of Stage 10 is that being fast-forwardable is not the same as being the
 * head that was approved.
 */
export async function buildDeliveryTargetFixture(): Promise<Stage10DeliveryTarget> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-stage10-target-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "stage10@example.test");
  await git(root, "config", "user.name", "Stage 10 Test");
  // The target is a user checkout, so Git must judge it under its own
  // line-ending policy rather than the artifact policy.
  await git(root, "config", "core.autocrlf", "true");

  // A runnable package, so a clone of the delivered ref can execute the same
  // validation command the run recorded rather than a stub of it.
  await write(root, "package.json", PACKAGE_JSON);
  await commit(root, "result.txt", "base\n", "base");
  const baseSha = await git(root, "rev-parse", "HEAD");

  await git(root, "checkout", "-b", "candidate");
  await commit(root, "result.txt", "mid\n", "mid");
  const midSha = await git(root, "rev-parse", "HEAD");
  await write(root, "result.test.js", RESULT_TEST);
  await commit(root, "result.txt", "candidate\n", "candidate");
  const candidateSha = await git(root, "rev-parse", "HEAD");
  const treeSha = await git(root, "rev-parse", `${candidateSha}^{tree}`);

  await git(root, "checkout", "--orphan", "unrelated");
  await commit(root, "other.txt", "unrelated\n", "unrelated");
  const unrelatedSha = await git(root, "rev-parse", "HEAD");

  await git(root, "checkout", "main");
  return { root, baseSha, midSha, candidateSha, treeSha, unrelatedSha };
}

export async function removeDeliveryTargetFixture(target: Stage10DeliveryTarget): Promise<void> {
  await rm(target.root, { recursive: true, force: true });
}

export function stage10Approval(target: Stage10DeliveryTarget) {
  return {
    manifestId: "manifest-stage10",
    finalSha: target.candidateSha,
    targetBranch: "main",
    targetHead: target.baseSha,
    targetFingerprint: STAGE10_FINGERPRINT,
    actor: "operator",
    idempotencyKey: "delivery-stage10"
  };
}

export function stage10Definition(target: Stage10DeliveryTarget): ProductRunDefinition {
  return {
    schemaVersion: 1,
    workspaceId: "workspace:stage10",
    userPrompt: "Deliver the verified candidate",
    acceptanceCriteria: ["the target holds the approved candidate"],
    title: "Stage 10 delivery",
    planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
    repairSelection: { executorId: "claude-code-cli", model: "sonnet" },
    executionConfig: {},
    targetContext: {
      fingerprint: STAGE10_FINGERPRINT,
      sourceBaseCommit: target.baseSha,
      sourceBranch: "main",
      sourceRealPath: target.root
    }
  };
}

export function stage10Projection(target: Stage10DeliveryTarget): RunProjection {
  const approval = stage10Approval(target);
  return {
    approvedGraphRevision: 1,
    deliveryApproval: approval,
    finalCandidate: {
      manifestId: approval.manifestId,
      commit: target.candidateSha,
      evidenceMatrixId: "matrix-stage10",
      sourceTargetFingerprint: approval.targetFingerprint,
      targetBranch: approval.targetBranch,
      targetHead: approval.targetHead,
      evidenceEligible: true,
      finalManifest: {
        commitSha: target.candidateSha,
        treeSha: target.treeSha,
        graphRevision: 1,
        artifactIds: ["artifact-stage10"],
        evidenceMatrixId: "matrix-stage10",
        validationRecipeDigest: "sha256:recipe-stage10",
        deliveryTarget: "main"
      }
    },
    evidenceMatrixSummaries: {
      "matrix-stage10": {
        candidateCommit: target.candidateSha,
        outcome: "verified",
        validationRecipeDigest: "sha256:recipe-stage10"
      }
    },
    adoptedArtifacts: {
      "artifact-instance": { contract: { id: "artifact-stage10", revision: "revision-1" } }
    }
  } as unknown as RunProjection;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8" });
  return stdout.trim();
}

async function commit(root: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(path.join(root, file), content, "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", message);
}

async function write(root: string, file: string, content: string): Promise<void> {
  await writeFile(path.join(root, file), content, "utf8");
}
