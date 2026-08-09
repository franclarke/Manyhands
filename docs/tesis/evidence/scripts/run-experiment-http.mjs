/**
 * Bounded HTTP boundary for experiment drivers.
 *
 * A stalled local server must become an attributed cell failure rather than
 * consuming the entire wall-clock budget with an opaque Undici error.
 */
export class ExperimentHttpError extends Error {
  constructor(message, { method, path, cause } = {}) {
    super(message, { cause });
    this.name = "ExperimentHttpError";
    this.method = method;
    this.path = path;
  }
}

export async function requestJson(baseUrl, path, {
  method = "GET",
  token,
  body,
  timeoutMs = 15_000
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token === undefined ? {} : { "x-manyhands-session": token })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ExperimentHttpError(
        `${method} ${path} -> ${response.status}${text.length === 0 ? "" : ` ${text}`}`,
        { method, path }
      );
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new ExperimentHttpError(`${method} ${path} returned invalid JSON`, { method, path, cause });
    }
  } catch (error) {
    if (error instanceof ExperimentHttpError) throw error;
    if (controller.signal.aborted) {
      throw new ExperimentHttpError(`${method} ${path} failed: request timed out after ${timeoutMs}ms`, {
        method,
        path,
        cause: error
      });
    }
    throw new ExperimentHttpError(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`, {
      method,
      path,
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}
