#!/usr/bin/env node
/** Core for every external Warehouse oracle. It executes outside the target. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { CAPABILITY_RULES, SCENARIO, SCHEMA_VERSION, capabilitiesFor } from "./probe-specimen.mjs";
import { resolveDefaultDevSpawn } from "../../../../../scripts/manyhands-dev-command.mjs";

const exec = promisify(execFile);
const STATE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * Run a pnpm command in `cwd`.
 *
 * The published probe contract contains a bare `--` separator. Spawning a
 * Windows `pnpm.cmd` shim routes that command line through cmd.exe, which
 * re-parses it and reports the token after `--` as an unknown command — an
 * instrument failure that looks exactly like a broken delivery. The shared
 * launcher resolver picks `pnpm.exe` when present and otherwise builds a
 * correctly quoted, verbatim cmd.exe line.
 */
export async function runPnpm(args, cwd, timeout) {
  const spawn = resolveDefaultDevSpawn(args);
  try {
    return await exec(spawn.command, spawn.args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      windowsVerbatimArguments: spawn.windowsVerbatimArguments
    });
  } catch (error) {
    throw new Error(`pnpm ${args.join(" ")} failed: ${error.stderr ?? error.message}`);
  }
}

/**
 * Validate one probe output against the specimen rules for `increment`.
 *
 * Pure and total: returns EVERY failure rather than throwing on the first one,
 * so a single burned run reports the complete defect list instead of revealing
 * them one at a time across successive runs. Extra capabilities beyond the
 * increment's chain are permitted; missing or malformed ones are not.
 */
export function checkProbeOutput(increment, output) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };

  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return ["probe output must be a JSON object"];
  }

  check(output.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}, got ${JSON.stringify(output.schemaVersion)}`);
  check(output.increment === increment, `increment must be "${increment}", got ${JSON.stringify(output.increment)}`);
  check(output.scenario === SCENARIO, `scenario must be "${SCENARIO}", got ${JSON.stringify(output.scenario)}`);
  check(
    typeof output.stateHash === "string" && STATE_HASH_PATTERN.test(output.stateHash),
    `stateHash must match sha256:<64 lowercase hex>, got ${JSON.stringify(output.stateHash)}`
  );

  const capabilities = output.capabilities;
  if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    failures.push("capabilities must be an object holding every declared capability");
    return failures;
  }

  for (const name of capabilitiesFor(increment)) {
    if (!Object.hasOwn(capabilities, name)) {
      const hoisted = Object.hasOwn(output, name) ? ` (found at the top level instead of inside capabilities)` : "";
      failures.push(`capabilities.${name} is missing${hoisted}`);
      continue;
    }
    const value = capabilities[name];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      failures.push(`capabilities.${name} must be an object, got ${JSON.stringify(value)}`);
      continue;
    }
    for (const [field, rule] of Object.entries(CAPABILITY_RULES[name])) {
      const actual = value[field];
      const label = `${name}.${field}`;
      if (rule.true === true) {
        check(actual === true, `${label} must be exactly true, got ${JSON.stringify(actual)}`);
      } else if (rule.finite === true) {
        check(typeof actual === "number" && Number.isFinite(actual), `${label} must be a finite number, got ${JSON.stringify(actual)}`);
      } else {
        if (typeof actual !== "number" || !Number.isFinite(actual)) {
          failures.push(`${label} must be a finite number, got ${JSON.stringify(actual)}`);
        } else {
          check(actual >= rule.min, `${label} must be >= ${rule.min}, got ${actual}`);
        }
      }
    }
  }

  return failures;
}

const GATE_SCRIPTS = ["test", "typecheck", "build"];
const PROBE_SCRIPT = "study:probe";

/**
 * An inline `node -e "console.log(...)"` one-liner. The seed ships exactly this
 * for every gate so the empty repository is installable; a delivery that leaves
 * one in place exits 0 without validating anything, which is how the first W1
 * recorded five satisfied criteria against untouched stubs.
 */
function isInlineEcho(command) {
  return /^node\s+(-e|--eval)\b/u.test(command.trim()) && /console\.log/u.test(command);
}

/**
 * Decide from the target's manifest alone whether the published commands exist
 * and are real. Pure, so it runs in milliseconds before any install or build,
 * and reports every problem at once.
 */
export function checkCommandSurface(packageJson) {
  const scripts = packageJson?.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [`package.json declares no scripts block; ${[...GATE_SCRIPTS, PROBE_SCRIPT].join(", ")} are all required`];
  }

  const failures = [];
  for (const script of [...GATE_SCRIPTS, PROBE_SCRIPT]) {
    const command = scripts[script];
    if (typeof command !== "string" || command.trim() === "") {
      failures.push(`script "${script}" is missing from package.json`);
    } else if (isInlineEcho(command)) {
      failures.push(`script "${script}" is still an inline echo stub (${command.trim()}); it validates nothing`);
    }
  }
  return failures;
}

/**
 * Entry point for every `Wn/oracle.mjs`. Reports a verdict, never a stack trace:
 * the failure text is copied verbatim into the run's `oracle-result.json` and is
 * read months later as thesis evidence.
 */
export async function runExternalOracle(spec) {
  try {
    await evaluate(spec);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

async function evaluate(spec) {
  const target = resolve(argument("--target") ?? process.env.WAREHOUSE_TARGET ?? process.cwd());
  const checks = [];

  const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  const surfaceFailures = checkCommandSurface(manifest);
  if (surfaceFailures.length > 0) {
    throw new Error(`command surface unusable (${surfaceFailures.length}):\n- ${surfaceFailures.join("\n- ")}`);
  }
  checks.push("command-surface:pass");

  for (const script of GATE_SCRIPTS) {
    await runPnpm([script], target, 180_000);
    checks.push(`${script}:pass`);
  }

  const first = await probe(target, spec.increment);
  const second = await probe(target, spec.increment);

  const failures = checkProbeOutput(spec.increment, first);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push("probe output is not deterministic across two invocations on the same commit");
  }
  if (failures.length > 0) {
    throw new Error(`probe contract violated (${failures.length}):\n- ${failures.join("\n- ")}`);
  }

  for (const capability of capabilitiesFor(spec.increment)) checks.push(`${capability}:pass`);

  process.stdout.write(`${JSON.stringify({
    oracleId: `warehouse-${spec.increment.toLowerCase()}-v1`,
    increment: spec.increment,
    target,
    outcome: "pass",
    stateHash: first.stateHash,
    checks
  }, null, 2)}\n`);
}

async function probe(target, increment) {
  const { stdout } = await runPnpm(["--silent", "study:probe", "--", "--increment", increment, "--scenario", SCENARIO, "--format", "json"], target, 120_000);
  try { return JSON.parse(stdout.trim()); }
  catch { throw new Error(`study:probe did not emit JSON: ${stdout.slice(0, 300)}`); }
}

function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
