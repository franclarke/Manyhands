import { describe, expect, it } from "vitest";

import { GOLDEN_FIXTURES } from "@/lib/run-model/fixtures";
import { buildRunModel } from "@/lib/run-model/reducer";

describe("canonical V2 presentation fixture", () => {
  it("folds every manual playback step without inventing a second state model", () => {
    const fixture = GOLDEN_FIXTURES["golden-appointment-booking"];
    for (let cursor = 0; cursor <= fixture.events.length; cursor += 1) {
      expect(() => buildRunModel(fixture.seed, fixture.events.slice(0, cursor))).not.toThrow();
    }
  });

  it("demonstrates local decisions, exact artifacts, one repair, and a verified result", () => {
    const fixture = GOLDEN_FIXTURES["golden-appointment-booking"];
    const model = buildRunModel(fixture.seed, fixture.events);

    expect(model.run.lifecycle).toBe("result_ready");
    expect(model.graph?.artifactRequirements).toHaveLength(1);
    expect(model.graph?.seamBindings).toHaveLength(2);
    expect(model.graph?.conflictConstraints).toHaveLength(1);
    expect(Object.values(model.projection?.decisions ?? {}).every((decision) => decision.status === "resolved")).toBe(true);
    expect(model.projection?.attempts["attempt-admin-1"]?.status).toBe("failed");
    expect(model.projection?.attempts["attempt-admin-2"]?.status).toBe("adopted");
    expect(model.projection?.finalCandidate?.evidenceEligible).toBe(true);
  });
});
