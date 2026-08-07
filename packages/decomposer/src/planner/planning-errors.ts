/**
 * Failure kinds a planning transport can raise, independent of which planner
 * consumes it. They outlived the one-shot WorkBreakdown planner that first
 * needed them, so they live on their own rather than inside a retired module.
 */

/** Signals a transport or protocol failure that another model attempt cannot repair. */
export class NonRetryablePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryablePlanningError";
  }
}

/**
 * Signals that the provider refused the request for capacity reasons.
 *
 * This is not a property of the plan the model produced, so it must not consume
 * the repair budget: Warehouse pilot series-9 lost all three planning attempts
 * to a throttled CLI while a minimal probe to the same model answered normally
 * seconds later. Spending attempts on it makes a transient condition look like a
 * model that cannot satisfy the schema, and no repair issue can recover it.
 */
export class PlanningCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningCapacityError";
  }
}
