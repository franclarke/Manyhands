/**
 * Prototype index (PR 06) — a simple fixture picker for `/runs/proto/<fixture>`.
 * Lists the golden fixtures; each links to its agent-first projection prototype.
 */
import Link from "next/link";
import { GOLDEN_FIXTURE_NAMES, type GoldenFixtureName } from "@/lib/run-model/fixtures";

const DESCRIPTIONS: Record<GoldenFixtureName, string> = {
  "golden-happy-path": "Run exitoso sin conflicto. Recorre las seis fases.",
  "golden-planning-question": "El planner pregunta (clarify); un subárbol espera, el resto sigue.",
  "golden-verify-auto-repair": "Falla de verificación reparada sola — sin atención humana.",
  "golden-behavioral-conflict": "Conflicto de comportamiento que sobrevive al congelado; enmienda de contrato.",
  "golden-seam-amendment-blast-radius": "Enmienda de firma que invalida consumidores río abajo (blast radius).",
  "golden-execution-failed": "Falla terminal de un leaf tras agotar el repair autónomo; el run termina en error.",
  "golden-planning-fallback": "Robustez de planning: un nodo reintenta y se recupera; otro cae a fallback (degradado pero usable)."
};

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
        <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1, #f1ead8)" }}>Golden fixtures</h1>
        <p style={{ margin: 0, color: "var(--text-2, #cfc7b4)", fontSize: 14 }}>
          Reproducción fixture-first sobre el modelo operativo (runStore + reducer + selectores). Sin backend.
        </p>
      </header>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {GOLDEN_FIXTURE_NAMES.map((name) => (
          <li key={name}>
            <Link
              href={`/runs/proto/${name}`}
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
                {name}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-3, #9a927f)" }}>{DESCRIPTIONS[name]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
