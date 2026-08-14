import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Stage 7 legacy transport reachability", () => {
  it("keeps the daemon execution entrypoint on canonical manifests rather than the legacy commit driver", async () => {
    const [worker, driver, canonicalExecutor] = await Promise.all([
      source("apps/daemon/src/transitional-unsafe-worker.ts"),
      source("packages/orchestrator-graph/src/canonical-execution-driver.ts"),
      source("packages/execution-core/src/v2/node-executor.ts")
    ]);

    expect(worker).toContain("CanonicalNodeExecutor");
    expect(worker).not.toContain("V2ExecutionDriver");
    expect(worker).not.toContain("IntegrationAgent");
    expect(worker).not.toMatch(/\.cherryPick\s*\(/u);

    expect(driver).toContain('kind: "manifest"');
    expect(driver).toContain("artifactManifests");
    expect(driver).not.toContain("artifactLocation");
    expect(driver).not.toMatch(/\.cherryPick\s*\(/u);

    const canonicalClass = canonicalExecutor.slice(canonicalExecutor.indexOf("export class CanonicalNodeExecutor"));
    expect(canonicalClass).toContain("GitArtifactBuilder");
    expect(canonicalClass).toContain("artifactManifests");
    expect(canonicalClass).not.toMatch(/\.cherryPick\s*\(/u);
  });
});

function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}
