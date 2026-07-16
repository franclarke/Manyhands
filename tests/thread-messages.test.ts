/**
 * Orchestrator thread message-builder (pure projection of the run-model log).
 *
 * Regression guard for the assistant-ui crash "A message with the same id
 * already exists in the parent tree": stable message ids (`decision-<id>`,
 * `conflict-<id>`) recur in the append-only log when a gate or conflict is
 * raised, retried, and raised again for the same target. The builder must emit
 * unique ids regardless.
 */
import { describe, expect, it } from "vitest";
import { buildThreadMessages } from "@/components/chat/thread-messages";
import type { RunEvent, RunEventType } from "@/lib/run-model/types";

let seq = 0;
function ev<T extends RunEventType>(type: T, payload: Record<string, unknown>, at?: string): RunEvent {
  seq += 1;
  return {
    seq,
    at: at ?? new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    runId: "run-1",
    actor: "system",
    type,
    payload
  };
}

describe("buildThreadMessages — id uniqueness", () => {
  it("emits unique message ids when an integration gate is re-raised across a retry", () => {
    seq = 0;
    const events: RunEvent[] = [
      ev("run.created", { intent: "Agregar feature X" }),
      ev("plan.started", {}),
      ev("plan.ready", { nodeCount: 3, seamCount: 1 }),
      // Integration fails → execution gate raised for the composite.
      ev("decision.raised", {
        decisionId: "clarify:composite-a",
        kind: "clarify",
        blocking: true,
        context: { nodeIds: ["composite-a"], question: "La integración falló. ¿Cómo querés continuar?", gate: "merge_conflict" }
      }),
      // Operator picks retry_integration.
      ev("decision.resolved", { decisionId: "clarify:composite-a", choice: { action: "retry_integration" }, actor: "human" }),
      // Retry fails again → SAME gate raised again (same decisionId).
      ev("decision.raised", {
        decisionId: "clarify:composite-a",
        kind: "clarify",
        blocking: true,
        context: { nodeIds: ["composite-a"], question: "La integración volvió a fallar. ¿Cómo querés continuar?", gate: "merge_conflict" }
      })
    ];

    const messages = buildThreadMessages(events);
    const ids = messages.map((m) => m.id);

    expect(new Set(ids).size).toBe(ids.length);
    // Exactly one decision card for the re-raised gate (the model collapses it).
    expect(ids.filter((id) => id === "decision-clarify:composite-a")).toHaveLength(1);
    // Both resolutions remain distinct (keyed by seq).
    expect(ids.filter((id) => id.startsWith("resolved-clarify:composite-a")).length).toBeGreaterThanOrEqual(1);
  });

  it("emits unique message ids when the same conflict is detected on retry", () => {
    seq = 0;
    const conflict = {
      conflictId: "integration:composite-a:conflict",
      dimension: "textual",
      status: "detected",
      nodeIds: ["leaf-a", "leaf-b"],
      files: ["src/shared.ts"],
      autoResolvable: false,
      diagnosisRef: "diagnosis://runs/run-1/integration/composite-a"
    };
    const events: RunEvent[] = [
      ev("run.created", { intent: "Agregar feature X" }),
      ev("conflict.detected", { ...conflict }),
      ev("conflict.detected", { ...conflict })
    ];

    const messages = buildThreadMessages(events);
    const ids = messages.map((m) => m.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "conflict-integration:composite-a:conflict")).toHaveLength(1);
  });

  it("projects scheduling wave selections into an execution wave card", () => {
    seq = 0;
    const events: RunEvent[] = [
      ev("run.created", { intent: "Agregar feature X" }),
      ev("plan.node.proposed", { nodeId: "leaf-api", title: "Actualizar API" }),
      ev("plan.node.proposed", { nodeId: "leaf-ui", title: "Actualizar UI" }),
      ev("run.scheduling.wave_selected", {
        version: 1,
        source: "run-executor",
        waveIndex: 0,
        policy: "risk_aware",
        readyTaskIds: ["leaf-api", "leaf-ui"],
        selectedTaskIds: ["leaf-api"],
        blockedTaskIds: ["leaf-ui"],
        blockedReasons: [
          { taskId: "leaf-ui", reason: "scope compartido", relatedTaskIds: ["leaf-api"], riskLevel: "high" }
        ],
        riskSummary: { low: 0, medium: 0, high: 1, blocking: 0 },
        fallbacks: [],
        warnings: [{ code: "scope-derived", taskIds: ["leaf-api"], message: "scope inferido" }]
      })
    ];

    const messages = buildThreadMessages(events);
    const waveMessage = messages.find((message) => message.id.startsWith("wave-progress-scheduling-"));
    const text = waveMessage?.content[0]?.text ?? "";

    expect(waveMessage).toBeDefined();
    expect(text).toContain("Ola 1 seleccionada por scheduling");
    expect(text).toContain("Seleccionadas: Actualizar API.");
    expect(text).toContain("Bloqueadas para otra ola: Actualizar UI.");
    expect(text).toContain("Actualizar UI: scope compartido (Actualizar API)");
    expect(text).toContain("scope inferido");
  });

  it("labels sparse legacy scheduling events with contiguous human ordinals", () => {
    const events = [46, 139, 201].map((eventSeq, index): RunEvent => ({
      seq: eventSeq,
      at: `2026-06-30T00:0${index}:00.000Z`,
      runId: "run-sparse",
      actor: "system",
      type: "run.scheduling.wave_selected",
      payload: {
        version: 1,
        waveId: `wave-${index + 1}`,
        waveIndex: eventSeq - 1,
        source: "execution-host",
        maxParallel: 6,
        routing: "fixed",
        policy: "risk_aware",
        readyTaskIds: [`leaf-${index}`],
        selectedTaskIds: [`leaf-${index}`],
        blockedTaskIds: [],
        blockedReasons: [],
        riskSummary: { low: 0, medium: 0, high: 0, blocking: 0 },
        fallbacks: [],
        warnings: []
      }
    }));

    const waveText = buildThreadMessages(events)
      .filter((message) => message.id.startsWith("wave-progress-scheduling-"))
      .map((message) => message.content[0]?.text ?? "");
    expect(waveText[0]).toContain("Ola 1 seleccionada");
    expect(waveText[1]).toContain("Ola 2 seleccionada");
    expect(waveText[2]).toContain("Ola 3 seleccionada");
  });
});
