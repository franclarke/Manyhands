import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkProbeOutput } from "../docs/tesis/evidence/warehouse/oracles/oracle-core.mjs";
import {
  capabilitiesFor,
  referenceProbeOutput,
  renderProbeContract
} from "../docs/tesis/evidence/warehouse/oracles/probe-specimen.mjs";

const prompts = path.resolve("docs/tesis/evidence/warehouse/protocol/prompts");
const increments = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);

const read = (increment: string) => readFile(path.join(prompts, `${increment}.md`), "utf8");

/** The single fenced JSON block a prompt publishes as its specimen. */
function extractSpecimen(prompt: string): unknown {
  const blocks = [...prompt.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => match[1]);
  expect(blocks).toHaveLength(1);
  return JSON.parse(blocks[0]);
}

describe("Warehouse prompt contract", () => {
  it.each(increments)("publishes the contract section rendered from the specimen for %s", async (increment) => {
    expect(await read(increment)).toContain(renderProbeContract(increment));
  });

  it.each(increments)("publishes a specimen the oracle accepts for %s", async (increment) => {
    const specimen = extractSpecimen(await read(increment));

    expect(specimen).toEqual(referenceProbeOutput(increment));
    expect(checkProbeOutput(increment, specimen)).toEqual([]);
  });

  it.each(increments)("nests every capability under `capabilities` in the specimen for %s", async (increment) => {
    const specimen = extractSpecimen(await read(increment)) as Record<string, unknown>;

    for (const capability of capabilitiesFor(increment)) {
      expect(specimen).not.toHaveProperty(capability);
      expect(specimen.capabilities).toHaveProperty(capability);
    }
  });

  /**
   * The regression that produced the W1 series-2 failure. The prompt opened its
   * contract with "Campos exactos:" followed by a flat list that put `layout`
   * and `inventory` beside the envelope fields, contradicting the paragraph
   * below it and the oracle. The delivery followed the flat list and was
   * rejected. No prompt may describe the shape in prose again.
   */
  it.each(increments)("never restates the field layout in prose for %s", async (increment) => {
    const prompt = await read(increment);

    expect(prompt).not.toMatch(/Campos exactos/iu);
    for (const capability of capabilitiesFor(increment)) {
      expect(prompt, `${increment} lists a top-level \`${capability}\``).not.toMatch(
        new RegExp(`\`(schemaVersion|increment|scenario|stateHash)\`[^\\n]*\`${capability}\``, "u")
      );
    }
  });

  it.each(increments)("states the exact probe command for %s", async (increment) => {
    expect(await read(increment)).toContain(
      `pnpm study:probe -- --increment ${increment} --scenario thesis-seed-2026 --format json`
    );
  });

  it.each(increments)("declares every minimum the oracle enforces for %s", async (increment) => {
    const prompt = await read(increment);

    // Each capability's minimums must be visible to the agent, not hidden in
    // the oracle: the stimulus is public, the acceptance rules are not secret.
    for (const capability of capabilitiesFor(increment)) {
      expect(prompt, `${increment} omits ${capability}`).toContain(`\`${capability}.`);
    }
  });
});
