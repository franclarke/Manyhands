/**
 * Cross-bundle singletons anchored on `globalThis`.
 *
 * Next.js compiles route handlers and server components into separate bundles.
 * This helper is limited to disposable process-local caches for web-owned
 * configuration repositories. Run actors, lifecycle state, process registries,
 * event streams and background promises belong exclusively to the daemon and
 * must never be stored here.
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
