# Checkpoint 3 — métricas y estabilidad

Estado: **completed**.

## Alcance cerrado

- Task 9: derivación no censurada conserva tiempo y tokens de runs fallidos,
  distingue cero de dato no disponible y rederiva las doce celdas de G5.
- Task 10: C-G1 y C-G2 cerrados con suites amplias, builds y dos runs
  productivos consecutivos sobre el mismo objetivo y commit.

## Evidencia

- commits previos: `cf6db65` (métricas) y `5584602` (preflight);
- C-G1: [`../../gates/c2-g1-results.md`](../../gates/c2-g1-results.md);
- C-G2: [`../../gates/c2-g2-results.md`](../../gates/c2-g2-results.md);
- runs: [`../../c2-stability/README.md`](../../c2-stability/README.md).

## Resultado y límite

Las dos repeticiones entregaron y pasaron verificación externa. C eligió una
hoja en ambas; eso confirma estabilidad de la decisión bajo este objetivo, no
superioridad de la política ni determinismo textual del Planner. La próxima
evidencia debe provenir de los assets y drivers Warehouse pre-registrados.
