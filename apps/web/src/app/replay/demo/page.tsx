import { Panel, StatusPill } from "@/components/panel";
import { RunCanvasShell } from "@/components/dag/RunCanvasShell";
import {
  BenchmarkNotFoundError,
  BenchmarkSelectionError,
  getDemoRunSnapshot
} from "@/lib/server/benchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReplayDemoSearchParams {
  benchmark?: string;
  config?: string;
  feature?: string;
}

interface ReplayDemoPageProps {
  searchParams?: Promise<ReplayDemoSearchParams>;
}

export default async function ReplayDemoPage({
  searchParams
}: ReplayDemoPageProps): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};
  const benchmarkId = params.benchmark ?? "conflict-v0";
  const configId = params.config ?? "B4";
  const featureId = params.feature;

  try {
    const options: Parameters<typeof getDemoRunSnapshot>[0] = {
      benchmarkId,
      config: configId
    };

    if (featureId !== undefined) {
      options.featureId = featureId;
    }

    const snapshot = await getDemoRunSnapshot(options);

    return (
      <div className="mh-fullbleed">
        <RunCanvasShell
          source={{ kind: "deterministic-replay" }}
          snapshot={snapshot}
          benchmarkLabel={benchmarkId}
          configLabel={configId}
          mode="Replay"
        />
      </div>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tone = error instanceof BenchmarkNotFoundError || error instanceof BenchmarkSelectionError
      ? "warning"
      : "danger";

    return (
      <Panel>
        <StatusPill tone={tone}>
          {tone === "warning" ? "Selection error" : "Snapshot failed"}
        </StatusPill>
        <h2 className="mt-4 text-xl font-semibold">Unable to render DAG canvas</h2>
        <p className="mt-2 text-sm text-[#ffb3b3]">{message}</p>
        <p className="mt-4 text-sm text-[#9aa8ba]">
          Try one of the supported combinations:
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-[#9aa8ba]">
          <li>
            <code className="mh-mono text-[#a7f3e7]">/replay/demo?benchmark=conflict-v0&amp;config=B4</code>
          </li>
          <li>
            <code className="mh-mono text-[#a7f3e7]">/replay/demo?benchmark=mock-v0&amp;config=B3</code>
          </li>
        </ul>
      </Panel>
    );
  }
}
