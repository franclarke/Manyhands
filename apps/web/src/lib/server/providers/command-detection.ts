import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

/**
 * Validation/build commands inferred from a repo's `package.json` and lockfiles.
 * Reused by the readiness panel (to show the user what we detected) and by the
 * ValidationCommandSuggester so leaves run the project's real checks.
 */
export interface DetectedCommands {
  packageManager: PackageManager;
  test?: string;
  build?: string;
  typecheck?: string;
  lint?: string;
}

/** Ordered candidate script names per command kind (first match wins). */
const SCRIPT_CANDIDATES: Record<Exclude<keyof DetectedCommands, "packageManager">, string[]> = {
  test: ["test", "test:unit", "tests", "vitest", "jest"],
  build: ["build", "compile"],
  typecheck: ["typecheck", "type-check", "tsc"],
  lint: ["lint", "eslint"]
};

export async function detectWorkspaceCommands(repoPath: string): Promise<DetectedCommands> {
  let scripts: Record<string, string> = {};
  let packageManagerField: string | undefined;
  try {
    const raw = await readFile(join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string>; packageManager?: string };
    scripts = pkg.scripts ?? {};
    packageManagerField = pkg.packageManager;
  } catch {
    // No readable package.json — return just the package manager guess.
  }

  const packageManager = detectPackageManager(repoPath, packageManagerField);
  const result: DetectedCommands = { packageManager };
  const runner = packageManager === "unknown" ? "npm" : packageManager;
  for (const [kind, candidates] of Object.entries(SCRIPT_CANDIDATES)) {
    const script = candidates.find((name) => typeof scripts[name] === "string" && scripts[name]!.trim().length > 0);
    if (script !== undefined) {
      result[kind as keyof typeof SCRIPT_CANDIDATES] = `${runner} run ${script}`;
    }
  }
  return result;
}

/** True when at least one runnable command was detected. */
export function hasDetectedCommands(commands: DetectedCommands): boolean {
  return (
    commands.test !== undefined ||
    commands.build !== undefined ||
    commands.typecheck !== undefined ||
    commands.lint !== undefined
  );
}

function detectPackageManager(repoPath: string, packageManagerField: string | undefined): PackageManager {
  if (packageManagerField !== undefined) {
    const name = packageManagerField.split("@")[0];
    if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") {
      return name;
    }
  }
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(repoPath, "bun.lockb"))) return "bun";
  if (existsSync(join(repoPath, "package-lock.json"))) return "npm";
  return "unknown";
}
