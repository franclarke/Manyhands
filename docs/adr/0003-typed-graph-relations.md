# ADR 0003 — Relaciones tipadas y artifacts explícitos

## Estado

Aceptado.

## Contexto

Una arista `dependency` no distingue ownership, flujo de archivos, compatibilidad
de interfaz o riesgo de colisión. La semántica `ordering_only` tampoco permite
que un consumer vea el resultado real de un producer.

## Decisión

El grafo separa:

- `parentId` para ownership;
- `ArtifactRequirement` para disponibilidad material;
- `SeamBinding` para compatibilidad paralela;
- `ConflictConstraint` para scheduling.

Las relaciones son canónicas y normalizadas. `ExecutionBaseBuilder` materializa
solo artifacts requeridos y registra la composición.

## Alternativas

- **Dependency genérica con type opcional:** menos cambios, pero permite estados
  ambiguos y lógica condicional dispersa.
- **Todo como artifact:** uniforme, pero confunde ownership y riesgo.
- **Relaciones separadas:** elegida; más tipos, semántica verificable.

## Consecuencias

- El modelo persistido cambia y requiere migración.
- Readiness se vuelve explicable.
- El scheduler no puede convertir riesgo en dependencia.
- Dependencias descubiertas generan graph amendments, no hacks locales.
