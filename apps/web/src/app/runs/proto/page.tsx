/**
 * Prototype index (PR 06) — a simple fixture picker for `/runs/proto/<fixture>`.
 * Lists the golden fixtures; each links to its agent-first projection prototype.
 */
import Link from "next/link";
import { FIXTURE_CATALOG } from "@/lib/run-model/fixtures";

export default function ProtoIndexPage(): React.ReactElement {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--copper, #d08a5a)"
          }}
        >
          Prototipo · agent-first
        </span>
        <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1, #f1ead8)" }}>Demos del sistema</h1>
        <p style={{ margin: 0, color: "var(--text-2, #cfc7b4)", fontSize: 14 }}>
          Escenarios reproducibles sobre el modelo operativo. Se ejecutan localmente, sin backend ni workspaces reales.
        </p>
      </header>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {FIXTURE_CATALOG.map((fixture) => (
          <li key={fixture.name}>
            <Link
              href={`/runs/proto/${fixture.name}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                background: "var(--surface, #1a1915)",
                border: "1px solid var(--border, rgba(241,234,216,0.12))",
                borderRadius: "var(--r-md, 8px)",
                textDecoration: "none"
              }}
            >
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 14, color: "var(--text-1, #f1ead8)" }}>
                {fixture.title}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-3, #9a927f)" }}>{fixture.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
