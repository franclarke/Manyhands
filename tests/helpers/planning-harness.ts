/**
 * In-process planning harness (redesign stage 1).
 *
 * Runs inspect -> decompose -> compile against a fixture repository with an
 * injected model, without a server, worktrees, HTTP or network. The unit of
 * learning for a planning defect drops from a 45-minute run to milliseconds,
 * which is the whole reason thirteen frozen series each died to a different
 * first-observed defect. See
 * `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  PILOT_UTILITY_POLICY,
  PlanningModule,
  buildGranularityPlanningBrief,
  compileGraphRevision,
  type CompiledGraphRevision,
  type PlanningOutcome,
  type SemanticPlanningModel,
  type SemanticPlanningModelRequest
} from "@manyhands/decomposer";
import { buildFastRepositorySnapshot } from "@manyhands/repository-index";

const exec = promisify(execFile);

export interface PlanningFixture {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

/** One recorded exchange with the model, in call order. */
export interface HarnessModelCall {
  system: string;
  user: string;
  repairIssues: string[];
  response: string;
}

export interface HarnessModel extends SemanticPlanningModel {
  /** Calls observed so far, so a test can assert on repair prompts. */
  readonly calls: HarnessModelCall[];
}

export interface PlanningRun {
  /** Absolute path of the materialized fixture; removed by `cleanup`. */
  repoRoot: string;
  snapshot: Awaited<ReturnType<typeof buildFastRepositorySnapshot>>;
  outcome: PlanningOutcome;
  /** Present only when planning produced a plan AND compilation succeeded. */
  compiled?: CompiledGraphRevision;
  /** Present when planning produced a plan but compilation threw. */
  compileError?: string;
  calls: HarnessModelCall[];
  cleanup(): Promise<void>;
}

/**
 * Materializes a fixture into a fresh temp git repository. The indexer reads the
 * tree at an exact commit, so a plain directory would index as `unavailable`
 * and every plan would be rejected before the model was ever consulted.
 */
export async function materializeFixture(
  fixture: PlanningFixture
): Promise<{ root: string; commit: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), `manyhands-planning-${fixture.name}-`));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    for (const [relative, contents] of Object.entries(fixture.files)) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "core.autocrlf", "false"]);
    await git(root, ["config", "user.name", "ManyHands Harness"]);
    await git(root, ["config", "user.email", "harness@local"]);
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "-m", "fixture baseline"]);
    const commit = (await git(root, ["rev-parse", "HEAD"])).trim();
    return { root, commit, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return exec("git", ["-C", cwd, ...args], { windowsHide: true }).then((result) => result.stdout);
}

const shared = new Map<string, Promise<{ root: string; commit: string; cleanup(): Promise<void> }>>();

/**
 * One materialized repository per fixture, reused across tests. Planning only
 * reads the repository, so sharing is safe and keeps the whole harness inside
 * its seconds-not-minutes budget. Release with `releaseFixtures()` in afterAll.
 */
export function sharedFixture(fixture: PlanningFixture) {
  let handle = shared.get(fixture.name);
  if (handle === undefined) {
    handle = materializeFixture(fixture);
    shared.set(fixture.name, handle);
  }
  return handle;
}

export async function releaseFixtures(): Promise<void> {
  const handles = [...shared.values()];
  shared.clear();
  await Promise.allSettled(handles.map(async (handle) => (await handle).cleanup()));
}

export interface RunPlanningInput {
  fixture: PlanningFixture;
  goal: string;
  /** Acceptance criteria; defaults to the goal as a single criterion. */
  criteria?: readonly string[];
  constraints?: readonly string[];
  model: HarnessModel;
  candidateCount?: 2 | 3;
  /** Attempts per candidate. 1 disables the repair channel, as the frozen cells did. */
  maxAttempts?: number;
  /** Materialize a private repository instead of reusing the shared one. */
  isolate?: boolean;
}

/**
 * Drives the productive planning path end to end. Compilation is attempted only
 * when planning produced a plan, and its failure is captured rather than thrown
 * so a test can assert on either boundary.
 */
export async function runPlanning(input: RunPlanningInput): Promise<PlanningRun> {
  const isolated = input.isolate === true;
  const fixture = isolated ? await materializeFixture(input.fixture) : await sharedFixture(input.fixture);
  const cleanup = isolated ? fixture.cleanup : async () => {};
  try {
    const snapshot = await buildFastRepositorySnapshot({
      rootPath: fixture.root,
      targetFingerprint: fingerprint(input.fixture),
      baseCommit: fixture.commit
    });
    const criteria = input.criteria ?? [input.goal];
    const module = new PlanningModule({
      model: input.model,
      maxAttempts: input.maxAttempts ?? 2,
      retryDelayMs: 0
    });
    const outcome = await module.plan({
      goal: input.goal,
      acceptanceCriteria: [...criteria],
      constraints: [...(input.constraints ?? [])],
      repositorySnapshot: {
        snapshotId: snapshot.snapshotId,
        inspectionDisposition: snapshot.inspectionDisposition,
        evidence: repositoryEvidence(snapshot)
      },
      granularityBrief: buildGranularityPlanningBrief({
        repositorySnapshot: snapshot,
        config: PILOT_UTILITY_POLICY,
        candidateCount: input.candidateCount ?? 2
      }),
      candidateCount: input.candidateCount ?? 2
    });

    const run: PlanningRun = {
      repoRoot: fixture.root,
      snapshot,
      outcome,
      calls: input.model.calls,
      cleanup
    };
    if (outcome.kind === "rejected") return run;

    try {
      run.compiled = compileGraphRevision(
        {
          semanticPlan: outcome.plan,
          repositorySnapshot: snapshot,
          sourceContract: {
            goal: input.goal,
            acceptanceCriteria: [...criteria],
            constraints: [...(input.constraints ?? [])]
          }
        },
        { idFor: stableId, now: () => "2026-01-01T00:00:00.000Z" }
      );
    } catch (error) {
      run.compileError = error instanceof Error ? error.message : String(error);
    }
    return run;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * Answers with scripted responses, in order, reusing the last one once the
 * script is exhausted. A function receives the request so a test can react to
 * repair issues.
 */
export function stubModel(
  script: string | unknown | readonly unknown[] | ((request: SemanticPlanningModelRequest) => string | unknown)
): HarnessModel {
  const calls: HarnessModelCall[] = [];
  const scripted = Array.isArray(script) ? [...script] : undefined;
  return {
    calls,
    async generate(request) {
      const raw = typeof script === "function"
        ? (script as (r: SemanticPlanningModelRequest) => string | unknown)(request)
        : scripted !== undefined
          ? scripted[Math.min(calls.length, scripted.length - 1)]
          : script;
      const response = typeof raw === "string" ? raw : JSON.stringify(raw);
      calls.push({ system: request.system, user: request.user, repairIssues: [...request.repairIssues], response });
      return response;
    }
  };
}

const TRANSCRIPTS = path.resolve(process.cwd(), "tests/fixtures/planning/transcripts");

/**
 * Replays responses a real CLI produced once. Transcripts are recorded by
 * `recordingModel` and must never be edited by hand: a hand-tuned transcript
 * proves nothing about the executor.
 */
export function replayModel(name: string): HarnessModel {
  const calls: HarnessModelCall[] = [];
  let responses: string[] | undefined;
  return {
    calls,
    async generate(request) {
      responses ??= JSON.parse(await readFile(path.join(TRANSCRIPTS, `${name}.json`), "utf8")).responses;
      const response = responses![Math.min(calls.length, responses!.length - 1)];
      if (response === undefined) throw new Error(`Transcript ${name} has no response for call ${calls.length + 1}.`);
      calls.push({ system: request.system, user: request.user, repairIssues: [...request.repairIssues], response });
      return response;
    }
  };
}

/** Wraps a model and persists its responses as a replayable transcript. */
export function recordingModel(name: string, inner: HarnessModel): HarnessModel {
  const calls: HarnessModelCall[] = [];
  return {
    calls,
    async generate(request) {
      const response = String(await inner.generate(request));
      calls.push({ system: request.system, user: request.user, repairIssues: [...request.repairIssues], response });
      await mkdir(TRANSCRIPTS, { recursive: true });
      await writeFile(
        path.join(TRANSCRIPTS, `${name}.json`),
        `${JSON.stringify({ name, recordedWith: "claude-code-cli", responses: calls.map((call) => call.response) }, null, 2)}\n`,
        "utf8"
      );
      return response;
    }
  };
}

/**
 * Spawns the real Claude Code CLI. Guarded by MANYHANDS_HARNESS_LIVE so a
 * normal suite run never reaches the network; only transcript recording does.
 */
export function liveModel(model = "haiku"): HarnessModel {
  const calls: HarnessModelCall[] = [];
  return {
    calls,
    async generate(request) {
      if (process.env.MANYHANDS_HARNESS_LIVE !== "1") {
        throw new Error("liveModel requires MANYHANDS_HARNESS_LIVE=1; the suite must not reach the network.");
      }
      const prompt = `${request.system}\n\n${request.user}${request.repairIssues.length === 0
        ? ""
        : `\n\nThe previous attempt was invalid. Repair every issue below and return the complete JSON again:\n- ${request.repairIssues.join("\n- ")}`}`;
      const { stdout } = await exec(
        process.env.MANYHANDS_CLAUDE_BIN ?? "claude",
        ["-p", prompt, "--model", model, "--output-format", "json", "--permission-mode", "plan"],
        { maxBuffer: 32 * 1024 * 1024, windowsHide: true }
      );
      const envelope: unknown = JSON.parse(stdout);
      const response = isRecord(envelope) && typeof envelope.result === "string" ? envelope.result : stdout;
      calls.push({ system: request.system, user: request.user, repairIssues: [...request.repairIssues], response });
      return response;
    }
  };
}

function fingerprint(fixture: PlanningFixture): string {
  return createHash("sha256").update(fixture.name).digest("hex").slice(0, 16);
}

function stableId(kind: string, key: string): string {
  return `${kind}-${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Mirrors `repositoryEvidence` in the productive planning host byte for byte.
 * A harness that grounded the planner differently from production would prove
 * nothing about production.
 */
function repositoryEvidence(snapshot: Awaited<ReturnType<typeof buildFastRepositorySnapshot>>) {
  const paths = snapshot.index?.files.map((file, index) => ({ id: `path-${index}`, kind: "path" as const, reference: file.path, observation: `Repository ${file.kind} file`, confidence: 1 })) ?? [];
  const hasPackageManifest = snapshot.capabilities.packageManager !== undefined ||
    Object.keys(snapshot.capabilities.scripts).length > 0 ||
    snapshot.capabilities.stack.some((item) => item.evidence.some((entry) => entry.includes("package.json")));
  if (hasPackageManifest && !paths.some((item) => item.reference.replaceAll("\\", "/").toLowerCase() === "package.json")) {
    paths.push({ id: "config-package-json", kind: "path" as const, reference: "package.json", observation: "Repository package manifest defining scripts, dependencies and toolchain metadata", confidence: 1 });
  }
  const diagnostics = snapshot.diagnostics.map((diagnostic, index) => ({ id: `diagnostic-${index}`, kind: "diagnostic" as const, reference: diagnostic.filePath ?? snapshot.rootPath, observation: diagnostic.message, confidence: diagnostic.severity === "error" ? 0.3 : 0.7 }));
  const scripts = Object.entries(snapshot.capabilities.scripts).map(([name, command], index) => ({ id: `script-${index}`, kind: "script" as const, reference: name, observation: command, confidence: 1 }));
  const stack = snapshot.capabilities.stack.map((item, index) => ({ id: `stack-${index}`, kind: "stack" as const, reference: item.name, observation: item.evidence.join("; ") || `Detected ${item.name}`, confidence: item.confidence }));
  return [...paths, ...scripts, ...stack, ...diagnostics];
}
