# `g6-02-T1-C-r1` — remediation-1

Fecha: 2026-08-01

Run `352f78c4-6cf2-4ae8-8cbc-44473440e1e1` avanzó por las validaciones de hojas,
pero falló en la integración antes de producir un candidato final. La causa
terminal preservada en el journal fue:

`EINVAL: invalid argument, mkdir ... .mutation-locks ... <attempt id muy largo>`.

El primer fix profundo (`95c00f5`) serializó la topología de worktrees y
garantizó el cleanup en `finally`; el segundo (`95e7fac`) acotó los nombres de
locks de integración con un sufijo SHA-256 estable. El intento original se
preserva sin sobrescribirlo; no se corrió evaluador externo y no hay SHA final.

## Qué no se concluye

- No es una medición externa de C.
- No se cuenta como 0/10.
- No se concluye que el estímulo o la política C sean incorrectos.
- No se declara costo monetario exacto: el journal no registró `costUsd`.
