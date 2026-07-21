import { describe, expect, it } from "vitest";
import { RunEventSchema } from "@manyhands/run-coordinator";

import { GOLDEN_FIXTURE_NAMES, GOLDEN_FIXTURES } from "@/lib/run-model/fixtures";
import { buildRunModel } from "@/lib/run-model/reducer";

describe("canonical V2 presentation fixture", () => {
  const fixture = GOLDEN_FIXTURES["golden-password-recovery"];

  it("replaces every legacy Proto sample with one interview-ready run", () => {
    expect(GOLDEN_FIXTURE_NAMES).toEqual(["golden-password-recovery"]);
    expect(fixture.seed.title).toBe("Recuperación segura de contraseña");
    expect(fixture.milestones.map((milestone) => milestone.id)).toEqual([
      "goal",
      "repository",
      "plan",
      "execution",
      "repair",
      "decision",
      "integration",
      "evidence",
      "delivery"
    ]);
  });

  it("folds every manual playback step without inventing a second state model", () => {
    for (let cursor = 0; cursor <= fixture.events.length; cursor += 1) {
      expect(() => buildRunModel(fixture.seed, fixture.events.slice(0, cursor))).not.toThrow();
    }
  });

  it("uses only canonical coordinator events", () => {
    for (const event of fixture.events) {
      expect(() => RunEventSchema.parse({
        eventId: event.eventId,
        runId: event.runId,
        sequence: event.seq,
        occurredAt: event.at,
        type: event.type,
        payload: event.payload
      })).not.toThrow();
    }
  });

  it("keeps composites ready until their own integration completes", () => {
    const firstIntegrationIndex = fixture.events.findIndex((event) => event.type === "integration.started");
    const beforeIntegration = buildRunModel(fixture.seed, fixture.events.slice(0, firstIntegrationIndex));

    for (const nodeId of ["security", "server", "experience"]) {
      expect(beforeIntegration.nodes.find((node) => node.id === nodeId)?.status).toBe("ready");
    }
    expect(beforeIntegration.nodes.find((node) => node.id === "root")?.status).not.toBe("succeeded");
  });

  it("demonstrates parallel work, a local repair, a human decision, integration, and delivery", () => {
    const model = buildRunModel(fixture.seed, fixture.events);

    expect(model.run.lifecycle).toBe("completed");
    expect(model.graph?.artifactRequirements).toHaveLength(2);
    expect(model.graph?.seamBindings).toHaveLength(2);
    expect(model.graph?.conflictConstraints).toHaveLength(1);
    expect(Object.values(model.projection?.decisions ?? {}).every((decision) => decision.status === "resolved")).toBe(true);
    expect(model.projection?.attempts["attempt-token-1"]?.status).toBe("failed");
    expect(model.projection?.attempts["attempt-token-2"]?.status).toBe("adopted");
    expect(Object.keys(model.projection?.integrations ?? {}).sort()).toEqual(["experience", "root", "security", "server"]);
    expect(Object.values(model.projection?.integrations ?? {}).every((integration) => integration.status === "completed")).toBe(true);
    expect(model.projection?.finalCandidate?.evidenceEligible).toBe(true);
    expect(model.projection?.deliveryReceipt?.confirmed).toBe(true);
  });
});
