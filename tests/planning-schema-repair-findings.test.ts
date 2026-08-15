import { describe, expect, it, vi } from "vitest";

import {
  PlanningEngine,
  type PlanningFinding,
  type PlanningModel,
  type PlanningModelProposal,
  type PlanningRepositoryReader
} from "@manyhands/decomposer";

import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

/**
 * A schema-invalid candidate used to reach the repair prompt as a single
 * finding whose message was the whole pretty-printed ZodError. The model then
 * had to re-derive which of sixty nested issues it was supposed to fix out of
 * an unstructured blob, which is why repair never converged.
 *
 * `verifyPlan` already reports one finding per issue as `path: message`, and
 * the repair prompt renders findings as `code: message`. Schema rejection has
 * no reason to be the one path that hands the model raw JSON.
 */
describe("Schema-invalid planning repair findings", () => {
  it("addresses each issue by path instead of one ZodError blob", async () => {
    const material = brokenMaterial((units) => {
      // Exactly the shapes the live composite run produced.
      units["unit:a"]!.outcomes = ["Module A exposes its contract."];
      units["unit:a"]!.repositorySurface = { resourceIds: ["resource:a"], pathHints: ["src/a.ts"] };
    });

    const repairFindings = await findingsHandedToRepair(material);
    const messages = repairFindings.filter(({ code }) => code === "schema_invalid").map(({ message }) => message);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.some((message) => message.startsWith("units.unit:a.outcomes"))).toBe(true);
    expect(messages.some((message) => message.startsWith("units.unit:a.repositorySurface"))).toBe(true);
    for (const message of messages) expect(message).not.toContain('"code":');
  });

  it("keeps every schema finding terminal so the model cannot ignore one", async () => {
    const material = brokenMaterial((units) => { units["unit:a"]!.expansion = "partial"; });
    const repairFindings = await findingsHandedToRepair(material);

    expect(repairFindings.length).toBeGreaterThan(0);
    for (const finding of repairFindings) {
      expect(finding.code).toBe("schema_invalid");
      expect(finding.severity).toBe("error");
    }
    expect(repairFindings.map(({ message }) => message)).toEqual(
      expect.arrayContaining([expect.stringContaining("units.unit:a.expansion")])
    );
  });
});

function brokenMaterial(
  breakIt: (units: Record<string, Record<string, unknown>>) => void
): unknown {
  const material = structuredClone(stage5Fixture().plan) as unknown as Record<string, unknown>;
  Reflect.deleteProperty(material, "digest");
  breakIt(material.units as Record<string, Record<string, unknown>>);
  return material;
}

/** The repair prompt is the only consumer of these findings, so it is the observable. */
async function findingsHandedToRepair(material: unknown): Promise<readonly PlanningFinding[]> {
  const fixture = stage5Fixture();
  const seen: Array<readonly PlanningFinding[]> = [];
  const model: PlanningModel = {
    propose: vi.fn(async (input): Promise<PlanningModelProposal> => {
      seen.push(input.previousFindings);
      return { kind: "candidate", material: material as never };
    })
  };
  await new PlanningEngine({ model, repository: repository(), hasher: stage5Sha256 }).plan({
    goal: fixture.goal,
    repositoryView: fixture.repositoryView,
    proofStrategies: fixture.proofStrategies,
    budget: { modelCalls: 3, repositoryQueries: 4, queryBytes: 10_000, revisions: 3, repairs: 2, expansions: 1 }
  }, new AbortController().signal);
  expect(seen[0], "the first call must not carry findings").toEqual([]);
  return seen[1] ?? [];
}

function repository(): PlanningRepositoryReader {
  return {
    inspect: async () => ({
      queryReceipts: ["query:architecture"],
      evidenceRefs: ["evidence:architecture"],
      repositoryQueries: 1,
      queryBytes: 1_024,
      missingCapabilities: []
    })
  };
}
