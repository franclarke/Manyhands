#!/usr/bin/env node
/**
 * Reproducible driver for the thesis runs (G4 canonical series and G5 cells).
 *
 * Drives one run end to end over the local HTTP API and preserves every raw
 * artifact it produced. It never edits the target repository itself: the only
 * writes come from ManyHands, and the only human-modelled acts are the two the
 * decision model requires (approve the plan, approve the delivery), performed
 * here as the operator so the run is hands-off but not self-approving inside
 * the orchestrator.
 *
 * Usage:
 *   node run-experiment.mjs --config <cell.json> --out <directory>
 *   node run-experiment.mjs --config <cell.json> --out <dir> --attach <runId>
 *
 * `--attach` resumes driving a run that already exists, so a driver restart
 * never costs an in-flight run.
 *
 * The config is the frozen cell definition; it is copied verbatim into the
 * output directory so a result can never drift from the configuration that
 * produced it.
 */
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import {
  assertWideGraphOracleConfiguration,
  assertWideGraphOracleAttribution
} from "./lib/wide-graph-oracle-contract.mjs";
import { resolveRunsDir } from "./run-experiment-paths.mjs";
import { executionConfigForG6Cell } from "./lib/g6-cell-protocol.mjs";

const exec = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const config = JSON.parse(await readFile(args.config, "utf8"));
const executionConfig = executionConfigForG6Cell(config);
const hasVersionedProtocol = config.schemaVersion !== undefined
  || config.protocol !== undefined
  || config.oracleContract !== undefined;
const oracleContract = hasVersionedProtocol
  ? await assertWideGraphOracleConfiguration(config)
  : undefined;
const outDir = resolve(args.out);
const runsDir = resolveRunsDir(config, process.env.MANYHANDS_RUNS_DIR);
await mkdir(outDir, { recursive: true });
const oracleContractPath = oracleContract === undefined ? undefined : join(outDir, "oracle-contract.json");
if (oracleContractPath !== undefined) {
  await writeFile(oracleContractPath, `${JSON.stringify(oracleContract, null, 2)}\n`, "utf8");
}

// A measurement cell stops at the compiled plan. The stop point is a property of
// the frozen cell, not of the invocation; `--stop-after` only exists so a cell
// can be driven that way without editing it, and a measurement cell that lost
// its stop point fails closed rather than silently executing.
const stopAfter = args["stop-after"] ?? config.stopAfter;
if (stopAfter !== undefined && stopAfter !== "planning") {
  fail(`--stop-after only accepts "planning", received "${stopAfter}"`);
}
const stopAfterPlanning = stopAfter === "planning";
if (config.seriesKind === "measurement" && !stopAfterPlanning) {
  fail(`cell ${config.cellId} is a measurement cell but declares no planning stop point`);
}

const BASE = config.baseUrl ?? "http://127.0.0.1:3000";
const TOKEN = process.env.MANYHANDS_SESSION_TOKEN;
if (TOKEN === undefined || TOKEN.length === 0) {
  fail("MANYHANDS_SESSION_TOKEN must be exported and match the server's token.");
}

const started = new Date().toISOString();
log(`cell ${config.cellId} | condition ${config.condition} | task ${config.taskId}`);

// 1-3. Either resume an existing run (`--attach`, for a driver restart) or
//      start one from the frozen baseline. `git diff HEAD` is the truth for
//      that baseline: anything but ManyHands' own runtime directory aborts the
//      cell. A resumed run is already past that gate, so it is not re-checked.
let runId = args.attach;
if (runId === undefined) {
  await assertCleanBaseline(config.targetRepo, config.baseSha);
  const workspaceId = await ensureWorkspace();
  log(`workspace ${workspaceId}`);
  const run = await post("/api/runs", {
    workspaceId,
    userPrompt: config.goal,
    planningSelection: config.planningSelection,
    executionSelection: config.executionSelection,
    repairSelection: config.repairSelection ?? config.executionSelection,
    // The condition is persisted on the run, so the journal names the policy
    // that shaped the plan instead of leaving it to the operator's notes.
    ...(config.granularityCondition !== undefined
      ? { granularityCondition: config.granularityCondition }
      : {}),
    executionConfig
  });
  runId = run.runId ?? run.run?.runId ?? run.id;
  log(`run ${runId}`);
} else {
  log(`attached to run ${runId}`);
}

// 4. Drive to a terminal state, answering only the two operator decisions.
const outcome = await drive(runId);
const finished = new Date().toISOString();

// 5. Preserve everything raw. No metric is computed here; derivation is a
//    separate, re-runnable step over these files.
await preserve(runId, { started, finished, outcome });
log(`lifecycle=${outcome.lifecycle} finalSha=${outcome.finalSha ?? "none"}`);
// Exiting while the HTTP sockets are still closing aborts libuv on Windows
// (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`), and the abort code
// replaces the cell's real exit code. The series driver classifies a cell by that
// code, so it is set here and Node is allowed to drain on its own.
process.exitCode = outcome.lifecycle === "completed" ? 0 : 1;

async function drive(runId) {
  const deadline = Date.now() + (config.wallClockLimitMs ?? 90 * 60 * 1000);
  let approvedPlan = false;
  let delivered = false;
  let oracleAttempted = false;
  let lastLifecycle = "";
  let idleSince = Date.now();
  while (Date.now() < deadline) {
    const view = await get(`/api/runs/${runId}/deliver`);
    const lifecycle = view.lifecycle ?? "unknown";
    if (lifecycle !== lastLifecycle) {
      log(`  -> ${lifecycle}`);
      lastLifecycle = lifecycle;
      idleSince = Date.now();
    }
    // An owner that stopped renewing its lease is dead, not slow: the runner
    // renews every 4 s. Polling it to the wall-clock limit is what turned three
    // `retry-11` cells into results nobody could attribute, so the cell ends here
    // with the exact instant the owner went silent.
    const stalled = await stalledOwner(runId, lifecycle);
    if (stalled !== undefined) {
      // Detectarlo no alcanza. Una operación vencida que nadie reclama deja el
      // run `running` para siempre: la celda queda sin resultado atribuible del
      // lado del producto, que es exactamente lo que pasó en `retry-11`. El
      // cancel reclama la lease vencida, verifica que los procesos estén muertos
      // y lleva el run a un estado terminal antes de cerrar la celda.
      log(`  ${stalled}`);
      const cancelled = await cancelAbandonedRun(runId);
      return { ...terminal(runId, lifecycle, view, stalled), abandonedRunCancelled: cancelled };
    }

    const pending = await pendingDecisions(runId);

    const plan = pending.find((decision) => decision.kind === "approve_plan");
    // A measurement cell exists to observe the granularity assessment, which the
    // journal already holds by the time this decision is raised. It stops by NOT
    // answering: `approve` is exactly what would start an execution the cell does
    // not need, and answering anything else would invent stimulus.
    if (plan !== undefined && stopAfterPlanning) {
      log(`  planning-only cell: leaving ${plan.id} unanswered`);
      return terminal(runId, lifecycle, view, "measurement_only_planning");
    }
    if (plan !== undefined && !approvedPlan) {
      log(`  approving plan (${plan.id})`);
      await post(`/api/runs/${runId}/decisions/${plan.id}`, { optionId: "approve" });
      approvedPlan = true;
      continue;
    }

    // A clarify_goal question means the planner needs an answer the frozen cell
    // must already contain: answering it ad hoc would change the stimulus
    // mid-experiment, so the cell stops instead.
    const clarify = pending.find((decision) => decision.kind === "clarify_goal");
    if (clarify !== undefined) {
      return terminal(runId, lifecycle, view, `planner asked for clarification: ${clarify.question}`);
    }

    if (lifecycle === "result_ready" && !delivered && view.candidate != null) {
      const candidate = view.candidate;
      if (oracleContract !== undefined) {
        if (oracleAttempted) {
          return terminal(runId, lifecycle, view, "external oracle was already attempted for this candidate");
        }
        oracleAttempted = true;
        const oracle = await verifyExternalOracle(candidate.commit);
        try {
          assertWideGraphOracleAttribution(oracleContract, oracle, {
            candidateSha: candidate.commit,
            moduleCount: config.moduleCount
          });
        } catch (error) {
          return terminal(runId, lifecycle, view, error instanceof Error ? error.message : String(error));
        }
      }
      log(`  approving delivery of ${candidate.commit}`);
      await post(`/api/runs/${runId}/deliver`, {
        manifestId: candidate.manifestId,
        finalSha: candidate.commit,
        targetBranch: candidate.targetBranch,
        targetHead: candidate.targetHead,
        targetFingerprint: candidate.sourceTargetFingerprint,
        actor: "thesis-operator",
        idempotencyKey: `${runId}:delivery`
      });
      delivered = true;
      continue;
    }

    if (["completed", "failed", "cancelled"].includes(lifecycle)) {
      if (lifecycle === "completed" && oracleContract !== undefined) {
        try {
          await assertCompletedDelivery(view);
        } catch (error) {
          return terminal(
            runId,
            "failed",
            { ...view, receipt: null },
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      return terminal(runId, lifecycle, view);
    }
    // A parked run with a decision the pre-registered cell does not authorize is
    // a stop, not something to improvise an answer for.
    if (lifecycle === "waiting_for_input" && Date.now() - idleSince > (config.parkedGraceMs ?? 60_000)) {
      return terminal(runId, lifecycle, view, pending.length === 0
        ? "run parked with no answerable decision"
        : `run parked on ${pending.map((decision) => decision.kind).join(", ")}`);
    }
    await sleep(config.pollIntervalMs ?? 10_000);
  }
  return { lifecycle: "timeout", reason: "wall clock limit reached" };
}

async function verifyExternalOracle(candidateSha) {
  const output = join(outDir, "oracle-result.json");
  const existing = await readFile(output, "utf8").catch(() => undefined);
  if (existing !== undefined) {
    log("  reusing the single preserved external oracle result");
    return JSON.parse(existing);
  }
  let executionError;
  try {
    await exec(process.execPath, [
      resolve("docs/tesis/evidence/scripts/run-wide-graph-oracle.mjs"),
      "--repository",
      config.targetRepo,
      "--delivered-sha",
      candidateSha,
      "--module-count",
      String(config.moduleCount),
      "--oracle-contract",
      oracleContractPath,
      "--out",
      output
    ], {
      cwd: process.cwd(),
      timeout: config.externalOracleTimeoutMs ?? 900_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    executionError = error;
  }
  const preserved = await readFile(output, "utf8").catch(() => undefined);
  if (preserved !== undefined) return JSON.parse(preserved);
  const failure = {
    oracleId: oracleContract.oracleId,
    oracleContractVersion: oracleContract.oracleContractVersion,
    oracleContractSha256: oracleContract.contractSha256,
    oracleEvaluatorSha256: oracleContract.evaluator.sha256,
    deliveredSha: candidateSha,
    outcome: "fail",
    checks: [],
    error: executionError instanceof Error ? executionError.message : String(executionError)
  };
  await writeFile(output, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  return failure;
}

async function assertCompletedDelivery(view) {
  const finalSha = view.receipt?.finalSha;
  if (typeof finalSha !== "string") {
    throw new Error("completed delivery has no finalSha to reconcile with the external oracle");
  }
  const output = join(outDir, "oracle-result.json");
  const receipt = JSON.parse(await readFile(output, "utf8"));
  assertWideGraphOracleAttribution(oracleContract, receipt, {
    candidateSha: finalSha,
    moduleCount: config.moduleCount
  });
}

/**
 * Lleva un run abandonado a un estado terminal. Devuelve `false` sin abortar la
 * celda si el servidor lo rechaza: el resultado del intento ya está decidido, y
 * perder el cancel no debe borrar la observación.
 */
async function cancelAbandonedRun(runId) {
  try {
    const response = await fetch(`${BASE}/api/runs/${runId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-manyhands-session": TOKEN },
      body: JSON.stringify({ reason: "abandoned run: the owning process stopped renewing its heartbeat" })
    });
    if (!response.ok) {
      log(`  cancel of the abandoned run returned ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    log(`  cancel of the abandoned run failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Reports the stale lease of a dead run owner, or `undefined` while the run is
 * still owned. Only an active operation can go stale: a parked run legitimately
 * holds none.
 */
async function stalledOwner(runId, lifecycle) {
  if (lifecycle !== "running") return undefined;
  let record;
  try {
    record = JSON.parse(await readFile(join(runsDir, `${runId}.json`), "utf8"));
  } catch {
    return undefined;
  }
  const run = record.run ?? record;
  const heartbeatAt = run.activeOperation?.heartbeatAt;
  if (typeof heartbeatAt !== "string") return undefined;
  const silentMs = Date.now() - Date.parse(heartbeatAt);
  if (!Number.isFinite(silentMs) || silentMs < (config.ownerHeartbeatStaleMs ?? 120_000)) {
    return undefined;
  }
  return `run owner ${run.activeOperation.operationId} stopped renewing its heartbeat at ${heartbeatAt}`;
}

/** Pending decisions come from the durable journal, the same source the UI reads. */
async function pendingDecisions(runId) {
  let raw;
  try {
    raw = await readFile(join(runsDir, `${runId}.events.v2.jsonl`), "utf8");
  } catch {
    return [];
  }
  const open = new Map();
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    // Journal records are envelopes: {schemaVersion, event}.
    const record = JSON.parse(line);
    const event = record.event ?? record;
    if (event.type === "decision.raised") open.set(event.payload.decision.id, event.payload.decision);
    if (event.type === "decision.resolved" || event.type === "decision.expired") open.delete(event.payload.decisionId);
  }
  return [...open.values()];
}

function terminal(runId, lifecycle, view, reason) {
  return {
    lifecycle,
    finalSha: view.receipt?.finalSha ?? view.candidate?.commit,
    receipt: view.receipt ?? null,
    ...(reason !== undefined ? { reason } : {})
  };
}

async function preserve(runId, meta) {
  await copyFile(args.config, join(outDir, "cell.json"));
  for (const suffix of [".events.v2.jsonl", ".snapshot.v2.json", ".json", ".granularity-metrics.json"]) {
    await copyFile(join(runsDir, `${runId}${suffix}`), join(outDir, `run${suffix}`)).catch(() => {
      log(`  (no ${suffix})`);
    });
  }
  // The delivered diff, straight from the target repository.
  if (meta.outcome.finalSha !== undefined) {
    const patch = await git(config.targetRepo, ["diff", `${config.baseSha}..${meta.outcome.finalSha}`]);
    await writeFile(join(outDir, "final-diff.patch"), patch, "utf8");
  }
  await writeFile(
    join(outDir, "result.json"),
    `${JSON.stringify({ cellId: config.cellId, condition: config.condition, taskId: config.taskId, runId, ...meta }, null, 2)}\n`,
    "utf8"
  );
}

async function ensureWorkspace() {
  const existing = (await get("/api/workspaces")).workspaces ?? [];
  const match = existing.find((workspace) => samePath(workspace.repoPath, config.targetRepo));
  if (match !== undefined) return match.id;
  const created = await post("/api/workspaces", {
    name: config.workspaceName ?? `thesis-${config.taskId}`,
    repoPath: config.targetRepo
  });
  return created.id ?? created.workspace?.id;
}

function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalize = (value) => value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}

async function assertCleanBaseline(repo, baseSha) {
  const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
  if (!head.startsWith(baseSha.slice(0, 7))) {
    fail(`target HEAD is ${head}, expected the frozen baseline ${baseSha}`);
  }
  const porcelain = (await git(repo, ["status", "--porcelain"])).split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.endsWith(".manyhands/"));
  if (porcelain.length > 0) fail(`target is dirty: ${porcelain.join(" | ")}`);
}

function git(repo, argv) {
  return exec("git", ["-C", repo, ...argv], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout);
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { "x-manyhands-session": TOKEN } });
  if (!response.ok) fail(`GET ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-manyhands-session": TOKEN },
    body: JSON.stringify(body)
  });
  if (!response.ok) fail(`POST ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/u, "")] = argv[i + 1];
  if (out.config === undefined || out.out === undefined) {
    fail("usage: --config <cell.json> --out <dir> [--attach <runId>]");
  }
  return out;
}

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }
function log(message) { process.stdout.write(`[${new Date().toISOString()}] ${message}\n`); }
function fail(message) { process.stderr.write(`ERROR: ${message}\n`); process.exit(2); }
