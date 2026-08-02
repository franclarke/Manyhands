# Etapa 4 — G6-03-T1-B-r1

Fecha de cierre: 2026-08-02
Condición: B — división fina fija
Modelo: Codex CLI / `gpt-5.4-mini` / `medium`

## Verificación

El planning-only `12fd7eb7-a958-451c-a308-ca16ee8a750e` terminó en
`needs_approval` con `measurement_only_planning`, sin aclaración y con siete
hojas seleccionadas. La corrida full `c7e47c17-c57d-41c4-a4a2-0e65857c929e`
completó delivery sobre la base `5da60192cc788032c59c7e7be27696ca0e0a30d7`.

| Campo | Resultado |
|---|---|
| lifecycle | `completed` |
| SHA final | `4fd86c11b2541460411b8708f8eaa05eb6337d2b` |
| hojas | 7 + integración |
| retries automáticos | 0 |
| costo reportado de hojas | USD 1.5930225 |
| tokens reportados de hojas | 354005 |
| criterios externos | 9/10 |
| criterio fallido | `behaviour-backorder-recorded` |

Los cuatro gates técnicos, la integridad del baseline, express-first, rechazo
de prioridad inválida y ambos criterios del probe pasaron. El único fallo fue
semántico: el candidate implementó `Backorder` con `lines` y `priority`, aunque
el contrato congelado exige `orderId`, `skuId` y `missing` positivo. El detalle
completo está en `runs/g6-03-T1-B-r1-remediation-26-full/external-verdict.json`;
los artefactos crudos permanecen en los directorios `remediation-24`,
`remediation-25` y `remediation-26`.

Por clasificación pre-registrada, es un fallo genuino de la condición, no un
fallo de infraestructura. La etapa se cierra con cobertura observada 9/10 y
se avanza a la siguiente celda sin reescribir este resultado.

## Qué no se concluye

- No se concluye que B haya logrado 10/10.
- No se concluye que una sola celda permita confirmar o falsar H-G6.
- No se concluye que el runtime, el oráculo o el contrato congelado deban
  relajarse.
- No se generaliza el resultado a las restantes condiciones o repeticiones.
