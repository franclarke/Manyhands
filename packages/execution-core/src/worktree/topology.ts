import path from "node:path";

/**
 * Serializes this process's mutations of one repository's worktree metadata.
 *
 * `git worktree add`, `remove` and `prune` all write the same `.git/worktrees`
 * bookkeeping, so two of them running at once against one repository can race.
 * Two things follow, and the second is why this is a module and not a field:
 *
 *  - Across processes there is nothing to do. Every caller runs inside the
 *    repository lease, which admits exactly one owner per git common directory.
 *    The cross-process filesystem lease this replaces was a distributed lock
 *    underneath an exclusive one — the tax root cause B describes — and it had
 *    teeth, because it could go stale and block a run that owned the repository
 *    outright.
 *  - Within the process the turnstile has to be keyed by the repository, not
 *    held per instance. A per-instance turnstile makes the guarantee depend on
 *    every caller remembering to share one object; keyed by repository, two
 *    managers and a workspace provider over the same repo serialize whether or
 *    not anyone wired them together.
 */
const chains = new Map<string, Promise<unknown>>();

export function withRepositoryTopology<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = topologyKey(repoRoot);
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  // The chain must survive a failed operation, or one error would deadlock
  // every later mutation behind a rejected promise.
  chains.set(key, next.catch(() => undefined));
  return next;
}

function topologyKey(repoRoot: string): string {
  const resolved = path.resolve(repoRoot).replaceAll("\\", "/").replace(/\/+$/u, "");
  // Windows and macOS paths are case-insensitive in practice, and two spellings
  // of one repository must not get two independent turnstiles.
  return process.platform === "linux" ? resolved : resolved.toLowerCase();
}
