"use client";

export interface DiffSide {
  label: string;
  content: string;
}

export function SideBySideDiffViewer({ before, after }: { before: DiffSide; after: DiffSide }): React.ReactElement {
  return (
    <section aria-label="Comparación del candidato" className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-slate-950 text-slate-100">
      <div className="grid grid-cols-2 border-b border-slate-700 bg-slate-900 text-micro font-semibold uppercase tracking-[0.1em] text-slate-300">
        <span className="border-r border-slate-700 px-4 py-2">{before.label}</span>
        <span className="px-4 py-2">{after.label}</span>
      </div>
      <div className="grid max-h-72 grid-cols-2 overflow-auto font-mono text-micro leading-5">
        <DiffColumn content={before.content} tone="before" />
        <DiffColumn content={after.content} tone="after" />
      </div>
    </section>
  );
}

function DiffColumn({ content, tone }: { content: string; tone: "before" | "after" }): React.ReactElement {
  const lines = content.split("\n");
  return (
    <pre className={`min-w-0 whitespace-pre-wrap break-words p-3 ${tone === "before" ? "border-r border-slate-700 bg-red-950/20" : "bg-emerald-950/20"}`}>
      {lines.map((line, index) => (
        <span key={`${index}:${line}`} className="grid grid-cols-[2.5rem_1fr]">
          <span aria-hidden className="select-none pr-3 text-right text-slate-500">{index + 1}</span>
          <span>{line || " "}</span>
        </span>
      ))}
    </pre>
  );
}
