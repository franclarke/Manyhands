/**
 * golden-appointment-booking — the all-audience presentation fixture.
 *
 * AgendaFácil is decomposed into product-readable technical boundaries:
 * backend/domain, customer web, and operational integrations. Every leaf is a
 * concrete implementation unit and the seams form an explainable end-to-end
 * chain from available hours to a confirmed appointment.
 */
import { demoConfig, ev, fixture } from "./_authoring";

const RUN_ID = "golden-appointment-booking";
const BOOKING_API = "seam-booking-api";
const AVAILABILITY_POLICY = "seam-availability-policy";
const AVAILABLE_SLOT = "seam-available-slot";
const BOOKING_CLIENT = "seam-booking-client";
const SELECTED_SLOT = "seam-selected-slot";
const BOOKING_REQUEST = "seam-booking-request";
const RESERVATION_LEASE = "seam-reservation-lease";
const BOOKING_RECEIPT = "seam-booking-receipt";
const REMINDER_JOB = "seam-reminder-job";

const assembled = fixture(RUN_ID, [
  // 1. Frame a product that the whole audience can understand.
  ev("system", "run.created", {
    intent: "Construir AgendaFácil, una aplicación web para consultar horarios, reservar un turno y recibir recordatorios.",
    workspaceId: "ws-agendafacil-demo",
    config: demoConfig
  }),
  ev("system", "run.context.resolved", { repo: "agendafacil-app", baseCommit: "a91d6e4", readiness: "ok" }),
  ev("system", "plan.started", {}),
  ev("system", "plan.node.proposed", { nodeId: "root", parentId: null, role: "root", title: "Construir AgendaFácil", goal: "Entregar una aplicación de turnos completa, verificable y operable.", depth: 0 }),
  ev("system", "plan.node.status", { nodeId: "root", state: "generating", attempt: 1 }),

  // 2. The first split is architectural, but each title retains its product outcome.
  ev("system", "plan.node.proposed", { nodeId: "c-backend", parentId: "root", role: "composite", title: "Motor de reservas · backend", goal: "Implementar contratos, disponibilidad y persistencia segura de reservas.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-customer-web", parentId: "root", role: "composite", title: "Experiencia de reserva · frontend", goal: "Implementar el recorrido web para buscar, reservar y gestionar un turno.", depth: 1 }),
  ev("system", "plan.node.proposed", { nodeId: "c-operations", parentId: "root", role: "composite", title: "Operación · integraciones", goal: "Implementar comunicaciones, agenda interna y auditoría.", depth: 1 }),
  ev("system", "decision.raised", {
    decisionId: "d-cancellation-policy",
    kind: "clarify",
    blocking: true,
    context: {
      nodeIds: ["c-backend", "c-customer-web"],
      question: "¿Hasta cuándo puede una persona cancelar o reprogramar su turno?",
      options: ["Hasta 24 horas antes", "Hasta 2 horas antes", "En cualquier momento"]
    }
  }),
  ev("human", "decision.resolved", {
    decisionId: "d-cancellation-policy",
    choice: { answer: "Hasta 24 horas antes; después debe comunicarse con el negocio." },
    actor: "human"
  }),

  // 3. Backend/domain branch.
  ev("system", "plan.node.proposed", { nodeId: "n-booking-contracts", parentId: "c-backend", role: "leaf", title: "Contratos de reservas", goal: "Definir tipos y operaciones compartidas por backend, frontend e integraciones.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "c-availability", parentId: "c-backend", role: "composite", title: "Servicio de disponibilidad", goal: "Calcular horarios reservables a partir de reglas y excepciones.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "c-booking-workflow", parentId: "c-backend", role: "composite", title: "Flujo transaccional de reserva", goal: "Crear, cancelar y persistir turnos sin duplicaciones.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-business-hours", parentId: "c-availability", role: "leaf", title: "Calcular horarios de atención", goal: "Convertir la agenda semanal del negocio en intervalos reservables.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-calendar-exceptions", parentId: "c-availability", role: "leaf", title: "Aplicar feriados y excepciones", goal: "Excluir cierres, pausas y horarios ya ocupados.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-concurrency-guard", parentId: "c-booking-workflow", role: "leaf", title: "Evitar reservas simultáneas", goal: "Reservar un horario de forma atómica cuando dos personas lo eligen a la vez.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-persist-booking", parentId: "c-booking-workflow", role: "leaf", title: "Persistir la reserva", goal: "Guardar el turno y emitir un comprobante estable.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-cancel-booking", parentId: "c-booking-workflow", role: "leaf", title: "Cancelar o reprogramar", goal: "Aplicar la política acordada de 24 horas y liberar el horario.", depth: 3 }),

  // 4. Customer-facing frontend branch.
  ev("system", "plan.node.proposed", { nodeId: "n-api-client", parentId: "c-customer-web", role: "leaf", title: "Cliente tipado de reservas", goal: "Adaptar el contrato HTTP del backend a operaciones seguras para la interfaz.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "c-booking-journey", parentId: "c-customer-web", role: "composite", title: "Recorrido web de reserva", goal: "Guiar a la persona desde el horario disponible hasta la confirmación.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-manage-booking", parentId: "c-customer-web", role: "leaf", title: "Gestionar mi turno", goal: "Consultar, cancelar o reprogramar una reserva existente.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-slot-selector", parentId: "c-booking-journey", role: "leaf", title: "Selector de fecha y horario", goal: "Mostrar únicamente horarios realmente disponibles.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-booking-form", parentId: "c-booking-journey", role: "leaf", title: "Formulario de reserva", goal: "Capturar nombre y contacto junto con el horario elegido.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-confirmation-view", parentId: "c-booking-journey", role: "leaf", title: "Pantalla de confirmación", goal: "Mostrar número, estado y horario confirmado del turno.", depth: 3 }),

  // 5. Operational branch.
  ev("system", "plan.node.proposed", { nodeId: "c-communications", parentId: "c-operations", role: "composite", title: "Comunicaciones automáticas", goal: "Confirmar la reserva y recordar el turno a tiempo.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-admin-agenda", parentId: "c-operations", role: "leaf", title: "Agenda diaria del negocio", goal: "Mostrar turnos del día y sus estados al equipo operativo.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-audit-log", parentId: "c-operations", role: "leaf", title: "Auditoría de cambios", goal: "Registrar quién creó, reprogramó o canceló cada turno.", depth: 2 }),
  ev("system", "plan.node.proposed", { nodeId: "n-confirmation-email", parentId: "c-communications", role: "leaf", title: "Correo de confirmación", goal: "Enviar el comprobante y programar el recordatorio.", depth: 3 }),
  ev("system", "plan.node.proposed", { nodeId: "n-reminder-scheduler", parentId: "c-communications", role: "leaf", title: "Programar recordatorios", goal: "Enviar un aviso 24 horas antes en la hora local correcta.", depth: 3 }),
  ev("system", "plan.node.status", { nodeId: "root", state: "generated", attempt: 1 }),

  // 6. Concrete seams and dependency edges tell the implementation story.
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-business-hours", toTaskId: "n-calendar-exceptions", type: "logical", inferred: false, rationale: "Las excepciones se aplican sobre los horarios base." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-booking-contracts", toTaskId: "n-api-client", type: "contractual", inferred: false, rationale: "El cliente web implementa el contrato público de reservas." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-api-client", toTaskId: "n-slot-selector", type: "contractual", inferred: false, rationale: "El selector consulta disponibilidad mediante el cliente tipado." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-slot-selector", toTaskId: "n-booking-form", type: "contractual", inferred: false, rationale: "El formulario recibe el horario elegido." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-booking-form", toTaskId: "n-concurrency-guard", type: "contractual", inferred: false, rationale: "La reserva atómica procesa una solicitud validada." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-concurrency-guard", toTaskId: "n-persist-booking", type: "contractual", inferred: false, rationale: "Solo se persiste un horario que fue bloqueado correctamente." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-persist-booking", toTaskId: "n-confirmation-view", type: "contractual", inferred: false, rationale: "La pantalla muestra el comprobante persistido." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-persist-booking", toTaskId: "n-confirmation-email", type: "contractual", inferred: false, rationale: "El correo usa el mismo comprobante canónico." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-confirmation-email", toTaskId: "n-reminder-scheduler", type: "contractual", inferred: false, rationale: "La confirmación crea el trabajo de recordatorio." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-persist-booking", toTaskId: "n-admin-agenda", type: "contractual", inferred: false, rationale: "La agenda interna consume reservas confirmadas." }),
  ev("system", "plan.dependency.proposed", { fromTaskId: "n-persist-booking", toTaskId: "n-audit-log", type: "logical", inferred: false, rationale: "Cada cambio persistido genera evidencia de auditoría." }),

  ev("system", "plan.seam.proposed", { seamId: BOOKING_API, name: "BookingApi", producerNodeId: "n-booking-contracts", consumerNodeIds: ["n-api-client", "n-cancel-booking", "n-admin-agenda"], draftSignature: "BookingApi { availability(query):Promise<AvailabilitySlot[]>; reserve(request):Promise<BookingReceipt>; cancel(id):Promise<BookingReceipt> }" }),
  ev("system", "plan.seam.proposed", { seamId: AVAILABILITY_POLICY, name: "AvailabilityPolicy", producerNodeId: "n-business-hours", consumerNodeIds: ["n-calendar-exceptions"], draftSignature: "AvailabilityPolicy { timezone:string; weeklyHours:Record<Weekday,TimeRange[]> }" }),
  ev("system", "plan.seam.proposed", { seamId: AVAILABLE_SLOT, name: "AvailabilitySlot", producerNodeId: "n-calendar-exceptions", consumerNodeIds: ["n-booking-contracts"], draftSignature: "AvailabilitySlot { startsAt:string; durationMinutes:number; available:boolean }" }),
  ev("system", "plan.seam.proposed", { seamId: BOOKING_CLIENT, name: "BookingClient", producerNodeId: "n-api-client", consumerNodeIds: ["n-slot-selector", "n-manage-booking"], draftSignature: "BookingClient { listSlots(date):Promise<AvailabilitySlot[]>; reserve(input):Promise<BookingReceipt>; cancel(id):Promise<BookingReceipt> }" }),
  ev("system", "plan.seam.proposed", { seamId: SELECTED_SLOT, name: "SelectedSlot", producerNodeId: "n-slot-selector", consumerNodeIds: ["n-booking-form"], draftSignature: "SelectedSlot { startsAt:string; durationMinutes:number }" }),
  ev("system", "plan.seam.proposed", { seamId: BOOKING_REQUEST, name: "BookingRequest", producerNodeId: "n-booking-form", consumerNodeIds: ["n-concurrency-guard"], draftSignature: "BookingRequest { slot:SelectedSlot; customer:{ name:string; email:string } }" }),
  ev("system", "plan.seam.proposed", { seamId: RESERVATION_LEASE, name: "ReservationLease", producerNodeId: "n-concurrency-guard", consumerNodeIds: ["n-persist-booking"], draftSignature: "ReservationLease { slotKey:string; token:string; expiresAt:string }" }),
  ev("system", "plan.seam.proposed", { seamId: BOOKING_RECEIPT, name: "BookingReceipt", producerNodeId: "n-persist-booking", consumerNodeIds: ["n-confirmation-view", "n-manage-booking", "n-confirmation-email", "n-admin-agenda", "n-audit-log"], draftSignature: "BookingReceipt { id:string; startsAt:string; status:'confirmed'|'cancelled'; customerEmail:string }" }),
  ev("system", "plan.seam.proposed", { seamId: REMINDER_JOB, name: "ReminderJob", producerNodeId: "n-confirmation-email", consumerNodeIds: ["n-reminder-scheduler"], draftSignature: "ReminderJob { bookingId:string; recipient:string; sendAt:string }" }),
  ev("system", "plan.ready", { rootId: "root", nodeCount: 23, seamCount: 9, criticFindings: [] }),
  ev("system", "decision.raised", { decisionId: "d-approve-plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-approve-plan", choice: { action: "approve" }, actor: "human" }),

  // 7. Grounding freezes the interfaces before isolated agents start.
  ev("system", "grounding.started", {}),
  ev("system", "skeleton.file.committed", { path: "packages/booking/src/contracts.ts", kind: "impl-stub" }),
  ev("system", "skeleton.file.committed", { path: "apps/web/src/lib/booking-client.ts", kind: "impl-stub" }),
  ev("system", "seam.frozen", { seamId: BOOKING_API, revision: 1, frozenSignature: "BookingApi { availability(query):Promise<AvailabilitySlot[]>; reserve(request):Promise<BookingReceipt>; cancel(id):Promise<BookingReceipt> }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: AVAILABILITY_POLICY, revision: 1, frozenSignature: "AvailabilityPolicy { timezone:string; weeklyHours:Record<Weekday,TimeRange[]> }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: AVAILABLE_SLOT, revision: 1, frozenSignature: "AvailabilitySlot { startsAt:string; durationMinutes:number; available:boolean }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: BOOKING_CLIENT, revision: 1, frozenSignature: "BookingClient { listSlots(date):Promise<AvailabilitySlot[]>; reserve(input):Promise<BookingReceipt>; cancel(id):Promise<BookingReceipt> }", extractedFrom: "apps/web/src/lib/booking-client.ts" }),
  ev("system", "seam.frozen", { seamId: SELECTED_SLOT, revision: 1, frozenSignature: "SelectedSlot { startsAt:string; durationMinutes:number }", extractedFrom: "apps/web/src/features/booking/types.ts" }),
  ev("system", "seam.frozen", { seamId: BOOKING_REQUEST, revision: 1, frozenSignature: "BookingRequest { slot:SelectedSlot; customer:{ name:string; email:string } }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: RESERVATION_LEASE, revision: 1, frozenSignature: "ReservationLease { slotKey:string; token:string; expiresAt:string }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: BOOKING_RECEIPT, revision: 1, frozenSignature: "BookingReceipt { id:string; startsAt:string; status:'confirmed'|'cancelled'; customerEmail:string }", extractedFrom: "packages/booking/src/contracts.ts" }),
  ev("system", "seam.frozen", { seamId: REMINDER_JOB, revision: 1, frozenSignature: "ReminderJob { bookingId:string; recipient:string; sendAt:string }", extractedFrom: "packages/notifications/src/contracts.ts" }),
  ev("system", "scope.derived", { nodeId: "n-booking-contracts", paths: ["packages/booking/src/contracts.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-business-hours", paths: ["packages/booking/src/availability/business-hours.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-calendar-exceptions", paths: ["packages/booking/src/availability/exceptions.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-concurrency-guard", paths: ["packages/booking/src/reservation/slot-lock.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-persist-booking", paths: ["packages/booking/src/reservation/repository.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-cancel-booking", paths: ["packages/booking/src/reservation/cancel.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-api-client", paths: ["apps/web/src/lib/booking-client.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-slot-selector", paths: ["apps/web/src/features/booking/slot-selector.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-booking-form", paths: ["apps/web/src/features/booking/booking-form.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-confirmation-view", paths: ["apps/web/src/features/booking/confirmation.tsx", "apps/web/src/features/booking/booking-status.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-manage-booking", paths: ["apps/web/src/features/booking/manage-booking.tsx", "apps/web/src/features/booking/booking-status.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-confirmation-email", paths: ["packages/notifications/src/booking-confirmation.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-reminder-scheduler", paths: ["packages/notifications/src/booking-reminder.ts"] }),
  ev("system", "scope.derived", { nodeId: "n-admin-agenda", paths: ["apps/web/src/features/admin/daily-agenda.tsx"] }),
  ev("system", "scope.derived", { nodeId: "n-audit-log", paths: ["packages/audit/src/booking-audit.ts"] }),
  ev("system", "wave.planned", { waves: [
    { waveId: "w-foundation", index: 0, nodeIds: ["n-booking-contracts", "n-business-hours", "n-api-client", "n-audit-log"], unlockedBySeams: [BOOKING_API, AVAILABILITY_POLICY, BOOKING_CLIENT, BOOKING_RECEIPT] },
    { waveId: "w-product", index: 1, nodeIds: ["n-calendar-exceptions", "n-slot-selector", "n-manage-booking", "n-admin-agenda"], unlockedBySeams: [AVAILABLE_SLOT, BOOKING_CLIENT, BOOKING_RECEIPT] },
    { waveId: "w-booking", index: 2, nodeIds: ["n-booking-form", "n-concurrency-guard", "n-persist-booking", "n-cancel-booking"], unlockedBySeams: [SELECTED_SLOT, BOOKING_REQUEST, RESERVATION_LEASE, BOOKING_RECEIPT] },
    { waveId: "w-delivery", index: 3, nodeIds: ["n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler"], unlockedBySeams: [BOOKING_RECEIPT, REMINDER_JOB] }
  ] }),
  ev("system", "grounding.completed", { skeletonCommit: "agendafacil-skeleton" }),

  // 8. Four bounded waves. Frozen seams let siblings work independently.
  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-foundation", source: "execution-host", waveIndex: 0, waveOrdinal: 1, maxParallel: 4, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-booking-contracts", "n-business-hours", "n-api-client", "n-audit-log"], selectedTaskIds: ["n-booking-contracts", "n-business-hours", "n-api-client", "n-audit-log"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 3, medium: 1, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-foundation", nodeIds: ["n-booking-contracts", "n-business-hours", "n-api-client", "n-audit-log"] }),
  ev("agent", "node.execution.started", { nodeId: "n-booking-contracts", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.execution.started", { nodeId: "n-business-hours", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.execution.started", { nodeId: "n-api-client", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.execution.started", { nodeId: "n-audit-log", agent: "claude-code-cli", model: "sonnet", waveId: "w-foundation" }),
  ev("agent", "node.verify.passed", { nodeId: "n-booking-contracts", waveId: "w-foundation", commit: "contracts-1", changedFiles: ["packages/booking/src/contracts.ts"], builtAgainst: [], produces: { seamId: BOOKING_API, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-business-hours", waveId: "w-foundation", commit: "hours-1", changedFiles: ["packages/booking/src/availability/business-hours.ts"], builtAgainst: [], produces: { seamId: AVAILABILITY_POLICY, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-api-client", waveId: "w-foundation", commit: "client-1", changedFiles: ["apps/web/src/lib/booking-client.ts"], builtAgainst: [{ seamId: BOOKING_API, revision: 1 }], produces: { seamId: BOOKING_CLIENT, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-audit-log", waveId: "w-foundation", commit: "audit-1", changedFiles: ["packages/audit/src/booking-audit.ts"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-foundation" }),

  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-product", source: "execution-host", waveIndex: 1, waveOrdinal: 2, maxParallel: 4, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-calendar-exceptions", "n-slot-selector", "n-manage-booking", "n-admin-agenda"], selectedTaskIds: ["n-calendar-exceptions", "n-slot-selector", "n-manage-booking", "n-admin-agenda"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 3, medium: 1, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-product", nodeIds: ["n-calendar-exceptions", "n-slot-selector", "n-manage-booking", "n-admin-agenda"] }),
  ev("agent", "node.execution.started", { nodeId: "n-calendar-exceptions", agent: "claude-code-cli", model: "sonnet", waveId: "w-product" }),
  ev("agent", "node.execution.started", { nodeId: "n-slot-selector", agent: "claude-code-cli", model: "sonnet", waveId: "w-product" }),
  ev("agent", "node.execution.started", { nodeId: "n-manage-booking", agent: "claude-code-cli", model: "sonnet", waveId: "w-product" }),
  ev("agent", "node.execution.started", { nodeId: "n-admin-agenda", agent: "claude-code-cli", model: "sonnet", waveId: "w-product" }),
  ev("agent", "node.verify.passed", { nodeId: "n-calendar-exceptions", waveId: "w-product", commit: "exceptions-1", changedFiles: ["packages/booking/src/availability/exceptions.ts"], builtAgainst: [{ seamId: AVAILABILITY_POLICY, revision: 1 }], produces: { seamId: AVAILABLE_SLOT, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-slot-selector", waveId: "w-product", commit: "selector-1", changedFiles: ["apps/web/src/features/booking/slot-selector.tsx"], builtAgainst: [{ seamId: BOOKING_CLIENT, revision: 1 }], produces: { seamId: SELECTED_SLOT, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-manage-booking", waveId: "w-product", commit: "manage-1", changedFiles: ["apps/web/src/features/booking/manage-booking.tsx", "apps/web/src/features/booking/booking-status.tsx"], builtAgainst: [{ seamId: BOOKING_CLIENT, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-admin-agenda", waveId: "w-product", commit: "agenda-1", changedFiles: ["apps/web/src/features/admin/daily-agenda.tsx"], builtAgainst: [{ seamId: BOOKING_API, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-product" }),

  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-booking", source: "execution-host", waveIndex: 2, waveOrdinal: 3, maxParallel: 4, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-booking-form", "n-concurrency-guard", "n-persist-booking", "n-cancel-booking"], selectedTaskIds: ["n-booking-form", "n-concurrency-guard", "n-persist-booking", "n-cancel-booking"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 1, high: 1, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-booking", nodeIds: ["n-booking-form", "n-concurrency-guard", "n-persist-booking", "n-cancel-booking"] }),
  ev("agent", "node.execution.started", { nodeId: "n-booking-form", agent: "claude-code-cli", model: "sonnet", waveId: "w-booking" }),
  ev("agent", "node.execution.started", { nodeId: "n-concurrency-guard", agent: "claude-code-cli", model: "sonnet", waveId: "w-booking" }),
  ev("agent", "node.execution.started", { nodeId: "n-persist-booking", agent: "claude-code-cli", model: "sonnet", waveId: "w-booking" }),
  ev("agent", "node.execution.started", { nodeId: "n-cancel-booking", agent: "claude-code-cli", model: "sonnet", waveId: "w-booking" }),
  ev("agent", "node.verify.passed", { nodeId: "n-booking-form", waveId: "w-booking", commit: "form-1", changedFiles: ["apps/web/src/features/booking/booking-form.tsx"], builtAgainst: [{ seamId: SELECTED_SLOT, revision: 1 }], produces: { seamId: BOOKING_REQUEST, revision: 1 } }),
  ev("agent", "node.verify.iteration", { nodeId: "n-concurrency-guard", waveId: "w-booking", iteration: 1, maxIterations: 3, build: "pass", testsPass: 4, testsTotal: 5 }),
  ev("agent", "node.verify.failed", { nodeId: "n-concurrency-guard", iteration: 1, cause: "Dos solicitudes simultáneas pueden confirmar el mismo horario." }),
  ev("agent", "node.repair.started", { nodeId: "n-concurrency-guard", reason: "Agregar reserva atómica y restricción única por horario." }),
  ev("agent", "node.verify.iteration", { nodeId: "n-concurrency-guard", waveId: "w-booking", iteration: 2, maxIterations: 3, build: "pass", testsPass: 5, testsTotal: 5 }),
  ev("agent", "node.verify.passed", { nodeId: "n-concurrency-guard", waveId: "w-booking", commit: "guard-2", changedFiles: ["packages/booking/src/reservation/slot-lock.ts"], builtAgainst: [{ seamId: BOOKING_REQUEST, revision: 1 }], produces: { seamId: RESERVATION_LEASE, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-persist-booking", waveId: "w-booking", commit: "persist-1", changedFiles: ["packages/booking/src/reservation/repository.ts"], builtAgainst: [{ seamId: RESERVATION_LEASE, revision: 1 }], produces: { seamId: BOOKING_RECEIPT, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-cancel-booking", waveId: "w-booking", commit: "cancel-1", changedFiles: ["packages/booking/src/reservation/cancel.ts"], builtAgainst: [{ seamId: BOOKING_API, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-booking" }),

  ev("system", "run.scheduling.wave_selected", { version: 1, waveId: "w-delivery", source: "execution-host", waveIndex: 3, waveOrdinal: 4, maxParallel: 4, routing: "fixed", policy: "risk_aware", readyTaskIds: ["n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler"], selectedTaskIds: ["n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler"], blockedTaskIds: [], blockedReasons: [], riskSummary: { low: 2, medium: 1, high: 0, blocking: 0 }, fallbacks: [], warnings: [] }),
  ev("system", "wave.opened", { waveId: "w-delivery", nodeIds: ["n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler"] }),
  ev("agent", "node.execution.started", { nodeId: "n-confirmation-view", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.execution.started", { nodeId: "n-confirmation-email", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.execution.started", { nodeId: "n-reminder-scheduler", agent: "claude-code-cli", model: "sonnet", waveId: "w-delivery" }),
  ev("agent", "node.verify.passed", { nodeId: "n-confirmation-view", waveId: "w-delivery", commit: "confirmation-1", changedFiles: ["apps/web/src/features/booking/confirmation.tsx", "apps/web/src/features/booking/booking-status.tsx"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 1 }] }),
  ev("agent", "node.verify.passed", { nodeId: "n-confirmation-email", waveId: "w-delivery", commit: "email-1", changedFiles: ["packages/notifications/src/booking-confirmation.ts"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 1 }], produces: { seamId: REMINDER_JOB, revision: 1 } }),
  ev("agent", "node.verify.passed", { nodeId: "n-reminder-scheduler", waveId: "w-delivery", commit: "reminder-1", changedFiles: ["packages/notifications/src/booking-reminder.ts"], builtAgainst: [{ seamId: REMINDER_JOB, revision: 1 }] }),
  ev("system", "wave.closed", { waveId: "w-delivery" }),

  // 9. The reminder reveals that the receipt is underspecified. Show the blast radius before applying it.
  ev("system", "amendment.proposed", {
    amendmentId: "am-booking-timezone",
    nodeId: "n-reminder-scheduler",
    kind: "seam",
    changeKind: "signature",
    detail: {
      seamId: BOOKING_RECEIPT,
      fromRevision: 1,
      toRevision: 2,
      newSignature: "BookingReceipt { id:string; startsAt:string; timezone:string; status:'confirmed'|'cancelled'; customerEmail:string }"
    },
    affects: ["n-persist-booking", "n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler", "n-admin-agenda", "n-audit-log", "c-booking-workflow", "c-backend", "c-booking-journey", "c-customer-web", "c-communications", "c-operations", "root"],
    diagnosisRef: "blob://golden-appointment-booking/amendments/booking-timezone"
  }),
  ev("system", "decision.raised", { decisionId: "d-booking-timezone", kind: "approve_amendment", blocking: true, context: { amendmentId: "am-booking-timezone", seamId: BOOKING_RECEIPT, nodeIds: ["n-persist-booking", "n-reminder-scheduler"] } }),
  ev("human", "decision.resolved", { decisionId: "d-booking-timezone", choice: { action: "approve" }, actor: "human" }),
  ev("system", "seam.amended", { seamId: BOOKING_RECEIPT, revision: 2, changeKind: "signature", signature: "BookingReceipt { id:string; startsAt:string; timezone:string; status:'confirmed'|'cancelled'; customerEmail:string }" }),
  ev("system", "amendment.applied", { amendmentId: "am-booking-timezone" }),

  // 10. Only the producer and affected consumers run again.
  ev("agent", "node.execution.started", { nodeId: "n-persist-booking", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-persist-booking", commit: "persist-2", changedFiles: ["packages/booking/src/reservation/repository.ts"], builtAgainst: [{ seamId: RESERVATION_LEASE, revision: 1 }], produces: { seamId: BOOKING_RECEIPT, revision: 2 } }),
  ev("agent", "node.execution.started", { nodeId: "n-confirmation-view", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-confirmation-view", commit: "confirmation-2", changedFiles: ["apps/web/src/features/booking/confirmation.tsx", "apps/web/src/features/booking/booking-status.tsx"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("agent", "node.execution.started", { nodeId: "n-confirmation-email", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-confirmation-email", commit: "email-2", changedFiles: ["packages/notifications/src/booking-confirmation.ts"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 2 }], produces: { seamId: REMINDER_JOB, revision: 1 } }),
  ev("agent", "node.execution.started", { nodeId: "n-reminder-scheduler", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-reminder-scheduler", commit: "reminder-2", changedFiles: ["packages/notifications/src/booking-reminder.ts"], builtAgainst: [{ seamId: REMINDER_JOB, revision: 1 }] }),
  ev("agent", "node.execution.started", { nodeId: "n-admin-agenda", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-admin-agenda", commit: "agenda-2", changedFiles: ["apps/web/src/features/admin/daily-agenda.tsx"], builtAgainst: [{ seamId: BOOKING_API, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("agent", "node.execution.started", { nodeId: "n-audit-log", agent: "claude-code-cli", model: "sonnet", reason: "amendment:booking-timezone" }),
  ev("agent", "node.verify.passed", { nodeId: "n-audit-log", commit: "audit-2", changedFiles: ["packages/audit/src/booking-audit.ts"], builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 2 }] }),

  // 11. Bottom-up integration, including one visible structural conflict repaired by the system.
  ev("system", "integration.started", { compositeNodeId: "c-availability", childNodeIds: ["n-business-hours", "n-calendar-exceptions"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-availability", testsPass: 8, testsTotal: 8, passed: true, builtAgainst: [{ seamId: AVAILABILITY_POLICY, revision: 1 }, { seamId: AVAILABLE_SLOT, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-availability", commit: "availability-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-booking-workflow", childNodeIds: ["n-concurrency-guard", "n-persist-booking", "n-cancel-booking"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-booking-workflow", testsPass: 17, testsTotal: 17, passed: true, builtAgainst: [{ seamId: BOOKING_REQUEST, revision: 1 }, { seamId: RESERVATION_LEASE, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-booking-workflow", commit: "booking-workflow-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-backend", childNodeIds: ["n-booking-contracts", "c-availability", "c-booking-workflow"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-backend", testsPass: 25, testsTotal: 25, passed: true, builtAgainst: [{ seamId: BOOKING_API, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-backend", commit: "backend-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-booking-journey", childNodeIds: ["n-slot-selector", "n-booking-form", "n-confirmation-view"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-booking-journey", testsPass: 14, testsTotal: 14, passed: true, builtAgainst: [{ seamId: BOOKING_CLIENT, revision: 1 }, { seamId: SELECTED_SLOT, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-booking-journey", commit: "journey-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-customer-web", childNodeIds: ["n-api-client", "c-booking-journey", "n-manage-booking"] }),
  ev("system", "conflict.detected", { conflictId: "cf-booking-status-view", dimension: "structural", status: "detected", nodeIds: ["n-confirmation-view", "n-manage-booking"], files: ["apps/web/src/features/booking/booking-status.tsx"], autoResolvable: true, diagnosisRef: "blob://golden-appointment-booking/conflicts/booking-status-view" }),
  ev("system", "conflict.resolved", { conflictId: "cf-booking-status-view", by: "system", resolutionId: "compose-shared-booking-status" }),
  ev("system", "integration.validated", { compositeNodeId: "c-customer-web", testsPass: 22, testsTotal: 22, passed: true, builtAgainst: [{ seamId: BOOKING_CLIENT, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-customer-web", commit: "customer-web-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-communications", childNodeIds: ["n-confirmation-email", "n-reminder-scheduler"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-communications", testsPass: 9, testsTotal: 9, passed: true, builtAgainst: [{ seamId: BOOKING_RECEIPT, revision: 2 }, { seamId: REMINDER_JOB, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-communications", commit: "communications-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "c-operations", childNodeIds: ["c-communications", "n-admin-agenda", "n-audit-log"] }),
  ev("system", "integration.validated", { compositeNodeId: "c-operations", testsPass: 16, testsTotal: 16, passed: true, builtAgainst: [{ seamId: BOOKING_API, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }] }),
  ev("system", "integration.completed", { compositeNodeId: "c-operations", commit: "operations-1", status: "success" }),
  ev("system", "integration.started", { compositeNodeId: "root", childNodeIds: ["c-backend", "c-customer-web", "c-operations"] }),
  ev("system", "integration.validated", { compositeNodeId: "root", testsPass: 52, testsTotal: 52, passed: true, builtAgainst: [{ seamId: BOOKING_API, revision: 1 }, { seamId: BOOKING_RECEIPT, revision: 2 }, { seamId: REMINDER_JOB, revision: 1 }] }),
  ev("system", "integration.completed", { compositeNodeId: "root", commit: "agendafacil-1", status: "success" }),

  // 12. Evidence and final human disposition.
  ev("system", "run.evidence.ready", {
    aggregateDiffRef: "blob://golden-appointment-booking/diff",
    tests: { pass: 52, total: 52 },
    narrativeRef: "blob://golden-appointment-booking/narrative",
    integrationCommit: "agendafacil-1",
    invalidationTrace: [{
      seamId: BOOKING_RECEIPT,
      from: 1,
      to: 2,
      cause: "Los recordatorios necesitan la zona horaria del negocio.",
      reExecuted: ["n-persist-booking", "n-confirmation-view", "n-confirmation-email", "n-reminder-scheduler", "n-admin-agenda", "n-audit-log"],
      reIntegrated: ["c-booking-workflow", "c-backend", "c-booking-journey", "c-customer-web", "c-communications", "c-operations", "root"],
      preserved: ["n-business-hours", "n-calendar-exceptions", "n-api-client", "n-slot-selector", "n-booking-form", "n-concurrency-guard", "n-cancel-booking", "n-manage-booking"]
    }]
  }),
  ev("system", "decision.raised", { decisionId: "d-merge", kind: "approve_merge", blocking: true, context: { diffRef: "blob://golden-appointment-booking/diff", nodeIds: ["root"] } }),
  ev("human", "decision.resolved", { decisionId: "d-merge", choice: { action: "accept" }, actor: "human" }),
  ev("system", "run.completed", { status: "success" }),
  ev("system", "run.metrics.ready", { metrics: { depth: 3, leafCount: 15, compositeCount: 8, avgLeafDepth: 2.67, maxLeafDepth: 3, dependencyCount: 11, avgAcceptanceCriteriaPerLeaf: 3, estimatedTokensPerLeaf: 2400, integrationSuccessRate: 1, leafSuccessRate: 1, conflictRate: 0.067, totalDurationMs: 248000, linesChanged: 1460, unexpectedCommitCount: 0, scopeViolationCount: 0, totalCostUsd: 2.48, testsPassedRate: 1 } })
]);

export const goldenAppointmentBooking = {
  ...assembled,
  playback: {
    delaysMs: assembled.events.map((event) => {
      if (event.type === "decision.raised") return 3400;
      if (event.type === "plan.node.proposed") return 1050;
      if (event.type === "plan.seam.proposed" || event.type === "seam.frozen") return 1200;
      if (event.type === "node.verify.failed" || event.type === "node.repair.started") return 2500;
      if (event.type === "amendment.proposed" || event.type === "seam.amended") return 2800;
      if (event.type === "conflict.detected" || event.type === "conflict.resolved") return 2500;
      if (event.type.startsWith("integration.")) return 1300;
      return 700;
    })
  }
};
