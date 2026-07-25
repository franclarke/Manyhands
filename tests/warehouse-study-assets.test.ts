import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("docs/tesis/evidence/warehouse");
const increments = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);
const cumulativeCapabilities = [
  "layout", "inventory", "visual", "orders", "simulation",
  "routing", "congestion", "persistence", "analytics", "accessibility"
];

describe("Warehouse study assets", () => {
  it("pins every prompt in the study asset manifest", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "assets-manifest.json"), "utf8"));
    const seedManifest = await readFile(path.join(root, "seed", "seed-manifest.json"));
    expect(createHash("sha256").update(seedManifest).digest("hex")).toBe(manifest.seedManifestSha256);
    for (const increment of increments) {
      const prompt = await readFile(path.join(root, "protocol", "prompts", `${increment}.md`));
      expect(createHash("sha256").update(prompt).digest("hex")).toBe(manifest.prompts[increment]);
    }
  });

  it.each(increments)("defines a complete, chained prompt for %s", async (increment) => {
    const prompt = await readFile(path.join(root, "protocol", "prompts", `${increment}.md`), "utf8");

    expect(prompt).toMatch(/^# W\d+ — .+/mu);
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("## Acceptance");
    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("## Oracle");
    expect(prompt).toContain(`Oracle id: \`warehouse-${increment.toLowerCase()}-v1\``);
    if (increment !== "W1") {
      expect(prompt).toContain(`Base: verified delivery of W${Number(increment.slice(1)) - 1}`);
    }
    for (const field of ["schemaVersion", "increment", "scenario", "capabilities", "stateHash"]) {
      expect(prompt).toContain(`\`${field}\``);
    }
    const capabilityCount = increment === "W8" ? cumulativeCapabilities.length : Number(increment.slice(1)) + 1;
    for (const capability of cumulativeCapabilities.slice(0, capabilityCount)) {
      expect(prompt).toContain(`\`${capability}\``);
    }
  });

  it.each(increments)("pins an external oracle and its content hash for %s", async (increment) => {
    const oracleDir = path.join(root, "oracles", increment);
    const manifest = JSON.parse(await readFile(path.join(oracleDir, "oracle.json"), "utf8"));
    const script = await readFile(path.join(oracleDir, "oracle.mjs"));
    const core = await readFile(path.join(root, "oracles", "oracle-core.mjs"));
    const specimen = await readFile(path.join(root, "oracles", "probe-specimen.mjs"));
    const hash = createHash("sha256").update(script).digest("hex");
    const coreHash = createHash("sha256").update(core).digest("hex");
    const specimenHash = createHash("sha256").update(specimen).digest("hex");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: `warehouse-${increment.toLowerCase()}-v1`,
      increment,
      command: ["node", "oracle.mjs"],
      timeoutMs: expect.any(Number),
      scriptSha256: hash,
      coreSha256: coreHash,
      specimenSha256: specimenHash
    });
    expect(manifest.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(script.toString("utf8")).toContain("external Warehouse oracle");
  });

  it("keeps every asset pin reconciled with the bytes it names", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);

    // `--check` exits non-zero on any stale pin, so hand-edited hashes cannot survive.
    await expect(
      run(process.execPath, ["docs/tesis/evidence/scripts/pin-warehouse-assets.mjs", "--check"], {
        cwd: process.cwd(),
        windowsHide: true
      })
    ).resolves.toMatchObject({ stdout: expect.stringContaining("all Warehouse asset pins match") });
  });

  it("keeps pnpm lifecycle banners out of the JSON probe channel", async () => {
    const core = await readFile(path.join(root, "oracles", "oracle-core.mjs"), "utf8");

    expect(core).toContain('["--silent", "study:probe"');
  });

  it("pins a domain-free, reproducible seed", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "seed", "seed-manifest.json"), "utf8"));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      repository: expect.any(String),
      commit: expect.stringMatching(/^[0-9a-f]{40}$/u),
      tree: expect.stringMatching(/^[0-9a-f]{40}$/u),
      lockfileSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      domainSourceFiles: []
    });
    expect(manifest.allowedSeedFiles).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/warehouse|inventory|order|routing/iu)
    ]));
  });
});
