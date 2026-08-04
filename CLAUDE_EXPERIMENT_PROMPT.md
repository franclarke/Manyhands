# Claude — experimento SP2 de planificación semántica

Ejecutá exclusivamente el protocolo SP2 definido en
`docs/tesis/evidence/semantic-planning/sp2-protocol.md`.

Usá el modelo Claude **de menor costo disponible** en el entorno
(preferentemente una variante Haiku). Si no está disponible, detenete e
informalo antes de usar un modelo más caro.

Primero leé `PRODUCT.md`, `AGENTS.md`, el protocolo SP2 y
`docs/tesis/HANDOFF.md`.

El target base es el template versionado
`docs/tesis/evidence/semantic-planning/sp2-target-template/`. Creá dos copias
limpias e independientes desde ese template y registrá el SHA inicial de cada
una. No uses Warehouse WC3, el SHA `5da60192…`, snapshots históricos ni el
fixture `tests/fixtures/warehouse-probe`.

Reglas:

- No modifiques ManyHands, el protocolo, el template o la evidencia histórica.
- Toda seam `api`, `type` o `command` debe materializarse como `files`,
  `manifest` o `commit`; `logical` invalida la celda antes de ejecutar.
- Ejecutá exactamente dos celdas independientes, sin retries automáticos y con
  una sola reparación dentro del scope declarado por celda.
- Corré el evaluador externo sobre el commit candidato exacto de cada celda.
- Conservá todos los logs, runs y resultados adversos.
- Emití `PASS` sólo con 2/2 celdas completas y todos los criterios externos
  satisfechos; de lo contrario emití `PARTIAL` o `FAIL` con causa observable.

Al finalizar, escribí el reporte indicado por el protocolo: configuración,
SHA, rutas de evidencia, uso/costo disponible, resultados por criterio y
veredicto final.
