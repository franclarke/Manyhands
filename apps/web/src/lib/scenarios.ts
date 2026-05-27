import type { DecompositionMode } from "@manyhands/core";

export interface DecompositionScenario {
  id: string;
  name: string;
  description: string;
  tags: ReadonlyArray<string>;
  benchmarkId: "mock-v0" | "conflict-v0";
  featureId: string;
  supportedGranularities: ReadonlyArray<DecompositionMode>;
  defaultPrompt: string;
}

export const SCENARIOS: ReadonlyArray<DecompositionScenario> = [
  {
    id: "passwordless-login",
    name: "Passwordless login",
    description: "Login con magic link, sesión y tests. Plan limpio, sin conflictos esperados.",
    tags: ["auth", "frontend", "tests"],
    benchmarkId: "mock-v0",
    featureId: "passwordless-login",
    supportedGranularities: ["coarse", "balanced", "fine"],
    defaultPrompt: "Implementar login passwordless con email/magic link, manejo de sesión y tests."
  },
  {
    id: "quote-approval-flow",
    name: "Quote approval flow",
    description: "Flujo de aprobación con estados y permisos. DAG balanceado, varias dependencias.",
    tags: ["workflow", "backend", "frontend"],
    benchmarkId: "mock-v0",
    featureId: "quote-approval-flow",
    supportedGranularities: ["coarse", "balanced", "fine"],
    defaultPrompt: "Agregar un flujo de aprobación de quotes con estados pending/approved/rejected y notificaciones."
  },
  {
    id: "payment-deposit-tracking",
    name: "Payment deposit tracking",
    description: "Tracking de depósitos y reconciliación. Toca DB schema y reportes.",
    tags: ["payments", "schema", "reports"],
    benchmarkId: "mock-v0",
    featureId: "payment-deposit-tracking",
    supportedGranularities: ["coarse", "balanced", "fine"],
    defaultPrompt: "Implementar tracking de depósitos con reconciliación contra el banco y reportes mensuales."
  },
  {
    id: "shared-schema-conflict",
    name: "Shared schema conflict",
    description: "Caso clásico de conflicto: dos cambios sobre el mismo schema. Risk alto/blocking.",
    tags: ["conflict", "schema", "high-risk"],
    benchmarkId: "conflict-v0",
    featureId: "shared-schema-conflict",
    supportedGranularities: ["balanced", "fine"],
    defaultPrompt: "Refactorizar el schema compartido entre auth y billing manteniendo backward-compat."
  }
];

export function getScenario(id: string): DecompositionScenario {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return scenario;
}

export function findScenario(id: string): DecompositionScenario | undefined {
  return SCENARIOS.find((entry) => entry.id === id);
}
