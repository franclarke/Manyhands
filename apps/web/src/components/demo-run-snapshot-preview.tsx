"use client";

import { useEffect, useState } from "react";
import type { RunSnapshot } from "@manyhands/core";
import { toRunGraphViewModel, type RunGraphViewModel } from "@/lib/graph-view-model";
import { Panel, StatusPill } from "@/components/panel";

interface LoadState {
  loading: boolean;
  error: string | null;
  graph: RunGraphViewModel | null;
  snapshot: RunSnapshot | null;
}

export function DemoRunSnapshotPreview(): React.ReactElement {
  const [state, setState] = useState<LoadState>({
    loading: true,
    error: null,
    graph: null,
    snapshot: null
  });

  useEffect(() => {
    let active = true;

    async function loadSnapshot(): Promise<void> {
      try {
        const response = await fetch("/api/demo/run-snapshot?benchmark=conflict-v0&config=B4", {
          cache: "no-store"
        });
        const payload = await response.json() as RunSnapshot | { error: string };

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : `Request failed with ${response.status}`);
        }

        const snapshot = payload as RunSnapshot;

        if (active) {
          setState({
            loading: false,
            error: null,
            snapshot,
            graph: toRunGraphViewModel(snapshot)
          });
        }
      } catch (error) {
        if (active) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            snapshot: null,
            graph: null
          });
        }
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, []);

  if (state.loading) {
    return (
      <Panel>
        <StatusPill tone="warning">Loading demo snapshot</StatusPill>
        <p className="mt-4 text-sm text-[#9aa8ba]">
          Fetching deterministic conflict-v0 / B4 data from the API.
        </p>
      </Panel>
    );
  }

  if (state.error !== null) {
    return (
      <Panel>
        <StatusPill tone="danger">Snapshot load failed</StatusPill>
        <p className="mt-4 text-sm text-[#ffb3b3]">{state.error}</p>
      </Panel>
    );
  }

  if (state.graph === null || state.snapshot === null) {
    return (
      <Panel>
        <StatusPill tone="danger">No snapshot</StatusPill>
        <p className="mt-4 text-sm text-[#ffb3b3]">The demo endpoint did not return a usable RunSnapshot.</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <StatusPill tone="accent">RunSnapshot demo</StatusPill>
          <h2 className="mt-4 text-xl font-semibold">{state.graph.featureId}</h2>
          <p className="mt-2 text-sm text-[#9aa8ba]">
            {state.graph.runId}. Schema {state.snapshot.metadata.schemaVersion}.
          </p>
        </div>
        <StatusPill tone="warning">deterministic mock only</StatusPill>
      </div>

      <div className="mt-5 grid gap-3 text-sm md:grid-cols-5">
        <Metric label="Tasks" value={state.graph.summary.taskCount} />
        <Metric label="Leaves" value={state.graph.summary.leafCount} />
        <Metric label="Dependencies" value={state.graph.summary.dependencyCount} />
        <Metric label="Risks" value={state.graph.summary.riskCount} />
        <Metric label="Trace events" value={state.graph.summary.traceEventCount} />
      </div>

      <div className="mt-6 overflow-x-auto border border-[#182332]">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-[#101824] text-xs text-[#9aa8ba] uppercase">
            <tr>
              <th className="px-3 py-3">Task</th>
              <th className="px-3 py-3">Kind</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Risk</th>
              <th className="px-3 py-3">Expected files</th>
            </tr>
          </thead>
          <tbody>
            {state.graph.nodes.map((node) => (
              <tr key={node.id} className="border-t border-[#182332]">
                <td className="px-3 py-3">
                  <div className="mh-mono text-xs text-[#a7f3e7]">{node.id}</div>
                  <div className="mt-1 text-[#edf3fb]">{node.title}</div>
                </td>
                <td className="px-3 py-3">{node.kind}</td>
                <td className="px-3 py-3">{node.status}</td>
                <td className="px-3 py-3">{node.riskLevel ?? "-"}</td>
                <td className="px-3 py-3 text-[#9aa8ba]">
                  {(node.expectedFiles ?? []).slice(0, 3).join(", ") || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="border border-[#182332] bg-[#0a1018] p-3">
      <div className="text-xs text-[#667387]">{label}</div>
      <div className="mt-1 mh-mono text-lg text-[#edf3fb]">{value}</div>
    </div>
  );
}
