# ADR 0005 — Contratos de obligaciones y validación por evidencia

## Estado

Aceptado.

## Contexto

Congelar comandos de test demasiado temprano vuelve frágil el plan. Confiar solo
en exit code o tests generados permite falsos positivos, criterios sin cubrir y
debilitamiento de suites.

## Decisión

Los contratos versionan goal, scope, seams, artifacts y obligaciones de
validación. La receta ejecutable se compila contra el repo vigente. Una Evidence
Matrix relaciona cada criterio con evidencia sobre un commit exacto.

Se registra baseline, se detecta debilitamiento de tests y se usa negative
control cuando es viable. Flaky y uncovered nunca se presentan como verified.

## Alternativas

- **Comandos fijos en planning:** simples, pero prematuros.
- **El agente decide cómo validarse:** flexible, pero no independiente.
- **Obligaciones estables + recipe tardía:** elegida.

## Consecuencias

- Hace falta `ValidationRecipeCompiler` y schema de evidencia.
- Los sandboxes de validación aumentan costo.
- `completed` adquiere significado fuerte y verificable.
- Aceptar riesgo humano no reescribe evidencia fallida como success.
