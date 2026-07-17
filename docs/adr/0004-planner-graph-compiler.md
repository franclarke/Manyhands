# ADR 0004 — Separar Planner y Graph Compiler

## Estado

Aceptado.

## Contexto

Pedir a un único modelo que comprenda el objetivo, diseñe boundaries, asigne IDs,
produzca scopes y emita un DAG válido hace difícil distinguir errores semánticos
de errores mecánicos.

## Decisión

El Planner produce `WorkBreakdown` grounded y explicable. El Graph Compiler
produce una `GraphRevision` ejecutable y versionada. Critics independientes
validan completitud, atomicidad, relaciones, contratos, scope, riesgo y evidencia.

## Alternativas

- **LLM produce TaskGraph final:** menor latencia y código, pero baja
  controlabilidad.
- **Planner totalmente determinista:** reproducible, pero no resuelve cortes
  semánticos complejos.
- **LLM semántico + compiler/critics:** elegida.

## Consecuencias

- Aparece un modelo intermedio nuevo.
- Las correcciones mecánicas pueden ser deterministas.
- Las preguntas humanas se elevan antes de compilar una falsa certeza.
- La falla del LLM sigue siendo explícita; no hay fallback silencioso.
