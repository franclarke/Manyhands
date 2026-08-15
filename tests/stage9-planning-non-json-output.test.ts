import { describe, expect, it } from "vitest";

import { parseCanonicalPlanningProposal } from "../apps/daemon/src/current-lifecycle-adapters.js";

const request = { goal: { id: "goal:x", revision: 1 } } as never;
const view = { digest: "sha256:view" } as never;

/**
 * Claude Code returns the assistant's prose in its `result` field. Under
 * `--permission-mode plan` that prose is a narrative plan, not the JSON the
 * planner asks for, and a bare JSON.parse turned it into an exception thrown
 * out of the effect adapter. The PlanningEngine already knows how to reject a
 * non-conforming proposal as `model_protocol_invalid`; it just never got the
 * chance because the parse threw first.
 */
describe("Canonical planning proposal parsing", () => {
  it("rejects prose as an unsupported proposal instead of throwing", () => {
    const parsed = parseCanonicalPlanningProposal(
      "I've written a plan for the two modules. First, tokenizer.js…",
      request,
      view
    );
    expect(parsed).toBeDefined();
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
});
