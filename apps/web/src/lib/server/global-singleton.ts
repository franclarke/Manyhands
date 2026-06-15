/**
 * Cross-bundle singletons anchored on `globalThis`.
 *
 * Next.js compiles every route handler and server-component entrypoint as its
 * own bundle, so module-level state is instantiated once PER BUNDLE (and again
 * after each dev recompile) — not once per process. Any in-memory state that
 * must be shared across routes (event buses, write locks, runner registries)
 * has to live on `globalThis`; otherwise it silently fragments: e.g. the
 * `/run-events` SSE route subscribed to a different EventEmitter instance than
 * the one the planning/execution pipelines publish to, so the workspace never
 * received live frames (root cause of "el grafo no se actualiza en vivo").
 */
const GLOBAL_KEY_PREFIX = "__manyhands:";

const globalStore = globalThis as unknown as Record<string, unknown>;

/** Get-or-create the process-wide instance for `key`. */
export function globalSingleton<T>(key: string, create: () => T): T {
  const fullKey = `${GLOBAL_KEY_PREFIX}${key}`;
  if (globalStore[fullKey] === undefined) {
    globalStore[fullKey] = create();
  }
  return globalStore[fullKey] as T;
}

/** Drop the instance so the next `globalSingleton(key, ...)` re-creates it. */
export function resetGlobalSingleton(key: string): void {
  delete globalStore[`${GLOBAL_KEY_PREFIX}${key}`];
}
