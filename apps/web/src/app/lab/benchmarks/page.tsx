import { BenchmarkRunner } from "@/components/benchmark-runner";
import { PageHeader } from "@/components/page-header";

export default function BenchmarksPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        eyebrow="Lab benchmarks"
        title="Run mock-v0 and conflict-v0 through the existing core."
        description="This screen consumes real API routes over BenchmarkManifest and BenchmarkReport artifacts. All runs are deterministic and mock-only."
      />
      <BenchmarkRunner />
    </div>
  );
}
