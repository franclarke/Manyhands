# Etapa 6 — G6-05-T1-A-r2

Fecha de cierre: 2026-08-02
Condición: A — hoja única forzada
Modelo: Codex CLI / `gpt-5.4-mini` / `medium`

## Verificación

El planning-only `3fc492fc-55b2-4756-82f3-4cb5735e6742` terminó sin aclaración.
La full `d2baaa3f-6775-4b1f-a884-33893602e86a` completó el ciclo y entregó
`a8831b8c1160bd1ce6854be8c7eda3c91791338f` desde la base exacta.

| Campo | Resultado |
|---|---|
| lifecycle | `completed` |
| SHA final | `a8831b8c1160bd1ce6854be8c7eda3c91791338f` |
| hojas | 1 |
| retries automáticos | 0 |
| costo reportado | USD 0.703998 |
| tokens reportados | 156444 |
| criterios externos | 9/10 |
| criterio fallido | `behaviour-backorder-recorded` |

La celda pasa operacionalmente, pero el candidate no expone
`listBackorders`. El fallo se clasifica como genuino y queda preservado en
`external-verdict.json`; no se modifica la evidencia para forzar una pasada.

## Qué no se concluye

- No se concluye PASS completo de A: la cobertura observada es 9/10.
- No se concluye confirmación ni falsación de H-G6.
- No se generaliza esta repetición aislada a la comparación completa.
- No se concluye que el contrato congelado, el oráculo o `minimumAdvantage`
  deban cambiarse.
