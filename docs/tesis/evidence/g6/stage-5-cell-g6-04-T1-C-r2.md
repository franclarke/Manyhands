# Etapa 5 — G6-04-T1-C-r2

Fecha de cierre: 2026-08-02
Condición: C — política adaptativa
Modelo: Codex CLI / `gpt-5.4-mini` / `medium`

## Verificación

El planning-only `52d089df-99e4-494a-a8ce-c09abb987fd6` pasó sin aclaración y
registró su estrategia. La full `a0f0edba-94e7-4fd7-9405-df62f9be7eda`
completó delivery desde la base exacta.

| Campo | Resultado |
|---|---|
| lifecycle | `completed` |
| SHA final | `a41b4babfaef5d45073ed577af1b27860eb6b615` |
| hojas | 7 + integración |
| retries automáticos | 0 |
| costo reportado de hojas | USD 1.376406 |
| tokens reportados de hojas | 305868 |
| criterios externos | 9/10 |
| criterio fallido | `behaviour-backorder-recorded` |

La celda pasa el chequeo operacional, pero su resultado externo es adverso en
el único criterio semántico de backorders. El fallo es consistente con el de
B-r1 y queda documentado en `remediation-audit-27.md`; no se altera la
evidencia para forzar una pasada.

## Qué no se concluye

- No se concluye PASS completo de C: la cobertura observada es 9/10.
- No se concluye confirmación ni falsación de H-G6.
- No se generaliza esta repetición aislada a la comparación completa.
- No se concluye que el oráculo o el contrato congelado deban cambiarse.
