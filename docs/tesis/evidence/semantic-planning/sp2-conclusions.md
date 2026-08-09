# Reconciliación de evidencia SP2

Fecha de reconciliación: 2026-08-09.

Este documento separa observaciones, claims de ingeniería y conclusiones
científicas. No reemplaza `sp2-protocol.md`, no cambia el freeze y no reinterpreta
G5, G6 ni la línea Warehouse.

## Cadena de evidencia

- Freeze de ManyHands: `90fde7a057db8a04e0f7cc1021685ca002e6fa8d`.
- Corrección posterior de compatibilidad de replay: `157cb6cadd91e9a2646ea25951b877c942579b3a`. Fue verificada después de la serie, pero no se aplicó ni se reintentó en las celdas congeladas.
- Modelo efectivo: Codex `gpt-5.4-mini`, esfuerzo `medium`, en planning, execution y repair. La desviación respecto del modelo Claude indicado por el protocolo está registrada en el freeze.
- Rehearsal 04w: `rehearsal-04w-v5`, ejecutado y explícitamente excluido del conteo.
- Oráculo externo: SHA-256 `8b03b82b7ce4a7bab084b217093744ebdc87f9fc9d0879ac9e8d0fe7a58ac7f5`, ejecutado desde worktrees descartables sobre cada candidato exacto.

## Observaciones de las celdas

| Celda | Base | Candidato exacto | Lifecycle | Tests del target | Oráculo | Métricas de grafo |
|---|---|---|---|---:|---|---|
| `sp2-cell-01` | `2dfb64c7d09852cba1d2509d1d4c78a8f2900677` | `8144bfe8a06a9f3a4d946ca5fa712ce76de262fb` | `completed`, `delivered` | 7/7 | PASS | profundidad 1; 3 hojas; branching 3 |
| `sp2-cell-02` | `f6b84b085e01c6c57fd2e730f47136152078ec6e` | `50773ec2c9a3c322f9eb5c19757eac8db0b51ec0` | `completed`, `delivered` | 8/8 | PASS | profundidad 1; 3 hojas; branching 3 |

Las dos celdas usaron condición C, política `adaptive-utility/3.1.0-pilot`,
scope estricto, presupuesto de retry cero y `pnpm build` antes de cada run.
Cada receipt confirmó el SHA final y la publicación en `main` del target.

El objetivo evaluado fue un vertical slice pequeño de Node ESM —domain →
application → API— con prioridad `standard`/`express` y registro de
backorders. El oráculo comprobó los cinco criterios pre-registrados,
incluidos el valor por defecto, la orden cancelable, el evento
`backorder-recorded`, la forma `{ orderId, skuId, missing }` y la superficie
API observable.

## Qué queda demostrado

### 1. El recorrido productivo completo es observable en un caso compacto

SP2 aporta dos observaciones independientes de un recorrido que llega desde un
plan semántico compilado hasta hojas ejecutadas, integración, validación del
commit candidato exacto, receipt y entrega. En este escenario, ManyHands no se
detuvo antes de integración ni necesitó un retry para producir el resultado.

Esto eleva los claims end-to-end de integración, delivery y ejecución real
(`CLAIM-040`, `CLAIM-042`, `CLAIM-043` y `CLAIM-044`) de evidencia sólo modular a
evidencia persistida en un target compacto.

### 2. La cadena de custodia del oráculo es válida para esta serie

El evaluador no estuvo dentro del template ni fue indexable o escribible por el
run. Se ejecutó sobre el checkout del SHA entregado y dejó un recibo externo
para cada celda. Por lo tanto, `PASS` significa que esos cinco criterios fueron
satisfechos por esos dos commits exactos, no sólo que el run terminó.

### 3. La planificación semántica produjo un grafo ejecutable para este objetivo

Ambas celdas persistieron un árbol de profundidad 1 con tres hojas, que
corresponde al vertical slice domain → application → API. Eso demuestra que la
planificación y el compilador pudieron expresar y ejecutar ese corte bajo la
política congelada.

No demuestra que el corte sea óptimo, que sea estable para otros objetivos ni
que la política adaptativa sea superior a no dividir.

### 4. Los defectos de etapa 7 quedaron cerrados como ingeniería

Los tickets 01–04 tienen implementación, regresiones y evidencia documental.
El chequeo independiente de Claude verificó autenticación con
`--setting-sources project,local` y escritura únicamente dentro del contrato de
la prueba. Los tickets 02 y 03 se verificaron contra sus observaciones
originales mediante sus regresiones. SP2 no reintrodujo ninguno de esos defectos.

## Qué no queda demostrado

- No hay comparación A/B/C en SP2: las dos celdas son condición C. No se puede
  inferir ventaja, superioridad, causalidad ni efecto de la granularidad.
- Dos celdas sobre un target pequeño no permiten inferencia estadística ni
  generalización a repositorios grandes, otros dominios, otros modelos o más
  profundidad de grafo.
- SP2 no resuelve el veredicto inconcluso de G6 ni modifica su falsador.
- La línea longitudinal Warehouse continúa en 1/8; SP2 no completa W2–W8 ni
  prueba escalabilidad.
- `minimumAdvantage = 0.15` y `maxLeafPlannedPaths = 12` continúan
  provisionales; no fueron calibrados por SP2.
- La corrección `157cb6c` fue posterior al freeze. Su suite verde es evidencia
  de compatibilidad del código actual, no una nueva medición de las celdas.
- La prueba de Claude verifica el perfil y el caso observado de escritura; no
  convierte `buildAgentEnvironment` en un sandbox general del sistema operativo.

## Conclusión defendible para la tesis

> En un target Node ESM pequeño y bajo un freeze explícito, ManyHands produjo en
> dos celdas un plan semántico domain → application → API, ejecutó sus hojas,
> integró el resultado, validó los commits candidatos exactos mediante un
> oráculo externo de cinco criterios y entregó ambos árboles con receipts
> confirmados.

La formulación debe presentarse como una demostración compacta de viabilidad y
trazabilidad end-to-end. No debe presentarse como evidencia de superioridad de
la política, de escalabilidad ni de generalización estadística. Los resultados
negativos e inconclusos de G5/G6 y Warehouse siguen formando parte de la
conclusión global.

## Fuentes

- [`sp2-preregistration.md`](sp2-preregistration.md)
- [`sp2-protocol.md`](sp2-protocol.md)
- [`sp2-freeze.json`](../../../../.scratch/stage-7-defects/sp2-freeze.json)
- [`sp2-result.json`](../../../../.scratch/stage-7-defects/sp2-result.json)
- [`runs/sp2-cell-01/oracle-result.json`](../../../../.scratch/stage-7-defects/runs/sp2-cell-01/oracle-result.json)
- [`runs/sp2-cell-02/oracle-result.json`](../../../../.scratch/stage-7-defects/runs/sp2-cell-02/oracle-result.json)
- [`claude-config-check.json`](../../../../.scratch/stage-7-defects/claude-config-check.json)
> **Estado para la entrega final (2026-08-09):** SP2 queda archivado como piloto
> end-to-end previo y no se combina con el experimento final V2. Su resultado
> `2/2` conserva valor de antecedente, pero no forma parte del denominador de
> H-F1/H-F2 ni completa Warehouse.
