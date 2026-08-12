import { describe, expect, it } from "vitest";
import { buildGraphRevision, readGraphRevision, readLegacyGraphForCompatibility, type GraphRevisionMaterial } from "@manyhands/task-graph";
import * as taskGraph from "@manyhands/task-graph";

describe("graph compatibility reader", () => {
  it("never treats schema-valid persisted content with a stale digest as executable", () => {
    const hasher = (canonical: string): string => canonical;
    const ref = (id: string) => ({ id, revision: 1, digest: `digest-${id}` });
    const material: GraphRevisionMaterial = {
      graphId: "g",
      revision: 1,
      semanticPlan: ref("plan"),
      repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" },
      rootId: "root",
      nodes: {
        root: { id: "root", parentId: null, kind: "root", title: "Root", goal: "Original", contractRef: ref("root") }
      },
      artifactRequirements: [],
      seamBindings: [],
      resourceClaims: [],
      runtimeLeaseClaims: [],
      contractRefs: [ref("root")]
    };
    const graph = buildGraphRevision(material, hasher);
    expect(readGraphRevision(graph, hasher)).toMatchObject({ kind: "canonical", readOnly: false, requiresReplan: false });

    const tampered = structuredClone(graph);
    tampered.nodes.root!.goal = "Tampered";

    expect(readGraphRevision(tampered, hasher)).toMatchObject({ kind: "unknown", readOnly: true, requiresReplan: true });
  });

  it("never invents canonical claims or executable identity", () => {
    const legacy = { schemaVersion: 2, graphId: "g", revision: 1, rootId: "n", baseCommit: "sha", repositorySnapshotId: "snap", nodes: { n: { id: "n", parentId: null, kind: "leaf", title: "N", goal: "G" } }, artifactRequirements: [], seamBindings: [], conflictConstraints: [], legacyOrderingConstraints: [], createdAt: "2026-08-12T00:00:00.000Z" };
    const read = readLegacyGraphForCompatibility(legacy);
    expect(read).toMatchObject({ kind: "legacy_v2", readOnly: true, requiresReplan: true });
    expect(read).not.toHaveProperty("resourceClaims");
  });

  it("does not export an ambiguously named live legacy producer", () => {
    expect(taskGraph).not.toHaveProperty("adaptTaskGraphV1ToV2");
    expect(taskGraph).not.toHaveProperty("reviseGraph");
    expect(taskGraph).not.toHaveProperty("reduceGraphRevision");
  });
});
