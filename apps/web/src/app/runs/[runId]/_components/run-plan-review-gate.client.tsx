"use client";

import type { PlanReviewSummary } from "@/lib/plan-review";
import { planReviewApprovalState } from "@/lib/plan-review-actions";
import { ModalDialog } from "@/components/ui/modal-dialog";

export function RunPlanReviewGate({
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
  const approvalLabel =
    summary.status === "errors"
      ? "Aprobar igual"
      : summary.status === "warnings"
        ? "Aprobar con advertencias"
        : "Aprobar plan";
  const visibleIssues = summary.issues.slice(0, 8);

  return (
    <ModalDialog ariaLabel="Plan review" onClose={() => { if (!busy) onCancel(); }} width={640} zIndex={70}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="mh-coord">plan review gate</div>
          <div className="mh-serif" style={{ marginTop: 3, color: "var(--text)", fontSize: 22, lineHeight: 1.2 }}>
            {summary.status === "clean"
              ? "Plan listo"
              : summary.status === "errors"
                ? "Revisar errores antes de aprobar"
                : "Revisar advertencias antes de aprobar"}
          </div>
        </div>
        <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>
          Cerrar
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <ReviewMetric label="hojas" value={summary.readiness.totalLeaves} />
        <ReviewMetric label="warnings" value={summary.issueCounts.warnings} />
        <ReviewMetric label="errors" value={summary.issueCounts.errors} />
        <ReviewMetric label="high risk" value={summary.unacknowledgedHighRiskCount} />
      </div>

      <div style={{ border: "1px solid var(--rule)", borderRadius: "var(--r-md)", padding: 12 }}>
        <div className="mh-coord" style={{ color: "var(--copper)", marginBottom: 8 }}>
          actionable issues
        </div>
        {visibleIssues.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 12.5 }}>No se encontraron problemas de review.</p>
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
          Cancelar
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
          {busy ? "Aprobando..." : approvalLabel}
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
