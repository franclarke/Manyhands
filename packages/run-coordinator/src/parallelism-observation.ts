import type { RunEvent } from "./domain/events.js";

/**
 * How much concurrency the run could have had at one scheduling decision, and
 * how much it took.
 */
export interface ParallelismObservation {
  /** Attempts dispatched earlier and not yet settled when readiness was observed. */
  running: number;
  /** Nodes that could have started right then, had the cap allowed it. */
  eligible: number;
  /** `running + eligible`: the concurrency the graph offered at that instant. */
  available: number;
  /** `running + dispatched`: the concurrency the run actually reached. */
  executed: number;
  /** The configured ceiling in force, when the journal recorded one. */
  maxParallel: number | undefined;
  /**
   * True when more was available than the run was allowed to take — the
   * configuration was the limit, not the plan.
   */
  capBinding: boolean;
  evaluatedAt: string;
}

export interface RunParallelismSummary {
  observations: ParallelismObservation[];
  /** Absent rather than zero when the run never scheduled, or never recorded. */
  peakAvailable: number | undefined;
  peakExecuted: number | undefined;
  maxParallel: number | undefined;
  capBindingObservations: number;
  /**
   * Readiness observations whose explanations were not recorded, so nothing can
   * be said about what was available. Reporting them as zero availability would
   * turn missing evidence into a finding.
   */
  unobservedReadinessCount: number;
}

/**
 * Derives parallelism available against parallelism executed from a run's
 * journal.
 *
 * The two numbers separate the two ways a run can end up serial, which the
 * redesign put at stake and which look identical from the outside. If
 * availability never exceeded what ran, the decomposition offered no
 * independent work and the graph is the limit. If it did, the cap is — and that
 * is a configured number, not a property of the plan.
 *
 * Concurrency is read from attempt lifecycle events rather than from the
 * scheduler's `activeResourceNodeIds`, which is a union that also carries
 * externally held resources: those block scheduling without being work in
 * flight, and counting them would inflate both numbers.
 */
export function observeRunParallelism(events: readonly RunEvent[]): RunParallelismSummary {
  const running = new Set<string>();
  const observations: ParallelismObservation[] = [];
  let unobservedReadinessCount = 0;
  let maxParallel: number | undefined;

  for (const event of events) {
    switch (event.type) {
      case "attempt.started":
        running.add(event.payload.attemptId);
        break;
      case "attempt.candidate_created":
      case "attempt.failed":
      case "attempt.discarded":
      case "attempt.stale":
        running.delete(event.payload.attemptId);
        break;
      case "readiness.observed": {
        const cap = event.payload.effectiveConfig?.maxParallel;
        if (cap !== undefined) maxParallel = cap;
        const explanations = event.payload.explanations;
        if (explanations === undefined) {
          unobservedReadinessCount += 1;
          break;
        }
        // `ready` is decided before the selector defers anything, so a deferred
        // node still reads as ready. It is not available: the constraint says it
        // cannot run beside what is running.
        const eligible = explanations.filter((explanation) => explanation.ready && explanation.deferred !== true).length;
        const inFlight = running.size;
        const available = inFlight + eligible;
        const executed = inFlight + event.payload.readyNodeIds.length;
        observations.push({
          running: inFlight,
          eligible,
          available,
          executed,
          maxParallel: cap,
          capBinding: available > executed,
          evaluatedAt: event.payload.evaluatedAt ?? event.occurredAt
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    observations,
    peakAvailable: peak(observations.map((observation) => observation.available)),
    peakExecuted: peak(observations.map((observation) => observation.executed)),
    maxParallel,
    capBindingObservations: observations.filter((observation) => observation.capBinding).length,
    unobservedReadinessCount
  };
}

function peak(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}
