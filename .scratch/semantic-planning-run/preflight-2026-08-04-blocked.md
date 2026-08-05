# Preflight del run de validación semántica — 2026-08-04

> Registro de preflight. **Cero celdas abiertas.** No se ejecutó ningún run, no
> se creó ningún target, no se modificó código, documentos ni protocolo.

## Configuración que se iba a congelar

| Elemento | Valor |
|---|---|
| Runtime ManyHands | `main` @ `73e3ed82f69dca051263e5732e9aaa1b8fec92b2` (working tree limpio) |
| Diseño | `docs/tesis/evidence/semantic-planning/next-run.md` |
| Slice | Domain, Application, API, Integration composite (4 unidades) |
| Base congelada requerida | `5da60192cc788032c59c7e7be27696ca0e0a30d7` (Warehouse Control Tower, WC3) |
| Ejecutor/modelo previsto | `claude-code-cli / haiku` (el Claude más barato disponible) |
| Repeticiones | 2 independientes, sin reintentos automáticos |
| Reparaciones | máximo 1, dentro del scope declarado |

## Resultado del preflight: **BLOQUEADO**

### B1 — La base congelada no existe en esta máquina (bloqueante)

El commit `5da60192cc788032c59c7e7be27696ca0e0a30d7` no está en ningún
repositorio Git accesible. Búsqueda realizada:

- `Get-ChildItem -Recurse -Filter "warehouse*"` bajo `C:\Users\franc` (depth 4):
  único resultado `C:\Users\franc\AppData\Local\Temp\manyhands-closure-gate-20260730\warehouse`,
  que contiene sólo logs y **no es un repositorio Git**.
- Barrido de todos los `.git` bajo `Documents`, `.codex`, `AppData\Local\Temp`,
  `Desktop` y `Downloads` (depth 5) con `git cat-file -t 5da60192…`: **NO-HITS**.
- `orders.ts` (archivo de dominio del Warehouse) bajo `C:\Users\franc`
  (depth 8, excluyendo `node_modules`): **NONE**.
- El seed declarado en `docs/tesis/evidence/warehouse/seed/seed-manifest.json`,
  `C:\Users\franc\Documents\Proyectos\warehouse-control-tower-seed`
  (`0f87e457…`), tampoco existe. No se puede reconstruir desde el seed.
- Papelera de reciclaje: 112 elementos, ninguno coincide con `warehouse`.
- Sólo existe la unidad `C:`; no hay otro volumen donde buscar.
- Los targets de la última serie congelada SP1q
  (`warehouse-semantic-sp1-15-20260803` y `-16-20260803`) tampoco existen.
  SP1q quedó congelado pero **nunca se ejecutó**: sus directorios de salida en
  `manyhands-semantic-preflight-runtime-20260803\runs\sp1q-01` están vacíos.
- No hay bundle, pack ni patch del Warehouse dentro de este repositorio.

**Consecuencia:** el paso 1 del protocolo ("crear dos targets limpios e
independientes desde el mismo commit base") no se puede satisfacer. Los pasos 2
a 6 dependen de él. No se abre ninguna celda.

### B2 — No existe evaluador externo correspondiente al slice de 4 unidades

El instrumento externo congelado de T1 es
`docs/tesis/evidence/g6/criteria-t1.json` + `docs/tesis/evidence/scripts/run-g6-evaluator.mjs`,
con 10 criterios. Tres de ellos —`behaviour-express-first`, `probe-single-json`
y `probe-deterministic`— pertenecen a fulfillment y probe, capas que
`next-run.md` **excluye explícitamente** de esta validación.

Por lo tanto el paso 6 ("evaluar cada commit candidato exacto con el evaluador
externo correspondiente") no tiene instrumento hoy. Habría que autorizarlo,
escribirlo y congelarlo antes de abrir la celda 1. No se escribió ninguno: eso
es una decisión de criterios y no se toma sin autorización.

### R1 — Espacio en disco (riesgo material)

`C:` tiene **2,2 GB libres** sobre 400 GB. Una celda clona el target e instala
dependencias en el pool de worktrees, además de los clones limpios del
evaluador externo. Es previsiblemente insuficiente para dos celdas.

### R2 — Toolchain fuera del de registro

`node -v` → `v24.16.0`; `pnpm -v` → `7.29.3`. El toolchain de registro de la
tesis es Node `22.23.1` / pnpm `7.29.3`, y `retry-11` fue explícitamente
descalificada como medición canónica por haber corrido bajo `v24.16.0`. El
runtime aislado 22.23.1 de `manyhands-thesis-freeze-4` ya no está en disco.

## Lo que sí está disponible

- **Modelo económico: disponible.** `claude-code-cli` con modelo `haiku` está en
  la política de routing (`packages/execution-core/src/routing/policy.ts:50`),
  el perfil pasa `--model` sin traducir
  (`packages/execution-core/src/executor/profiles/claude-code.ts:19`), planning
  V2 acepta ese executor
  (`apps/web/src/lib/server/runs/v2/run-coordinator-host.ts:176`) y el CLI está
  instalado (`~/.local/bin/claude`, `2.1.220`). El modelo **no** es el bloqueo.
- **El fix de seams ejecutables está en `main`.** El diagnóstico
  `executable_seam_requires_materialization` vive en
  `packages/decomposer/src/planner/planning-envelope.ts` con test en
  `tests/planning-envelope.test.ts`. La rama `codex/semantic-planning-v1`
  (`c37d11f`) conserva la serie SP1 completa y su `protocol.md`.

## Veredicto

**FAIL por no ejecución.** 0/2 celdas. No es atribuible a la política de
planificación ni al producto: es pérdida de un activo de infraestructura (el
repositorio base congelado). No se declara PASS ni PARTIAL, no se sustituyó la
base por otra y no se reescribió evidencia previa.

## Qué no se concluye

- No se concluye nada sobre el rediseño de planning semántico ni sobre el
  rechazo de seams `logical`: no se generó ningún plan.
- No se concluye que SP1q, SP1p o cualquier serie anterior cambien de resultado.
- No se concluye que la base sea irrecuperable fuera de esta máquina; sólo que
  no está en ella.
