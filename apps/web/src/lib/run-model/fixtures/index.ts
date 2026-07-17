/**
 * Golden fixtures registry. Each fixture is a `RunFixture` (array of `RunEvent`)
 * with the same shape as the future SSE stream, so it reduces identically to live.
 * See docs/design/golden-fixtures.md. This registry reflects the current
 * prototype implementation and must be audited against the target event model.
 */
import type { RunFixture } from "../types";
import { goldenHappyPath } from "./golden-happy-path";
import { goldenPlanningQuestion } from "./golden-planning-question";
import { goldenVerifyAutoRepair } from "./golden-verify-auto-repair";
import { goldenBehavioralConflict } from "./golden-behavioral-conflict";
import { goldenSeamAmendmentBlastRadius } from "./golden-seam-amendment-blast-radius";
import { goldenExecutionFailed } from "./golden-execution-failed";
import { goldenPlanningFallback } from "./golden-planning-fallback";
import { goldenSupportDeskSaas } from "./golden-support-desk-saas";
import { goldenSubscriptionsBillingSaas } from "./golden-subscriptions-billing-saas";
import { goldenDeepImportPipeline } from "./golden-deep-import-pipeline";
import { goldenAppointmentBooking } from "./golden-appointment-booking";

export {
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenVerifyAutoRepair,
  goldenBehavioralConflict,
  goldenSeamAmendmentBlastRadius,
  goldenExecutionFailed,
  goldenPlanningFallback,
  goldenSupportDeskSaas,
  goldenSubscriptionsBillingSaas,
  goldenDeepImportPipeline,
  goldenAppointmentBooking
};

/** Discover fixtures by name. */
export const GOLDEN_FIXTURES = {
  "golden-happy-path": goldenHappyPath,
  "golden-planning-question": goldenPlanningQuestion,
  "golden-verify-auto-repair": goldenVerifyAutoRepair,
  "golden-behavioral-conflict": goldenBehavioralConflict,
  "golden-seam-amendment-blast-radius": goldenSeamAmendmentBlastRadius,
  "golden-execution-failed": goldenExecutionFailed,
  "golden-planning-fallback": goldenPlanningFallback,
  "golden-support-desk-saas": goldenSupportDeskSaas,
  "golden-subscriptions-billing-saas": goldenSubscriptionsBillingSaas,
  "golden-deep-import-pipeline": goldenDeepImportPipeline,
  "golden-appointment-booking": goldenAppointmentBooking
} satisfies Record<string, RunFixture>;

export type GoldenFixtureName = keyof typeof GOLDEN_FIXTURES;

export const GOLDEN_FIXTURE_NAMES = Object.keys(GOLDEN_FIXTURES) as GoldenFixtureName[];

/** Copy and ordering shared by the fixture picker and the `/runs/proto` sidebar. */
export interface FixtureCatalogEntry {
  name: GoldenFixtureName;
  title: string;
  description: string;
}

export const FIXTURE_CATALOG: readonly FixtureCatalogEntry[] = [
  {
    name: "golden-appointment-booking",
    title: "AgendaFácil: reservas de turnos",
    description: "Demo principal para todo público: backend, frontend y operación coordinados por contratos; incluye reparación, enmienda selectiva y conflicto resuelto."
  },
  {
    name: "golden-deep-import-pipeline",
    title: "Atlas Import: pipeline profundo",
    description: "Demo técnica: importación B2B con 9 niveles, contratos encadenados, gates humanos y una integración ascendente visible."
  },
  {
    name: "golden-support-desk-saas",
    title: "SupportFlow: mesa de ayuda SaaS",
    description: "Demo end-to-end: acceso, tickets, comentarios, notificaciones y métricas; incluye repair, decisión y reejecución selectiva."
  },
  {
    name: "golden-subscriptions-billing-saas",
    title: "LedgerCloud: suscripciones y facturación",
    description: "Demo end-to-end: catálogo, checkout, webhooks, facturas y revenue; incluye aclaración de planning y reparación automática de integración."
  },
  {
    name: "golden-happy-path",
    title: "Camino feliz",
    description: "Run exitoso sin conflicto. Recorre las seis fases."
  },
  {
    name: "golden-planning-question",
    title: "Pregunta de planning",
    description: "El planner pide una aclaración; un subárbol espera y el resto conserva su contexto."
  },
  {
    name: "golden-verify-auto-repair",
    title: "Reparación autónoma",
    description: "Una verificación falla y se repara sin interrumpir a la persona operadora."
  },
  {
    name: "golden-behavioral-conflict",
    title: "Conflicto de comportamiento",
    description: "Un desacuerdo semántico sobrevive al merge y requiere una decisión humana."
  },
  {
    name: "golden-seam-amendment-blast-radius",
    title: "Enmienda y blast radius",
    description: "Un cambio de firma invalida solo a los consumidores que realmente dependen de ella."
  },
  {
    name: "golden-execution-failed",
    title: "Fallo terminal",
    description: "Un leaf agota su reparación autónoma y el run termina con un error accionable."
  },
  {
    name: "golden-planning-fallback",
    title: "Planning degradado",
    description: "Un nodo se recupera tras reintentos y otro usa fallback de manera explícita."
  }
];
