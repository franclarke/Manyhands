# Retry 8 — N=16

Estado: **FAIL atribuible, sin candidato**.

- Run: `b8e114ef-72a9-495f-82ae-6c92ca6906d2`.
- Freeze: `c38a976712f5145002667f0b0f6686136b13b190`.
- Base: `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- Condición/executor: `C`, `codex-cli/gpt-5.5/high`.
- Lifecycle: `failed`; candidate, receipt y oráculo no existen.

El planner produjo un grafo de 19 hojas y persistió:

- `parallelism = 0.9444`;
- `coordination = 0.1053`;
- `validationDuplication = 0.8649`;
- `benefit = 0.501`, `cost = 0.4291`;
- `splitAdvantage = 0.0719`.

La hoja composite era inviable y C seleccionó el split disponible. El Graph
Compiler rechazó el plan porque el composite y las hojas declararon los mismos
planned outputs.

## Límite

Este run no mide ejecución ni oráculo. Confirma que el defecto de ownership no
es exclusivo de N=4/N=8. No se atribuye a C ni se reintenta sin regresión, fix,
gates y un freeze nuevo.
