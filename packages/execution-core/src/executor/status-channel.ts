/**
 * Send-to-user channel for long-running agents.
 *
 * Headless CLIs have no tool-call path back to the orchestrator, so the
 * protocol rides on stdout: any line of the form `MH_STATUS {json}` is treated
 * as a structured progress report and surfaced live to the user (trace store +
 * run event bus) without ending the agent's turn. Everything else streams
 * through untouched — the channel is purely additive and D5 still holds (git
 * diff decides what changed, never stdout).
 */

export interface AgentStatusUpdate {
  /** Short human-readable progress report ("implementing parser", "running tests"). */
  message: string;
  /** Optional coarse phase tag (e.g. "explore", "implement", "test", "fix"). */
  phase?: string;
  /** Optional 0-100 completion estimate. */
  pct?: number;
}

export const AGENT_STATUS_PREFIX = "MH_STATUS";

/**
 * Paragraph appended to leaf/repair instructions teaching the agent the
 * protocol. Kept short: one example beats prose.
 */
export const AGENT_STATUS_PROTOCOL_INSTRUCTIONS = [
  "Progress reporting: while you work, you can report progress to the user by printing a single line",
  `starting with ${AGENT_STATUS_PREFIX} followed by a JSON object, e.g.:`,
  `${AGENT_STATUS_PREFIX} {"message":"implementing the parser","phase":"implement","pct":40}`,
  'Only "message" is required. Emit one when you start a distinct sub-task and when tests pass/fail.',
  "These lines are surfaced to the user in real time; do not use them for anything else."
].join("\n");

export interface AgentStatusScanner {
  /** Feed a raw output chunk (may contain partial lines). */
  (chunk: string): void;
  /** Process any trailing line that never received its newline. */
  flush(): void;
}

function parseStatusLine(line: string): AgentStatusUpdate | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(AGENT_STATUS_PREFIX)) {
    return undefined;
  }
  const payload = trimmed
    .slice(AGENT_STATUS_PREFIX.length)
    .replace(/^\s*:?\s*/, "");
  if (!payload.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (typeof parsed.message !== "string" || parsed.message.length === 0) {
      return undefined;
    }
    const update: AgentStatusUpdate = { message: parsed.message };
    if (typeof parsed.phase === "string" && parsed.phase.length > 0) {
      update.phase = parsed.phase;
    }
    if (typeof parsed.pct === "number" && Number.isFinite(parsed.pct) && parsed.pct >= 0 && parsed.pct <= 100) {
      update.pct = parsed.pct;
    }
    return update;
  } catch {
    return undefined;
  }
}

/**
 * Stateful line scanner: reassembles lines across chunk boundaries, emits a
 * status update per well-formed `MH_STATUS {json}` line, and never throws on
 * malformed payloads (an agent garbling the protocol must not kill the run).
 */
export function createAgentStatusScanner(
  onStatus: (update: AgentStatusUpdate) => void
): AgentStatusScanner {
  let buffer = "";

  const handleLine = (line: string): void => {
    const update = parseStatusLine(line);
    if (update !== undefined) {
      onStatus(update);
    }
  };

  const scan = ((chunk: string): void => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }) as AgentStatusScanner;

  scan.flush = (): void => {
    if (buffer.length > 0) {
      handleLine(buffer);
      buffer = "";
    }
  };

  return scan;
}
