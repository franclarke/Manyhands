# `g6-02-T1-C-r1` — remediation-6

Fecha: 2026-08-01

## Resultado

- Run: `e6442dc5-c1e7-429d-8f6b-b913c06c8ed2`.
- Condición: C, `codex-cli / gpt-5.4-mini / medium`.
- Planning: `needs_approval`, 6 hojas, profundidad máxima 1, branching promedio 6.
- Lifecycle full: `completed`.
- SHA entregado y evaluado: `0447b738edce84aea923dde723169259e4239538`.
- Receipt: `delivery:e6442dc5-c1e7-429d-8f6b-b913c06c8ed2:delivery`.
- Base: `5da60192cc788032c59c7e7be27696ca0e0a30d7`.
- Evaluador externo: `7/10`.

La creación ya no reprodujo el 500 de `run.created`; las hojas llegaron a
candidate, la integración terminó y la entrega fue confirmada. El veredicto
externo es adverso y se preserva exactamente:

| Criterio | Resultado |
|---|---|
| `gate-install` | satisfecho |
| `gate-test` | satisfecho |
| `gate-typecheck` | no satisfecho |
| `gate-build` | no satisfecho |
| `integrity-baseline-tests` | satisfecho |
| `behaviour-express-first` | satisfecho |
| `behaviour-backorder-recorded` | no satisfecho |
| `behaviour-invalid-priority-rejected` | satisfecho |
| `probe-single-json` | satisfecho |
| `probe-deterministic` | satisfecho |

El journal registra `tokensTotal=291539` para seis candidatos de hojas. No
registra `tokensIn`, `tokensOut` ni `costUsd`; el costo monetario no se inventa.
El intervalo del run fue `2026-08-01T07:20:27.825Z`–`2026-08-01T07:39:32.080Z`.

## Qué no se concluye

- No se concluye que C sea superior, igual o inferior a A o B: faltan las
  repeticiones comparables.
- No se concluye que el fix de infraestructura corrija el candidato: el
  evaluador externo siguió observando fallos genuinos de la implementación.
- No se reinterpreta 7/10 como PASS ni se reintenta esta misma celda.
- No se declara costo USD exacto ni se afirma que el tope monetario haya sido
  medido, porque el runtime no emitió `costUsd`.
