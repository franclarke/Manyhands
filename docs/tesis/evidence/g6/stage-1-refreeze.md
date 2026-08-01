# Etapa 1 — re-congelamiento de G6 con Codex

Fecha: 2026-08-01

## Enmienda aplicada

La selección comparativa quedó fijada como `codex-cli / gpt-5.4-mini / low` para
planning, execution y repair. La celda previa `g6-01-T1-A-r1`, ejecutada con
`claude-code-cli / sonnet`, se conserva como piloto y no se mezcla con la serie.
La enmienda quedó registrada en `docs/tesis/evidence/g6-preregistration.md`
antes de cualquier dato comparativo.

## Configuración y clones

Se materializaron seis celdas homogéneas, con el orden pre-registrado:

| Celda | Condición | Repetición | Clon independiente |
|---|---|---:|---|
| `g6-01-T1-A-r1` | A | 1 | `warehouse-g6-02` |
| `g6-02-T1-C-r1` | C | 1 | `warehouse-g6-03` |
| `g6-03-T1-B-r1` | B | 1 | `warehouse-g6-04` |
| `g6-04-T1-C-r2` | C | 2 | `warehouse-g6-05` |
| `g6-05-T1-A-r2` | A | 2 | `warehouse-g6-06` |
| `g6-06-T1-B-r2` | B | 2 | `warehouse-g6-07` |

Cada clon fue creado desde `warehouse-control-tower-compact`, rama fuente
`wc/compact`, base `5da60192cc788032c59c7e7be27696ca0e0a30d7`; quedó en rama local
`main`, `core.autocrlf=false`, `i/lf w/lf`, y estado `CLEAN`. No se reutilizó el
clon que recibió la entrega Claude.

## Freeze reproducible

`docs/tesis/evidence/g6/freeze.json` fija:

- commit ManyHands de la base verificada: `9194307b929c570466be42d1c76345738e0af7b0`;
- tree de esa base: `4d27d2390613ded82a0e1d6230c920ea286a1947`;
- política `adaptive-utility/3.1.0-pilot`, con marcador presente en `dist`;
- `packages/decomposer/dist/index.js`: SHA-256
  `82fa6291977b1244f4851e5263be383bf46a3aeaddc1b0224cd126c80d9f56f8`;
- lockfile: SHA-256
  `ccfdec805178d04f07921c595206239eafe58236ac61300c6589b4953ecc9c40`;
- hashes de tarea, criterios, evaluador, biblioteca, driver, pre-registro y las
  seis celdas.

La comprobación post-freeze comparó cada hash contra el archivo en disco y dio
PASS en todos los elementos; también confirmó el tree del commit congelado.

## Gate sobre la base limpia

Se ejecutó el build antes del test:

| Comando | Resultado |
|---|---|
| `pnpm build` | PASS |
| `pnpm test` | PASS — 221 archivos, 1546 passed, 2 skipped |

Durante la primera corrida de la suite apareció en rojo una inconsistencia
preexistente en `docs/tesis/evidence/warehouse/wide-graph/oracle-freeze-v2.json`:
el freeze esperaba el hash `a2f0…`, pero el build reproducible producía `82fa…`.
La regresión focalizada `tests/wide-graph-oracle-contract.test.ts` pasó 7/7 luego
del ajuste de ese único hash, que quedó en el commit local `9194307`.

## Qué no se concluye

El re-freeze no demuestra que `gpt-5.4-mini` pueda implementar T1, ni produce
cobertura, costo, hojas o resultado de granularidad. Tampoco ejecuta una celda,
no compara condiciones y no modifica `minimumAdvantage`, la fórmula, el estímulo,
los criterios externos ni el oráculo. Esas observaciones quedan reservadas para
la etapa 2 y las etapas 3–7.
