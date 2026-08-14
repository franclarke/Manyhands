import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

/**
 * Stage 9 retires universal integration repair and implicit parent power from
 * the productive route. The code survives only for historical V2 replay, so the
 * guard is reachability rather than absence.
 */
describe("Stage 9 legacy integration retirement", () => {
  it("keeps the universal integration agent out of every productive path", async () => {
    const [worker, driver, canonicalExecutor, daemonProfile] = await Promise.all([
      source("apps/daemon/src/transitional-unsafe-worker.ts"),
      source("packages/orchestrator-graph/src/canonical-execution-driver.ts"),
      source("packages/execution-core/src/v2/node-executor.ts"),
      source("apps/daemon/src/daemon-profile.ts")
    ]);

    for (const productive of [worker, driver, daemonProfile]) {
      expect(productive).not.toContain("IntegrationAgent");
      expect(productive).not.toMatch(/\.cherryPick\s*\(/u);
    }
    // The canonical executor may construct the manifest integrator, but only
    // with commit transport switched off.
    const canonicalClass = canonicalExecutor.slice(canonicalExecutor.indexOf("export class CanonicalNodeExecutor"));
    expect(canonicalClass).toContain("allowCommitArtifactTransport: false");
  });

  it("names the surviving consumer and the stage that deletes it", async () => {
    // A legacy adapter without a named consumer and an explicit retirement
    // stage is indistinguishable from code nobody dares remove.
    const manifest = await source("packages/execution-core/src/integration/manifest.ts");
    const gate = manifest.slice(manifest.indexOf("allowCommitTransport") - 900, manifest.indexOf("allowCommitTransport") + 80);
    expect(gate).toContain("V2NodeExecutor");
    expect(gate).toContain("Stage 11");
    expect(gate).toContain("@deprecated");
  });

  it("defaults commit transport off so a new caller cannot inherit it", async () => {
    const manifest = await source("packages/execution-core/src/integration/manifest.ts");
    expect(manifest).toContain("this.deps.allowCommitTransport !== true");
  });

  it("routes integration failures through the domain router rather than a fixed conflict", async () => {
    const driver = await source("packages/orchestrator-graph/src/canonical-execution-driver.ts");
    expect(driver).toContain("routeRepair");
    // The parent is no longer the default address for every failure.
    expect(driver).toContain("repairTargetNodeId");
  });
});
