import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("docs/tesis/evidence/warehouse");
const increments = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);

describe("Warehouse study assets", () => {
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
  });

  it.each(increments)("pins an external oracle and its content hash for %s", async (increment) => {
    const oracleDir = path.join(root, "oracles", increment);
    const manifest = JSON.parse(await readFile(path.join(oracleDir, "oracle.json"), "utf8"));
    const script = await readFile(path.join(oracleDir, "oracle.mjs"));
    const core = await readFile(path.join(root, "oracles", "oracle-core.mjs"));
    const hash = createHash("sha256").update(script).digest("hex");
    const coreHash = createHash("sha256").update(core).digest("hex");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: `warehouse-${increment.toLowerCase()}-v1`,
      increment,
      command: ["node", "oracle.mjs"],
      timeoutMs: expect.any(Number),
      scriptSha256: hash,
      coreSha256: coreHash
    });
    expect(manifest.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(script.toString("utf8")).toContain("external Warehouse oracle");
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
