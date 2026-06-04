"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RunStatusKey } from "@/lib/api-types";
import type { PlanReviewSummary } from "@/lib/plan-review";
import { planReviewApprovalState } from "@/lib/plan-review-actions";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { OPEN_CONFLICT_REVIEW_EVENT } from "@/components/dag/conflict-bottom-sheet.client";

interface RunActionBarProps {
  runId: string;
  status: RunStatusKey;
  readyTaskCount: number;
  activeConflictCount: number;
  planReview: PlanReviewSummary | null;
}

export function RunActionBar({
  runId,
  status,
  readyTaskCount,
  activeConflictCount,
  planReview
}: RunActionBarProps): React.ReactElement | null {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reviewErrorMessage, setReviewErrorMessage] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function call(action: "approve-plan" | "run" | "pause" | "resume" | "restart" | "auto-resolve"): Promise<void> {
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

  async function approveFromReview(): Promise<void> {
    setErrorMessage(null);
    setReviewErrorMessage(null);
    setBusy("approve-plan");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/approve-plan`, {
        method: "POST"
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }
      setReviewOpen(false);
      router.refresh();
    } catch (error) {
      setReviewErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function openConflictReview(): void {
    window.dispatchEvent(new Event(OPEN_CONFLICT_REVIEW_EVENT));
  }

  if (status === "completed") {
    return null;
  }

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        background: "rgba(241,234,216,0.035)",
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
        <Button
          variant="primary"
          busy={busy === "approve-plan"}
          onClick={() => {
            if (planReview !== null) {
              setReviewErrorMessage(null);
              setReviewOpen(true);
              return;
            }
            void call("approve-plan");
          }}
        >
          Approve plan
        </Button>
      ) : null}
      {activeConflictCount > 0 && (status === "needs_review" || status === "approved") ? (
        <>
          <Button variant="primary" busy={busy === "auto-resolve"} onClick={() => void call("auto-resolve")}>
            Auto-resolve conflicts ({activeConflictCount})
          </Button>
          <Button variant="ghost" onClick={openConflictReview}>
            Review conflicts ({activeConflictCount})
          </Button>
        </>
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
      <span className="mh-mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
        next action / {status.replace("_", " ")}
      </span>
      <span style={{ flex: 1 }} />
      {errorMessage !== null ? (
        <span className="mh-mono" style={{ color: "var(--error)", fontSize: 12 }}>
          {errorMessage}
        </span>
      ) : null}
      {reviewOpen && planReview !== null ? (
        <PlanReviewModal
          summary={planReview}
          busy={busy === "approve-plan"}
          errorMessage={reviewErrorMessage}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => void approveFromReview()}
        />
      ) : null}
    </div>
  );
}

function PlanReviewModal({
  summary,
  busy,
  errorMessage,
  onCancel,
  onConfirm
}: {
  summary: PlanReviewSummary;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const approvalState = planReviewApprovalState(summary);
  const visibleIssues = summary.issues.slice(0, 7);
  return (
    <ModalDialog ariaLabel="Plan review" onClose={() => { if (!busy) onCancel(); }} width={640} zIndex={60}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div className="mh-coord">plan review gate</div>
            <div className="mh-serif" style={{ marginTop: 3, color: "var(--text)", fontSize: 22, lineHeight: 1.2 }}>
              {summary.status === "clean"
                ? "Plan looks ready"
                : summary.status === "errors"
                  ? "Resolve errors before approval"
                  : "Review before approval"}
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>
            Close
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <ReviewMetric label="leaves" value={summary.readiness.totalLeaves} />
          <ReviewMetric label="warnings" value={summary.issueCounts.warnings} />
          <ReviewMetric label="errors" value={summary.issueCounts.errors} />
          <ReviewMetric label="high risk" value={summary.unacknowledgedHighRiskCount} />
        </div>

        <div style={{ border: "1px solid var(--rule)", borderRadius: "var(--r-md)", padding: 12 }}>
          <div className="mh-coord" style={{ color: "var(--copper)", marginBottom: 8 }}>
            readiness
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 16px", fontSize: 12 }}>
            <ReviewRow label="Contracts" value={`${summary.readiness.contractReadyLeaves}/${summary.readiness.totalLeaves}`} />
            <ReviewRow label="Scopes" value={`${summary.readiness.scopeReadyLeaves}/${summary.readiness.totalLeaves}`} />
            <ReviewRow label="Acceptance" value={`${summary.readiness.acceptanceReadyLeaves}/${summary.readiness.totalLeaves}`} />
            <ReviewRow label="Expected output" value={`${summary.readiness.expectedOutputReadyLeaves}/${summary.readiness.totalLeaves}`} />
          </div>
        </div>

        <div style={{ border: "1px solid var(--rule)", borderRadius: "var(--r-md)", padding: 12 }}>
          <div className="mh-coord" style={{ color: "var(--copper)", marginBottom: 8 }}>
            plan edits
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PatchTag label="node edits" value={summary.patchCounts.humanEdits} />
            <PatchTag label="regens" value={summary.patchCounts.subtreeRegenerations} />
            <PatchTag label="deps +" value={summary.patchCounts.dependenciesAdded} />
            <PatchTag label="deps -" value={summary.patchCounts.dependenciesRemoved} />
            <PatchTag label="integrators" value={summary.patchCounts.integratorsAdded} />
            <PatchTag label="risk ack" value={summary.patchCounts.riskAcknowledgements} />
          </div>
        </div>

        <div style={{ border: "1px solid var(--rule)", borderRadius: "var(--r-md)", padding: 12 }}>
          <div className="mh-coord" style={{ color: "var(--copper)", marginBottom: 8 }}>
            actionable issues
          </div>
          {visibleIssues.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: 12.5 }}>No review issues found.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleIssues.map((issue, index) => (
                <div key={`${issue.kind}-${issue.title}-${index}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span className="mh-dot" style={{ color: issue.severity === "error" ? "var(--error)" : "var(--ready)", marginTop: 6 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "var(--text)", fontSize: 12.5, fontWeight: 700 }}>
                      {issue.title}{issue.taskId !== undefined ? ` / ${issue.taskId}` : ""}
                    </div>
                    <div style={{ color: "var(--text-2)", fontSize: 12.5, lineHeight: 1.5 }}>{issue.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {errorMessage !== null ? (
          <div
            style={{
              border: "1px solid rgba(178,106,96,0.35)",
              background: "rgba(178,106,96,0.08)",
              color: "var(--error)",
              borderRadius: "var(--r-md)",
              padding: "9px 10px",
              fontSize: 12,
              lineHeight: 1.45
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || approvalState.disabled}
            style={{
              ...primaryButtonStyle,
              opacity: approvalState.disabled ? 0.58 : 1,
              cursor: approvalState.disabled ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Approving..." : approvalState.label}
          </button>
        </div>
    </ModalDialog>
  );
}

function ReviewMetric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: "var(--r-md)", padding: "9px 10px" }}>
      <div className="mh-mono" style={{ color: "var(--text)", fontSize: 18 }}>
        {value}
      </div>
      <div className="mh-coord" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span className="mh-mono" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function PatchTag({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <span className="mh-mono" style={{ border: "1px solid var(--rule)", borderRadius: 5, padding: "4px 7px", color: "var(--text-2)", fontSize: 11 }}>
      {value} {label}
    </span>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--rule-control)",
  background: "rgba(241,234,216,0.035)",
  color: "var(--text)",
  borderRadius: 5,
  minHeight: 36,
  padding: "0 12px",
  cursor: "pointer",
  fontSize: 12.5
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--copper)",
  background: "rgba(208,138,90,0.16)",
  color: "var(--copper-hi)",
  borderRadius: 5,
  minHeight: 36,
  padding: "0 13px",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 600
};
