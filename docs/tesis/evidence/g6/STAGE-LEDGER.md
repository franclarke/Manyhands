# G6 · Ledger de etapas

Una fila por etapa completada. La escribe el agente al terminar cada etapa,
**después** de correr su verificación y **antes** de pasar a la siguiente.

| Etapa | Fecha | Resultado | Commit | Evidencia |
|---|---|---|---|---|
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
