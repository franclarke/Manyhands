import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCandidateTreeManifest,
  buildEvidenceBinding,
  buildGoalContract,
  buildProofStrategy,
  type DigestHasher
} from "@manyhands/contracts";
import { bindExactEvidence } from "@manyhands/execution-core";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("Stage 7 exact evidence binding", () => {
  it("binds a satisfied observation to its retained candidate, exact baseline and declared authority", () => {
    const goal = buildGoalContract({
      id: "goal:stage7", revision: 1, goal: "Prove the exact candidate.", constraints: [], qualityAttributes: [],
      acceptanceCriteria: [{
        id: "criterion:stage7", statement: "The candidate passes the focused test.", required: true, level: "product",
        protectedReferences: [],
        verification: { allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }], independence: "independent_required" }
      }],
      target: { repositoryId: "repo:stage7", baseCommit: "a".repeat(40), treeSha: "b".repeat(40) }
    }, sha256);
    const strategy = buildProofStrategy({
      id: "proof:stage7", revision: 1, goalContractDigest: goal.digest, criterionId: "criterion:stage7", obligationId: "obligation:stage7",
      mode: "executable", authority: "orchestrator_deterministic", repositoryViewDigest: "sha256:view",
      procedureRef: "command:test", selectorDigest: selectorDigest(["tests/stage7.test.ts"]), environmentPolicyDigest: "sha256:environment", independence: "independent_required"
    }, sha256);
    const candidate = buildCandidateTreeManifest({
      id: "candidate:attempt-stage7", contract: { id: "task:stage7", revision: 1, digest: "sha256:task" },
      producerNodeId: "node:stage7", producerAttemptId: "attempt:stage7", inputFingerprint: "sha256:fingerprint",
      repositoryObjectStoreId: "object-store:stage7", objectFormat: "sha1",
      sourceCandidate: { commitOid: "c".repeat(40), treeOid: "d".repeat(40) }, retainedByRef: "refs/manyhands/runs/stage7/attempts/stage7/artifacts/candidate",
      kind: "candidate_tree", baseCommitOid: "a".repeat(40), commitOid: "c".repeat(40), treeOid: "d".repeat(40)
    }, sha256);

    const bindings = bindExactEvidence({
      goal,
      candidate,
      baseline: { commitOid: "a".repeat(40), treeOid: "b".repeat(40) },
      validationObligations: {
        "obligation:stage7": {
          id: "obligation:stage7", revision: 1, digest: "sha256:obligation", criterionId: "criterion:stage7",
          ownerNodeId: "node:stage7", required: true,
          proofStrategy: { id: strategy.id, revision: strategy.revision, digest: strategy.digest }
        }
      },
      proofStrategies: { [strategy.id]: strategy },
      matrix: {
        matrixId: "matrix:stage7", candidateCommit: "c".repeat(40),
        criteria: [{ criterionId: "criterion:stage7", obligationId: "obligation:stage7", status: "satisfied" }],
        validationRecipeDigest: "sha256:recipe",
        observations: [{ evidenceId: "evidence:1", kind: "test_result", commandDigest: "command", durationMs: 1, passed: true, attempt: 1, outputDigest: "e".repeat(64), criterionIds: ["criterion:stage7"], obligationIds: ["obligation:stage7"], references: ["tests/stage7.test.ts"] }]
      }
    }, sha256);

    expect(bindings).toEqual([buildEvidenceBinding({
      id: "evidence:matrix:stage7:obligation:stage7", revision: 1, goalContractDigest: goal.digest,
      criterionId: "criterion:stage7", obligationId: "obligation:stage7",
      candidate: { manifestDigest: candidate.manifestDigest, commitOid: candidate.commitOid, treeOid: candidate.treeOid },
      baseline: { commitOid: "a".repeat(40), treeOid: "b".repeat(40) }, proofStrategyDigest: strategy.digest,
      mode: "executable", authority: "orchestrator_deterministic", recipeDigest: "sha256:recipe",
      environmentDigest: "sha256:environment", selectorDigest: selectorDigest(["tests/stage7.test.ts"]), outputDigest: `sha256:${"e".repeat(64)}`, outcome: "satisfied"
    }, sha256)]);
  });

  it("rejects an observation whose executed references differ from the declared selector", () => {
    const goal = buildGoalContract({
      id: "goal:selector", revision: 1, goal: "Keep selector authority exact.", constraints: [], qualityAttributes: [],
      acceptanceCriteria: [{
        id: "criterion:selector", statement: "The declared test selector is executed.", required: true, level: "product",
        protectedReferences: [],
        verification: { allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }], independence: "independent_required" }
      }],
      target: { repositoryId: "repo:stage7", baseCommit: "a".repeat(40), treeSha: "b".repeat(40) }
    }, sha256);
    const strategy = buildProofStrategy({
      id: "proof:selector", revision: 1, goalContractDigest: goal.digest, criterionId: "criterion:selector", obligationId: "obligation:selector",
      mode: "executable", authority: "orchestrator_deterministic", repositoryViewDigest: "sha256:view",
      procedureRef: "command:test", selectorDigest: selectorDigest(["tests/declared.test.ts"]), environmentPolicyDigest: "sha256:environment", independence: "independent_required"
    }, sha256);
    const candidate = candidateManifest("candidate:selector", "c", "d");

    expect(() => bindExactEvidence({
      goal,
      candidate,
      baseline: { commitOid: "a".repeat(40), treeOid: "b".repeat(40) },
      validationObligations: {
        "obligation:selector": {
          id: "obligation:selector", revision: 1, digest: "sha256:obligation", criterionId: "criterion:selector",
          ownerNodeId: "node:selector", required: true,
          proofStrategy: { id: strategy.id, revision: strategy.revision, digest: strategy.digest }
        }
      },
      proofStrategies: { [strategy.id]: strategy },
      matrix: {
        matrixId: "matrix:selector", candidateCommit: candidate.commitOid,
        criteria: [{ criterionId: "criterion:selector", obligationId: "obligation:selector", status: "satisfied" }],
        validationRecipeDigest: "sha256:recipe",
        observations: [{
          evidenceId: "evidence:selector", kind: "test_result", commandDigest: "command", durationMs: 1, passed: true, attempt: 1,
          outputDigest: "e".repeat(64), criterionIds: ["criterion:selector"], obligationIds: ["obligation:selector"],
          references: ["tests/substituted.test.ts"]
        }]
      }
    }, sha256)).toThrow(/selector digest/i);
  });

  it("does not require selector authority for an advisory criterion without an exact observation", () => {
    const goal = buildGoalContract({
      id: "goal:advisory", revision: 1, goal: "Keep advisory evidence optional.", constraints: [], qualityAttributes: [],
      acceptanceCriteria: [
        { id: "criterion:required", statement: "The focused test passes.", required: true, level: "product", protectedReferences: [], verification: { allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }], independence: "independent_required" } },
        { id: "criterion:advisory", statement: "Accessibility review is advisory.", required: false, level: "product", protectedReferences: [], verification: { allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }], independence: "independent_required" } }
      ],
      target: { repositoryId: "repo:stage7", baseCommit: "a".repeat(40), treeSha: "b".repeat(40) }
    }, sha256);
    const requiredStrategy = buildProofStrategy({
      id: "proof:required", revision: 1, goalContractDigest: goal.digest, criterionId: "criterion:required", obligationId: "obligation:required",
      mode: "executable", authority: "orchestrator_deterministic", repositoryViewDigest: "sha256:view", procedureRef: "command:test", selectorDigest: selectorDigest(["tests/required.test.ts"]), environmentPolicyDigest: "sha256:environment", independence: "independent_required"
    }, sha256);
    const advisoryStrategy = buildProofStrategy({
      id: "proof:advisory", revision: 1, goalContractDigest: goal.digest, criterionId: "criterion:advisory", obligationId: "obligation:advisory",
      mode: "executable", authority: "orchestrator_deterministic", repositoryViewDigest: "sha256:view", procedureRef: "manual:a11y", environmentPolicyDigest: "sha256:environment", independence: "independent_required"
    }, sha256);
    const candidate = candidateManifest("candidate:advisory", "c", "d");

    const bindings = bindExactEvidence({
      goal,
      candidate,
      baseline: { commitOid: "a".repeat(40), treeOid: "b".repeat(40) },
      validationObligations: {
        "obligation:required": { id: "obligation:required", revision: 1, digest: "sha256:required", criterionId: "criterion:required", ownerNodeId: "node:required", required: true, proofStrategy: { id: requiredStrategy.id, revision: requiredStrategy.revision, digest: requiredStrategy.digest } },
        "obligation:advisory": { id: "obligation:advisory", revision: 1, digest: "sha256:advisory", criterionId: "criterion:advisory", ownerNodeId: "node:advisory", required: false, proofStrategy: { id: advisoryStrategy.id, revision: advisoryStrategy.revision, digest: advisoryStrategy.digest } }
      },
      proofStrategies: { [requiredStrategy.id]: requiredStrategy, [advisoryStrategy.id]: advisoryStrategy },
      matrix: {
        matrixId: "matrix:advisory", candidateCommit: candidate.commitOid, validationRecipeDigest: "sha256:recipe",
        criteria: [
          { criterionId: "criterion:required", obligationId: "obligation:required", status: "satisfied" },
          { criterionId: "criterion:advisory", obligationId: "obligation:advisory", status: "uncovered" }
        ],
        observations: [{ evidenceId: "evidence:required", kind: "test_result", commandDigest: "command", durationMs: 1, passed: true, attempt: 1, outputDigest: "e".repeat(64), criterionIds: ["criterion:required"], obligationIds: ["obligation:required"], references: ["tests/required.test.ts"] }]
      }
    }, sha256);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.obligationId).toBe("obligation:required");
  });
});

function candidateManifest(id: string, commit: string, tree: string) {
  return buildCandidateTreeManifest({
    id, contract: { id: "task:stage7", revision: 1, digest: "sha256:task" },
    producerNodeId: "node:stage7", producerAttemptId: "attempt:stage7", inputFingerprint: "sha256:fingerprint",
    repositoryObjectStoreId: "object-store:stage7", objectFormat: "sha1",
    sourceCandidate: { commitOid: commit.repeat(40), treeOid: tree.repeat(40) }, retainedByRef: `refs/manyhands/runs/stage7/attempts/stage7/artifacts/${id}`,
    kind: "candidate_tree", baseCommitOid: "a".repeat(40), commitOid: commit.repeat(40), treeOid: tree.repeat(40)
  }, sha256);
}

function selectorDigest(references: readonly string[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([...references].sort())).digest("hex")}`;
}
