#!/usr/bin/env node
/** Core for every external Warehouse oracle. It executes outside the target. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const pnpm = "pnpm";

export async function runExternalOracle(spec) {
  const target = resolve(argument("--target") ?? process.env.WAREHOUSE_TARGET ?? process.cwd());
  const scenario = "thesis-seed-2026";
  const checks = [];

  for (const script of ["test", "typecheck", "build"]) {
    await command(pnpm, [script], target, 180_000);
    checks.push(`${script}:pass`);
  }

  const first = await probe(target, spec.increment, scenario);
  const second = await probe(target, spec.increment, scenario);
  assert(first.schemaVersion === 1, "probe schemaVersion must be 1");
  assert(first.increment === spec.increment, `probe increment must be ${spec.increment}`);
  assert(first.scenario === scenario, `probe scenario must be ${scenario}`);
  assert(JSON.stringify(first) === JSON.stringify(second), "probe output is not deterministic");
  assert(typeof first.stateHash === "string" && /^sha256:[0-9a-f]{64}$/u.test(first.stateHash), "stateHash is not versioned sha256");

  for (const capability of spec.capabilities) {
    assert(Object.hasOwn(first.capabilities ?? {}, capability), `missing capability ${capability}`);
    validate(capability, first.capabilities[capability]);
    checks.push(`${capability}:pass`);
  }

  process.stdout.write(`${JSON.stringify({
    oracleId: `warehouse-${spec.increment.toLowerCase()}-v1`,
    increment: spec.increment,
    target,
    outcome: "pass",
    stateHash: first.stateHash,
    checks
  }, null, 2)}\n`);
}

async function probe(target, increment, scenario) {
  const { stdout } = await command(pnpm, ["study:probe", "--", "--increment", increment, "--scenario", scenario, "--format", "json"], target, 120_000);
  try { return JSON.parse(stdout.trim()); }
  catch { throw new Error(`study:probe did not emit JSON: ${stdout.slice(0, 300)}`); }
}

function validate(name, value) {
  assert(value !== null && typeof value === "object", `${name} must be an object`);
  const validators = {
    layout: () => { positive(value.zones, "layout.zones", 3); positive(value.bins, "layout.bins", 12); },
    inventory: () => { positive(value.skus, "inventory.skus", 3); positive(value.totalUnits, "inventory.totalUnits", 1); },
    visual: () => { positive(value.svgElements, "visual.svgElements", 1); positive(value.heatmapCells, "visual.heatmapCells", 12); positive(value.textLabels, "visual.textLabels", 3); },
    orders: () => { positive(value.accepted, "orders.accepted", 1); positive(value.rejected, "orders.rejected", 1); assert(value.reservationConserved === true, "orders must conserve reservations"); },
    simulation: () => { positive(value.events, "simulation.events", 4); assert(value.playPauseStepReset === true, "simulation controls incomplete"); assert(value.sseMonotonic === true, "SSE sequence is not monotonic"); },
    routing: () => { positive(value.pickStops, "routing.pickStops", 2); positive(value.distance, "routing.distance", 1); assert(value.overlayVisible === true, "route overlay not visible"); },
    congestion: () => { positive(value.waves, "congestion.waves", 2); assert(value.capacityEnforced === true, "picker capacity not enforced"); assert(value.costInfluencesRoute === true, "congestion does not influence routing"); },
    persistence: () => { positive(value.timelineEvents, "persistence.timelineEvents", 4); assert(value.replayMatchesLive === true, "replay differs from live state"); assert(value.snapshotRestores === true, "snapshot restore failed"); },
    analytics: () => { number(value.throughput, "analytics.throughput"); number(value.utilization, "analytics.utilization"); positive(value.alerts, "analytics.alerts", 1); },
    accessibility: () => { assert(value.keyboardJourney === true, "keyboard journey failed"); assert(value.reducedMotion === true, "reduced motion unsupported"); assert(value.statusNotColorOnly === true, "status depends on color only"); }
  };
  validators[name]?.();
}

async function command(file, args, cwd, timeout) {
  try { return await exec(file, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }); }
  catch (error) { throw new Error(`${file} ${args.join(" ")} failed: ${error.stderr ?? error.message}`); }
}
function argument(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function positive(value, label, minimum) { number(value, label); assert(value >= minimum, `${label} must be >= ${minimum}`); }
function number(value, label) { assert(typeof value === "number" && Number.isFinite(value), `${label} must be finite`); }
