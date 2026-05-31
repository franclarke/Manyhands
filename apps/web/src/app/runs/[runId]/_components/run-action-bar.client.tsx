"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunStatusKey } from "@/lib/api-types";
import { Button } from "@/components/ui/button";

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
        border: "1px solid var(--rule)",
        background: "rgba(229,222,204,0.018)",
        borderRadius: "var(--r-md)",
        padding: "8px 10px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap"
      }}
    >
      {status === "generating" ? (
        <Button variant="ghost" busy={busy === "pause"} onClick={() => void call("pause")}>
          Pause planning
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button variant="primary" busy={busy === "resume"} onClick={() => void call("resume")}>
          Resume
        </Button>
      ) : null}
      {status === "needs_review" ? (
        <Button variant="primary" busy={busy === "approve-plan"} onClick={() => void call("approve-plan")}>
          Approve plan
        </Button>
      ) : null}
      {status === "approved" ? (
        <Button variant="primary" busy={busy === "run"} onClick={() => void call("run")}>
          Run ready nodes ({readyTaskCount})
        </Button>
      ) : null}
      {status === "running" ? (
        <Button variant="ghost" busy={busy === "pause"} onClick={() => void call("pause")}>
          Pause execution
        </Button>
      ) : null}
      {status === "interrupted" || status === "failed" ? (
        <Button variant="primary" busy={busy === "restart"} onClick={() => void call("restart")}>
          Restart
        </Button>
      ) : null}
      <span className="mh-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
        next action / {status.replace("_", " ")}
      </span>
      <span style={{ flex: 1 }} />
      {errorMessage !== null ? (
        <span className="mh-mono" style={{ color: "var(--error)", fontSize: 12 }}>
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
