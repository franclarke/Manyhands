# G6 · Ledger de etapas

Una fila por etapa completada. La escribe el agente al terminar cada etapa,
**después** de correr su verificación y **antes** de pasar a la siguiente.

| Etapa | Fecha | Resultado | Commit | Evidencia |
|---|---|---|---|---|
| Piloto (celda A con Claude) | 2026-08-01 | Entregada, 10/10 criterios externos, USD 3,01. Reclasificada como piloto si la etapa 0 elige Codex. | `efafeab` | `runs/g6-01-T1-A-r1/README.md` |
| 0 | 2026-08-01 | PASS: Codex CLI 0.146.0 funciona headless con `gpt-5.4-mini` y esfuerzo `low`; el servidor aceptó una creación de workspace autenticada HTTP 201 con estado fuera del repo. Se elige Codex y la celda Claude queda como piloto. | `00df9ee` | `stage-0-executor-preflight.md` |
| 1 | 2026-08-01 | PASS: G6 re-congelado con Codex `gpt-5.4-mini/low`, seis celdas, seis clones independientes en la base exacta, hashes verificados; `pnpm build` y `pnpm test` PASS. | `e8afb71` | `stage-1-refreeze.md` |

## Cómo llenarlo

- **Resultado**: en una línea, qué pasó de verdad. Si algo falló, decilo acá.
- **Commit**: el commit local que dejó la etapa.
- **Evidencia**: la ruta del archivo que la etapa produjo.

No borres filas. Una etapa repetida agrega una fila nueva y deja la anterior.
