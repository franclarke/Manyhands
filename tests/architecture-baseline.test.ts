import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunRecordSchema } from "@/lib/server/runs/schema";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
describe("target architecture migration baseline", () => {
  it("pins a package-manager runtime that supports the declared Node baseline", async () => {
    const [rootPackage, workflow] = await Promise.all([
      readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
      readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8")
    ]);
    const manifest = JSON.parse(rootPackage) as {
      packageManager?: string;
      engines?: { node?: string; pnpm?: string };
    };

    expect(manifest.packageManager).toBe("pnpm@11.21.0");
    expect(manifest.engines).toEqual({ node: ">=22.13", pnpm: "11.21.0" });
    expect(workflow).toContain("version: 11.21.0");
    expect(workflow).toContain("node-version: 22.22.0");
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

  it("freezes known legacy reachability until the owning migration stage retires it", async () => {
    const productSources = [
      ...(await sourceFiles(path.join(REPO_ROOT, "apps", "web", "src"))),
      ...(await sourceFiles(path.join(REPO_ROOT, "packages")))
    ];
    const sourceByPath = new Map(
      await Promise.all(productSources.map(async (file) => [relativePath(file), await readFile(file, "utf8")] as const))
    );
    const frozenLegacy = [
      {
        pattern: /projectSemanticPlanForLegacyCompiler/u,
        files: [
          "apps/web/src/lib/server/runs/v2/planning-host.ts",
          "packages/decomposer/src/compiler/graph-compiler.ts",
          "packages/decomposer/src/planner/candidate-plan.ts",
          "packages/decomposer/src/planner/semantic-plan-projection.ts"
        ]
      },
      {
        pattern: /@manyhands\/conflict-risk/u,
        files: [
          "apps/web/src/lib/server/runs/v2/execution-pipeline.ts",
          "packages/execution-core/src/run/executor.ts",
          "packages/orchestrator-graph/src/v2/execution-driver.ts",
          "packages/scheduler/src/index.ts",
          "packages/scheduler/src/wave-selector-v2.ts"
        ]
      },
      {
        pattern: /@manyhands\/orchestrator-graph/u,
        files: ["apps/web/src/lib/server/runs/v2/execution-pipeline.ts"]
      },
      {
        pattern: /\bWorkBreakdown\b/u,
        files: [
          "apps/web/src/lib/server/runs/v2/planning-host.ts",
          "apps/web/src/lib/server/runs/v2/run-coordinator-host.ts",
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
        pattern: /startRunBackgroundTask/u,
        files: [
          "apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts",
          "apps/web/src/app/api/runs/route.ts",
          "apps/web/src/lib/server/runs/runner-state.ts",
          "apps/web/src/lib/server/runs/v2/execution-pipeline.ts"
        ]
      },
      {
        pattern: /reconcileRunRecordProjectionV2/u,
        files: [
          "apps/web/src/app/api/runs/[id]/route.ts",
          "apps/web/src/lib/server/runs/v2/command-host.ts"
        ]
      },
      {
        pattern: /reconcileRunLiveness/u,
        files: [
          "apps/web/src/app/api/runs/[id]/route.ts",
          "apps/web/src/lib/server/runs/liveness-supervisor.ts"
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
          "apps/web/src/lib/server/runs/v2/planning-host.ts",
          "apps/web/src/lib/server/runs/v2/run-coordinator-host.ts"
        ]
      },
      {
        pattern: /\bG5\b/u,
        files: ["apps/web/src/lib/server/runs/v2/planning-host.ts"]
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
