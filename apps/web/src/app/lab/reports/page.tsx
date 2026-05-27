import { PageHeader } from "@/components/page-header";
import { Panel, StatusPill } from "@/components/panel";

export default function ReportsPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        eyebrow="Lab reports"
        title="Report browsing is reserved for a later phase."
        description="This foundation can return BenchmarkReport artifacts from a benchmark run, but it does not persist or index reports yet."
      />
      <Panel>
        <StatusPill>Not persisted yet</StatusPill>
        <h2 className="mt-4 text-xl font-semibold">Planned artifacts</h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-[#9aa8ba]">
          <li>BenchmarkReport history with schema version and report hash.</li>
          <li>Links from reports to saved RunSnapshot artifacts.</li>
          <li>Comparison views for B0-B4 and future real-runner pilots.</li>
        </ul>
      </Panel>
    </div>
  );
}
