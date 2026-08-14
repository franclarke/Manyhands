import { describe, expect, it } from "vitest";

import { checkResourceAuthority } from "@manyhands/task-graph";

const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:x"] };

function modifyClaim(nodeId: string, resourceId: string, artifactId: string) {
  return {
    id: `resource-claim:${nodeId}:${resourceId}:modify`,
    nodeId,
    resourceId,
    source: "planner" as const,
    evidenceRefs: ["evidence:x"],
    epistemic,
    access: "modify" as const,
    ownerPhase: "implementation" as const,
    inputVersion: { kind: "repository_view" as const, digest: "sha256:view" },
    outputArtifact: { id: artifactId, revision: 1, digest: "sha256:artifact" }
  };
}

function observeClaim(nodeId: string, resourceId: string) {
  return {
    id: `resource-claim:${nodeId}:${resourceId}:observe`,
    nodeId,
    resourceId,
    source: "planner" as const,
    evidenceRefs: ["evidence:x"],
    epistemic,
    access: "observe" as const,
    inputVersion: { kind: "repository_view" as const, digest: "sha256:view" }
  };
}

function artifactContract(id: string, producerNodeId: string, expectedPaths: string[]) {
  return { id, revision: "1", producerNodeId, expectedPaths };
}

const claims = [
  modifyClaim("unit:a", "resource:a", "artifact:a"),
  modifyClaim("unit:b", "resource:b", "artifact:b"),
  modifyClaim("unit:root", "resource:wire", "artifact:root")
];
const artifactContracts = [
  artifactContract("artifact:a", "unit:a", ["src/a.ts"]),
  artifactContract("artifact:b", "unit:b", ["src/b.ts"]),
  artifactContract("artifact:root", "unit:root", ["src/app/wire.ts"])
];

describe("Stage 9 resource authority", () => {
  it("accepts a composite that writes only what it claims", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: claims,
      artifactContracts,
      changedPaths: ["src/app/wire.ts"]
    })).toEqual([]);
  });

  it("reports a composite writing a child-owned path", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: claims,
      artifactContracts,
      changedPaths: ["src/app/wire.ts", "src/a.ts"]
    })).toEqual([{
      kind: "ownership_violation",
      path: "src/a.ts",
      ownedByNodeId: "unit:a",
      attemptedByNodeId: "unit:root"
    }]);
  });

  it("reports every violating path in a stable order", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: claims,
      artifactContracts,
      changedPaths: ["src/b.ts", "src/a.ts"]
    }).map(({ path, ownedByNodeId }) => [path, ownedByNodeId])).toEqual([
      ["src/a.ts", "unit:a"],
      ["src/b.ts", "unit:b"]
    ]);
  });

  it("treats a shared claim as the child's authority, not shared permission", () => {
    // The composite also claims resource:a. The child's modify claim still owns
    // the path: being the parent is not a second title to the same resource.
    const shared = [...claims, modifyClaim("unit:root", "resource:a", "artifact:root-extra")];
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: shared,
      artifactContracts: [...artifactContracts, artifactContract("artifact:root-extra", "unit:root", ["src/a.ts"])],
      changedPaths: ["src/a.ts"]
    })).toEqual([{
      kind: "ownership_violation",
      path: "src/a.ts",
      ownedByNodeId: "unit:a",
      attemptedByNodeId: "unit:root"
    }]);
  });

  it("ignores observe claims, which grant no write title", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: [...claims, observeClaim("unit:b", "resource:wire")],
      artifactContracts,
      changedPaths: ["src/app/wire.ts"]
    })).toEqual([]);
  });

  it("says nothing about unclaimed paths, which are the scope enforcer's business", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:root",
      resourceClaims: claims,
      artifactContracts,
      changedPaths: ["src/unclaimed.ts"]
    })).toEqual([]);
  });

  it("lets a leaf write the path it owns", () => {
    expect(checkResourceAuthority({
      nodeId: "unit:a",
      resourceClaims: claims,
      artifactContracts,
      changedPaths: ["src/a.ts"]
    })).toEqual([]);
  });
});
