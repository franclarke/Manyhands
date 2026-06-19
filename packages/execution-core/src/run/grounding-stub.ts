/**
 * Shared marker for unimplemented stubs the grounding step leaves in the walking
 * skeleton. A leaf is expected to replace its stub with a real implementation; if
 * its target files still carry this marker after the agent runs, the agent did no
 * real work. Conversely, an empty diff over files that DON'T carry the marker means
 * the grounding baseline already fully satisfies the contract (a no-op leaf — e.g.
 * a barrel/re-export the scaffolder produced in full).
 *
 * Single source of truth: the deterministic scaffolder embeds this exact phrase in
 * stub bodies, the LLM grounding fallback is instructed to use it, and the result
 * recorder matches it (case-insensitive) to tell a no-op success from a real
 * empty-diff failure.
 */
export const GROUNDING_STUB_MARKER = "Not implemented";

/** Case-insensitive matcher for {@link GROUNDING_STUB_MARKER} in file contents. */
export const GROUNDING_STUB_PATTERN = /not implemented/i;

/** Standard throwing stub body the deterministic scaffolder emits for a function. */
export function stubThrow(functionName: string): string {
  return `throw new Error("${GROUNDING_STUB_MARKER}: ${functionName}");`;
}
