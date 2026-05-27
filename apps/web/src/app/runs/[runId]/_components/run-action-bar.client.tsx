"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunStatusKey } from "@/lib/api-types";

interface RunActionBarProps {
  runId: string;
  status: RunStatusKey;
  readyTaskCount: number;
}

export function RunActionBar({ runId, status, readyTaskCount }: RunActionBarProps): React.ReactElement | null {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function call(action: "approve-plan" | "run" | "pause" | "resume" | "restart"): Promise<void> {
    setErrorMessage(null);
    setBusy(action);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST"
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  if (status === "completed") {
    return null;
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface)",
        borderRadius: "var(--r-md)",
        padding: "10px 14px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap"
      }}
    >
      {status === "generating" ? (
        <SecondaryButton busy={busy === "pause"} onClick={() => void call("pause")}>
          Pause generation
        </SecondaryButton>
      ) : null}
      {status === "paused" ? (
        <PrimaryButton busy={busy === "resume"} onClick={() => void call("resume")}>
          Resume
        </PrimaryButton>
      ) : null}
      {status === "needs_review" ? (
        <PrimaryButton busy={busy === "approve-plan"} onClick={() => void call("approve-plan")}>
          Approve plan
        </PrimaryButton>
      ) : null}
      {status === "approved" ? (
        <PrimaryButton busy={busy === "run"} onClick={() => void call("run")}>
          Run ready tasks · {readyTaskCount}
        </PrimaryButton>
      ) : null}
      {status === "running" ? (
        <SecondaryButton busy={busy === "pause"} onClick={() => void call("pause")}>
          Pause execution
        </SecondaryButton>
      ) : null}
      {status === "interrupted" || status === "failed" ? (
        <PrimaryButton busy={busy === "restart"} onClick={() => void call("restart")}>
          Restart
        </PrimaryButton>
      ) : null}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-3)",
          letterSpacing: 0.4
        }}
      >
        lifecycle · {status}
      </span>
      <span style={{ flex: 1 }} />
      {errorMessage !== null ? (
        <span style={{ color: "var(--error)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  children,
  busy,
  onClick
}: {
  children: React.ReactNode;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      style={{
        padding: "7px 14px",
        border: "1px solid var(--coral)",
        background: "var(--coral)",
        color: "#1A1915",
        borderRadius: "var(--r-md)",
        fontSize: 13,
        fontWeight: 600,
        cursor: busy ? "not-allowed" : "pointer"
      }}
    >
      {busy ? "…" : children}
    </button>
  );
}

function SecondaryButton({
  children,
  busy,
  onClick
}: {
  children: React.ReactNode;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      style={{
        padding: "6px 12px",
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        color: "var(--text)",
        borderRadius: "var(--r-md)",
        fontSize: 12.5,
        cursor: busy ? "not-allowed" : "pointer"
      }}
    >
      {busy ? "…" : children}
    </button>
  );
}
