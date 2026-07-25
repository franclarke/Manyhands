# Progreso — C2 + Warehouse

> **Plan rector:** [`../../../plans/2026-07-24-c2-warehouse-thesis-program.md`](../../../plans/2026-07-24-c2-warehouse-thesis-program.md)
> · **Inicio:** 2026-07-24 · **Estado general:** en ejecución.

## Reglas del ledger

- Un checkpoint requiere documentación, tests/comandos registrados y commit.
- Los cambios conductuales siguen TDD rojo → verde → refactor.
- `pilot` y `final` nunca comparten runs de versiones diferentes.
- Ningún resultado C2 se incorpora a la tesis antes del freeze y los gates.
- No se hace push.

## Checkpoints

| Checkpoint | Tasks | Estado | Commit | Verificación |
|---|---:|---|---|---|
| 1 — C2 core | 1–4 | **in progress** | pending | pending |
| 2 — Productive integration | 5–8 | pending | — | — |
| 3 — Metrics and stability | 9–10 | pending | — | — |
| 4 — Warehouse assets and drivers | 11–12 | pending | — | — |
| 5 — Pilot construction | 13 | pending | — | — |
| 6 — Freeze | 14 | pending | — | — |
| 7 — Final construction and comparison | 15–16 | pending | — | — |
| 8 — Results and thesis | 17–18 | pending | — | — |

## Registro cronológico

### 2026-07-24 — Inicio del checkpoint 1

- Se aceptó ADR 0012 como target de implementación piloto.
- Se preservó C1 como ruta histórica y G5 como resultado formativo negativo.
- Se fijó que Tasks 1–4 cierran juntas antes de integrar C2 al planning
  productivo.
- Siguiente evidencia: regresión roja para métricas de tamaño del índice.
