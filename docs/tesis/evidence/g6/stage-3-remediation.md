# G6 — Etapa 3: remediación de `g6-02-T1-C-r1`

Fecha: 2026-08-01

## Resultado final de la etapa

La celda C quedó operacionalmente resuelta y produjo un resultado atribuible:
el run `e6442dc5-c1e7-429d-8f6b-b913c06c8ed2` completó y entregó el SHA
`0447b738edce84aea923dde723169259e4239538`. El evaluador externo congelado
dio `7/10`. Se clasifica como **fallo genuino de la condición**, no como fallo
de infraestructura: los tres problemas externos fueron `gate-typecheck`,
`gate-build` y `behaviour-backorder-recorded`.

La medición se conserva aunque sea adversa. La etapa 4 puede comenzar porque
ya existe un candidato entregado y un veredicto externo atribuible; no se
reintenta la misma celda ni se modifica el estímulo, la fórmula, el umbral, los
criterios o el oráculo.

## Cadena de fallos y fixes profundos

1. El intento original `7d034bfd-f81a-4a23-80f2-4b9778f4511b` falló al limpiar
   un worktree antes de candidate. Se corrigió la serialización de topología y
   el cleanup garantizado en `95c00f5`.
2. `remediation-1`, run `352f78c4-6cf2-4ae8-8cbc-44473440e1e1`, reprodujo un
   `EINVAL` por nombres de lock de integración demasiado largos. Se corrigió
   el bounded lock naming en `95e7fac`.
3. Los lanzamientos `remediation-2` y `remediation-3` expusieron errores de
   supervisión/ruta; se preservan sin atribuirlos a C. El driver ahora prioriza
   `MANYHANDS_RUNS_DIR`, con regresión roja-verde en
   `run-experiment-paths.test.mjs`.
4. `remediation-5`, run `7b8b677a-c8c6-46cc-8bb9-7c1ec230cbb8`, reprodujo la
   carrera read-after-write de `run.created`. Se corrigió sembrando el evento
   canónico antes de responder 201, con regresión en
   `run-create-canonical-seed.test.ts`.
5. `remediation-6` verificó los fixes: no hubo 500 inicial, fallo de cleanup ni
   fallo de lock; el resultado externo adverso permanece como evidencia del
   candidato, no se “repara” retrospectivamente.

## Planning y granularidad

El planning válido de remediación `2e82cdd5-a7e5-434b-b5f0-c7e2fff5f4ef`
terminó en `needs_approval` con 7 hojas, profundidad máxima 1 y branching 7.
El run final, creado después de los fixes del driver y de la API, registró
6 hojas, profundidad máxima 1 y branching 6. El cambio de cantidad de hojas
queda registrado como observación del planning de la tentativa válida final;
no se altera para homogeneizarlo.

## Consumo y presupuesto

El run final registra `tokensTotal=291539` en seis candidatos, una invocación por
hoja y cero reparaciones. El journal no registra `tokensIn`, `tokensOut` ni
`costUsd`; por lo tanto no se inventa un costo en dólares. La evidencia de
presupuesto monetario es limitada por esa ausencia.

## Evidencia

- Planning original y ejecución detenida: `stage-3-cell-g6-02-T1-C-r1.md`.
- Fallos y fixes intermedios: los README de `remediation-1` a `remediation-5`.
- Resultado final y veredicto: `runs/g6-02-T1-C-r1-remediation-6/`.
- Regresiones: `tests/run-create-canonical-seed.test.ts` y
  `docs/tesis/evidence/scripts/run-experiment-paths.test.mjs`.

## Qué no se concluye

- No se concluye que H-G6 esté sostenida o falsada con una sola observación C.
- No se concluye que C sea peor que A o B: faltan las celdas comparables y las
  repeticiones.
- No se atribuyen a C los fallos de harness sin candidate.
- No se declara un costo monetario exacto.
- No se reescribe ni se corrige el candidato adverso después de su entrega.
