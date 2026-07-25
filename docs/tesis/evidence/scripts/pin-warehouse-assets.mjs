#!/usr/bin/env node
/**
 * Regenerate every Warehouse study asset pin from the files on disk.
 *
 * The pins were hand-edited three times during the pilot and each edit was an
 * opportunity to publish a hash that did not match the artefact it named. This
 * script is the only supported way to move them: it reads the real bytes and
 * rewrites `oracles/<Wn>/oracle.json` plus `assets-manifest.json`.
 *
 *   node docs/tesis/evidence/scripts/pin-warehouse-assets.mjs           # rewrite
 *   node docs/tesis/evidence/scripts/pin-warehouse-assets.mjs --check   # verify only
 *
 * `--check` exits non-zero when any pin is stale, so it can gate a freeze.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve("docs/tesis/evidence/warehouse");
const increments = Array.from({ length: 8 }, (_, index) => `W${index + 1}`);
const checkOnly = process.argv.includes("--check");
const ORACLE_TIMEOUT_MS = 600_000;

const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

const coreSha256 = await sha256(join(root, "oracles", "oracle-core.mjs"));
const specimenSha256 = await sha256(join(root, "oracles", "probe-specimen.mjs"));
const seedManifestSha256 = await sha256(join(root, "seed", "seed-manifest.json"));

const stale = [];

for (const increment of increments) {
  const path = join(root, "oracles", increment, "oracle.json");
  const pin = {
    schemaVersion: 1,
    id: `warehouse-${increment.toLowerCase()}-v1`,
    increment,
    command: ["node", "oracle.mjs"],
    timeoutMs: ORACLE_TIMEOUT_MS,
    scriptSha256: await sha256(join(root, "oracles", increment, "oracle.mjs")),
    coreSha256,
    specimenSha256
  };
  await reconcile(path, `${JSON.stringify(pin)}\n`);
}

const manifestPath = join(root, "assets-manifest.json");
const existing = JSON.parse(await readFile(manifestPath, "utf8"));
const prompts = {};
for (const increment of increments) {
  prompts[increment] = await sha256(join(root, "protocol", "prompts", `${increment}.md`));
}
const manifest = {
  schemaVersion: 1,
  policyVersion: existing.policyVersion,
  seedManifestSha256,
  oracleCoreSha256: coreSha256,
  probeSpecimenSha256: specimenSha256,
  prompts
};
await reconcile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (stale.length > 0) {
  process.stdout.write(`stale pins (${stale.length}):\n- ${stale.join("\n- ")}\n`);
  process.exit(checkOnly ? 1 : 0);
}
process.stdout.write(`${checkOnly ? "all Warehouse asset pins match" : "Warehouse asset pins rewritten"}\n`);

async function reconcile(path, next) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current === next) return;
  stale.push(path);
  if (!checkOnly) await writeFile(path, next, "utf8");
}
