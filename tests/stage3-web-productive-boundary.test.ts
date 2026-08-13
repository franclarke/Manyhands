import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routes = [
  "apps/web/src/app/api/runs/route.ts",
  "apps/web/src/app/api/runs/[id]/route.ts",
  "apps/web/src/app/api/runs/[id]/run/route.ts",
  "apps/web/src/app/api/runs/[id]/pause/route.ts",
  "apps/web/src/app/api/runs/[id]/resume/route.ts",
  "apps/web/src/app/api/runs/[id]/restart/route.ts",
  "apps/web/src/app/api/runs/[id]/cancel/route.ts",
  "apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts",
  "apps/web/src/app/api/runs/[id]/deliver/route.ts",
  "apps/web/src/app/api/runs/[id]/run-events/route.ts"
] as const;

const forbiddenProductiveOwners = [
  "getRunRepository",
  "JsonRunRecordStore",
  "JsonlRunEventStore",
  "runner-state",
  "run-abort-registry",
  "command-host",
  "run-coordinator-host",
  "execution-pipeline",
  "planning-host",
  "reconcileRunLiveness",
  "initializeRunCanonicalEvents"
] as const;

describe("Stage 3 web productive boundary", () => {
  it.each(routes)("makes %s a daemon IPC BFF with no legacy lifecycle owner", async (relative) => {
    const source = await readFile(path.resolve(relative), "utf8");
    expect(source).toContain("@/lib/server/daemon/productive-client");
    for (const forbidden of forbiddenProductiveOwners) {
      expect(source, `${relative} must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps GET/list/SSE behind daemon query/event pages only", async () => {
    const readRoutes = await Promise.all([
      "apps/web/src/app/api/runs/route.ts",
      "apps/web/src/app/api/runs/[id]/route.ts",
      "apps/web/src/app/api/runs/[id]/run-events/route.ts"
    ].map((relative) => readFile(path.resolve(relative), "utf8")));
    expect(readRoutes.join("\n")).not.toMatch(/\.save\(|\.update\(|appendFenced|startRunBackgroundTask|reconcileRun/);
  });

  it("does not export the retired web process owner from the runs public surface", async () => {
    const source = await readFile(path.resolve("apps/web/src/lib/server/runs/index.ts"), "utf8");
    expect(source).not.toMatch(/runner-state|run-operation-lease|run-abort-registry/);
  });
});
