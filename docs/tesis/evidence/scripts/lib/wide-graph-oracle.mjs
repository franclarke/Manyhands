export function projectionIds(report) {
  if (!Array.isArray(report?.projections)) return [];
  return report.projections.map((projection) =>
    typeof projection === "string" ? projection : projection?.id
  );
}

export function checkWideGraphOutput(report, moduleCount) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (report?.moduleCount !== moduleCount) {
    failures.push(`moduleCount must be ${moduleCount}`);
  }
  if (report?.scenario !== "thesis-seed-2026") {
    failures.push('scenario must be "thesis-seed-2026"');
  }
  const ids = projectionIds(report);
  if (ids.length !== moduleCount) {
    failures.push(`projection count must be ${moduleCount}, got ${ids.length}`);
  }
  const expected = Array.from(
    { length: moduleCount },
    (_, index) => `projection-${String(index + 1).padStart(2, "0")}`
  );
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    failures.push(`projection order must be ${expected.join(", ")}`);
  }
  return failures;
}
