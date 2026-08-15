import { describe, expect, it } from "vitest";

import { parseCanonicalPlanningProposal } from "../apps/daemon/src/current-lifecycle-adapters.js";

const request = { goal: { id: "goal:x", revision: 1 } } as never;
const view = { digest: "sha256:view" } as never;

const NEEDS_INPUT = JSON.stringify({ kind: "needs_input", decisions: [] });

/**
 * Claude Code returns the assistant's prose in its `result` field, and a bare
 * JSON.parse turned anything else into an exception thrown out of the effect
 * adapter. The PlanningEngine already knows how to reject a non-conforming
 * proposal as `model_protocol_invalid`; it just never got the chance.
 *
 * A markdown code fence is a different case: the model did answer with the
 * requested object, it simply formatted it. Treating that as a protocol
 * violation makes planning fail intermittently for no real reason.
 */
describe("Canonical planning proposal parsing", () => {
  it("rejects prose as an unsupported proposal instead of throwing", () => {
    const parsed = parseCanonicalPlanningProposal(
      "I've written a plan for the two modules. First, tokenizer.js…",
      request,
      view
    );
    expect(["candidate", "needs_input", "ambiguous"]).not.toContain((parsed as { kind?: string }).kind);
  });

  it("rejects a truncated JSON body the same way", () => {
    const parsed = parseCanonicalPlanningProposal('{"kind":"candidate","material":', request, view);
    expect(["candidate", "needs_input", "ambiguous"]).not.toContain((parsed as { kind?: string }).kind);
  });

  it("rejects an empty response", () => {
    const parsed = parseCanonicalPlanningProposal("   ", request, view);
    expect(["candidate", "needs_input", "ambiguous"]).not.toContain((parsed as { kind?: string }).kind);
  });

  it("reads a proposal the model wrapped in a markdown code fence", () => {
    const fenced = ["```json", NEEDS_INPUT, "```"].join("\n");
    expect((parseCanonicalPlanningProposal(fenced, request, view) as { kind?: string }).kind)
      .toBe("needs_input");
  });

  it("reads a fenced proposal surrounded by prose", () => {
    const answer = [
      "Here is the plan:",
      "",
      "```json",
      NEEDS_INPUT,
      "```",
      "",
      "Let me know if you want changes."
    ].join("\n");
    expect((parseCanonicalPlanningProposal(answer, request, view) as { kind?: string }).kind)
      .toBe("needs_input");
  });

  it("reads an unlabelled fence", () => {
    const fenced = ["```", NEEDS_INPUT, "```"].join("\n");
    expect((parseCanonicalPlanningProposal(fenced, request, view) as { kind?: string }).kind)
      .toBe("needs_input");
  });
});
