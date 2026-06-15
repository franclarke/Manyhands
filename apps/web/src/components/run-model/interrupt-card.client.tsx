"use client";
/**
 * InterruptCard — LangGraph HITL interrupt integration component.
 *
 * Renders a single interrupt from the LangGraph graph as a rich interactive card.
 * Maps interrupt types to the appropriate decision UI:
 *   - planning_question: multi-choice clarification card
 *   - plan_approval: approve/reject plan card with critic findings
 *   - leaf_validation_failed: test failure card with repair option
 *   - merge_conflict: conflict resolution card
 *
 * On submit, calls POST /api/runs/[id]/resume with the user's answer.
 * The component is part of the live run conversational pane (not the fixture demo).
 *
 * Design: docs/design/langgraph-orchestrator-design.md §4 (HITL flow)
 */
import { useState, useTransition } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PlanningQuestionInterrupt {
  type: "planning_question";
  nodeId: string;
  question: string;
  options: string[];
}

export interface PlanApprovalInterrupt {
  type: "plan_approval";
  planCritic: { status: string; findings: Array<{ severity: string; message: string; source: string }> };
  seamCritic: { status: string; findings: Array<{ severity: string; message: string; source: string }> };
  totalFindings: number;
  errorCount: number;
}

export interface LeafValidationInterrupt {
  type: "leaf_validation_failed";
  runId: string;
  taskId: string;
  validationOutput?: string;
  autoRepairAttempted: boolean;
  autoRepairResult?: unknown;
}

export interface MergeConflictInterrupt {
  type: "merge_conflict";
  compositeTaskId: string;
  status: string;
  conflictDetails?: { files: string[]; diff?: string };
}

export type LangGraphInterrupt =
  | PlanningQuestionInterrupt
  | PlanApprovalInterrupt
  | LeafValidationInterrupt
  | MergeConflictInterrupt;

export interface InterruptCardProps {
  runId: string;
  interrupt: LangGraphInterrupt;
  /** Called after the resume API returns successfully. */
  onResolved?: (() => void) | undefined;
}

// ─── InterruptCard ─────────────────────────────────────────────────────────

export function InterruptCard({ runId, interrupt, onResolved }: InterruptCardProps): React.ReactElement {
  switch (interrupt.type) {
    case "planning_question":
      return <PlanningQuestionCard runId={runId} interrupt={interrupt} onResolved={onResolved} />;
    case "plan_approval":
      return <PlanApprovalCard runId={runId} interrupt={interrupt} onResolved={onResolved} />;
    case "leaf_validation_failed":
      return <LeafValidationCard runId={runId} interrupt={interrupt} onResolved={onResolved} />;
    case "merge_conflict":
      return <MergeConflictCard runId={runId} interrupt={interrupt} onResolved={onResolved} />;
  }
}

// ─── Resume API integration ─────────────────────────────────────────────────

async function resumeRun(runId: string, answer: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/runs/${runId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Resume failed: ${response.status}`);
  }
}

// ─── Planning Question Card ────────────────────────────────────────────────

function PlanningQuestionCard({
  runId,
  interrupt,
  onResolved
}: {
  runId: string;
  interrupt: PlanningQuestionInterrupt;
  onResolved?: (() => void) | undefined;
}): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const answer = selected === "__custom__" ? customAnswer : selected;

  const handleSubmit = (): void => {
    if (!answer || answer.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await resumeRun(runId, {
          userAnswers: { [interrupt.nodeId]: answer }
        });
        onResolved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <InterruptCardShell
      type="Pregunta de planificación"
      accent="var(--gated, #d0953a)"
      label={`Nodo: ${interrupt.nodeId}`}
    >
      <p style={{ margin: 0, fontSize: 14, color: "var(--text-1, #f1ead8)", lineHeight: 1.5 }}>
        {interrupt.question}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {interrupt.options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={selected === opt}
            onClick={() => setSelected(opt)}
            style={{
              textAlign: "left",
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${selected === opt ? "var(--copper, #d08a5a)" : "var(--border, rgba(241,234,216,0.12))"}`,
              background: selected === opt ? "rgba(208,138,90,0.14)" : "transparent",
              color: "var(--text-1, #f1ead8)",
              cursor: "pointer",
              fontSize: 13
            }}
          >
            {opt}
          </button>
        ))}

        <button
          type="button"
          aria-pressed={selected === "__custom__"}
          onClick={() => setSelected("__custom__")}
          style={{
            textAlign: "left",
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${selected === "__custom__" ? "var(--copper, #d08a5a)" : "var(--border, rgba(241,234,216,0.12))"}`,
            background: selected === "__custom__" ? "rgba(208,138,90,0.14)" : "transparent",
            color: "var(--text-3, #9a927f)",
            cursor: "pointer",
            fontSize: 13
          }}
        >
          Respuesta personalizada…
        </button>

        {selected === "__custom__" ? (
          <textarea
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            placeholder="Escribe tu respuesta aquí…"
            rows={3}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--border, rgba(241,234,216,0.2))",
              background: "rgba(241,234,216,0.04)",
              color: "var(--text-1, #f1ead8)",
              fontFamily: "inherit",
              fontSize: 13,
              resize: "vertical"
            }}
          />
        ) : null}
      </div>

      {error !== null ? <ErrorLine text={error} /> : null}

      <SubmitButton
        label="Enviar respuesta"
        disabled={!answer || answer.trim().length === 0 || isPending}
        loading={isPending}
        onClick={handleSubmit}
      />
    </InterruptCardShell>
  );
}

// ─── Plan Approval Card ────────────────────────────────────────────────────

function PlanApprovalCard({
  runId,
  interrupt,
  onResolved
}: {
  runId: string;
  interrupt: PlanApprovalInterrupt;
  onResolved?: (() => void) | undefined;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleApprove = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        await resumeRun(runId, { approved: true });
        onResolved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const hasErrors = interrupt.errorCount > 0;
  const accent = hasErrors ? "var(--error, #cf5b5b)" : "var(--gated, #d0953a)";

  return (
    <InterruptCardShell
      type="Aprobación del plan"
      accent={accent}
      label={`${interrupt.totalFindings} hallazgos · ${interrupt.errorCount} errores`}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2, #cfc7b4)" }}>
        El plan está propuesto como hipótesis y listo para iniciar ejecución.
        Revisá las costuras y el DAG antes de aprobar.
      </p>

      {interrupt.totalFindings > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3, #9a927f)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Hallazgos del crítico
          </span>
          {[...interrupt.planCritic.findings, ...interrupt.seamCritic.findings].map((f, i) => (
            <div
              key={i}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                background: f.severity === "error" ? "rgba(207,91,91,0.08)" : "rgba(208,149,58,0.06)",
                border: `1px solid ${f.severity === "error" ? "rgba(207,91,91,0.3)" : "rgba(208,149,58,0.2)"}`,
                fontSize: 12,
                color: f.severity === "error" ? "var(--error, #cf5b5b)" : "var(--text-2, #cfc7b4)"
              }}
            >
              [{f.severity}] {f.message}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--done, #6bbf73)", fontFamily: "var(--font-mono, monospace)" }}>
          ✓ Sin hallazgos del crítico
        </div>
      )}

      {error !== null ? <ErrorLine text={error} /> : null}

      <div style={{ display: "flex", gap: 10 }}>
        <SubmitButton
          label="Aprobar plan →"
          disabled={isPending}
          loading={isPending}
          onClick={handleApprove}
        />
        {hasErrors ? (
          <span style={{ fontSize: 12, color: "var(--error, #cf5b5b)", alignSelf: "center" }}>
            ⚠ Hay errores en el crítico
          </span>
        ) : null}
      </div>
    </InterruptCardShell>
  );
}

// ─── Leaf Validation Card ──────────────────────────────────────────────────

function LeafValidationCard({
  runId,
  interrupt,
  onResolved
}: {
  runId: string;
  interrupt: LeafValidationInterrupt;
  onResolved?: (() => void) | undefined;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAccept = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        await resumeRun(runId, { action: "accept_failing", taskId: interrupt.taskId });
        onResolved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const handleRetry = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        await resumeRun(runId, { action: "retry_repair", taskId: interrupt.taskId });
        onResolved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <InterruptCardShell
      type="Validación fallida"
      accent="var(--error, #cf5b5b)"
      label={`Tarea: ${interrupt.taskId}`}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2, #cfc7b4)" }}>
        {interrupt.autoRepairAttempted
          ? "La auto-reparación falló. La tarea no pasa los tests."
          : "La tarea no pasó la validación."}
      </p>

      {interrupt.validationOutput ? (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(207,91,91,0.06)",
            border: "1px solid rgba(207,91,91,0.2)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            color: "var(--text-2, #cfc7b4)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 200,
            overflow: "auto"
          }}
        >
          {interrupt.validationOutput.slice(0, 2000)}
          {interrupt.validationOutput.length > 2000 ? "\n…(truncado)" : ""}
        </pre>
      ) : null}

      {error !== null ? <ErrorLine text={error} /> : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!interrupt.autoRepairAttempted ? (
          <SubmitButton
            label="Reintentar reparación"
            disabled={isPending}
            loading={isPending}
            onClick={handleRetry}
          />
        ) : null}
        <SubmitButton
          label="Aceptar resultado (con fallo)"
          disabled={isPending}
          loading={isPending}
          onClick={handleAccept}
          secondary
        />
      </div>
    </InterruptCardShell>
  );
}

// ─── Merge Conflict Card ───────────────────────────────────────────────────

function MergeConflictCard({
  runId,
  interrupt,
  onResolved
}: {
  runId: string;
  interrupt: MergeConflictInterrupt;
  onResolved?: (() => void) | undefined;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAccept = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        await resumeRun(runId, { action: "accept_conflict", compositeTaskId: interrupt.compositeTaskId });
        onResolved?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <InterruptCardShell
      type="Conflicto de integración"
      accent="var(--error, #cf5b5b)"
      label={`Composite: ${interrupt.compositeTaskId}`}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2, #cfc7b4)" }}>
        La integración falló con estado <code style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--error, #cf5b5b)" }}>{interrupt.status}</code>.
        La auto-reparación (Composer) no pudo resolver los conflictos.
      </p>

      {interrupt.conflictDetails !== undefined ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-3, #9a927f)" }}>
            Archivos en conflicto:
          </span>
          {interrupt.conflictDetails.files.map((f) => (
            <code
              key={f}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                color: "var(--text-2, #cfc7b4)",
                padding: "2px 6px",
                background: "rgba(241,234,216,0.04)",
                borderRadius: 4
              }}
            >
              {f}
            </code>
          ))}
        </div>
      ) : null}

      {error !== null ? <ErrorLine text={error} /> : null}

      <SubmitButton
        label="Aceptar integración fallida"
        disabled={isPending}
        loading={isPending}
        onClick={handleAccept}
        secondary
      />
    </InterruptCardShell>
  );
}

// ─── Shared sub-components ─────────────────────────────────────────────────

function InterruptCardShell({
  type,
  accent,
  label,
  children
}: {
  type: string;
  accent: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 16px",
        background: "var(--surface, #1a1915)",
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: "var(--r-md, 8px)",
        boxShadow: `0 0 0 1px ${accent}22`
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: accent
          }}
        >
          {type}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-3, #9a927f)" }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function SubmitButton({
  label,
  disabled,
  loading,
  onClick,
  secondary = false
}: {
  label: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  secondary?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 34,
        padding: "0 16px",
        borderRadius: 6,
        border: `1px solid ${secondary ? "var(--rule-control, rgba(241,234,216,0.2))" : "var(--copper, #d08a5a)"}`,
        background: secondary
          ? "rgba(241,234,216,0.04)"
          : disabled
            ? "rgba(208,138,90,0.06)"
            : "rgba(208,138,90,0.16)",
        color: secondary
          ? "var(--text-3, #9a927f)"
          : disabled
            ? "var(--text-4, #6f6857)"
            : "var(--copper-hi, #e0a070)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: loading ? 0.7 : 1,
        transition: "all 150ms ease"
      }}
    >
      {loading ? "Procesando…" : label}
    </button>
  );
}

function ErrorLine({ text }: { text: string }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--error, #cf5b5b)",
        fontFamily: "var(--font-mono, monospace)",
        padding: "4px 8px",
        borderRadius: 4,
        background: "rgba(207,91,91,0.08)"
      }}
    >
      Error: {text}
    </div>
  );
}
