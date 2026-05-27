import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Panel, StatusPill } from "@/components/panel";

interface EntryCard {
  title: string;
  description: string;
  href: string;
  badge: string;
}

const ENTRIES: EntryCard[] = [
  {
    title: "Conflict benchmark · B4",
    description: "shared-schema-conflict feature with risk_aware + human_gated_mock scheduling. Best showcase of gate edges and blocking risk.",
    href: "/replay/demo?benchmark=conflict-v0&config=B4",
    badge: "conflict-v0 · B4"
  },
  {
    title: "Conflict benchmark · B2",
    description: "parallel_naive baseline over the same conflict fixture. Useful to compare against B4 gate decisions.",
    href: "/replay/demo?benchmark=conflict-v0&config=B2",
    badge: "conflict-v0 · B2"
  },
  {
    title: "Mock benchmark · B3",
    description: "risk_aware scheduling on the mock-v0 dataset. Cleaner DAG, fewer high-risk edges.",
    href: "/replay/demo?benchmark=mock-v0&config=B3",
    badge: "mock-v0 · B3"
  },
  {
    title: "Mock benchmark · B0",
    description: "sequential_dag baseline. One task at a time, useful as a structural reference.",
    href: "/replay/demo?benchmark=mock-v0&config=B0",
    badge: "mock-v0 · B0"
  }
];

export default function ReplayPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        eyebrow="Replay mode"
        title="Inspect a deterministic RunSnapshot through the DAG canvas."
        description="Replay opens read-only canvases over real RunSnapshots produced by the deterministic mock flow. Persisted run replay arrives in a later phase — for now we surface configurations from the bundled benchmarks."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14
        }}
      >
        {ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="mh-card"
            style={{
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              transition: "border-color 150ms ease-out, transform 150ms ease-out"
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--coral)",
                letterSpacing: 0.4
              }}
            >
              {entry.badge}
            </span>
            <span
              className="mh-serif"
              style={{ fontSize: 18, color: "var(--text)", lineHeight: 1.25 }}
            >
              {entry.title}
            </span>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--text-2)",
                lineHeight: 1.55
              }}
            >
              {entry.description}
            </p>
            <span
              style={{
                marginTop: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)"
              }}
            >
              Open canvas →
            </span>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 22 }}>
        <Panel>
          <StatusPill>Coming later</StatusPill>
          <h2
            className="mh-serif"
            style={{ marginTop: 14, fontSize: 22, color: "var(--text)" }}
          >
            Persisted run replay
          </h2>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            A future phase will list saved runs from <code className="mh-mono">.manyhands/runs</code>{" "}
            and let you replay them by id. For now, every canvas you open is generated on demand by{" "}
            <code className="mh-mono">runBenchmarkMockFlow</code> and is not persisted.
          </p>
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 8
            }}
          >
            {["TaskGraph", "AgentTaskContract", "RunSnapshot", "BenchmarkReport"].map((item) => (
              <div
                key={item}
                style={{
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-1)",
                  padding: "10px 12px",
                  borderRadius: "var(--r-md)"
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--coral)"
                  }}
                >
                  {item}
                </div>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11.5,
                    color: "var(--text-3)",
                    lineHeight: 1.5
                  }}
                >
                  Planned for inspection and thesis demo workflows.
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
