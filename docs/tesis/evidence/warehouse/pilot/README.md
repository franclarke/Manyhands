# Warehouse Pilot

Estado: **iniciado; primer W1 invalidado y no adoptado**.

Esta construcción permite corregir C2, ManyHands, prompts y drivers. Sus runs se
conservan como evidencia formativa y no responden las preguntas finales de la
tesis. El piloto sólo cierra cuando W1–W8 pasan sus oráculos externos.

## Intentos preservados

- El primer lanzamiento fue abortado por preflight antes de crear un run:
  `seed_hash_mismatch`. La causa y regresión están en
  [`defects/seed-lock-checkout-normalization/README.md`](defects/seed-lock-checkout-normalization/README.md).
- El run W1 `dbd343bd-3f65-4a51-90e0-742b5806c789` completó y entregó
  `651948b03cccb884ee41cbe4f20d4f43d290bfe1`, pero el oráculo externo falló.
  La entrega no fue adoptada como base W2. Reveló dos defectos independientes:
  la superficie de comandos quedó fuera del scope aunque el planner la exigía,
  y el prompt no publicaba la envoltura JSON exacta esperada por el oráculo.
  Véanse
  [`validation-stub-command-surface`](defects/validation-stub-command-surface/README.md)
  y
  [`oracle-contract-underspecified`](defects/oracle-contract-underspecified/README.md).

Resultado acumulado del piloto: **0/8 incrementos verificados**. El siguiente
intento comienza desde un clon nuevo del seed; no modifica ni oculta esta
evidencia formativa.
