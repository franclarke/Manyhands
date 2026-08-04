# Claude — experimento de validación semántica

Trabajá en este repositorio para ejecutar el próximo experimento de validación
de ManyHands. Usá el modelo Claude **de menor costo disponible** en el entorno
(preferentemente una variante Haiku si está habilitada). No uses un modelo más
caro salvo que el modelo económico no esté disponible; si ocurre, detenete e
informalo antes de ejecutar.

Primero leé:

- `PRODUCT.md`
- `AGENTS.md`
- `docs/tesis/evidence/semantic-planning/next-run.md`
- `docs/tesis/evidence/g6/FINAL-REPORT.md`
- `docs/tesis/HANDOFF.md`

Objetivo: validar el rediseño de planning con un vertical slice de cuatro
unidades: Domain, Application, API e Integration composite. La seam ejecutable
debe estar materializada como `files`, `manifest` o `commit`; nunca como
`logical`.

Protocolo:

1. Crear dos targets limpios e independientes desde el mismo commit base.
2. Congelar y registrar SHA, prompt, modelo, esfuerzo, presupuesto y criterios.
3. Generar el plan y revisar su salida durable antes de ejecutar. Si una seam
   ejecutable es `logical`, declarar la celda inválida y no continuarla.
4. Ejecutar exactamente dos repeticiones independientes, sin retries
   automáticos ni cambios de prompt, umbral, política u oráculo entre celdas.
5. Permitir como máximo una reparación dentro del scope declarado de cada
   celda. No ampliar scopes para corregir un plan defectuoso.
6. Evaluar cada commit candidato exacto con el evaluador externo correspondiente.

Reglas de evidencia:

- Preservá todos los runs, logs y resultados adversos; no borres ni reescribas
  evidencia histórica.
- No declares `PASS` por un timeout, una salida parcial, un fixture o un test
  focal aislado.
- Reportá `PASS` sólo con 2/2 celdas completas y todos los criterios externos
  satisfechos. En cualquier otro caso, reportá `PARTIAL` o `FAIL` con la causa.
- No cambies código, documentos de arquitectura ni el protocolo mientras
  ejecutás el experimento. Si encontrás un defecto, detenete y documentalo.

Al finalizar, escribí un reporte breve con: configuración congelada, rutas de
evidencia, SHA de cada celda, resultado por criterio, costos/uso disponibles y
veredicto `PASS`/`PARTIAL`/`FAIL`.
