"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Terminal } from "lucide-react";

export interface NodeActivityEntry {
  index: number;
  type: string;
  timestamp: string;
  text: string;
}

/**
 * What the agent behind this node is doing, as it does it.
 *
 * A running node used to be a spinner: the chunks were recorded but nothing
 * read them back, so an operator could not tell a working agent from a stuck
 * one. There is no progress bar here on purpose — the executor reports output,
 * not completion, and a percentage would be invented.
 */
export function NodeActivityPanel({
  runId,
  nodeId,
  running
}: {
  runId: string;
  nodeId: string;
  running: boolean;
}): React.ReactElement {
  const [entries, setEntries] = useState<readonly NodeActivityEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setEntries([]);
    setConnected(false);
    setStartedAt(null);
    const source = new EventSource(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/activity`
    );
    source.onopen = () => setConnected(true);
    source.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as NodeActivityEntry;
        setEntries((current) => [...current, entry].slice(-500));
        if (entry.type === "executor_started") setStartedAt(Date.parse(entry.timestamp));
      } catch {
        // A malformed frame must not take the panel down with it.
      }
    };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [runId, nodeId]);

  useEffect(() => {
    if (startedAt === null || !running) return;
    const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1_000);
    return () => clearInterval(timer);
  }, [startedAt, running]);

  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [entries]);

  const text = entries
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry) => entry.text)
    .join("");
  const finished = entries.some((entry) => entry.type === "executor_completed");

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <Terminal aria-hidden className="h-3.5 w-3.5 text-[var(--color-accent)]" />
        <span className="text-eyebrow uppercase tracking-wide text-[var(--color-text-subtle)]">Actividad del agente</span>
        {running && !finished
          ? <LoaderCircle aria-hidden className="h-3 w-3 animate-spin motion-reduce:animate-none text-[var(--color-text-subtle)]" />
          : null}
        {startedAt !== null && running && !finished
          ? <span className="mh-mono text-micro text-[var(--color-text-subtle)]">{formatElapsed(elapsed)}</span>
          : null}
      </div>
      {text.length === 0 ? (
        <p className="text-micro leading-5 text-[var(--color-text-subtle)]">
          {running
            ? connected
              ? "El agente arrancó y todavía no emitió salida."
              : "Sin conexión con la actividad de este nodo."
            : "Este nodo no registró actividad de agente."}
        </p>
      ) : (
        <pre
          ref={logRef}
          aria-label="Salida del agente"
          tabIndex={0}
          className="mh-mono max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2 text-micro leading-5 text-[var(--color-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {text}
        </pre>
      )}
    </section>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
