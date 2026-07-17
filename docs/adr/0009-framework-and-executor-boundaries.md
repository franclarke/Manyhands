# ADR 0009 — Frameworks y executors como adapters

## Estado

Aceptado.

## Contexto

La arquitectura previa presentaba LangGraph StateGraph, checkpoints, React Flow
y perfiles CLI como si definieran el dominio. Eso dificulta probar y evolucionar
el producto.

## Decisión

TaskGraph, contracts, events, attempts, decisions, artifacts y outcomes no
dependen de frameworks. LangGraph puede adaptar el Run Coordinator; React Flow
puede renderizar el canvas; Claude Code/Codex implementan `AgentExecutor`.

## Alternativas

- **Adoptar tipos del framework como dominio:** menos adapters, alto lock-in.
- **Eliminar frameworks inmediatamente:** pureza a costa de una reescritura.
- **Boundary explícito y migración incremental:** elegida.

## Consecuencias

- Se requieren mappers y puertos claros.
- Cambiar executor modifica config/fingerprint, no schemas del run.
- Checkpoint no sustituye event log.
- La transición evalúa si LangGraph sigue aportando valor antes de reemplazarlo.
