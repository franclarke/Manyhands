import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Panel, StatusPill } from "@/components/panel";

export default function LabPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        eyebrow="Lab Mode"
        title="Run deterministic benchmarks over the existing core."
        description="Lab Mode is the controlled evaluation surface for B0-B4 orchestration strategies. It is mock-only and designed for reproducibility, not real agent quality claims."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <StatusPill tone="accent">Active</StatusPill>
          <h2 className="mt-4 text-xl font-semibold">Benchmarks</h2>
          <p className="mt-2 text-sm leading-6 text-[#9aa8ba]">
            Load validated manifests, run mock-v0 or conflict-v0, and inspect BenchmarkReport summaries.
          </p>
          <Link
            href="/lab/benchmarks"
            className="mt-5 inline-flex border border-[#77d7c8]/55 bg-[#77d7c8]/12 px-4 py-2 text-sm font-medium text-[#a7f3e7]"
          >
            Open benchmarks
          </Link>
        </Panel>
        <Panel>
          <StatusPill>Placeholder</StatusPill>
          <h2 className="mt-4 text-xl font-semibold">Reports</h2>
          <p className="mt-2 text-sm leading-6 text-[#9aa8ba]">
            Report persistence and browsing will come after this API-backed foundation.
          </p>
          <Link
            href="/lab/reports"
            className="mt-5 inline-flex border border-[#2b3a50] bg-[#101824] px-4 py-2 text-sm text-[#c7d2df]"
          >
            View placeholder
          </Link>
        </Panel>
      </div>
    </div>
  );
}
