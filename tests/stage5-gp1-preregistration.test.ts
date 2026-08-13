import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGoalContract, verifyCanonicalDigest } from "@manyhands/contracts";
import { stage5Sha256 } from "./helpers/stage5-fixture.js";

const root = "docs/audits/stage-5/preregistration";

describe("Stage 5 GP1 pre-registration", () => {
  const files = readdirSync(root).filter((name) => name.endsWith(".json")).sort();

  it("freezes exactly two real-repository cases and one initial session each", () => {
    expect(files).toEqual(["express.json", "manyhands.json"]);
    for (const file of files) {
      const value = load(file);
      expect(value.repository.baseCommit).toMatch(/^[0-9a-f]{40}$/u);
      expect(value.repository.treeSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(value.repository.viewDigest).toMatch(/^sha256:/u);
      expect(value.provider).toMatchObject({
        cli: "codex-cli",
        cliVersion: "0.146.0",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandbox: "read-only",
        ephemeral: true,
        initialSessions: 1,
        repeatPolicy: "forbidden_without_recorded_causal_change"
      });
    }
  });

  it("binds canonical goals and independent topology/browser oracles before outputs", () => {
    for (const file of files) {
      const value = load(file);
      expect(buildGoalContract(withoutDigest(value.goal), stage5Sha256)).toEqual(value.goal);
      expect(verifyCanonicalDigest(value.goal, "digest", stage5Sha256)).toBe(true);
      expect(value.topologyOracle.goalDigest).toBe(value.goal.digest);
      expect(value.topologyOracle.repositoryViewDigest).toBe(value.repository.viewDigest);
      expect(value.topologyOracle.requiredResponsibilities.length).toBeGreaterThanOrEqual(5);
      expect(value.topologyOracle.requiredSeams.length).toBeGreaterThanOrEqual(2);
      expect(value.topologyOracle.requiredOwnership.length).toBeGreaterThanOrEqual(3);
      expect(value.browserOracle.requiredSections).toEqual(expect.arrayContaining([
        "Responsibility hierarchy", "Explicit seams", "Proof coverage"
      ]));
      expect(value.browserOracle.viewports).toEqual(expect.arrayContaining([
        { width: 1440, height: 1000 }, { width: 390, height: 844 }
      ]));
    }
    expect(readdirSync("docs/audits/stage-5").filter((name) => /output|result|screenshot/iu.test(name))).toEqual([]);
  });
});

function load(file: string): any {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

function withoutDigest<T extends { digest: string }>(value: T): Omit<T, "digest"> {
  const { digest: _digest, ...material } = value;
  return material;
}
