import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  AUTO_FIT_ON_RUN_EVENT,
  affectedSubgraphNodeIds,
  lifecycleMedalForNode,
  relationDisplayName
} from "@/app/runs/[runId]/_components/cockpit-state";

describe("cockpit lifecycle medals", () => {
  it("keeps a candidate distinct from a verified result", () => {
    const candidate = lifecycleMedalForNode({
      nodeId: "api",
      attempts: [{
        attemptId: "attempt-api",
        nodeId: "api",
        status: "candidate",
        candidateCommit: "abc123def456"
      }],
      integrations: [],
      evidenceMatrices: [],
      delivered: false
    });

    expect(candidate).toMatchObject({
      state: "candidate",
      badge: "Candidate [abc123d]"
    });
  });

  it("reports exact evidence coverage for verified candidates", () => {
    const verified = lifecycleMedalForNode({
      nodeId: "api",
      attempts: [{
        attemptId: "attempt-api",
        nodeId: "api",
        status: "validated",
        candidateCommit: "abc123def456"
      }],
      integrations: [],
      evidenceMatrices: [{
        candidateCommit: "abc123def456",
        outcome: "verified",
        criteria: [
          { status: "satisfied" },
          { status: "not_applicable" },
          { status: "satisfied" }
        ]
      }],
      delivered: false
    });

    expect(verified).toMatchObject({
      state: "verified",
      badge: "Verified [2/3 passed]"
    });
  });

  it("surfaces failure evidence, stale attempts, and final delivery", () => {
    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [{ attemptId: "failed", nodeId: "api", status: "failed", failureReason: "Unit tests failed" }],
      integrations: [],
      evidenceMatrices: [],
      delivered: false
    })).toMatchObject({ state: "failed", detail: "Unit tests failed" });

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [{ attemptId: "stale", nodeId: "api", status: "stale" }],
      integrations: [],
      evidenceMatrices: [],
      delivered: false
    })).toMatchObject({ state: "stale", badge: "Stale" });

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [],
      integrations: [],
      evidenceMatrices: [],
      delivered: true
    })).toMatchObject({ state: "delivered", badge: "Delivered" });
  });
});

describe("non-blocking decision scope", () => {
  const nodes = [
    { id: "root", parentId: null },
    { id: "backend", parentId: "root" },
    { id: "api", parentId: "backend" },
    { id: "database", parentId: "backend" },
    { id: "frontend", parentId: "root" },
    { id: "web", parentId: "frontend" }
  ];

  it("pauses only explicitly affected nodes and their descendants", () => {
    expect(affectedSubgraphNodeIds(nodes, ["backend"])).toEqual(
      new Set(["backend", "api", "database"])
    );
  });

  it("leaves an independent branch runnable", () => {
    const blocked = affectedSubgraphNodeIds(nodes, ["backend"]);

    expect(blocked.has("web")).toBe(false);
    expect(blocked.has("frontend")).toBe(false);
  });
});

describe("relation and viewport contracts", () => {
  it("uses the canonical typed relation names", () => {
    expect(relationDisplayName("artifact")).toBe("ArtifactRequirement");
    expect(relationDisplayName("contract")).toBe("SeamBinding");
    expect(relationDisplayName("conflict")).toBe("ConflictConstraint");
  });

  it("never auto-fits the canvas in response to run events", () => {
    expect(AUTO_FIT_ON_RUN_EVENT).toBe(false);
    const canvasSource = readFileSync(
      new URL("../apps/web/src/app/runs/[runId]/_components/cockpit-run-graph.tsx", import.meta.url),
      "utf8"
    );

    expect(canvasSource).not.toContain("fitView(");
    expect(canvasSource).not.toContain("setCenter(");
  });

  it("provides explicit reduced-motion fallbacks for animated UI", () => {
    const nodeSource = readFileSync(
      new URL("../apps/web/src/app/runs/[runId]/_components/task-node-v2.tsx", import.meta.url),
      "utf8"
    );
    const dialogSource = readFileSync(
      new URL("../apps/web/src/app/runs/[runId]/_components/accessible-dialog.tsx", import.meta.url),
      "utf8"
    );

    expect(nodeSource).toContain("motion-reduce:animate-none");
    expect(dialogSource).toContain("motion-safe:");
  });
});
