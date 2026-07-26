#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  advanceVerifiedBase,
  assertOraclePassed,
  buildLongitudinalPlan,
  evaluatePreflight,
  forkVerifiedChainState,
  INCREMENTS,
  MINIMUM_FREE_BYTES,
  seedIdentityMatches,
  selectionMatches,
  studyStageSelections
} from "./lib/warehouse-longitudinal.mjs";

const exec = promisify(execFile);
const mode = argument("--mode") ?? fail("--mode pilot|final is required");
const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const seedManifestPath = resolve("docs/tesis/evidence/warehouse/seed/seed-manifest.json");
const assetsManifestPath = resolve("docs/tesis/evidence/warehouse/assets-manifest.json");
const seed = JSON.parse(await readFile(seedManifestPath, "utf8"));
const assets = JSON.parse(await readFile(assetsManifestPath, "utf8"));
const targetRepo = resolve(argument("--target") ?? seed.repository);
const outDir = resolve(argument("--out") ?? `docs/tesis/evidence/warehouse/${mode}`);
const currentManyHandsCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
const declaredManyHandsCommit = argument("--manyhands-commit") ?? currentManyHandsCommit;
const resumeStatePath = argument("--resume-state");
const state = resumeStatePath === undefined
  ? await readState(outDir, seed.commit)
  : forkVerifiedChainState(JSON.parse(await readFile(resolve(resumeStatePath), "utf8")));
const observation = await observe({ root, targetRepo, expectedBase: state.currentBase, seed, assets, declaredManyHandsCommit });
const failures = evaluatePreflight(observation);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`PREFLIGHT ${failure.code}: ${failure.message}\n`);
  process.exit(2);
}

if (dryRun) {
  const plan = buildLongitudinalPlan({ mode, baseSha: state.currentBase, targetRepo, dryRun: true, startAt: state.completed.length });
  process.stdout.write(`${JSON.stringify({ mode, manyHandsCommit: declaredManyHandsCommit, targetRepo, outDir, cells: plan }, null, 2)}\n`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
let currentBase = state.currentBase;
for (const increment of INCREMENTS.slice(state.completed.length)) {
  const runDir = join(outDir, "runs", increment);
  const configDir = join(outDir, "configs");
  await mkdir(configDir, { recursive: true });
  const promptPath = resolve(`docs/tesis/evidence/warehouse/protocol/prompts/${increment}.md`);
  const configPath = join(configDir, `${increment}.json`);
  const config = {
    cellId: `warehouse-${mode}-${increment.toLowerCase()}`,
    condition: "C",
    granularityCondition: "C",
    taskId: increment,
    workspaceName: `warehouse-${mode}`,
    baseUrl: argument("--base-url") ?? "http://127.0.0.1:3111",
    targetRepo,
    baseSha: currentBase,
    manyhandsCommit: declaredManyHandsCommit,
    promptSha256: assets.prompts[increment],
    goal: await readFile(promptPath, "utf8"),
    ...studyStageSelections(),
    // The 600s leaf timeout was inherited from the Codex-era stability runs,
    // whose target was an existing 1000-line repository. Warehouse W1 builds an
    // entire project out of an empty seed — toolchain, domain, scenario, the
    // public probe and its tests — and series-8 was killed at exactly 10:04
    // still working, not stuck: it never errored, it ran out of clock. A leaf
    // ceiling below the 900s integration ceiling also had the build of a whole
    // project on a tighter budget than the merge of its parts.
    //
    // 1800s is set from that shape, not tuned until a run passes: three times
    // the inherited value, still well inside the 7200s per-run wall clock, and
    // uniform across W1-W8 so no increment is privileged. Whatever the pilot
    // settles on is frozen for the final series.
    executionConfig: { maxParallel: 2, scopePolicy: "strict", leafTimeoutMs: 1800000, integrationTimeoutMs: 1800000, unexpectedCommitPolicy: "reject" },
    runsDir: resolve(".manyhands/runs"),
    pollIntervalMs: 10000,
    wallClockLimitMs: 7200000
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await run(process.execPath, [resolve("docs/tesis/evidence/scripts/run-experiment.mjs"), "--config", configPath, "--out", runDir], root, 7_500_000);
  const runResult = JSON.parse(await readFile(join(runDir, "result.json"), "utf8"));
  if (runResult.outcome?.lifecycle !== "completed") fail(`${increment} lifecycle ${runResult.outcome?.lifecycle}`);
  const deliveredSha = runResult.outcome.finalSha;
  const verificationClone = await mkdtemp(join(tmpdir(), `manyhands-warehouse-${mode}-${increment}-`));
  try {
    await run("git", ["clone", "--no-hardlinks", targetRepo, verificationClone], root, 300_000);
    await git(verificationClone, ["checkout", "--detach", deliveredSha]);
    const oraclePath = join(runDir, "oracle-result.json");
    await run(process.execPath, [resolve("docs/tesis/evidence/scripts/run-warehouse-oracle.mjs"), "--increment", increment, "--target", verificationClone, "--out", oraclePath], root, 900_000);
    const oracle = JSON.parse(await readFile(oraclePath, "utf8"));
    assertOraclePassed(oracle);
    currentBase = advanceVerifiedBase({ currentBase, deliveredSha, oracleOutcome: oracle.outcome });
    state.completed.push({ increment, baseSha: config.baseSha, deliveredSha, oracleId: oracle.oracleId, stateHash: oracle.stateHash });
    state.currentBase = currentBase;
    state.manyHandsCommits = [...new Set([...state.manyHandsCommits, declaredManyHandsCommit])];
    await writeState(outDir, state);
  } finally {
    const safeTemp = resolve(verificationClone).startsWith(resolve(tmpdir()));
    if (safeTemp) await rm(verificationClone, { recursive: true, force: true });
  }
}
process.stdout.write(`Warehouse ${mode} completed W1-W8 at ${currentBase}\n`);

async function observe({ root, targetRepo, expectedBase, seed, assets, declaredManyHandsCommit }) {
  const fs = await statfs(targetRepo);
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  const targetHead = (await git(targetRepo, ["rev-parse", "HEAD"])).trim();
  const seedManifestMatches = sha(await readFile(seedManifestPath)) === assets.seedManifestSha256;
  const seedCheck = seedManifestMatches && (expectedBase === seed.commit ? await verifySeed(targetRepo, seed) : true);
  const promptHashesMatch = await verifyPromptHashes(assets.prompts);
  const oracleHashesMatch = await verifyOracleHashes(assets.oracleCoreSha256);
  const dist = await readFile(resolve("packages/decomposer/dist/index.js"), "utf8").catch(() => "");
  const pnpmVersion = (await run("pnpm", ["--version"], root, 30_000)).stdout.trim();
  return {
    freeBytes,
    minimumFreeBytes: MINIMUM_FREE_BYTES,
    manyHandsDirty: (await git(root, ["status", "--porcelain"])).trim() !== "",
    targetDirty: (await git(targetRepo, ["status", "--porcelain"])).trim() !== "",
    targetHead,
    expectedBase,
    seedMatches: seedCheck,
    promptHashesMatch,
    oracleHashesMatch,
    distHasPolicyMarker: dist.includes(assets.policyVersion),
    commitMatches: (await git(root, ["rev-parse", "HEAD"])).trim() === declaredManyHandsCommit,
    toolchainMatches: Number(process.versions.node.split('.')[0]) >= 22 && pnpmVersion === "7.29.3",
    modelMatches: selectionMatches(studyStageSelections().executionSelection)
  };
}

async function verifySeed(repository, expected) {
  const tree = (await git(repository, ["rev-parse", "HEAD^{tree}"])).trim();
  const lockfileGitBlob = (await git(repository, ["rev-parse", "HEAD:pnpm-lock.yaml"])).trim();
  return seedIdentityMatches({
    tree,
    expectedTree: expected.tree,
    lockfileGitBlob,
    expectedLockfileGitBlob: expected.lockfileGitBlob
  });
}
async function verifyPromptHashes(expected) {
  for (const increment of INCREMENTS) if (sha(await readFile(resolve(`docs/tesis/evidence/warehouse/protocol/prompts/${increment}.md`))) !== expected[increment]) return false;
  return true;
}
async function verifyOracleHashes(expectedCore) {
  if (sha(await readFile(resolve("docs/tesis/evidence/warehouse/oracles/oracle-core.mjs"))) !== expectedCore) return false;
  for (const increment of INCREMENTS) {
    const dir = resolve(`docs/tesis/evidence/warehouse/oracles/${increment}`);
    const manifest = JSON.parse(await readFile(join(dir, "oracle.json"), "utf8"));
    if (sha(await readFile(join(dir, "oracle.mjs"))) !== manifest.scriptSha256 || manifest.coreSha256 !== expectedCore) return false;
  }
  return true;
}
async function readState(outDir, seedCommit) {
  try { return JSON.parse(await readFile(join(outDir, "chain-state.json"), "utf8")); }
  catch { return { schemaVersion: 1, currentBase: seedCommit, completed: [], manyHandsCommits: [] }; }
}
async function writeState(outDir, state) {
  const target = join(outDir, "chain-state.json");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function git(cwd, args) { return run("git", ["-C", cwd, ...args], root, 300_000).then((result) => result.stdout); }
function run(file, args, cwd, timeout) { return exec(file, args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); }
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
