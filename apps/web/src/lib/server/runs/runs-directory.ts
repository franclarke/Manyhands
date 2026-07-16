import path from "node:path";
import { resolveRepoRoot } from "../repo-root";

/**
 * Leaf module (RU1): the runs directory resolver lives outside repository.ts
 * so evidence stores can use it without importing the repository → schema →
 * repo-provisioner → process-supervision chain (import cycle).
 */
export function resolveRunsDirectory(): string {
  const override = process.env.MANYHANDS_RUNS_DIR;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(resolveRepoRoot(), ".manyhands", "runs");
}
