import { describe, expect, it } from "vitest";

import type { Workspace } from "@/lib/api-types";
import { toRunPreview, toRunResponse } from "@/lib/server/runs/presenter";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

describe("canonical run presenter", () => {
  it("exposes lifecycle, event cursor, immutable selections and final candidate cache", () => {
    const record = makeRunRecordV2({
      lifecycle: "result_ready",
      projection: {
        lifecycle: "result_ready",
        eventSequence: 42,
        graphId: "graph-1",
        graphRevision: 2,
        approvedGraphRevision: 2,
        finalManifestId: "manifest-1",
        finalCommit: "abc123",
        updatedAt: "2026-07-17T12:30:00.000Z"
      }
    });

    expect(toRunResponse(record).run).toMatchObject({
      runId: record.runId,
      lifecycle: "result_ready",
      eventSequence: 42,
      planningSelection: record.planningSelection,
      finalManifestId: "manifest-1",
      finalCommit: "abc123"
    });
  });

  it("canonicalizes workspace aliases in detail and preview payloads", () => {
    const canonical: Workspace = {
      id: "ws-canonical",
      slug: "canonical",
      name: "Canonical",
      createdAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:00.000Z"
    };
    const record = makeRunRecordV2({ workspaceId: "ws-legacy" });
    const preview = toRunPreview(record, new Map([["ws-legacy", canonical]]));

    expect(preview).toMatchObject({ workspaceId: "ws-canonical", workspaceName: "Canonical", status: "planning" });
    expect(toRunResponse(record, canonical.id).run.workspaceId).toBe("ws-canonical");
  });
});
