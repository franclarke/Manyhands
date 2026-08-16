import { describe, expect, it } from "vitest";

import { executionBaseArtifacts } from "@manyhands/orchestrator-graph";
import { buildGraphRevision, type GraphRevisionMaterial } from "@manyhands/task-graph";

/**
 * The rehearsal run of 2026-08-16 failed at depth three with `artifact_error`,
 * and nothing was wrong with either artifact.
 *
 * `unit:sentence-length` consumed `unit:top-words`, which had itself been built
 * on top of `unit:word-total`. The driver materialized only the direct input, so
 * the worktree tree was the run base while `top-words`' manifest declared
 * base-plus-word-total — and an exact change set applied to a tree it was not
 * computed against is refused, correctly.
 *
 * One root over two leaves never showed this: the single producer's base was the
 * run base. It appears the moment a graph is three deep.
 */
describe("The artifacts a node lays down before it starts", () => {
  it("include what its inputs were themselves built on", () => {
    const graph = chainGraph();

    expect(executionBaseArtifacts(graph, "c").map(({ producerNodeId }) => producerNodeId))
      .toEqual(["a", "b"]);
  });

  it("are ordered so each one lands on the tree it was computed against", () => {
    // `b`'s manifest expects base-plus-a, so `a` has to be applied first.
    // Reversing this is the same failure with a different message.
    const graph = chainGraph();

    expect(executionBaseArtifacts(graph, "c").map(({ artifactContract }) => artifactContract.id))
      .toEqual(["artifact:a", "artifact:b"]);
  });

  it("stay empty for a node that consumes nothing", () => {
    expect(executionBaseArtifacts(chainGraph(), "a")).toEqual([]);
  });

  it("leave out a sibling's artifact that this node never depends on", () => {
    // `d` produces for the root only. Laying it under `c` would put changes in
    // `c`'s base that `c`'s contract never mentioned.
    const graph = chainGraph();

    expect(executionBaseArtifacts(graph, "c").map(({ producerNodeId }) => producerNodeId))
      .not.toContain("d");
  });

  it("gather every branch when a node consumes more than one", () => {
    const graph = chainGraph();

    // The root consumes a, b, c and d, so its base is all four, each after
    // whatever it was built on.
    const order = executionBaseArtifacts(graph, "root").map(({ producerNodeId }) => producerNodeId);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
});

/** a → b → c, plus an independent d, all feeding the root. */
function chainGraph() {
  const material: GraphRevisionMaterial = {
    graphId: "g",
    revision: 1,
    semanticPlan: ref("plan"),
    repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" },
    rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "R", goal: "R", contractRef: ref("root") },
      a: { id: "a", parentId: "root", kind: "leaf", title: "A", goal: "A", contractRef: ref("a") },
      b: { id: "b", parentId: "root", kind: "leaf", title: "B", goal: "B", contractRef: ref("b") },
      c: { id: "c", parentId: "root", kind: "leaf", title: "C", goal: "C", contractRef: ref("c") },
      d: { id: "d", parentId: "root", kind: "leaf", title: "D", goal: "D", contractRef: ref("d") }
    },
    artifactRequirements: [
      requirement("a-b", "a", "b", "artifact:a"),
      requirement("b-c", "b", "c", "artifact:b"),
      requirement("a-root", "a", "root", "artifact:a"),
      requirement("b-root", "b", "root", "artifact:b"),
      requirement("c-root", "c", "root", "artifact:c"),
      requirement("d-root", "d", "root", "artifact:d")
    ],
    seamBindings: [],
    resourceClaims: [],
    runtimeLeaseClaims: [],
    contractRefs: [
      ref("root"), ref("a"), ref("b"), ref("c"), ref("d"),
      ref("artifact:a"), ref("artifact:b"), ref("artifact:c"), ref("artifact:d")
    ]
  };
  return buildGraphRevision(material, (value) => `${value.length}`);
}

function requirement(id: string, producerNodeId: string, consumerNodeId: string, artifact: string) {
  return {
    id,
    producerNodeId,
    consumerNodeId,
    artifactContract: ref(artifact),
    consumerInputName: producerNodeId,
    acceptedManifestKinds: ["change_set" as const]
  };
}

function ref(id: string): { id: string; revision: number; digest: string } {
  return { id, revision: 1, digest: `digest:${id}` };
}
