import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunRecordSchema } from "@/lib/server/runs/schema";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEGACY_CORE_CONSUMERS = [
  "apps/web/src/app/api/runs/[id]/nodes/[taskId]/regen/route.ts",
  "apps/web/src/lib/conflict-view-model.ts",
  "apps/web/src/lib/decomposer-policy.ts",
  "apps/web/src/lib/live-graph.ts",
  "apps/web/src/lib/plan-control.ts",
  "apps/web/src/lib/plan-review.ts",
  "apps/web/src/lib/server/runs/editing.ts",
  "apps/web/src/lib/server/runs/execution-state.ts",
  "apps/web/src/lib/server/runs/integrator-service.ts",
  "apps/web/src/lib/server/runs/patches.ts",
  "apps/web/src/lib/server/runs/planning-host.ts",
  "apps/web/src/lib/server/runs/planning-invocation-service.ts",
  "apps/web/src/lib/server/runs/presenter.ts",
  "apps/web/src/lib/server/runs/replan-service.ts",
  "apps/web/src/lib/server/runs/repo-index-cache.ts"
] as const;

describe("target architecture migration baseline", () => {
  it("loads a representative V1 run without losing its durable identity", async () => {
    const fixture = JSON.parse(
      await readFile(path.join(REPO_ROOT, "tests", "fixtures", "current-run-record-v1.json"), "utf8")
    ) as unknown;
    const run = RunRecordSchema.parse(fixture);

    expect(run.status).toBe("needs_delivery");
    expect(run.targetContext).toMatchObject({
      sourceRealPath: "C:/work/example-app",
      sourceBranch: "main",
      sourceBaseCommit: "1111111111111111111111111111111111111111",
      fingerprint: "sha256:target-v1"
    });
    expect(run.planning).toMatchObject({ decomposition: { graph: { id: "graph-v1" } } });
    expect(run.activeOperation).toMatchObject({ kind: "delivery", fencingToken: 7 });
    expect(run.finalArtifactManifest).toMatchObject({
      runId: run.runId,
      finalSha: "3333333333333333333333333333333333333333",
      artifactDisposition: "ready",
      deliveryDisposition: "needs_delivery"
    });
  });

  it("keeps packages independent from application-layer imports", async () => {
    const packageSources = await sourceFiles(path.join(REPO_ROOT, "packages"));
    const violations: string[] = [];

    for (const file of packageSources) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'](?:@\/|apps\/|[^"']*\/apps\/)/u.test(source)) {
        violations.push(relativePath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("freezes the existing @manyhands/core consumer allowlist", async () => {
    const productSources = [
      ...(await sourceFiles(path.join(REPO_ROOT, "apps", "web", "src"))),
      ...(await sourceFiles(path.join(REPO_ROOT, "packages")))
    ];
    const consumers: string[] = [];

    for (const file of productSources) {
      if ((await readFile(file, "utf8")).includes("@manyhands/core")) {
        consumers.push(relativePath(file));
      }
    }

    expect(consumers.sort()).toEqual([...LEGACY_CORE_CONSUMERS].sort());
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dist" && entry.name !== "node_modules") {
        result.push(...(await sourceFiles(entryPath)));
      }
    } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      result.push(entryPath);
    }
  }
  return result;
}

function relativePath(file: string): string {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}
