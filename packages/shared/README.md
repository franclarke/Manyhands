# @manyhands/shared

> Tipos base y helpers puros compartidos por todo el monorepo. Es la capa más baja: no depende de ningún otro paquete.

## Rol en el pipeline

Soporte transversal. Define los tipos primitivos (validados con Zod) y utilidades que el resto de los paquetes reutiliza para hablar el mismo idioma.

## Conceptos clave

- **Identificadores y timestamps validados.** `EntityId` e `IsoTimestamp` no son `string` sueltos: pasan por un esquema Zod que garantiza forma consistente en todas las fronteras.
- **Helpers de conjuntos deterministas.** Operaciones de unicidad/intersección estables, usadas por scheduling y conflict-risk.

## API pública

| Símbolo | Tipo | Descripción |
|---|---|---|
| `NonEmptyStringSchema`, `EntityIdSchema`, `IsoTimestampSchema` | schema Zod | Primitivos validados (+ tipos inferidos) |
| `nowIso()` | función | Timestamp ISO actual |
| `uniqueValues`, `intersectValues` | función | Unicidad / intersección de arrays |
| `clamp01`, `pairKey` | función | Clamp a [0,1] / clave canónica de un par |

## Dependencias

Ninguna. **Usado por:** todos los paquetes.
