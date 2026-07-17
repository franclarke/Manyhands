# ADR 0007 — Intentos inmutables e integración bottom-up

## Estado

Aceptado.

## Contexto

Reintentos que sobrescriben estado pierden evidencia. Ejecutar siempre desde el
mismo base commit impide consumir outputs reales. Cherry-pick transitivo puede
duplicar u omitir cambios sin explicación.

## Decisión

Cada intento tiene `InputFingerprint`, worktree y evidencia propios. Un
Execution Base Manifest compone artifacts requeridos. Solo candidatos fresh y
verificados se adoptan. Cada composite produce IntegrationManifest y artifact
nuevo.

El integrator dispone de una reparación semántica acotada antes de pedir una
decisión.

## Alternativas

- **Estado mutable por nodo:** simple, no auditable.
- **Branch larga por nodo con retries:** conserva git, pero mezcla inputs.
- **Attempts inmutables + manifests:** elegida.

## Consecuencias

- Mayor volumen de metadata y retención.
- Reproducibilidad e invalidación precisas.
- Los fallos se clasifican antes de reintentar.
- El orquestador, no el agente, crea commits adoptables.
