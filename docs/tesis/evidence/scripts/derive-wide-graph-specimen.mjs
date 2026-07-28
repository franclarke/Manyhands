#!/usr/bin/env node
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import ts from "typescript";

const run = promisify(execFile);
const SCENARIO_PATH = "src/scenarios/thesis-seed-2026.ts";
const SCENARIO_NAME = "thesis-seed-2026";

const args = parseArgs(process.argv.slice(2));
const source = await readGitBlob(args.repository, args.commit, SCENARIO_PATH);
const specimen = deriveSpecimen(source);

if (args.check) {
  const { WIDE_GRAPH_METRICS } = await import("./lib/wide-graph-metrics.mjs");
  const expected = WIDE_GRAPH_METRICS.map(({ id, expected: value }) => ({ id, value }));
  if (!isDeepStrictEqual(specimen.metrics, expected)) {
    process.stderr.write("derived W1 specimen does not match the frozen wide-graph catalogue\n");
    process.exit(1);
  }
}

process.stdout.write(`${JSON.stringify(specimen)}\n`);

function parseArgs(argv) {
  let repository;
  let commit;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repository") repository = argv[++index];
    else if (argument === "--commit") commit = argv[++index];
    else if (argument === "--check") check = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!repository) throw new Error("--repository is required");
  if (!commit) throw new Error("--commit is required");
  return { repository, commit, check };
}

async function readGitBlob(repository, commit, path) {
  const { stdout } = await run(
    "git",
    ["-c", `safe.directory=${repository.replaceAll("\\", "/")}`, "-C", repository, "show", `${commit}:${path}`],
    { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true }
  );
  return stdout;
}

function deriveSpecimen(sourceText) {
  const sourceFile = ts.createSourceFile(SCENARIO_PATH, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const zones = stringArray(variableInitializer(sourceFile, "ZONE_NAMES"), "ZONE_NAMES");
  const binsPerZone = numberLiteral(variableInitializer(sourceFile, "BINS_PER_ZONE"), "BINS_PER_ZONE");
  const skus = stringArray(variableInitializer(sourceFile, "SKUS"), "SKUS");
  const placements = stockPlan(variableInitializer(sourceFile, "stockPlan"), skus);

  const zoneIds = zones.map((_, index) => `zone-${index + 1}`);
  const bins = zoneIds.flatMap((zoneId, zoneIndex) =>
    Array.from({ length: binsPerZone }, (_, slotIndex) => ({
      id: `bin-${zoneIndex + 1}-${slotIndex + 1}`,
      zoneId
    }))
  );

  return {
    schemaVersion: 1,
    scenario: SCENARIO_NAME,
    metrics: calculateMetrics({ zoneIds, bins, skus, placements })
  };
}

function variableInitializer(sourceFile, name) {
  let initializer;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!initializer) throw new Error(`Scenario blob does not declare ${name}`);
  return initializer;
}

function stringArray(node, name) {
  if (!ts.isArrayLiteralExpression(node)) throw new Error(`${name} must be an array literal`);
  return node.elements.map((element) => {
    if (!ts.isStringLiteral(element)) throw new Error(`${name} must contain only string literals`);
    return element.text;
  });
}

function numberLiteral(node, name) {
  if (!ts.isNumericLiteral(node)) throw new Error(`${name} must be a numeric literal`);
  return Number(node.text);
}

function stockPlan(node, skus) {
  if (!ts.isArrayLiteralExpression(node)) throw new Error("stockPlan must be an array literal");
  return node.elements.map((element) => {
    if (!ts.isArrayLiteralExpression(element) || element.elements.length !== 3) {
      throw new Error("stockPlan entries must be [binId, skuId, quantity] tuples");
    }
    const [binNode, skuNode, quantityNode] = element.elements;
    if (!ts.isStringLiteral(binNode) || !ts.isNumericLiteral(quantityNode)) {
      throw new Error("stockPlan bin ids and quantities must be literals");
    }
    let skuId;
    if (ts.isStringLiteral(skuNode)) skuId = skuNode.text;
    else if (
      ts.isElementAccessExpression(skuNode)
      && ts.isIdentifier(skuNode.expression)
      && skuNode.expression.text === "SKUS"
      && skuNode.argumentExpression
      && ts.isNumericLiteral(skuNode.argumentExpression)
    ) {
      skuId = skus[Number(skuNode.argumentExpression.text)];
    }
    if (!skuId) throw new Error("stockPlan SKU must be a literal or SKUS numeric lookup");
    return { binId: binNode.text, skuId, quantity: Number(quantityNode.text) };
  });
}

function calculateMetrics({ zoneIds, bins, skus, placements }) {
  const binZone = new Map(bins.map((bin) => [bin.id, bin.zoneId]));
  const quantitiesByBin = new Map(bins.map((bin) => [bin.id, 0]));
  const binsBySku = new Map(skus.map((sku) => [sku, new Set()]));
  const zonesBySku = new Map(skus.map((sku) => [sku, new Set()]));
  const skusByZone = new Map(zoneIds.map((zone) => [zone, new Set()]));
  const totalsBySku = Object.fromEntries(skus.map((sku) => [sku, 0]));
  const totalsByZone = Object.fromEntries(zoneIds.map((zone) => [zone, 0]));

  for (const { binId, skuId, quantity } of placements) {
    const zoneId = binZone.get(binId);
    if (!zoneId) throw new Error(`stockPlan references unknown bin ${binId}`);
    if (!(skuId in totalsBySku)) throw new Error(`stockPlan references unknown SKU ${skuId}`);
    quantitiesByBin.set(binId, quantitiesByBin.get(binId) + quantity);
    totalsBySku[skuId] += quantity;
    totalsByZone[zoneId] += quantity;
    binsBySku.get(skuId).add(binId);
    zonesBySku.get(skuId).add(zoneId);
    skusByZone.get(zoneId).add(skuId);
  }

  const occupied = [...quantitiesByBin.entries()].filter(([, quantity]) => quantity > 0);
  const emptyBinIds = [...quantitiesByBin.entries()]
    .filter(([, quantity]) => quantity === 0)
    .map(([binId]) => binId)
    .sort();
  const occupiedQuantities = occupied.map(([, quantity]) => quantity).sort((left, right) => left - right);
  const totalUnits = Object.values(totalsByZone).reduce((total, quantity) => total + quantity, 0);
  const topBin = [...occupied].sort(
    ([leftId, leftQuantity], [rightId, rightQuantity]) =>
      rightQuantity - leftQuantity || leftId.localeCompare(rightId)
  )[0];
  const medianIndex = occupiedQuantities.length / 2;
  const median = occupiedQuantities.length % 2 === 0
    ? (occupiedQuantities[medianIndex - 1] + occupiedQuantities[medianIndex]) / 2
    : occupiedQuantities[Math.floor(medianIndex)];

  const occupiedPerZone = Object.fromEntries(zoneIds.map((zoneId) => [
    zoneId,
    occupied.filter(([binId]) => binZone.get(binId) === zoneId).length
  ]));

  return [
    metric("zone-unit-totals", totalsByZone),
    metric("sku-unit-totals", totalsBySku),
    metric("bin-occupancy", { occupied: occupied.length, empty: emptyBinIds.length, total: bins.length }),
    metric("sku-bin-spread", mapCounts(skus, binsBySku)),
    metric("zone-sku-mix", mapCounts(zoneIds, skusByZone)),
    metric("top-bin-by-units", { binId: topBin[0], units: topBin[1] }),
    metric("empty-bin-ids", emptyBinIds),
    metric("median-occupied-bin-units", median),
    metric("single-bin-skus", skus.filter((sku) => binsBySku.get(sku).size === 1).sort()),
    metric("zone-share-of-units", Object.fromEntries(
      zoneIds.map((zoneId) => [zoneId, roundFour(totalsByZone[zoneId] / totalUnits)])
    )),
    metric("sku-zone-presence", mapSortedValues(skus, zonesBySku)),
    metric("occupied-bins-per-zone", occupiedPerZone),
    metric("unit-quantity-extremes", {
      min: occupiedQuantities[0],
      max: occupiedQuantities[occupiedQuantities.length - 1]
    }),
    metric("top-bin-concentration", roundFour(topBin[1] / totalUnits)),
    metric("multi-bin-skus", Object.fromEntries(
      skus.filter((sku) => binsBySku.get(sku).size > 1).map((sku) => [sku, [...binsBySku.get(sku)].sort()])
    )),
    metric("zone-mean-units-per-occupied-bin", Object.fromEntries(
      zoneIds.map((zoneId) => [
        zoneId,
        occupiedPerZone[zoneId] === 0 ? 0 : roundFour(totalsByZone[zoneId] / occupiedPerZone[zoneId])
      ])
    ))
  ];
}

function metric(id, value) {
  return { id, value };
}

function mapCounts(keys, values) {
  return Object.fromEntries(keys.map((key) => [key, values.get(key).size]));
}

function mapSortedValues(keys, values) {
  return Object.fromEntries(keys.map((key) => [key, [...values.get(key)].sort()]));
}

function roundFour(value) {
  return Number(value.toFixed(4));
}
