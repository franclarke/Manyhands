/**
 * Canonical shape of the Warehouse study probe.
 *
 * This module is the ONE definition of the probe contract. Three consumers
 * derive from it and may not restate it:
 *
 *   1. `oracle-core.mjs` validates real deliveries against these rules;
 *   2. each `Wn.md` prompt embeds `referenceProbeOutput(Wn)` verbatim as the
 *      published specimen the delivery must match;
 *   3. `tests/warehouse-oracle-conformance.test.ts` proves the rules accept the
 *      specimen and reject each way a delivery has drifted from it.
 *
 * Prose descriptions of the shape are what produced the W1 series-2 failure:
 * the prompt listed `layout` and `inventory` alongside the envelope fields, the
 * delivery hoisted them to the top level, and the oracle — which requires them
 * inside `capabilities` — rejected a delivery that had followed the prompt.
 * A specimen cannot contradict itself the way two paragraphs can.
 */

export const SCENARIO = "thesis-seed-2026";
export const SCHEMA_VERSION = 1;

/** Cumulative capability chain. `capabilitiesFor` slices it; nothing else may reorder it. */
export const CAPABILITY_CHAIN = [
  "layout",
  "inventory",
  "visual",
  "orders",
  "simulation",
  "routing",
  "congestion",
  "persistence",
  "analytics",
  "accessibility"
];

/** How many capabilities each increment adds to the chain. */
const CAPABILITY_COUNT = { W1: 2, W2: 3, W3: 4, W4: 5, W5: 6, W6: 7, W7: 8, W8: 10 };

/**
 * Declared minimums and invariants per capability field. `min` is inclusive.
 * `finite` accepts any finite number, including zero and negatives.
 */
export const CAPABILITY_RULES = {
  layout: { zones: { min: 3 }, bins: { min: 12 } },
  inventory: { skus: { min: 3 }, totalUnits: { min: 1 } },
  visual: { svgElements: { min: 1 }, heatmapCells: { min: 12 }, textLabels: { min: 3 } },
  orders: { accepted: { min: 1 }, rejected: { min: 1 }, reservationConserved: { true: true } },
  simulation: { events: { min: 4 }, playPauseStepReset: { true: true }, sseMonotonic: { true: true } },
  routing: { pickStops: { min: 2 }, distance: { min: 1 }, overlayVisible: { true: true } },
  congestion: { waves: { min: 2 }, capacityEnforced: { true: true }, costInfluencesRoute: { true: true } },
  persistence: { timelineEvents: { min: 4 }, replayMatchesLive: { true: true }, snapshotRestores: { true: true } },
  analytics: { throughput: { finite: true }, utilization: { finite: true }, alerts: { min: 1 } },
  accessibility: { keyboardJourney: { true: true }, reducedMotion: { true: true }, statusNotColorOnly: { true: true } }
};

/**
 * Illustrative values, deliberately above the declared minimums so the specimen
 * reads as a shape and not as a target to hit exactly. `heatmapCells` matches
 * `layout.bins` because W2 requires at least one cell per bin.
 */
const REFERENCE_CAPABILITIES = {
  layout: { zones: 4, bins: 16 },
  inventory: { skus: 5, totalUnits: 240 },
  visual: { svgElements: 64, heatmapCells: 16, textLabels: 12 },
  orders: { accepted: 3, rejected: 1, reservationConserved: true },
  simulation: { events: 12, playPauseStepReset: true, sseMonotonic: true },
  routing: { pickStops: 4, distance: 18, overlayVisible: true },
  congestion: { waves: 2, capacityEnforced: true, costInfluencesRoute: true },
  persistence: { timelineEvents: 12, replayMatchesLive: true, snapshotRestores: true },
  analytics: { throughput: 7.5, utilization: 0.62, alerts: 2 },
  accessibility: { keyboardJourney: true, reducedMotion: true, statusNotColorOnly: true }
};

/**
 * Placeholder digest. Well-formed for the `sha256:<64 lowercase hex>` rule and
 * obviously not a real state hash, so nobody can mistake it for an expected value.
 */
export const PLACEHOLDER_STATE_HASH = `sha256:${"0123456789abcdef".repeat(4)}`;

export function capabilitiesFor(increment) {
  const count = CAPABILITY_COUNT[increment];
  if (count === undefined) throw new Error(`unknown increment ${increment}`);
  return CAPABILITY_CHAIN.slice(0, count);
}

/** A fresh, valid probe output for `increment`. Callers may mutate it freely. */
export function referenceProbeOutput(increment) {
  const capabilities = {};
  for (const capability of capabilitiesFor(increment)) {
    capabilities[capability] = { ...REFERENCE_CAPABILITIES[capability] };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    increment,
    scenario: SCENARIO,
    stateHash: PLACEHOLDER_STATE_HASH,
    capabilities
  };
}

/** The specimen exactly as it is published inside a prompt. */
export function referenceProbeJson(increment) {
  return JSON.stringify(referenceProbeOutput(increment), null, 2);
}

/** Human-readable statement of one field's rule, in the prompt's language. */
function describeRule(capability, field, rule) {
  if (rule.true === true) return `- \`${capability}.${field}\` es exactamente \`true\`.`;
  if (rule.finite === true) return `- \`${capability}.${field}\` es un número finito.`;
  return `- \`${capability}.${field}\` es un número >= ${rule.min}.`;
}

/**
 * Render the `## Probe contract` section a prompt publishes.
 *
 * The prompts do not author this text: `pin-warehouse-assets.mjs` writes it from
 * here, so the published stimulus and the enforced rules cannot disagree. The
 * previous prose version opened with a flat "Campos exactos" list that placed
 * the capabilities beside the envelope fields; the W1 series-2 delivery followed
 * that list, hoisted them out of `capabilities`, and the oracle rejected it.
 */
export function renderProbeContract(increment) {
  const capabilities = capabilitiesFor(increment);
  const rules = capabilities.flatMap((capability) =>
    Object.entries(CAPABILITY_RULES[capability]).map(([field, rule]) => describeRule(capability, field, rule))
  );

  return `## Probe contract

El comando \`pnpm study:probe -- --increment ${increment} --scenario ${SCENARIO} --format json\`
escribe en stdout un único objeto JSON y ninguna otra salida, con exactamente
esta forma:

\`\`\`json
${referenceProbeJson(increment)}
\`\`\`

La envoltura fija \`schemaVersion\`, \`increment\` y \`scenario\`. Las capacidades
requeridas en este incremento son ${capabilities.map((name) => `\`${name}\``).join(", ")}.
Cada una vive anidada dentro de \`capabilities\`: ninguna se publica en el nivel
superior ni se renombra.

Los valores del ejemplo son ilustrativos. Derivalos del escenario respetando
estos mínimos e invariantes, que el oráculo externo verifica:

${rules.join("\n")}

\`stateHash\` es la cadena \`sha256:\` seguida de 64 dígitos hexadecimales
minúsculos. Dos invocaciones sobre el mismo commit emiten bytes idénticos.`;
}
