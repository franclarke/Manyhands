import { metricsFor } from "./wide-graph-metrics.mjs";

export function projectionIds(report) {
  if (!Array.isArray(report?.projections)) return [];
  return report.projections.map((projection) =>
    typeof projection === "string" ? projection : projection?.projectionId ?? projection?.id
  );
}

/**
 * Comparación estructural, estable frente al orden de claves de un objeto: dos
 * respuestas con las mismas entradas son la misma respuesta.
 */
function sameAnswer(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((item, index) => sameAnswer(actual[index], item));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    return expectedKeys.length === actualKeys.length
      && expectedKeys.every((key, index) => key === actualKeys[index])
      && expectedKeys.every((key) => sameAnswer(actual[key], expected[key]));
  }
  return actual === expected;
}

/**
 * El oráculo compara contra el specimen congelado, no sólo contra la forma.
 *
 * Verificar estructura y determinismo no distingue un módulo correcto de uno que
 * devuelve un valor plausible inventado: dos corridas de un stub son igual de
 * idénticas entre sí que dos corridas de una implementación real. Como el seed
 * está congelado, cada pregunta tiene un único resultado correcto y se puede
 * exigir ese resultado.
 */
export function checkWideGraphOutput(report, moduleCount) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (report?.moduleCount !== moduleCount) {
    failures.push(`moduleCount must be ${moduleCount}`);
  }
  if (report?.scenario !== "thesis-seed-2026") {
    failures.push('scenario must be "thesis-seed-2026"');
  }

  const metrics = metricsFor(moduleCount);
  const ids = projectionIds(report);
  if (ids.length !== moduleCount) {
    failures.push(`projection count must be ${moduleCount}, got ${ids.length}`);
  }
  const expectedIds = metrics.map((metric) => metric.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    failures.push(`projection order must be ${expectedIds.join(", ")}`);
    return failures;
  }

  const projections = Array.isArray(report?.projections) ? report.projections : [];
  for (const [index, metric] of metrics.entries()) {
    const actual = projections[index]?.value;
    if (actual === undefined) {
      failures.push(`${metric.id} reported no value`);
    } else if (!sameAnswer(actual, metric.expected)) {
      failures.push(`${metric.id} answered ${JSON.stringify(actual)}; expected ${JSON.stringify(metric.expected)}`);
    }
  }
  return failures;
}
