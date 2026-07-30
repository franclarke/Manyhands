# 02 — El replay de C1 es honesto

**What to build:** replayar un journal historico con condicion C1 o funciona fielmente, o falla ruidosamente; nunca se reinterpreta en silencio bajo la semantica de la politica C actual.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Regresion roja primero, que falle por la razon correcta: hoy un journal C1 se resuelve a C sin aviso.
- [x] Se elige y se documenta una de las dos salidas: replay fiel, o rechazo explicito.
- [x] Si se elige rechazo, la reachability muerta de la politica legacy se retira.
- [x] Los documentos que afirman que C1 sigue replayable quedan alineados con el codigo.

## Cierre — 2026-07-30

**Salida elegida: rechazo explícito.** La política `C_task` que produjo los
journals C1 no está implementada en este build, así que un replay fiel no es
reconstruible sin reintroducir código que nadie ejercita.

- **RED por la razón correcta:** el test que existía afirmaba el defecto
  (`"exposes A/B/C and normalizes historical C1/C2 records to C"`). Se reemplazó
  por la invariante correcta y falló primero con
  `C1: expected [Function] to throw an error`.
- **GREEN:** `resolveGranularityCondition` rechaza `C1` y `C2` con un mensaje que
  nombra la versión de política vigente y la salida admisible. `A`, `B`, `C` y
  `undefined` siguen resolviendo igual, y un valor desconocido sigue fallando con
  su propio mensaje.
- **Reachability muerta retirada:** `granularityPolicyFor` y
  `LEGACY_POLICY_BY_CONDITION` existían "para replay de C1" y no tenían ningún
  llamador productivo — sólo el test. Ambos eliminados.
- **Evidencia intacta:** `StoredGranularityConditionSchema` sigue aceptando
  `C1`/`C2`, así que los run records históricos se leen sin cambios. Lo que se
  rechaza es *planificar* bajo una condición histórica.
- **Documentos alineados:** `docs/adr/0012-utility-based-granularity-selection.md`
  afirmaba "C1 se conserva para replay histórico"; queda corregido en el propio
  documento, no sólo acá.
- Gates: 7/7 en `tests/granularity-policy-conditions.test.ts`; 26/26 en el
  conjunto afectado (policy conditions, utility policy, granularity strategy
  event); typechecks de `@manyhands/decomposer` y web PASS con Node 22.23.1.
