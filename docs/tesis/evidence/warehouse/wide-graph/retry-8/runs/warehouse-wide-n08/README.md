# Retry 8 — N=8

Estado: **FAIL atribuible, sin candidato**.

- Run: `0b6b5781-42e4-49ad-b662-f5ab700df118`.
- Freeze: `c38a976712f5145002667f0b0f6686136b13b190`.
- Base: `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- Condición/executor: `C`, `codex-cli/gpt-5.5/high`.
- Lifecycle: `failed`; candidate, receipt y oráculo no existen.

El primer intento interno del planner fue rechazado porque dos contratos se
autoconsumían. El segundo produjo un grafo de 11 hojas y persistió:

- `parallelism = 0.7`;
- `coordination = 0.1818`;
- `validationDuplication = 0.5806`;
- `benefit = 0.5586`, `cost = 0.3688`;
- `splitAdvantage = 0.1898`.

C seleccionó el split, pero el Graph Compiler rechazó el plan porque el
composite y las hojas declararon los mismos planned outputs.

## Límite

Este run no mide ejecución ni oráculo. Sí demuestra un defecto sistémico de
ownership del plan, reproducido a otra anchura. No se atribuye a los umbrales de
C ni se reintenta sin una corrección del producto.
