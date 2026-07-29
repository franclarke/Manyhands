import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const WIDE_GRAPH_ORACLE_ID = "warehouse-wide-graph-v2";
export const WIDE_GRAPH_ORACLE_CONTRACT_VERSION = 2;
export const WIDE_GRAPH_PROTOCOL = Object.freeze({ id: "warehouse-wide-graph", version: 2 });

const EVALUATOR_PATH = "docs/tesis/evidence/scripts/lib/wide-graph-oracle.mjs";
const RUNNER_PATH = "docs/tesis/evidence/scripts/run-wide-graph-oracle.mjs";
const DEPENDENCY_PATHS = [
  "docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs",
  "docs/tesis/evidence/scripts/lib/wide-graph-oracle-plan.mjs",
  "docs/tesis/evidence/warehouse/oracles/oracle-core.mjs",
  "docs/tesis/evidence/warehouse/oracles/probe-specimen.mjs",
  "scripts/manyhands-dev-command.mjs",
  "docs/tesis/evidence/scripts/lib/wide-graph-oracle-contract.mjs"
];
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CRITERION_MAPPINGS = [
  { criterionId: "repository-gates", checks: ["install-frozen-lockfile", "test", "typecheck", "build"] },
  { criterionId: "module-boundary", checks: ["module-boundary"] },
  { criterionId: "deterministic-probe", checks: ["deterministic-probe"] },
  { criterionId: "projection-order", checks: ["projection-order"] },
  { criterionId: "projection-values", checks: ["specimen-values"] }
];

export async function loadWideGraphOracleContract(root = REPOSITORY_ROOT) {
  const evaluator = { path: EVALUATOR_PATH, sha256: await fileSha256(root, EVALUATOR_PATH) };
  const runner = { path: RUNNER_PATH, sha256: await fileSha256(root, RUNNER_PATH) };
  const dependencies = await Promise.all(DEPENDENCY_PATHS.map(async (path) => ({
    path,
    sha256: await fileSha256(root, path)
  })));
  const identity = {
    schemaVersion: 1,
    oracleId: WIDE_GRAPH_ORACLE_ID,
    oracleContractVersion: WIDE_GRAPH_ORACLE_CONTRACT_VERSION,
    evaluator,
    runner,
    dependencies,
    criterionMappings: CRITERION_MAPPINGS.map((mapping) => ({
      criterionId: mapping.criterionId,
      checks: [...mapping.checks]
    }))
  };
  return { ...identity, contractSha256: sha256(stableJson(identity)) };
}

export async function assertFrozenWideGraphOracleContract(contract, root = REPOSITORY_ROOT) {
  if (contract === undefined || contract === null || typeof contract !== "object") {
    throw new Error("frozen external oracle contract is required");
  }
  const current = await loadWideGraphOracleContract(root);
  for (const field of ["schemaVersion", "oracleId", "oracleContractVersion", "contractSha256"]) {
    if (contract[field] !== current[field]) {
      throw new Error(`oracle contract ${field} mismatch: ${contract[field]} != ${current[field]}`);
    }
  }
  for (const asset of ["evaluator", "runner"]) {
    if (contract[asset]?.path !== current[asset].path) {
      throw new Error(`${asset} path mismatch: ${contract[asset]?.path} != ${current[asset].path}`);
    }
    if (contract[asset]?.sha256 !== current[asset].sha256) {
      throw new Error(`${asset} hash mismatch: ${contract[asset]?.sha256} != ${current[asset].sha256}`);
    }
  }
  for (const dependency of current.dependencies) {
    const frozen = contract.dependencies?.find((candidate) => candidate?.path === dependency.path);
    if (frozen?.sha256 !== dependency.sha256) {
      throw new Error(`dependency hash mismatch for ${dependency.path}: ${frozen?.sha256} != ${dependency.sha256}`);
    }
  }
  for (const required of current.criterionMappings) {
    const actual = contract.criterionMappings?.find((mapping) => mapping?.criterionId === required.criterionId);
    if (stableJson(actual) !== stableJson(required)) {
      throw new Error(`oracle criterion mapping mismatch for ${required.criterionId}`);
    }
  }
  if (stableJson(contract.criterionMappings) !== stableJson(current.criterionMappings)) {
    throw new Error("oracle criterion mappings contain unversioned additions or reordering");
  }
  if (!isDeepStrictEqual(contract, current)) {
    throw new Error("oracle contract contains unversioned fields or values");
  }
  return contract;
}

export async function assertWideGraphOracleSeriesContract(manifest, cells, root = REPOSITORY_ROOT) {
  const contract = await assertWideGraphOracleConfiguration(manifest, root);
  for (const cell of cells) {
    if (!isDeepStrictEqual(cell.protocol, manifest.protocol)) {
      throw new Error(`${cell.cellId} protocol differs from the frozen series manifest`);
    }
    if (!isDeepStrictEqual(cell.oracleContract, contract)) {
      throw new Error(`${cell.cellId} oracle contract differs from the frozen series manifest`);
    }
    await assertWideGraphOracleConfiguration(cell, root);
  }
  return contract;
}

export async function assertWideGraphOracleConfiguration(config, root = REPOSITORY_ROOT) {
  if (config?.schemaVersion !== 2) {
    throw new Error(`wide graph configuration schemaVersion must be 2, got ${config?.schemaVersion}`);
  }
  if (!isDeepStrictEqual(config.protocol, WIDE_GRAPH_PROTOCOL)) {
    throw new Error(`wide graph protocol must be ${JSON.stringify(WIDE_GRAPH_PROTOCOL)}`);
  }
  return assertFrozenWideGraphOracleContract(config.oracleContract, root);
}

export function assertWideGraphOracleAttribution(contract, receipt, expectedCandidate) {
  const expected = {
    oracleId: contract.oracleId,
    oracleContractVersion: contract.oracleContractVersion,
    oracleContractSha256: contract.contractSha256,
    oracleEvaluatorSha256: contract.evaluator.sha256,
    verifiedSha: expectedCandidate.candidateSha,
    moduleCount: expectedCandidate.moduleCount,
    outcome: "pass"
  };
  const mismatches = Object.entries(expected)
    .filter(([field, value]) => receipt?.[field] !== value)
    .map(([field, value]) => `${field}: ${receipt?.[field]} != ${value}`);
  const observedChecks = new Set(Array.isArray(receipt?.checks) ? receipt.checks : []);
  for (const mapping of contract.criterionMappings) {
    for (const check of mapping.checks) {
      if (!observedChecks.has(check)) mismatches.push(`${mapping.criterionId}: missing check ${check}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`oracle attribution mismatch: ${mismatches.join("; ")}`);
  }
}

async function fileSha256(root, relativePath) {
  return sha256(await readFile(resolve(root, relativePath)));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
