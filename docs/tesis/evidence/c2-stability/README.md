# Estabilidad C

Estado: **PASS**.

## Configuración congelada para el gate

- ManyHands: `55846028fac63fd523ee784448b899bed5ecfa51`;
- política: `adaptive-utility/2.0.0-pilot`, condición `C`;
- target base: `1da878de6edd38cefb1ea4d8ceecdceea0bb6acc`;
- objetivo, modelo `gpt-5.5`, esfuerzo `high` y configuración de ejecución:
  idénticos en ambas repeticiones;
- ejecución: secuencial, sobre dos clones independientes del mismo commit.

## Resultado

| Run | Run id | Entrega | Reloj journal | Tokens | Frontera | Reparaciones |
|---|---|---:|---:|---:|---|---:|
| 1 | `820d370e-b6fd-4f6e-bcd6-5c809494dd02` | sí | 368 s | 55 955 | 1 hoja, profundidad 0 | 0 |
| 2 | `4b7c75b8-8cb6-46c9-bca4-3a999ad18783` | sí | 371 s | 59 106 | 1 hoja, profundidad 0 | 0 |

Los dos journals contienen 31 eventos válidos y pliegan a `completed`. Las
matrices de evidencia registran cinco criterios satisfechos y outcome
`verified` sobre los commits entregados. Los receipts confirman que ambas
entregas partieron de la misma base.

C no forzó fan-out. El composite raíz fue divisible, pero eligió hoja porque
`splitAdvantage` fue `-0.2005` y `-0.2271`, por debajo del margen mínimo `0.15`.
Los candidate tree hashes difieren porque la planificación viva produjo nombres
y evidencia de candidato no idénticos; la decisión observable de política fue
estable.

## Verificación externa

Cada commit entregado se instaló y verificó en un clon limpio independiente:

- run 1: `f86c5c71ddfec064b53f4473477d7bdd8099ad42`, 9 tests y typecheck PASS;
- run 2: `cf0810b535f8ba4bfd43b8081640a5fa28aed4ad`, 10 tests y typecheck PASS.

En ambos clones `pnpm-lock.yaml` mostró una diferencia de stat/normalización en
el worktree, pero su hash Git de contenido coincidió exactamente con `HEAD`; no
hubo modificación material del lockfile. Véanse los archivos `verification.md`
de cada run.

## Alcance de la conclusión

Este gate demuestra repetibilidad de entrega y explicación C sobre una tarea
mediana. No demuestra que C supere a una condición alternativa ni que el
Planner produzca topologías idénticas. Esa pregunta queda reservada al estudio
Warehouse posterior al freeze.
