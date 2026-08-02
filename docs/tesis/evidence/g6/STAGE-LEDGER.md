# G6 · Ledger de etapas

Una fila por etapa completada. La escribe el agente al terminar cada etapa,
**después** de correr su verificación y **antes** de pasar a la siguiente.

| Etapa | Fecha | Resultado | Commit | Evidencia |
|---|---|---|---|---|
| 12 | 2026-08-02 | PASS final corregido: gates, informe en la ruta exigida, raw runs preservados en Git y secciones finales de evidencia completadas; no se ejecutaron runs nuevos. | `2b779b3` | `FINAL-REPORT.md` |
| 11 | 2026-08-02 | PASS: dossier trazable de evidencia para PI-1, PI-2 y PI-3; separa entregas, fallos, parámetros provisionales y limitaciones, con índice de archivos y sección final `Qué no se concluye`. | `31f0589` | `../THESIS-EVIDENCE-DOSSIER.md` |
| 10 | 2026-08-02 | PASS técnico tras reviews independientes: se cerraron los hallazgos fail-open de intención física, reproducibilidad local y auditoría de cambios eliminados; queda declarada la violación histórica de no tocar main.tex/presentacion.tex. | `ac9e6a3` | `stage-10-reviews.md` |
| 9 | 2026-08-02 | PASS: veredicto pre-registrado inconcluso; A supera a C en r1 pero empata en r2, por lo que no se cumple el falsador en la misma dirección y no se sostiene H-G6. | `225ba26` | `verdict.md` |
| 8 | 2026-08-02 | PASS: derivador reproducible produjo las 6 filas canónicas; A media 0.9, B media 0.85, C media 0.8. Se preservan costos no reportados como `null` y se corrigieron el freeze de dist y el harness de integración/cancelación para que el gate completo pase. | `d1d9089` | `results.md` |
| 7 | 2026-08-02 | PASS operacional / candidate B-r2-remediation-39 entregado y evaluado 8/10; ahora pasan los tres comportamientos y los probes, pero fallan typecheck y build. Fallo adverso preservado. | `538ffc1` | `stage-7-cell-g6-06-T1-B-r2.md` |
| 6 | 2026-08-02 | PASS operacional / candidate A-r2 entregado y evaluado 9/10; fallo genuino `listBackorders` ausente, preservado sin corregir el candidate después de medir. | `a57eae5` | `stage-6-cell-g6-05-T1-A-r2.md` |
| 5 | 2026-08-02 | PASS operacional / candidate C-r2 entregado y evaluado 9/10; vuelve a fallar genuinamente `behaviour-backorder-recorded` (`quantity` en lugar de `missing`), preservado sin relajar el diseño. | `bcebb02` | `stage-5-cell-g6-04-T1-C-r2.md` |
| 4 | 2026-08-02 | PASS operacional / candidate entregado y evaluado 9/10; fallo genuino preservado en `behaviour-backorder-recorded`, sin relajar criterios ni reescribir el resultado. | `d7f9fd1` | `stage-4-cell-g6-03-T1-B-r1.md` |
| 3 (remediada) | 2026-08-01 | PASS operacional / resultado adverso preservado: tras fixes profundos de worktree, locks, runtime del driver y creacion canonica, C completo entrego un candidato y evaluador externo 7/10. Fallo genuino en typecheck, build y backorder-recorded; se avanza a etapa 4 sin reintentar C. | `8410219` | `stage-3-remediation.md` |
| Piloto (celda A con Claude) | 2026-08-01 | Entregada, 10/10 criterios externos, USD 3,01. Reclasificada como piloto si la etapa 0 elige Codex. | `efafeab` | `runs/g6-01-T1-A-r1/README.md` |
| 0 | 2026-08-01 | PASS: Codex CLI 0.146.0 funciona headless con `gpt-5.4-mini` y esfuerzo `low`; el servidor aceptó una creación de workspace autenticada HTTP 201 con estado fuera del repo. Se elige Codex y la celda Claude queda como piloto. | `00df9ee` | `stage-0-executor-preflight.md` |
| 1 | 2026-08-01 | PASS: G6 re-congelado con Codex `gpt-5.4-mini/low`, seis celdas, seis clones independientes en la base exacta, hashes verificados; `pnpm build` y `pnpm test` PASS. | `e8afb71` | `stage-1-refreeze.md` |
| 2 | 2026-08-01 | PASS: `low` terminó pre-candidate sin candidato y se preservó; la única escalada declarada a `gpt-5.4-mini/medium` produjo un candidato evaluado 9/10, con cuatro de cinco criterios de tarea satisfechos. Continúa la serie. | `b476900` | `stage-2-capability-floor.md` |
| 3 | 2026-08-01 | DETENIDA: el planning-only de C compiló 7 hojas, pero la ejecución completa terminó pre-candidate por fallo de limpieza de worktree en validación. Se cerró la rama con `stop`, sin retry; no hubo candidato final ni evaluador externo. No se avanza a etapas 4–12. | `9c61f3b` | `stage-3-cell-g6-02-T1-C-r1.md` |

## Cómo llenarlo

- **Resultado**: en una línea, qué pasó de verdad. Si algo falló, decilo acá.
- **Commit**: el commit local que dejó la etapa.
- **Evidencia**: la ruta del archivo que la etapa produjo.

No borres filas. Una etapa repetida agrega una fila nueva y deja la anterior.
