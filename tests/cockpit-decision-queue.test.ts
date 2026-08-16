import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  AUTO_FIT_ON_RUN_EVENT,
  affectedSubgraphNodeIds,
  evidenceMatrixForIdentity,
  isFinalCandidateDeliverable,
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
      badge: "Candidato · abc123d"
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
        matrixId: "matrix-api",
        candidateCommit: "abc123def456",
        outcome: "verified",
        criteria: [
          { status: "satisfied" },
          { status: "not_applicable" },
          { status: "satisfied" }
        ]
      }],
      evidenceMatrixId: "matrix-api",
      delivered: false
    });

    expect(verified).toMatchObject({
      state: "verified",
      badge: "Verificado · 2/3 criterios"
    });
  });

  it("never labels incomplete or failed evidence as verified", () => {
    const attempt = {
      attemptId: "attempt-api",
      nodeId: "api",
      status: "validated" as const,
      candidateCommit: "abc123def456"
    };

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [attempt],
      integrations: [],
      evidenceMatrixId: "matrix-api",
      evidenceMatrices: [{ matrixId: "matrix-api", candidateCommit: attempt.candidateCommit, outcome: "unverified", criteria: [] }],
      delivered: false
    })).toMatchObject({ state: "evidence_incomplete", badge: "Evidencia incompleta" });

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [attempt],
      integrations: [],
      evidenceMatrixId: "matrix-api",
      evidenceMatrices: [{ matrixId: "matrix-api", candidateCommit: attempt.candidateCommit, outcome: "failed", criteria: [] }],
      delivered: false
    })).toMatchObject({ state: "failed", badge: "Falló", detail: "La validación no pasó." });

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [attempt],
      integrations: [],
      evidenceMatrices: [],
      delivered: false
    })).toMatchObject({ state: "evidence_pending", badge: "Evidencia pendiente" });

    expect(lifecycleMedalForNode({
      nodeId: "root",
      attempts: [],
      integrations: [{ nodeId: "root", status: "completed", candidateCommit: "root123", evidenceMatrixId: "matrix-root" }],
      evidenceMatrices: [{ matrixId: "matrix-root", candidateCommit: "root123", outcome: "unverified", criteria: [] }],
      delivered: false
    })).toMatchObject({ state: "evidence_incomplete", badge: "Evidencia incompleta" });
  });

  it("uses the canonical matrix id when the same commit has multiple outcomes", () => {
    const commit = "abc123def456";
    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [{ attemptId: "attempt-api", nodeId: "api", status: "validated", candidateCommit: commit }],
      integrations: [],
      evidenceMatrixId: "matrix-unverified",
      evidenceMatrices: [
        { matrixId: "matrix-unverified", candidateCommit: commit, outcome: "unverified", criteria: [] },
        { matrixId: "matrix-other", candidateCommit: commit, outcome: "verified", criteria: [{ status: "satisfied" }] }
      ],
      delivered: false
    })).toMatchObject({ state: "evidence_incomplete", badge: "Evidencia incompleta" });

    expect(evidenceMatrixForIdentity([
      { matrixId: "matrix-final", candidateCommit: commit, outcome: "unverified" },
      { matrixId: "matrix-other", candidateCommit: commit, outcome: "verified" }
    ], { matrixId: "matrix-final", candidateCommit: commit })).toMatchObject({
      matrixId: "matrix-final",
      outcome: "unverified"
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
    })).toMatchObject({ state: "stale", badge: "Obsoleto" });

    expect(lifecycleMedalForNode({
      nodeId: "api",
      attempts: [],
      integrations: [],
      evidenceMatrices: [],
      delivered: true
    })).toMatchObject({ state: "delivered", badge: "Entregado" });
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

describe("delivery evidence guard", () => {
  const candidate = { commit: "abc123", evidenceMatrixId: "matrix-1", evidenceEligible: true };
  const verified = { matrixId: "matrix-1", candidateCommit: "abc123", outcome: "verified" };

  it("allows only the exact verified matrix for a result-ready candidate", () => {
    expect(isFinalCandidateDeliverable({
      lifecycle: "result_ready",
      finalCandidate: candidate,
      evidenceMatrices: [verified]
    })).toBe(true);

    for (const evidenceMatrices of [
      [],
      [{ ...verified, outcome: "unverified" }],
      [{ ...verified, outcome: "failed" }],
      [{ ...verified, candidateCommit: "different" }],
      [{ ...verified, matrixId: "different" }]
    ]) {
      expect(isFinalCandidateDeliverable({ lifecycle: "result_ready", finalCandidate: candidate, evidenceMatrices })).toBe(false);
    }
  });
});

describe("relation and viewport contracts", () => {
  it("names a relation by what it is, not by the type that carries it", () => {
    // This used to pin the canonical type names as the operator-facing labels.
    // `ArtifactRequirement` is precise and it is our word, not theirs; the
    // canonical name still appears in the inspector, beside the contract it
    // names, where the precision is what the reader came for.
    expect(relationDisplayName("artifact")).toBe("Entrega de artefacto");
    expect(relationDisplayName("contract")).toBe("Contrato de frontera");
    expect(relationDisplayName("conflict")).toBe("Conflicto de recursos");
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
