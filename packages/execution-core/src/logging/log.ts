/**
 * Structured, greppable logging for the execution pipeline.
 *
 * Every execute path (worktree → executor → result recording → integration →
 * validation) emits a single-line log per lifecycle event and per failure edge
 * case, so a real run prints *why* a leaf did not succeed instead of the failure
 * only living in the in-memory trace store.
 *
 * Format: `[exec:<scope>] <message> key=value key=value`
 *
 * Toggle:
 *   - `MANYHANDS_EXEC_LOG=0|false` silences all execution logs.
 *   - `MANYHANDS_EXEC_LOG=1|true`  forces them on (even under tests).
 *   - Default: ON for real runs, OFF under Vitest (so the suite stays quiet).
 */

export type LogFields = Record<string, unknown>;

function loggingEnabled(): boolean {
  const flag = process.env.MANYHANDS_EXEC_LOG;
  if (flag !== undefined) {
    const normalized = flag.trim().toLowerCase();
    return normalized !== "0" && normalized !== "false" && normalized !== "off";
  }
  // Default ON, except under Vitest where error/edge-case paths are exercised on
  // purpose and would flood the test output.
  return process.env.VITEST === undefined;
}

/** Keep long values (stderr tails, diffs, paths) readable on a single line. */
const VALUE_LIMIT = 600;

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return String(value);
  }
  if (value instanceof Error) {
    return JSON.stringify(value.message);
  }
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  } else if (Array.isArray(value)) {
    text = value.join(",");
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  // Collapse newlines so the line stays grep-friendly, then clamp the length.
  const flat = text.replace(/\s*\n\s*/gu, " ⏎ ").trim();
  const clamped = flat.length > VALUE_LIMIT ? `${flat.slice(0, VALUE_LIMIT)}…(+${flat.length - VALUE_LIMIT})` : flat;
  return /\s/u.test(clamped) ? JSON.stringify(clamped) : clamped;
}

function formatFields(fields?: LogFields): string {
  if (fields === undefined) {
    return "";
  }
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function line(scope: string, message: string, fields?: LogFields): string {
  return `[exec:${scope}] ${message}${formatFields(fields)}`;
}

export function execLog(scope: string, message: string, fields?: LogFields): void {
  if (!loggingEnabled()) {
    return;
  }
  console.log(line(scope, message, fields));
}

export function execWarn(scope: string, message: string, fields?: LogFields): void {
  if (!loggingEnabled()) {
    return;
  }
  console.warn(line(scope, message, fields));
}

export function execError(scope: string, message: string, fields?: LogFields): void {
  if (!loggingEnabled()) {
    return;
  }
  console.error(line(scope, message, fields));
}
