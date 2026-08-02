# Etapa 7 — G6-06-T1-B-r2

Fecha de cierre: 2026-08-02  
Condicion: B — hoja unica forzada  
Modelo: Codex CLI / `gpt-5.4-mini` / `medium`

## Verificacion

La ejecucion oficial de B no pudo cerrar inicialmente por una omision de
intencion de acceptance (`required`). La serie de remediacion se preserva
completa: `remediation-29` corrigio el timeout de planning; `remediation-31`
corrigio el conflicto de artefactos; `remediation-35` entrego un candidate
8/10, pero el criterio de backorder fallo porque `recorded.find` no era una
funcion; `remediation-36` verifico la presencia del contrato heredado, pero la
integracion final elimino adiciones de los hijos y quedo detenida en
`waiting_for_input`; `remediation-37` fue un fallo de lanzamiento por falta de
`MANYHANDS_SESSION_TOKEN`; y `remediation-38` quedo detenida porque la hoja de
fulfillment no tenia evidencia de test exacta en su contrato. Ninguno de esos
intentos fue reintentado ni reinterpretado.

El fix profundo de fidelidad contractual y evidencia de tests quedo en
`a0e6477` y la corrida posterior `g6-06-T1-B-r2-remediation-39-full` completo
el ciclo sin aclaracion ni fallo de infraestructura:

| Campo | Resultado |
|---|---|
| run | `d13ef9ff-0c56-4d5f-b4a8-4656e57bb951` |
| lifecycle | `completed` |
| SHA final | `f53cced0213ca57514dc4863189a7d47ba387168` |
| hojas | 6 |
| retries automaticos | 0 |
| costo reportado | USD 1,223334 |
| tokens reportados | 271.852 |
| criterios externos | 8/10 |
| criterios fallidos | `gate-typecheck`, `gate-build` |

El evaluador externo congelado confirma que pasan install, test, integridad de
los 14 tests baseline, prioridad express, backorder registrado, rechazo de
prioridad invalida, probe de JSON unico y determinismo. El candidate queda
entregado y el veredicto esta preservado en
`runs/g6-06-T1-B-r2-remediation-39-full/external-verdict.json`.

El costo acumulado informado por los journals hasta esta remediacion es USD
16,2697131, por debajo del tope de USD 40 para la serie y del tope de USD 8
para la celda. El resultado 8/10 es adverso y queda preservado: no se corrige
el candidate despues de medirlo y no se relajan los criterios externos.

## Qué no se concluye

- No se concluye PASS completo de B: la cobertura observada es 8/10 y build/typecheck fallan.
- No se concluye confirmacion ni falsacion de H-G6 a partir de esta celda.
- No se concluye que los fallos de `remediation-36`, `remediation-37` o `remediation-38` sean fallos genuinos de capacidad del modelo; quedaron clasificados como no atribuibles a la capacidad por sus causas de integracion, lanzamiento y evidencia previa.
- No se generaliza una entrega aislada a la comparacion completa de G6.
- No se concluye que deban cambiarse el contrato congelado, el oraculo, `minimumAdvantage`, la formula, el estimulo o los criterios externos.
