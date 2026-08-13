import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunRecordSchema } from "@/lib/server/runs/schema";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
describe("target architecture migration baseline", () => {
  it("pins a package-manager runtime that supports the declared Node baseline", async () => {
    const [rootPackage, workflow, nvmrc] = await Promise.all([
      readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
      readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(path.join(REPO_ROOT, ".nvmrc"), "utf8")
    ]);
    const manifest = JSON.parse(rootPackage) as {
      packageManager?: string;
      engines?: { node?: string; pnpm?: string };
    };

    expect(manifest.packageManager).toBe("pnpm@11.21.0");
    expect(manifest.engines).toEqual({ node: ">=22.13", pnpm: "11.21.0" });
    expect(workflow).toContain("version: 11.21.0");
    expect(workflow).toContain("node-version: 22.22.0");
    expect(nvmrc.trim()).toBe("22.22.0");
  });

  it("preserves baseline resolutions while allowing declared additive workspace importers", async () => {
    const lockfile = await readFile(path.join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");
    const packageResolutions = parsePackageResolutions(lockfile);
    const importerResolutions = parseImporterResolutions(lockfile);
    const declaredTransitionResolutions = [
      "apps/daemon|dependencies|@manyhands/conflict-risk|link:../../packages/conflict-risk",
      "apps/daemon|dependencies|@manyhands/contracts|link:../../packages/contracts",
      "apps/daemon|dependencies|@manyhands/decomposer|link:../../packages/decomposer",
      "apps/daemon|dependencies|@manyhands/execution-core|link:../../packages/execution-core",
      "apps/daemon|dependencies|@manyhands/orchestrator-graph|link:../../packages/orchestrator-graph",
      "apps/daemon|dependencies|@manyhands/repository-index|link:../../packages/repository-index",
      "apps/daemon|dependencies|@manyhands/run-coordinator|link:../../packages/run-coordinator",
      "apps/daemon|dependencies|@manyhands/run-engine|link:../../packages/run-engine",
      "apps/daemon|dependencies|@manyhands/run-store|link:../../packages/run-store",
      "apps/daemon|dependencies|@manyhands/shared|link:../../packages/shared",
      "apps/daemon|dependencies|@manyhands/task-graph|link:../../packages/task-graph",
      "apps/daemon|dependencies|@manyhands/trace-store|link:../../packages/trace-store",
      "packages/run-coordinator|dependencies|@manyhands/contracts|link:../contracts",
      "packages/run-engine|dependencies|@manyhands/contracts|link:../contracts",
      "packages/run-engine|dependencies|@manyhands/run-coordinator|link:../run-coordinator",
      "packages/run-engine|dependencies|@manyhands/run-store|link:../run-store",
      "packages/run-store|dependencies|@manyhands/contracts|link:../contracts"
    ].sort();
    const transitionResolutionSet = new Set(declaredTransitionResolutions);
    const baselineImporterResolutions = importerResolutions.filter(
      (resolution) => !transitionResolutionSet.has(resolution)
    );
    const transitionImporterResolutions = importerResolutions.filter(
      (resolution) => transitionResolutionSet.has(resolution)
    );

    expect(packageResolutions).toHaveLength(778);
    expect(sha256Lines(packageResolutions)).toBe(
      "845bda9823eacae6bf087008b95b5fc99a80888a69026a967df71026b71e6673"
    );
    expect(baselineImporterResolutions).toHaveLength(100);
    expect(sha256Lines(baselineImporterResolutions)).toBe(
      "0d5aeecdbc69dd8e6a5523c39e96855b805d214d7b7935b44b9a31310b706e5f"
    );
    expect(transitionImporterResolutions).toEqual(declaredTransitionResolutions);
  });

  it("keeps clean-clone qualification reproducible and its receipts versionable", async () => {
    const [script, nativeProcessScript, closureScript, gitignore, gitattributes] = await Promise.all([
      readFile(path.join(REPO_ROOT, "scripts", "verify-stage0-clean-clone.ps1"), "utf8"),
      readFile(path.join(REPO_ROOT, "scripts", "stage0-native-process.ps1"), "utf8"),
      readFile(path.join(REPO_ROOT, "scripts", "verify-stage0-closure.ps1"), "utf8"),
      readFile(path.join(REPO_ROOT, ".gitignore"), "utf8"),
      readFile(path.join(REPO_ROOT, ".gitattributes"), "utf8")
    ]);

    expect(script).toContain("Assert-NewAbsoluteDirectory $ClonePath 'ClonePath'");
    expect(script).toContain("--no-local");
    expect(script).toContain("--no-hardlinks");
    expect(script).toContain("STORE_FILES_BEFORE_INSTALL=");
    expect(script).toContain("Node archive checksum mismatch");
    expect(script).toContain("Node runtime mismatch");
    expect(script).toContain("pnpm runtime mismatch");
    expect(script).toContain("$script:ExpectedNodeVersion");
    expect(script).toContain("$script:ExpectedPnpmVersion");
    expect(script).not.toContain("$script:NodeVersion");
    expect(script).not.toContain("$script:PnpmVersion");
    expect(script).toContain("Final Node runtime mismatch");
    expect(script).toContain("Final pnpm runtime mismatch");
    expect(script).toContain("Pinned pnpm or Node executable changed during qualification");
    expect(script).toContain("PNPM_NODE_SHA256=");
    expect(script).toContain("PNPM_PATH=");
    expect(script).toContain("PNPM_SHA256=");
    expect(script).not.toContain("$pnpm @('exec', 'node', '--version')");
    expect(script).toContain("Detached clone identity changed during qualification");
    expect(script).toContain("RECEIPT_STATUS=pass");
    expect(script).toContain("stage0-native-process.ps1");
    expect(nativeProcessScript).toContain("decide success solely from the native exit code");
    expect(nativeProcessScript).toContain("$global:LASTEXITCODE = $null");
    expect(nativeProcessScript).toContain("Native executable is not a file");
    expect(nativeProcessScript).toContain("PowerShell metacharacters");
    expect(script).toContain("source-api-routes");
    expect(script).toContain("source-legacy-imports");
    expect(script).toContain("RG_PATH=");
    expect(script).toContain("RG_VERSION=");
    expect(script.indexOf("'package-build'", script.indexOf("'package-typechecks'"))).toBeLessThan(
      script.indexOf("'web-typecheck'", script.indexOf("'package-typechecks'"))
    );
    expect(script).toContain("'vitest', 'run', '--retry=0'");
    expect(script).toContain("--format', 'json'");
    expect(script).toContain("LINT_FINGERPRINT_SCHEMA=eslint-json-v1");
    expect(script).toContain("74bd6c28c7f21924479e2ec82cfea8de75b8b4d36c0707c0892a64c3db822c70");
    expect(script).not.toContain("78 problems (78 errors, 0 warnings)");
    expect(closureScript).toContain("'rev-list', '--parents', '-n', '1', 'HEAD'");
    expect(closureScript).toContain("Closure must have exactly one parent equal to qualified candidate");
    expect(closureScript).toContain("Closure receipt set mismatch");
    expect(closureScript).toContain("Closure changed paths outside the allowlist");
    expect(closureScript).toContain("qualificationLogFiles do not match the 18 logs added");
    expect(closureScript).toContain("stage0-evidence-integrity.test.ts");
    expect(closureScript).toContain("'diff', '--check', \"$architectureBaseline..HEAD\"");
    expect(closureScript).toContain("Closure identity or worktree changed during verification");
    expect(script).toContain("'--strict-config', 'doctor', '--summary', '--ascii'");
    expect(script).toContain("FINAL_STATUS_COUNT=");
    expect(script).not.toMatch(/\bRemove-Item\b/u);
    expect(gitignore).toContain("!docs/audits/stage-0/logs/");
    expect(gitignore).toContain("docs/audits/stage-0/logs/*");
    expect(gitignore).toContain("!docs/audits/stage-0/logs/*.log");
    expect(gitattributes).toContain("/docs/audits/stage-0/logs/** -text -diff");
  });

  it("keeps V1 records out of the canonical V2 cache schema", async () => {
    const fixture = JSON.parse(
      await readFile(path.join(REPO_ROOT, "tests", "fixtures", "current-run-record-v1.json"), "utf8")
    ) as unknown;
    expect(RunRecordSchema.safeParse(fixture).success).toBe(false);
  });

  it("keeps packages independent from application-layer imports", async () => {
    const packageSources = await sourceFiles(path.join(REPO_ROOT, "packages"));
    const violations: string[] = [];

    for (const file of packageSources) {
      const source = await readFile(file, "utf8");
      if (/from\s+["'](?:@\/|apps\/|[^"']*\/apps\/)/u.test(source)) {
        violations.push(relativePath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids productive @manyhands/core consumers", async () => {
    const productSources = [
      ...(await sourceFiles(path.join(REPO_ROOT, "apps", "web", "src"))),
      ...(await sourceFiles(path.join(REPO_ROOT, "packages")))
    ];
    const consumers: string[] = [];

    for (const file of productSources) {
      if ((await readFile(file, "utf8")).includes("@manyhands/core")) {
        consumers.push(relativePath(file));
      }
    }

    expect(consumers).toEqual([]);
  });

  it("tracks remaining non-web compatibility and rejects web lifecycle producers", async () => {
    const productSources = [
      ...(await sourceFiles(path.join(REPO_ROOT, "apps", "web", "src"))),
      ...(await sourceFiles(path.join(REPO_ROOT, "packages")))
    ];
    const sourceByPath = new Map(
      await Promise.all(productSources.map(async (file) => [relativePath(file), await readFile(file, "utf8")] as const))
    );
    const forbiddenWebLifecycleProducer =
      /startRunBackgroundTask|tryMarkRunnerActive|claimRunOperation|reconcileRunLiveness|runPlanningV2|runExecutionV2|createExecutionCoordinatorHostV2|initializeRunCanonicalEvents|JsonRunRecordStore|killRunProcessesVerified|supervisedSpawnFn|RunFailureReceiptStore|projectV2RunRecordCache/u;
    const webLifecycleProducers = [...sourceByPath]
      .filter(([file, source]) => file.startsWith("apps/web/src/") && forbiddenWebLifecycleProducer.test(source))
      .map(([file]) => file)
      .sort();
    expect(webLifecycleProducers).toEqual([]);

    const frozenLegacy = [
      {
        pattern: /projectSemanticPlanForLegacyCompiler/u,
        files: [
          "packages/decomposer/src/compiler/graph-compiler.ts",
          "packages/decomposer/src/planner/candidate-plan.ts",
          "packages/decomposer/src/planner/semantic-plan-projection.ts"
        ]
      },
      {
        pattern: /@manyhands\/conflict-risk/u,
        files: [
          "packages/execution-core/src/run/executor.ts",
          "packages/orchestrator-graph/src/v2/execution-driver.ts",
          "packages/scheduler/src/index.ts",
          "packages/scheduler/src/wave-selector-v2.ts"
        ]
      },
      {
        pattern: /\bWorkBreakdown\b/u,
        files: [
          "packages/decomposer/src/compiler/contract-compiler.ts",
          "packages/decomposer/src/compiler/graph-compiler.ts",
          "packages/decomposer/src/critics/review.ts",
          "packages/decomposer/src/granularity/apply-granularity-selection.ts",
          "packages/decomposer/src/granularity/repository-context-profile.ts",
          "packages/decomposer/src/granularity/strategy-selector.ts",
          "packages/decomposer/src/planner/candidate-plan.ts",
          "packages/decomposer/src/planner/planning-errors.ts",
          "packages/decomposer/src/planner/schema.ts",
          "packages/decomposer/src/planner/semantic-plan-projection.ts",
          "packages/decomposer/src/planner/semantic-plan.ts"
        ]
      },
      {
        pattern: /\bCandidatePlan\b/u,
        files: [
          "packages/decomposer/src/compiler/contract-compiler.ts",
          "packages/decomposer/src/compiler/graph-compiler.ts",
          "packages/decomposer/src/index.ts",
          "packages/decomposer/src/planner/candidate-plan.ts",
          "packages/decomposer/src/planner/semantic-plan-projection.ts",
          "packages/decomposer/src/planner/semantic-plan.ts"
        ]
      },
      {
        pattern: /dangerously-skip-permissions/u,
        files: ["packages/execution-core/src/executor/profiles/claude-code.ts"]
      },
      {
        pattern: /backorders?/iu,
        files: [
          "packages/decomposer/src/planner/recursive-planner.ts",
          "packages/execution-core/src/v2/node-executor.ts",
          "packages/execution-core/src/validation/test-integrity.ts"
        ]
      },
      {
        pattern: /granularityCondition/u,
        files: [
          "apps/web/src/app/api/runs/route.ts",
          "apps/web/src/lib/server/runs/schema.ts",
          "packages/run-coordinator/src/product-lifecycle.ts"
        ]
      }
    ];

    for (const legacy of frozenLegacy) {
      const reachableFiles = [...sourceByPath]
        .filter(([, source]) => legacy.pattern.test(source))
        .map(([file]) => file)
        .sort();
      expect(reachableFiles).toEqual([...legacy.files].sort());
    }
  });

  it("pins the redesign harness to Sol Ultra with least-privilege agent profiles", async () => {
    const config = await readFile(path.join(REPO_ROOT, ".codex", "config.toml"), "utf8");
    expect(config).toMatch(/^model = "gpt-5\.6-sol"$/mu);
    expect(config).toMatch(/^model_reasoning_effort = "ultra"$/mu);
    expect(config).toMatch(/^sandbox_mode = "workspace-write"$/mu);
    expect(config).toMatch(/^max_concurrent_threads_per_session = 3$/mu);
    expect(config).toMatch(/^multi_agent = true$/mu);
    expect(config).toMatch(/^multi_agent_v2 = false$/mu);

    const agentDirectory = path.join(REPO_ROOT, ".codex", "agents");
    const agentFiles = (await readdir(agentDirectory))
      .filter((file) => file.endsWith(".toml"))
      .sort();
    expect(agentFiles).toEqual([
      "redesign-explorer.toml",
      "redesign-reviewer.toml",
      "redesign-worker.toml"
    ]);

    for (const agentFile of agentFiles) {
      const agent = await readFile(path.join(agentDirectory, agentFile), "utf8");
      expect(agent).toMatch(/^model = "gpt-5\.6-sol"$/mu);
      expect(agent).toMatch(/^model_reasoning_effort = "ultra"$/mu);
      expect(agent).not.toContain('sandbox_mode = "danger-full-access"');
    }
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dist" && entry.name !== "node_modules") {
        result.push(...(await sourceFiles(entryPath)));
      }
    } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      result.push(entryPath);
    }
  }
  return result;
}

function relativePath(file: string): string {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function parsePackageResolutions(lockfile: string): string[] {
  const lines = lockfile.split(/\r?\n/u);
  const start = lines.indexOf("packages:");
  const end = lines.indexOf("snapshots:");
  if (start < 0 || end <= start) {
    throw new Error("Expected a pnpm v9 lockfile with packages and snapshots sections.");
  }

  const resolutions: string[] = [];
  let packageId: string | undefined;
  for (const line of lines.slice(start + 1, end)) {
    const packageMatch = /^ {2}(\S.*):$/u.exec(line);
    if (packageMatch) {
      packageId = unquoteYamlScalar(packageMatch[1]!);
      continue;
    }
    const resolutionMatch = /^ {4}resolution: \{integrity: ([^,}]+).*\}$/u.exec(line);
    if (resolutionMatch && packageId) {
      resolutions.push(`${packageId}|${unquoteYamlScalar(resolutionMatch[1]!)}`);
      packageId = undefined;
    }
  }
  return resolutions.sort();
}

function parseImporterResolutions(lockfile: string): string[] {
  const lines = lockfile.split(/\r?\n/u);
  const start = lines.indexOf("importers:");
  const end = lines.indexOf("packages:");
  if (start < 0 || end <= start) {
    throw new Error("Expected a pnpm lockfile with importers and packages sections.");
  }

  const resolutions: string[] = [];
  let importer: string | undefined;
  let section: "dependencies" | "devDependencies" | "optionalDependencies" | undefined;
  let dependency: string | undefined;
  for (const line of lines.slice(start + 1, end)) {
    const importerMatch = /^ {2}(\S.*):$/u.exec(line);
    if (importerMatch) {
      importer = unquoteYamlScalar(importerMatch[1]!);
      section = undefined;
      dependency = undefined;
      continue;
    }
    const sectionMatch = /^ {4}(dependencies|devDependencies|optionalDependencies):$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1] as typeof section;
      dependency = undefined;
      continue;
    }
    const dependencyMatch = /^ {6}(\S.*):$/u.exec(line);
    if (dependencyMatch && section) {
      dependency = unquoteYamlScalar(dependencyMatch[1]!);
      continue;
    }
    const versionMatch = /^ {8}version: (.+)$/u.exec(line);
    if (versionMatch && importer && section && dependency) {
      const encodedVersion = unquoteYamlScalar(versionMatch[1]!);
      const version = encodedVersion.startsWith("link:")
        ? encodedVersion
        : encodedVersion.split("(", 1)[0];
      resolutions.push(`${importer}|${section}|${dependency}|${version}`);
      dependency = undefined;
    }
  }
  return resolutions.sort();
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1).replaceAll("''", "'")
    : trimmed;
}

function sha256Lines(lines: readonly string[]): string {
  return createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
}
