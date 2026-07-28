# Retry 8 — N=4

Estado: **FAIL atribuible, sin candidato**.

- Run: `9bd2e8fc-0e7c-4342-b908-d6a25818382f`.
- Freeze de ManyHands: `c38a976712f5145002667f0b0f6686136b13b190`.
- Base Warehouse: `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- Condición: `C`, política `adaptive-utility/3.1.0-pilot`.
- Executor: `codex-cli`, modelo `gpt-5.5`, effort `high`.
- Lifecycle final: `failed`.
- Candidate, receipt y delivered SHA: no existen.
- Oráculo externo: no ejecutado porque su contrato exige un delivered SHA.

## Resultado observado

ManyHands inspeccionó la base W1 y el planner produjo un grafo con siete hojas.
La política C persistió sus assessments y seleccionó el split del composite
porque la hoja era inviable, aun con `splitAdvantage = -0.163`.

El Graph Compiler rechazó el plan antes de aprobación y ejecución:

- el composite y sus hijos declararon los mismos trece planned outputs;
- el registry y el script de salida formaron ciclos de artefactos;
- el lifecycle terminó `failed` sin materializar worktrees ni candidato.

El journal crudo conserva el árbol, los valores de C y el diagnóstico completo.
`oracle-disposition.json` registra por qué no existe un veredicto sobre una
entrega, sin fabricar un SHA ni convertir la ausencia en PASS.

## Qué se concluye

En esta medición real, ManyHands no logró convertir el objetivo N=4 en un plan
compilable. La arquitectura sí detectó y rechazó relaciones inválidas antes de
ejecutar, pero el sistema end-to-end no entregó el software.

## Qué no se concluye

- No se midió ejecución, integración ni corrección funcional de los módulos.
- No se observó un límite de capacidad por N=4: el fallo fue semántico en el
  plan concreto.
- No se atribuye el grafo inválido a los pesos o umbrales de C.
- No se infiere que otra política de granularidad hubiera producido un plan
  válido.
- No se reintenta esta célula: hacerlo con el mismo freeze seleccionando sólo un
  resultado posterior introduciría sesgo.
