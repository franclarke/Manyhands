# G6 — Etapa 3: `g6-02-T1-C-r1`

Fecha: 2026-08-01

## Resultado

La etapa se detuvo sin candidato final. El planning-only compiló la condición
C con 7 hojas, profundidad máxima 1 y branching promedio 7. La ejecución
completa produjo dos candidatos internos en waves previas, pero una tercera
rama terminó con un fallo pre-candidate de limpieza de worktree. La decisión
de conflicto se cerró con `stop`, sin retry, para respetar la regla de un
intento por celda.

## Planning-only

- Run: `95d9a069-0bd1-4b48-b915-6f4d69a38f5d`.
- Lifecycle terminal: `needs_approval`.
- No se respondió una aprobación de ejecución: el modo planning-only deja esa
  decisión pendiente por diseño.
- Evidencia: `runs/g6-02-T1-C-r1-planning/`.

## Ejecución completa

- Run: `7d034bfd-f81a-4a23-80f2-4b9778f4511b`.
- Selección: `codex-cli / gpt-5.4-mini / medium`.
- Lifecycle: `failed`.
- `finalSha`: ninguno; no se corrió evaluador externo.
- El target `warehouse-g6-03` quedó limpio y en la base
  `5da60192cc788032c59c7e7be27696ca0e0a30d7`.
- Causa terminal: `Failed to clean worktree for task
  validation-5da60192cc78`.
- Clasificación del runtime: `execution_failed`, área `code_test`, con
  acción permitida `retry` o `propose_graph_amendment`.
- Decisión aplicada: `stop`; no se suministró guidance ni se reintentó.
- Evidencia: `runs/g6-02-T1-C-r1/`.

Los dos candidatos internos descartados quedan registrados en el journal:
`ebc14722e7abd2222cabafa2ddbc0285cecd1ccc` y
`d2ddf284a6012a793726a4e64c6e740b9b985d1e`. No son candidatos finales ni
fueron enviados al evaluador externo.

## Consumo registrado

El journal registra `tokensTotal=49139` y `tokensTotal=90676` para los dos
intentos que produjeron esos candidatos internos: 139815 tokens reportados en
total. El intervalo del run fue
`2026-08-01T05:47:42.376Z`–`2026-08-01T06:05:50.830Z` (18m 08.454s).

No se registraron `tokensIn`, `tokensOut` ni `costUsd`; el costo monetario no
se inventa. No hay evidencia en el journal de que se haya alcanzado el tope
de USD 8 por celda, pero la comprobación monetaria queda limitada por el
campo ausente.

## Clasificación y límite de avance

Este es un fallo de infraestructura del flujo de ejecución, no un resultado
externo de la condición C: no hay candidato final ni cobertura 0/10. Como no
se puede corregir la limpieza del worktree dentro de esta celda sin reintentar
el fallo pre-candidate, la serie queda detenida en la etapa 3. No se inician
las etapas 4–12.

## Qué no se concluye

- No se concluye que C falle como política: no hubo candidato final evaluable.
- No se concluye ningún resultado externo sobre esta celda.
- No se concluye una comparación entre A, B y C.
- No se declara un costo monetario exacto porque el journal no lo registró.
- Los dos candidatos internos no se cuentan como entregas ni como criterios
  satisfechos.
