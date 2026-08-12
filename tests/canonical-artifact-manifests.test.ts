import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CandidateTreeManifestSchema,
  ChangeSetManifestSchema,
  buildCandidateTreeManifest,
  buildChangeSetManifest,
  buildInputFingerprint,
  validateInputFingerprint,
  validateManifestIdentity,
  type DigestHasher
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const oid = (character: string) => character.repeat(40);

describe("canonical artifact manifests", () => {
  it("canonicalizes change entries as an explicit set and rejects mutable lifecycle/evidence fields", () => {
    const entries = [
      { oldPath: "src/z.ts", newPath: "src/z.ts", operation: "modify" as const, oldOid: oid("1"), newOid: oid("2"), oldMode: "100644", newMode: "100644" },
      { newPath: "src/a.ts", operation: "add" as const, newOid: oid("3"), newMode: "100644" }
    ];
    const first = buildChangeSetManifest(changeMaterial(entries), sha256);
    const equivalent = buildChangeSetManifest(changeMaterial([...entries].reverse()), sha256);

    expect(first.manifestDigest).toBe(equivalent.manifestDigest);
    expect(first.entries.map((entry) => entry.newPath)).toEqual(["src/a.ts", "src/z.ts"]);
    expect(ChangeSetManifestSchema.safeParse({ ...first, status: "verified" }).success).toBe(false);
    expect(ChangeSetManifestSchema.safeParse({ ...first, evidence: [] }).success).toBe(false);
    expect(validateManifestIdentity(first, sha256)).toEqual({ ok: true, issues: [] });
  });

  it("rejects contradictory preimages and postimages with operation-specific causes", () => {
    const addWithPreimage = ChangeSetManifestSchema.safeParse({
      ...changeMaterial([
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          operation: "add",
          oldOid: oid("1"),
          newOid: oid("2"),
          oldMode: "100644",
          newMode: "100644"
        }
      ]),
      manifestDigest: "sha256:contradictory-add"
    });
    const deleteWithPostimage = ChangeSetManifestSchema.safeParse({
      ...changeMaterial([
        {
          oldPath: "src/old.ts",
          newPath: "src/new.ts",
          operation: "delete",
          oldOid: oid("1"),
          newOid: oid("2"),
          oldMode: "100644",
          newMode: "100644"
        }
      ]),
      manifestDigest: "sha256:contradictory-delete"
    });

    expect(addWithPreimage.success).toBe(false);
    expect(deleteWithPostimage.success).toBe(false);
    if (!addWithPreimage.success) {
      expect(addWithPreimage.error.issues.map((issue) => issue.message))
        .toContain("add must not declare an oldPath, oldOid or oldMode preimage");
    }
    if (!deleteWithPostimage.success) {
      expect(deleteWithPostimage.error.issues.map((issue) => issue.message))
        .toContain("delete must not declare a newPath, newOid or newMode postimage");
    }
  });

  it("rejects modify when the Git object type changes from regular file to symlink", () => {
    const result = ChangeSetManifestSchema.safeParse({
      ...changeMaterial([
        {
          oldPath: "src/file.ts",
          newPath: "src/file.ts",
          operation: "modify",
          oldOid: oid("1"),
          newOid: oid("2"),
          oldMode: "100644",
          newMode: "120000"
        }
      ]),
      manifestDigest: "sha256:invalid-modify-type-change"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message))
        .toContain("modify must preserve the Git object type; use type_change when the type changes");
    }
  });

  it("rejects type_change when both modes retain the regular-file Git object type", () => {
    const result = ChangeSetManifestSchema.safeParse({
      ...changeMaterial([
        {
          oldPath: "src/file.ts",
          newPath: "src/file.ts",
          operation: "type_change",
          oldOid: oid("1"),
          newOid: oid("2"),
          oldMode: "100644",
          newMode: "100644"
        }
      ]),
      manifestDigest: "sha256:invalid-type-change"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message))
        .toContain("type_change requires the Git object type to change");
    }
  });

  it("reports digest and source-candidate identity failures by cause", () => {
    const manifest = buildCandidateTreeManifest(candidateMaterial(), sha256);
    expect(CandidateTreeManifestSchema.parse(manifest)).toEqual(manifest);
    expect(validateManifestIdentity({ ...manifest, manifestDigest: "sha256:tampered" }, sha256).issues)
      .toContainEqual(expect.objectContaining({ code: "manifest_digest_mismatch" }));
    expect(validateManifestIdentity({
      ...manifest,
      sourceCandidate: { ...manifest.sourceCandidate, treeOid: oid("f") }
    }, sha256).issues).toContainEqual(expect.objectContaining({ code: "source_candidate_mismatch" }));
  });

  it("binds an InputFingerprint to all eligibility inputs independent of artifact completion order", () => {
    const material = {
      executionBase: { repositoryViewDigest: "sha256:view", treeSha: oid("a") },
      consumedArtifactDigests: ["sha256:z", "sha256:a"],
      nodeContractDigest: "sha256:node",
      resourceClaimDigest: "sha256:claims",
      contextDigest: "sha256:context",
      executorProfileDigest: "sha256:executor",
      sandboxCapabilityDigest: "sha256:sandbox"
    };
    const first = buildInputFingerprint(material, sha256);
    const equivalent = buildInputFingerprint({ ...material, consumedArtifactDigests: [...material.consumedArtifactDigests].reverse() }, sha256);

    expect(first).toBe(equivalent);
    expect(validateInputFingerprint(material, first, sha256)).toEqual({ ok: true, issues: [] });
    expect(validateInputFingerprint({ ...material, contextDigest: "sha256:changed" }, first, sha256).issues)
      .toContainEqual(expect.objectContaining({ code: "fingerprint_digest_mismatch" }));
  });
});

function commonIdentity() {
  return {
    id: "manifest:booking",
    contract: { id: "artifact-contract:booking", revision: 1, digest: "sha256:artifact-contract" },
    producerNodeId: "node:booking",
    producerAttemptId: "attempt:booking:1",
    inputFingerprint: `sha256:${"a".repeat(64)}`,
    repositoryObjectStoreId: "object-store:repo",
    objectFormat: "sha1" as const,
    sourceCandidate: { commitOid: oid("c"), treeOid: oid("d") },
    retainedByRef: "refs/manyhands/runs/run-1/attempt-1"
  };
}

function changeMaterial(entries: Array<Record<string, unknown>>) {
  return {
    ...commonIdentity(),
    kind: "change_set" as const,
    baseTreeSha: oid("b"),
    resultTreeSha: oid("d"),
    entries
  };
}

function candidateMaterial() {
  return {
    ...commonIdentity(),
    kind: "candidate_tree" as const,
    baseCommitOid: oid("b"),
    commitOid: oid("c"),
    treeOid: oid("d")
  };
}
