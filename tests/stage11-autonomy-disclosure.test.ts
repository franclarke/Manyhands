import { describe, expect, it } from "vitest";

import { autonomyDisclosure, eventDetail } from "@/lib/run-model/presentation";

/**
 * A run that approves its own plan and publishes its own result looks, from the
 * outside, exactly like a run whose operator was very fast. The workspace has to
 * say which one it is: the delegation that made it possible, and, on each act
 * the delegation performed, that no person pressed anything.
 */
describe("What the workspace says about a delegation", () => {
  it("names the delegation and what it covers", () => {
    expect(autonomyDisclosure({ autonomy: "autonomous" })).toEqual({
      level: "autonomous",
      label: "Autónomo",
      scope: "Aprueba el plan y publica el resultado sin volver a preguntar."
    });
    expect(autonomyDisclosure({ autonomy: "semi" })?.scope)
      .toBe("Aprueba el plan y reintenta solo; la publicación espera tu decisión.");
  });

  it("shows nothing when the operator delegated nothing", () => {
    // A supervised run has no standing authorization to disclose, and a badge
    // reading "Supervisado" would be chrome describing the absence of a fact.
    expect(autonomyDisclosure({ autonomy: "supervised" })).toBeNull();
    expect(autonomyDisclosure({})).toBeNull();
    expect(autonomyDisclosure(undefined)).toBeNull();
  });
});

describe("What the activity feed says about who acted", () => {
  it("attributes a delegated approval to the authorization that made it", () => {
    expect(eventDetail({
      type: "decision.resolved",
      payload: { decisionId: "approve-plan", optionId: "approve", authorizedBy: { kind: "autonomy_policy", level: "semi" } }
    })).toBe("Resuelta por la autonomía del run · Semi");
  });

  it("attributes an answer with no authorization to a person", () => {
    expect(eventDetail({ type: "decision.resolved", payload: { decisionId: "approve-plan", optionId: "approve" } }))
      .toBe("Respondida por una persona");
  });

  it("says a publication was delegated when the approval names the policy", () => {
    expect(eventDetail({ type: "delivery.started", payload: { approval: { actor: "autonomy_policy" } } }))
      .toBe("Publicación delegada al iniciar el run");
    expect(eventDetail({ type: "delivery.started", payload: { approval: { actor: "operator" } } })).toBeNull();
  });

  it("adds nothing to an event that carries no such fact", () => {
    // The line exists to report something the payload states. Inventing a
    // qualifier for every event is how a feed starts describing itself.
    expect(eventDetail({ type: "planning.completed", payload: {} })).toBeNull();
    expect(eventDetail({ type: "decision.resolved" })).toBe("Respondida por una persona");
  });
});
