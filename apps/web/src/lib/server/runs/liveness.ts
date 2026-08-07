import type { RunStatus } from "./schema";

/**
 * Whether a run is still being worked on, decided by the product rather than by
 * the experiment harness.
 *
 * A run whose owner dies used to stay `running` until something else happened
 * to claim it, so the harness had to notice and cancel it. That is backwards —
 * a tool that depends on its test rig to avoid hanging is not finished — and it
 * also poisons measurement, because the harness's polling interval becomes part
 * of every duration the thesis reports.
 *
 * The taxonomy is closed on purpose: every verdict has exactly one disposition,
 * so no failure can land in a generic bucket. See stage 5 of
 * `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 */

export const RUN_LIVENESS_VERDICTS = [
  /** Already finished; nothing to decide. */
  "terminal",
  /** Heartbeat within the staleness window. */
  "alive",
  /** Heartbeat expired AND no owner process behind it. Terminal. */
  "owner_absent",
  /** Heartbeat expired but the owner process is alive. Reportable, never terminal. */
  "owner_silent",
  /** Waiting for a human by design; nobody is meant to be holding it. */
  "parked",
  /** Should be working and holding no operation at all. Terminal. */
  "unowned"
] as const;

export type RunLivenessVerdictKind = (typeof RUN_LIVENESS_VERDICTS)[number];

export type RunLivenessVerdict =
  | { kind: "terminal" }
  | { kind: "alive" }
  | { kind: "owner_absent"; operationId: string; silentForMs: number }
  | { kind: "owner_silent"; operationId: string; silentForMs: number }
  | { kind: "parked" }
  | { kind: "unowned" };

export interface RunLivenessInput {
  lifecycle: RunStatus;
  activeOperation?: { operationId: string; heartbeatAt?: string } | undefined;
  /**
   * Whether a process belonging to this run is verifiably alive. Derived from
   * durable process evidence, never from the absence of metadata: a run with no
   * journal has no candidates, which is not the same as having no processes.
   */
  ownerProcessPresent: boolean;
  staleAfterMs: number;
  now: string;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "interrupted"
]);

/**
 * Lifecycles that are waiting on a person, not on a process.
 *
 * These hold no operation by design, and an expired heartbeat on one means only
 * that the last runner released it cleanly. Reading either as abandonment would
 * end exactly the runs that are behaving correctly — the most expensive false
 * positive available here, because it destroys work that was only waiting to be
 * approved.
 */
const PARKED: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "needs_approval",
  "waiting_for_input",
  "paused",
  "result_ready"
]);

export function classifyRunLiveness(input: RunLivenessInput): RunLivenessVerdict {
  if (TERMINAL.has(input.lifecycle)) return { kind: "terminal" };
  if (PARKED.has(input.lifecycle)) return { kind: "parked" };
  if (input.activeOperation === undefined) return { kind: "unowned" };

  const { operationId, heartbeatAt } = input.activeOperation;
  // A live operation that never wrote a heartbeat is silent, not fresh.
  // Treating absence as freshness would make the never-heartbeating case — the
  // one where a runner died before its first tick — permanently undetectable.
  const silentForMs = heartbeatAt === undefined
    ? Number.POSITIVE_INFINITY
    : silenceOf(heartbeatAt, input.now);

  if (silentForMs <= input.staleAfterMs) return { kind: "alive" };
  // Both halves are required. An expired heartbeat alone means a busy executor
  // that has not written one; ending its run would destroy work in progress.
  return input.ownerProcessPresent
    ? { kind: "owner_silent", operationId, silentForMs }
    : { kind: "owner_absent", operationId, silentForMs };
}

function silenceOf(heartbeatAt: string, now: string): number {
  const beat = Date.parse(heartbeatAt);
  const evaluatedAt = Date.parse(now);
  if (!Number.isFinite(beat) || !Number.isFinite(evaluatedAt)) {
    throw new Error(`Cannot measure liveness from unparseable timestamps (${heartbeatAt}, ${now}).`);
  }
  if (beat > evaluatedAt) {
    // Silently clamping would report a stalled run as fresh forever, which is
    // the failure this module exists to end.
    throw new Error(`Run heartbeat ${heartbeatAt} is in the future relative to ${now}; refusing to judge liveness from a skewed clock.`);
  }
  return evaluatedAt - beat;
}
