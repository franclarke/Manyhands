import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webSourceRoot = path.resolve("apps/web/src");

const routes = [
  "apps/web/src/app/api/runs/route.ts",
  "apps/web/src/app/api/runs/[id]/route.ts",
  "apps/web/src/app/api/runs/[id]/run/route.ts",
  "apps/web/src/app/api/runs/[id]/pause/route.ts",
  "apps/web/src/app/api/runs/[id]/resume/route.ts",
  "apps/web/src/app/api/runs/[id]/restart/route.ts",
  "apps/web/src/app/api/runs/[id]/cancel/route.ts",
  "apps/web/src/app/api/runs/[id]/decisions/[decisionId]/route.ts",
  "apps/web/src/app/api/runs/[id]/deliver/route.ts",
  "apps/web/src/app/api/runs/[id]/run-events/route.ts"
] as const;

const forbiddenProductiveOwners = [
  "getRunRepository",
  "JsonRunRecordStore",
  "JsonlRunEventStore",
  "runner-state",
  "run-abort-registry",
  "command-host",
  "run-coordinator-host",
  "execution-pipeline",
  "planning-host",
  "reconcileRunLiveness",
  "initializeRunCanonicalEvents"
] as const;

const retiredWebOwnerModules = [
  "lib/decomposer-policy.ts",
  "lib/server/runs/interrupted.ts",
  "lib/server/runs/liveness.ts",
  "lib/server/runs/repository.ts",
  "lib/server/runs/store.ts",
  "lib/server/runs/presenter.ts",
  "lib/server/runs/route-errors.ts",
  "lib/server/runs/run-model-projection.ts",
  "lib/server/runs/liveness-supervisor.ts",
  "lib/server/runs/process-evidence.ts",
  "lib/server/runs/process-supervision.ts",
  "lib/server/runs/repo-lock.ts",
  "lib/server/runs/run-abort-registry.ts",
  "lib/server/runs/run-operation-lease.ts",
  "lib/server/runs/runner-heartbeat.ts",
  "lib/server/runs/runner-state.ts",
  "lib/server/runs/runs-directory.ts",
  "lib/server/runs/v2/command-host.ts",
  "lib/server/runs/v2/execution-coordinator-host.ts",
  "lib/server/runs/v2/execution-pipeline.ts",
  "lib/server/runs/v2/initialize-run.ts",
  "lib/server/runs/v2/planning-host.ts",
  "lib/server/runs/v2/run-coordinator-host.ts",
  "lib/server/runs/v2/run-failure-receipt.ts",
  "lib/server/runs/v2/run-record-cache.ts"
] as const;

const webLifecycleProducerSignature =
  /\b(?:pickDecomposer|ClaudeCodeRecursiveDecomposer|CodexRecursiveDecomposer|startRunBackgroundTask|tryMarkRunnerActive|markRunnerInactive|claimRunOperation|releaseRunOperation|reconcileRunLiveness|initializeRunCanonicalEvents|runPlanningV2|runExecutionV2|startExecutionV2Pipeline|JsonRunRecordStore|RunFailureReceiptStore|createExecutionCoordinatorHostV2|supervisedSpawnFn|runWithProcessSupervision|killRunProcessesVerified)\b/u;

describe("Stage 3 web productive boundary", () => {
  it.each(routes)("makes %s a daemon IPC BFF with no legacy lifecycle owner", async (relative) => {
    const source = await readFile(path.resolve(relative), "utf8");
    expect(source).toContain("@/lib/server/daemon/productive-client");
    for (const forbidden of forbiddenProductiveOwners) {
      expect(source, `${relative} must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps GET/list/SSE behind daemon query/event pages only", async () => {
    const readRoutes = await Promise.all([
      "apps/web/src/app/api/runs/route.ts",
      "apps/web/src/app/api/runs/[id]/route.ts",
      "apps/web/src/app/api/runs/[id]/run-events/route.ts"
    ].map((relative) => readFile(path.resolve(relative), "utf8")));
    expect(readRoutes.join("\n")).not.toMatch(/\.save\(|\.update\(|appendFenced|startRunBackgroundTask|reconcileRun/);
  });

  it("does not export the retired web process owner from the runs public surface", async () => {
    const source = await readFile(path.resolve("apps/web/src/lib/server/runs/index.ts"), "utf8");
    expect(source).not.toMatch(/runner-state|run-operation-lease|run-abort-registry/);
  });

  it("renders sidebar, list and detail from the same daemon projection source", async () => {
    const layout = await readFile(path.resolve("apps/web/src/app/layout.tsx"), "utf8");
    expect(layout).toContain("listProductRuns");
    expect(layout).toContain("toProductRunPreview");
    expect(layout).not.toContain("getRunRepository");
    expect(layout).not.toContain("toRunPreview");
  });

  it("deletes test-only web lifecycle producers after daemon cutover", async () => {
    const existing = await Promise.all(retiredWebOwnerModules.map(async (relative) => (
      await exists(path.join(webSourceRoot, relative)) ? relative : undefined
    )));
    expect(existing.filter((relative) => relative !== undefined)).toEqual([]);
  });

  it("keeps every productive web entrypoint unreachable from retired lifecycle owners", async () => {
    const entrypoints = [
      ...(await sourceFiles(path.join(webSourceRoot, "app"))),
      path.join(webSourceRoot, "middleware.ts")
    ];
    const reachable = await reachableWebSources(entrypoints);
    const violations = (await Promise.all([...reachable].map(async (file) => (
      webLifecycleProducerSignature.test(await readFile(file, "utf8"))
        ? path.relative(webSourceRoot, file).replaceAll("\\", "/")
        : undefined
    )))).filter((file) => file !== undefined).sort();
    expect(violations).toEqual([]);
  });

  it("retains legacy migration only as an explicit offline, dry-run-first tool", async () => {
    const migration = path.join(webSourceRoot, "lib/server/runs/v2/migrate-run.ts");
    const [source, script, reachable] = await Promise.all([
      readFile(migration, "utf8"),
      readFile(path.resolve("scripts/migrate-runs-v2.mjs"), "utf8"),
      reachableWebSources([
        ...(await sourceFiles(path.join(webSourceRoot, "app"))),
        path.join(webSourceRoot, "middleware.ts")
      ])
    ]);
    expect(source).toContain("Offline-only compatibility importer");
    expect(source).toContain("if (options.apply !== true)");
    expect(script).toContain("migrate-run.ts");
    expect(reachable.has(migration)).toBe(false);
  });

  it("keeps retained online readers free of web lifecycle writes", async () => {
    const readers = await Promise.all([
      "lib/server/runs/schema.ts",
      "lib/server/runs/target-context.ts",
      "lib/server/runs/v2/run-event-reader.ts"
    ].map((relative) => readFile(path.join(webSourceRoot, relative), "utf8")));
    expect(readers.join("\n")).not.toMatch(
      /getRunRepository|JsonRunRecordStore|appendFenced|claimRunOperation|reconcileRunLiveness|startRunBackgroundTask|globalSingleton/u
    );
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [target] : [];
  }))).flat();
}

async function reachableWebSources(entrypoints: readonly string[]): Promise<Set<string>> {
  const pending = [...entrypoints];
  const reachable = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (reachable.has(current) || !await exists(current)) continue;
    reachable.add(current);
    const source = await readFile(current, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      const resolved = await resolveWebModule(current, specifier);
      if (resolved !== undefined && !reachable.has(resolved)) pending.push(resolved);
    }
  }
  return reachable;
}

function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gu)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

async function resolveWebModule(importer: string, specifier: string): Promise<string | undefined> {
  const base = specifier.startsWith("@/")
    ? path.join(webSourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : undefined;
  if (base === undefined) return undefined;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
