# Informe final de evidencia de la tesis

Fecha de cierre: 2026-08-09.

## Autoridad vigente

La evidencia positiva central de la tesis es el experimento final V2, descrito
en [`final-experiment/FINAL-REPORT.md`](final-experiment/FINAL-REPORT.md). Su
veredicto es **H-F1 PASS 4/4** y **H-F2 PASS 4/4** bajo un freeze explícito.
Es la única serie que se usa para sostener conjuntamente las dos proposiciones
operables de la entrega.

H-F1 afirma viabilidad end-to-end acotada: cuatro celdas entregadas, con SHA
no vacío y oráculo externo PASS sobre el commit exacto. H-F2 afirma una forma de
topología: dos tareas multi-capa con raíz composite y tres hojas, y dos tareas
cohesivas con una envoltura de raíz y una sola hoja ejecutable.

## Resultado final

| Celda | Run | Candidate SHA | Lifecycle | Oráculo | Topología |
|---|---|---|---|---|---|
| `M-C-r1` | `21f2aebf-9218-4c2e-9e96-b8b60b86fc59` | `6204eeb8b416bda97c9a97d9a82f667726bf0022` | completed, delivered | PASS | 3 hojas |
| `M-C-r2` | `99c0c50f-8e76-49ef-8bd4-bb020b1240b9` | `73c6b35a5849a2514513fd4bf44139dd91f6537f` | completed, delivered | PASS | 3 hojas |
| `S-C-r1` | `a74c6959-8981-41b7-9341-899fca9a504e` | `e4caca0b7df98367bb998cb6f40ba95de0b93033` | completed, delivered | PASS | 1 hoja |
| `S-C-r2` | `d611c700-b392-41d0-88ae-39ebead48119` | `eb3631af68bc1add42d60aa051cf603ed3be7218` | completed, delivered | PASS | 1 hoja |

Modelo efectivo: Codex `gpt-5.4-mini`, esfuerzo `medium`, en planning,
execution y repair. Se usaron cero retries automáticos y `pnpm build` antes de
cada run. El rehearsal se excluye del denominador. La cadena de custodia,
hashes, métricas y journals están en `.scratch/final-thesis-experiment-v2/`.

## Evidencia histórica que no se combina

- Warehouse queda en `1/8`; no se presenta como escala demostrada.
- G5 queda como resultado comparativo negativo.
- G6 queda inconcluso.
- G7 no produjo candidatos.
- SP2 queda como piloto previo y no se suma a V2.
- V1 queda como resultado adverso por un negative control insensible; después se
  corrigió el fixture y se creó el freeze V2 independiente.

Estos resultados no se borran ni se convierten en éxitos. Se conservan para
explicar límites, defectos encontrados y por qué la serie final fue
reorganizada.

## Conclusión defendible

ManyHands demostró, en el target y la configuración congelados, un recorrido
end-to-end que planifica una tarea semántica, ejecuta hojas aisladas, integra,
valida el commit candidato exacto mediante un oráculo independiente y entrega
el resultado. También produjo las dos topologías pre-registradas para las
formas de tarea evaluadas.

No se concluye superioridad de una política frente a A/B, causalidad,
optimalidad, escalabilidad, generalización estadística ni finalización de
Warehouse. Para sostener cualquiera de esas afirmaciones haría falta un
estudio distinto, con controles y una base que aquí no se obtuvo.

## Gates de software

La implementación de ManyHands usada en el freeze fue compilada y tipada antes
de ejecutar las celdas. La corrección del fixture de sensibilidad pasó el
preflight con template FAIL, referencias PASS y negative-control sensitivity
PASS. El servidor se detuvo después del cuarto run y el puerto `3200` quedó sin
listener.

No se hizo push.
