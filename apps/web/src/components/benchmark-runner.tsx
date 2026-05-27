"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  ApiErrorResponse,
  BenchmarkRunResponse,
  BenchmarkSummary,
  BenchmarksListResponse
} from "@/lib/api-types";
import type { BenchmarkReport, EvaluationConfiguration } from "@manyhands/evaluator";
import { Panel, StatusPill } from "@/components/panel";

type ConfigSelection = "all" | EvaluationConfiguration;

export function BenchmarkRunner(): React.ReactElement {
  const [benchmarks, setBenchmarks] = useState<BenchmarkSummary[]>([]);
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [reportResponse, setReportResponse] = useState<BenchmarkRunResponse | null>(null);
  const [selectionByBenchmark, setSelectionByBenchmark] = useState<Record<string, ConfigSelection>>({});

  useEffect(() => {
    let active = true;

    async function loadBenchmarks(): Promise<void> {
      try {
        setLoadingBenchmarks(true);
        const response = await fetch("/api/benchmarks", { cache: "no-store" });
        const payload = await readResponse<BenchmarksListResponse>(response);

        if (active) {
          setBenchmarks(payload.benchmarks);
          setLoadError(null);
        }
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (active) {
          setLoadingBenchmarks(false);
        }
      }
    }

    void loadBenchmarks();

    return () => {
      active = false;
    };
  }, []);

  async function handleRun(benchmark: BenchmarkSummary): Promise<void> {
    const selection = selectionByBenchmark[benchmark.id] ?? "all";
    const body = selection === "all" ? {} : { config: selection };

    try {
      setRunningId(benchmark.id);
      setRunError(null);
      const response = await fetch(`/api/benchmarks/${benchmark.id}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const payload = await readResponse<BenchmarkRunResponse>(response);
      setReportResponse(payload);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningId(null);
    }
  }

  const latestReport = reportResponse?.report ?? null;

  return (
    <div className="space-y-6">
      <Panel>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Available benchmarks</h2>
            <p className="mt-2 text-sm text-[#9aa8ba]">
              Data comes from validated BenchmarkManifest files through the web API.
            </p>
          </div>
          <StatusPill tone="warning">deterministic mock only</StatusPill>
        </div>

        {loadingBenchmarks ? (
          <p className="text-sm text-[#9aa8ba]">Loading benchmark manifests...</p>
        ) : null}

        {loadError ? (
          <div className="border border-[#ff8f8f]/40 bg-[#ff8f8f]/10 p-4 text-sm text-[#ffb3b3]">
            {loadError}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {benchmarks.map((benchmark) => {
            const selection = selectionByBenchmark[benchmark.id] ?? "all";
            const running = runningId === benchmark.id;

            return (
              <article key={benchmark.id} className="border border-[#223044] bg-[#0a1018] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="mh-mono text-base font-semibold text-[#edf3fb]">{benchmark.id}</h3>
                    <p className="mt-1 text-sm text-[#9aa8ba]">{benchmark.name}</p>
                  </div>
                  <StatusPill>{benchmark.featureCount} features</StatusPill>
                </div>
                {benchmark.description ? (
                  <p className="mt-4 text-sm leading-6 text-[#9aa8ba]">{benchmark.description}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {benchmark.configurations.map((configuration) => (
                    <span
                      key={configuration}
                      className="mh-mono border border-[#182332] bg-[#080b10] px-2 py-1 text-xs text-[#c7d2df]"
                    >
                      {configuration}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <select
                    value={selection}
                    onChange={(event) => {
                      setSelectionByBenchmark((current) => ({
                        ...current,
                        [benchmark.id]: event.target.value as ConfigSelection
                      }));
                    }}
                    className="border border-[#223044] bg-[#080b10] px-3 py-2 text-sm text-[#edf3fb]"
                  >
                    <option value="all">All configurations</option>
                    {benchmark.configurations.map((configuration) => (
                      <option key={configuration} value={configuration}>
                        {configuration}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={running || runningId !== null}
                    onClick={() => {
                      void handleRun(benchmark);
                    }}
                    className="border border-[#77d7c8]/55 bg-[#77d7c8]/12 px-4 py-2 text-sm font-medium text-[#a7f3e7] disabled:cursor-not-allowed disabled:border-[#2b3a50] disabled:bg-[#101824] disabled:text-[#667387]"
                  >
                    {running ? "Running..." : "Run benchmark"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>

      {runError ? (
        <Panel>
          <StatusPill tone="danger">Run failed</StatusPill>
          <p className="mt-4 text-sm text-[#ffb3b3]">{runError}</p>
        </Panel>
      ) : null}

      {latestReport ? <ReportSummary report={latestReport} /> : null}
    </div>
  );
}

function ReportSummary({ report }: { report: BenchmarkReport }): React.ReactElement {
  const selectedFeatures = useMemo(() => report.featureIds.join(", "), [report.featureIds]);
  const selectedConfigs = useMemo(() => report.configurationIds.join(", "), [report.configurationIds]);

  return (
    <Panel>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <StatusPill tone="accent">BenchmarkReport</StatusPill>
          <h2 className="mt-4 text-xl font-semibold">{report.benchmarkId}</h2>
          <p className="mt-2 text-sm text-[#9aa8ba]">
            Schema {report.metadata.schemaVersion}. Deterministic: {String(report.metadata.deterministic)}.
          </p>
        </div>
        <div className="mh-mono max-w-full overflow-hidden text-xs text-[#667387] md:text-right">
          <div>Report hash</div>
          <div className="mt-1 truncate text-[#c7d2df]">{report.metadata.reportHash ?? "not computed"}</div>
        </div>
      </div>

      <div className="mb-5 grid gap-3 text-sm md:grid-cols-2">
        <div className="border border-[#182332] bg-[#0a1018] p-3">
          <div className="text-xs text-[#667387]">Selected configs</div>
          <div className="mt-1 mh-mono text-[#edf3fb]">{selectedConfigs}</div>
        </div>
        <div className="border border-[#182332] bg-[#0a1018] p-3">
          <div className="text-xs text-[#667387]">Selected features</div>
          <div className="mt-1 mh-mono text-[#edf3fb]">{selectedFeatures}</div>
        </div>
      </div>

      <div className="overflow-x-auto border border-[var(--border-soft)] rounded">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase" style={{ background: "var(--bg-1)", color: "var(--text-2)" }}>
            <tr>
              <th className="px-3 py-3">Configuration</th>
              <th className="px-3 py-3">Runs</th>
              <th className="px-3 py-3">Avg leaves</th>
              <th className="px-3 py-3">Avg batches</th>
              <th className="px-3 py-3">Avg risks</th>
              <th className="px-3 py-3">Gate required</th>
              <th className="px-3 py-3">Scope violations</th>
              <th className="px-3 py-3">Canvas</th>
            </tr>
          </thead>
          <tbody>
            {report.configurations.map((configuration) => (
              <tr key={configuration.configurationId} style={{ borderTop: "1px solid var(--border-soft)" }}>
                <td className="mh-mono px-3 py-3" style={{ color: "var(--coral)" }}>{configuration.configurationId}</td>
                <td className="px-3 py-3">{configuration.runCount}</td>
                <td className="px-3 py-3">{configuration.avgLeafCount}</td>
                <td className="px-3 py-3">{configuration.avgBatchCount}</td>
                <td className="px-3 py-3">{roundDisplay(configuration.avgHighRiskCount + configuration.avgBlockingRiskCount)}</td>
                <td className="px-3 py-3">{configuration.avgGateRequiredCount}</td>
                <td className="px-3 py-3">{configuration.totalScopeViolations}</td>
                <td className="px-3 py-3">
                  <Link
                    href={`/replay/demo?benchmark=${report.benchmarkId}&config=${configuration.configurationId}`}
                    className="mh-mono"
                    style={{
                      fontSize: 12,
                      color: "var(--coral)",
                      textDecoration: "none",
                      whiteSpace: "nowrap"
                    }}
                  >
                    Open canvas →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="mt-5"
        style={{
          padding: 14,
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--r-md)",
          background: "var(--bg-1)"
        }}
      >
        <h3 className="mh-serif" style={{ fontSize: 16, color: "var(--text)", margin: 0 }}>
          Open this run in the DAG canvas
        </h3>
        <p style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-2)" }}>
          Each configuration above can be replayed read-only as a graph with filters, inspector and trace events.
        </p>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {report.configurations.map((configuration) => (
            <Link
              key={configuration.configurationId}
              href={`/replay/demo?benchmark=${report.benchmarkId}&config=${configuration.configurationId}`}
              style={{
                padding: "6px 12px",
                border: "1px solid rgba(204,120,92,0.45)",
                background: "rgba(204,120,92,0.10)",
                color: "var(--coral-hi)",
                fontSize: 12,
                borderRadius: 999,
                fontFamily: "var(--font-mono)"
              }}
            >
              {report.benchmarkId} · {configuration.configurationId} ↗
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Methodological warnings</h3>
        <div className="mt-3 grid gap-2">
          {report.warnings.map((warning) => (
            <div
              key={`${warning.code}:${warning.message}`}
              className="border border-[#f4c36a]/30 bg-[#f4c36a]/8 p-3 text-sm text-[#f4d79d]"
            >
              <span className="mh-mono text-xs text-[#f4c36a]">{warning.code}</span>
              <p className="mt-1 text-[#d9c99f]">{warning.message}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

async function readResponse<T extends object>(response: Response): Promise<T> {
  const payload = await response.json() as T | ApiErrorResponse;

  if (!response.ok) {
    throw new Error("error" in payload ? payload.error : `Request failed with ${response.status}`);
  }

  return payload as T;
}

function roundDisplay(value: number): number {
  return Number(value.toFixed(4));
}
