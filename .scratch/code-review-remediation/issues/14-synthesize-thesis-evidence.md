# 14 — Las afirmaciones reflejan toda la evidencia

**What to build:** la matriz de claims y los documentos de evidencia expresan un veredicto único y trazable para H1 y H2, incluidos resultados adversos, series no comparables y parámetros provisionales.

**Blocked by:** 02, 04, 08, 09, 12, 13 — la síntesis necesita semántica de replay honesta, recibos distinguibles, variables declaradas y ambas líneas de evidencia cerradas.

**Status:** closed

- [x] Cada afirmación de H1 y H2 enlaza journals, commits y recibos concretos.
- [x] Los N anteriores quedan etiquetados como evidencia mecánica y no comparable con `retry-7`.
- [x] `maxLeafPlannedPaths` y `minimumAdvantage` quedan declarados provisionales salvo evidencia nueva que los ancle.
- [x] Las limitaciones y resultados adversos se conservan sin reinterpretación favorable.

## Cierre — 2026-07-30

La rederivación vive en `docs/tesis/claim-evidence-matrix.md`, sección
"Rederivación final — ticket 14 — 2026-07-30".

- **H1 sostenido con límite declarado**: `retry-12-measure` mide el efecto sin
  tocar término, fórmula ni umbral; el caso motivador no fue re-medido a su
  anchura y la serie no es comparable con las Codex.
- **H2 no sostenido**: nueve celdas anchas sin entrega, cada causa terminal
  documentada por separado y ninguna atribuida a la política C. W1 sigue siendo
  la única entrega externamente verificada; la cadena longitudinal queda 1/8.
- **N viejos etiquetados** como evidencia mecánica y declarados no comparables;
  `retry-7` sigue siendo un freeze nunca ejecutado.
- **Parámetros provisionales**: `maxLeafPlannedPaths` y `minimumAdvantage`, con
  la razón por la que ninguno está anclado.
- **Sólo suben CLAIM-020 y CLAIM-021**, y sólo porque la brecha que los había
  degradado —estado de recursos y presupuesto fijo en el host V2— está cerrada en
  la ruta productiva y cubierta por tests. Los claims end-to-end (040, 041, 042,
  043, 044, 052, 053) **no suben**: ningún run nuevo entregó.
