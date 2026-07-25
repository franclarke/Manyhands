# Warehouse Pilot

Estado: **iniciado; W1 aún no ejecutado**.

Esta construcción permite corregir C2, ManyHands, prompts y drivers. Sus runs se
conservan como evidencia formativa y no responden las preguntas finales de la
tesis. El piloto sólo cierra cuando W1–W8 pasan sus oráculos externos.

## Intentos de instrumento previos a W1

- El primer lanzamiento fue abortado por preflight antes de crear un run:
  `seed_hash_mismatch`. La causa y regresión están en
  [`defects/seed-lock-checkout-normalization/README.md`](defects/seed-lock-checkout-normalization/README.md).
