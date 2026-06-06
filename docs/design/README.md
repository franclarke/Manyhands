# Rediseño agent-first de ManyHands — documentación de diseño

> Estado: **baseline de diseño** (2026-06-05). Estos documentos son la fuente de verdad para reconstruir ManyHands hacia un sistema agent-first. El plan de ejecución por PRs ya está escrito: ver [`implementation-plan.md`](implementation-plan.md).
>
> **Implementación en curso (fixture-first):** PR01–PR09 ✅ + **PR-U1 ✅** (foco polimórfico + evidencia + hardening). El prototipo agent-first vive en `/runs/proto/<fixture>` — la demo fixture-first más completa, ahora con foco on-demand (node/seam/conflict/decision/evidence) y deep-link `?focus=<kind>:<id>`, sin backend. Backend/SSE real (PR11+) todavía pendiente. Estado real, matriz PR01–14 y próximo paso: ver [`implementation-status.md`](implementation-status.md).

Esta carpeta nace de una serie de discusiones de diseño y dos *stress tests* del modelo operativo. Reemplaza conceptualmente la dirección anterior (UI plan-céntrica / dashboard-like) por una **sala de control continua** para orquestar múltiples coding agents trabajando en paralelo sobre un DAG vivo.

## Orden de lectura

| # | Documento | Rol |
|---|-----------|-----|
| 1 | [`agent-first-redesign.md`](agent-first-redesign.md) | Visión. Qué estamos construyendo y por qué. La experiencia objetivo. |
| 2 | [`run-operative-model.md`](run-operative-model.md) | **Núcleo técnico.** Event log, entidades, reducer, selectores, invariantes. Base directa para `runStore`. |
| 3 | [`interaction-model.md`](interaction-model.md) | UX/producto. Cómo se vive un run de punta a punta. |
| 4 | [`system-components.md`](system-components.md) | Piezas conceptuales de producto/arquitectura y cómo colaboran. |
| 5 | [`evolution-and-rationale.md`](evolution-and-rationale.md) | Registro histórico. Por qué cambiamos. |
| 6 | [`golden-fixtures.md`](golden-fixtures.md) | Los fixtures golden que validan el modelo antes del backend. |
| 7 | [`implementation-readiness.md`](implementation-readiness.md) | Puente al plan de implementación. Qué está congelado, qué falta, riesgos. |
| 8 | [`implementation-plan.md`](implementation-plan.md) | **Plan ejecutable por PRs** (01–14): diagnóstico del repo, fases, PRs concretos, dependencias, trazabilidad, testing, v1. |
| 9 | [`implementation-status.md`](implementation-status.md) | **Estado vivo** tras PR01–PR09: matriz de PRs, alineación con la visión, hallazgos técnicos, gaps, decisiones de implementación y recomendación del próximo PR (PR-U1 Ultracode). |

## Conceptos clave (glosario rápido)

- **Sala de control continua** — un único run que *madura* a través de fases; no pantallas separadas.
- **U de involucramiento humano** — alto al inicio (autoría + juicio), bajo en el medio (supervisión ambiente), alto al final (arbitraje + aceptación).
- **Fases como centros de gravedad** — Framing · Proposal · Foundation · Supervision · Reconciliation · Disposition. Se solapan en el tiempo.
- **Event log append-only** = fuente de verdad dinámica. Todo estado visible es **derivado**.
- **Seam** — contrato entre nodos; lo que *fabrica* el paralelismo seguro. Tiene `signature`, `contract?` y `revision`.
- **Verify-loop** — un leaf "anda" cuando pasa sus tests, no cuando produjo un diff.
- **Freshness** — eje derivado ortogonal al `ExecutionState`: un nodo `integrated` puede quedar `stale` por una enmienda de seam.
- **Decision** — recurso unificado para toda intervención humana.

## Estado de las decisiones

Congelado: el modelo operativo con los refinamientos **A–P** (ver [`run-operative-model.md`](run-operative-model.md#refinamientos-congelados-ap) y [`evolution-and-rationale.md`](evolution-and-rationale.md)). Validado por los stress tests `golden-behavioral-conflict` y `golden-seam-amendment-blast-radius`.

Relación con las decisiones cerradas del producto (D1–D10) y la arquitectura de ejecución: ver [`../DECISIONS.md`](../DECISIONS.md). Este rediseño es de la **capa de orquestación + experiencia**; no renegocia D1–D10.
