# ADR 0006 — Run Coordinator durable y estado derivado

## Estado

Aceptado.

## Contexto

Snapshots JSON, checkpoints de LangGraph, estados de UI y events podían
contradecirse. Además, tareas background sin autoridad durable podían persistir
resultados después de cancelación o takeover.

## Decisión

El event log de dominio contiene hechos ordenados. Snapshots materializan un
cursor. El Run Coordinator es el único actor que adopta resultados y avanza
outcomes. Las operaciones usan leases y fencing; logs/checkpoints son mecanismos
separados.

## Alternativas

- **Snapshot mutable como verdad:** lectura simple, auditoría y concurrencia
  frágiles.
- **Checkpoints del framework como historia:** acopla dominio y motor.
- **Event log + snapshots + leases:** elegida.

## Consecuencias

- Se necesitan schema/versioning, replay e idempotencia.
- La UI puede compartir reducer con fixtures.
- Cancelación y takeover tienen semántica comprobable.
- Persistencia JSON puede seguir temporalmente si implementa el contrato; una DB
  no es requisito arquitectónico inmediato.
