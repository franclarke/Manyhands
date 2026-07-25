import { readFile } from "node:fs/promises";

export const UNAVAILABLE = "unavailable";
export const NOT_APPLICABLE = "not_applicable";

export async function readJournal(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw.split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line);
      return parsed.event ?? parsed;
    });
}

export function summarizeRunJournal(events, externalOracle) {
  const ordered = [...events].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const runId = ordered[0]?.runId ?? UNAVAILABLE;
  const timestamps = ordered.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  const delivery = ordered.findLast((event) => event.type === "delivery.published");
  const delivered = delivery?.payload?.receipt?.confirmed === true ? 1 : 0;
  const terminalAttempts = ordered.filter((event) =>
    event.type === "attempt.candidate_created" || event.type === "attempt.failed"
  );
  const reportedUsage = terminalAttempts
    .map((event) => event.payload?.usage)
    .filter((usage) => usage?.source === "reported");
  const tokensTotal = reportedUsage.length === 0
    ? UNAVAILABLE
    : reportedUsage.reduce((sum, usage) => sum + tokensFor(usage), 0);
  const strategyEvents = ordered.filter((event) => event.type === "planning.granularity_strategy_selected");
  const latestStrategy = strategyEvents.at(-1)?.payload;

  return {
    runId,
    delivered,
    lifecycle: lifecycleFor(ordered, delivered),
    wallClockSeconds: timestamps.length < 2
      ? UNAVAILABLE
      : Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000),
    attempts: ordered.filter((event) => event.type === "attempt.started").length,
    repairs: ordered.filter((event) => event.type === "attempt.repair_attempted" || event.type === "integration.repair_attempted").length,
    tokensTotal,
    usageStatus: reportedUsage.length === 0 ? UNAVAILABLE : "reported",
    usageReportedAttempts: reportedUsage.length,
    usageUnavailableAttempts: terminalAttempts.length - reportedUsage.length,
    externalOracleCoverage: oracleCoverage(delivered, externalOracle),
    policyVersion: latestStrategy?.policyVersion ?? UNAVAILABLE,
    condition: latestStrategy?.condition ?? UNAVAILABLE,
    candidateTreeHash: latestStrategy?.candidateTreeHash ?? UNAVAILABLE,
    leafCount: latestStrategy?.metrics?.totalLeafCount ?? UNAVAILABLE,
    graphDepth: latestStrategy?.metrics?.maxGraphDepth ?? UNAVAILABLE,
    branchingFactor: latestStrategy?.metrics?.averageBranchingFactor ?? UNAVAILABLE,
    strategyAssessments: strategyEvents.flatMap((event) =>
      (event.payload?.assessments ?? []).map((assessment) => ({
        runId,
        policyVersion: event.payload.policyVersion,
        condition: event.payload.condition,
        candidateTreeHash: event.payload.candidateTreeHash,
        ...assessment
      }))
    )
  };
}

export function toCsv(rows, columns) {
  return `${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n")}\n`;
}

function tokensFor(usage) {
  if (usage.tokensTotal !== undefined) return usage.tokensTotal;
  return (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0);
}

function oracleCoverage(delivered, oracle) {
  if (delivered === 0) return NOT_APPLICABLE;
  if (oracle === undefined) return UNAVAILABLE;
  if (oracle.total === 0) return NOT_APPLICABLE;
  return round(oracle.satisfied / oracle.total, 4);
}

function lifecycleFor(events, delivered) {
  if (delivered === 1) return "completed";
  const failed = events.findLast((event) => event.type === "run.failed" || event.type === "planning.failed");
  if (failed !== undefined) return "failed";
  return events.at(-1)?.type ?? UNAVAILABLE;
}

function csvCell(value) {
  const serializable = value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  const text = serializable === undefined || serializable === null ? UNAVAILABLE : String(serializable);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
