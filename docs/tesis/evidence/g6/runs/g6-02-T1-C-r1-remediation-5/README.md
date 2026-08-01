# `g6-02-T1-C-r1` — remediation-5

Fecha: 2026-08-01

Run `7b8b677a-c8c6-46cc-8bb9-7c1ec230cbb8` reprodujo el fallo read-after-write
de la API: el primer `GET /api/runs/:id/deliver` recibió HTTP 500 con
`Cannot fold a run without run.created.`. El intento terminó antes de
candidate y no se evaluó externamente.

El fix profundo fue sembrar el evento canónico `run.created` antes de devolver
201 desde `POST /api/runs`, con una autoridad de fencing propia y una regresión
en `tests/run-create-canonical-seed.test.ts`.

## Qué no se concluye

- No se cuenta como 0/10 ni como un resultado de C.
- No se concluye que el planner haya fallado.
- No se declara costo monetario exacto.
