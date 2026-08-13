# Handoff operativo — Stage 3 cerrado, Stage 4 listo para iniciar

## Estado exacto

- **Repositorio:** `C:\Users\franc\Documents\Proyectos\Manyhands`
- **Branch:** `codex/correctness-first-full-implementation`
- **Stage 3 code candidate:** `4e495abd0805c62f7641dc73c19b82ffc7eedc38`
- **Candidate tree:** `84a59b1d9db2ee978d87b6a079dafee281e38a64`
- **Stage 3 documentation commit de entrada:**
  `092fb903440c85f82aef5cdbe4b720ab7f8f29ec`
- **GR:** `pass`
- **Stage 4 / GRepo:** `not_started`
- **Stages 5–11:** `not_started`

La evidencia técnica que cierra GR está en
[`docs/audits/stage-3/README.md`](../audits/stage-3/README.md). Este handoff
prepara la reanudación; no inicia Stage 4 ni reemplaza al plan canónico.

## Configuración recomendada

Para Stage 4 se recomienda:

- **modelo:** `gpt-5.6-sol`;
- **esfuerzo principal:** `high`;
- **`ultra`:** sólo para resolver una ambigüedad arquitectónica acotada que no
  cierre con source/tests o para la única revisión independiente de GRepo;
- **concurrencia normal:** conductor más, como máximo, dos hijos con ownership
  disjunto; explorers read-only y un reviewer final independiente;
- **modelos live:** ninguno.

Si la herramienta obliga a elegir un único esfuerzo para toda la ejecución,
elegir `high`. Stage 4 es trabajo determinista de modelo de dominio, identidad,
Git y queries; `ultra` continuo tiene un costo alto y no sustituye tests de
determinismo, fixtures adversos ni una revisión acotada.

## Lectura obligatoria antes de editar

1. [`PRODUCT.md`](../../PRODUCT.md).
2. [`AGENTS.md`](../../AGENTS.md).
3. [Plan correctness-first canónico](../plans/2026-08-12-correctness-first-system-redesign.md),
   completo, con foco en §§ 9.1–9.3 y Stage 4 / GRepo.
4. [Runbook de ejecución](../agents/correctness-first-execution.md).
5. [Stage 0 baseline](../audits/stage-0/README.md),
   [productive route](../audits/stage-0/productive-route.md) y
   [transition ledger](../audits/stage-0/transition-ledger.md).
6. [Stage 1 / G1](../audits/stage-1/README.md).
7. [Stage 2 / GD0+GD1](../audits/stage-2/README.md).
8. [Stage 3 / GR](../audits/stage-3/README.md).
9. [Estudio longitudinal exploratorio](../plans/2026-08-13-exploratory-longitudinal-study.md)
   para entender el límite de presupuesto; no debe ejecutarse en Stage 4.
10. Este handoff nuevamente, después de recorrer el source actual.

## Objetivo normativo de Stage 4

Construir verdad de repositorio versionada, determinista y consultable:

- hechos con provenance y estado epistémico
  `unknown | known | partial | conflicting`;
- `RepositoryView` inmutable sobre base exacta y overlays adoptados exactos;
- `ResourceCatalog` por vista con identidad canónica, alias/containment y overlap
  `yes | no | unknown`;
- identidad semántica de recursos separada de runtime leases;
- queries con presupuesto, política de generados, symlinks/gitlinks explícitos y
  digest estable.

GRepo pasa sólo si base, overlays y presupuesto idénticos producen digest y
respuestas idénticos; los casos adversos tienen outcomes explícitos; `unknown`
no se interpreta como ausencia de conflicto; y ninguna afirmación del planner
carece de provenance.

## Estado real del source al cerrar Stage 3

### Fundación que se debe conservar

- `packages/repository-index/src/fast-indexer.ts` abre una vista Git exacta,
  enumera con `rg`, cachea por base SHA/perfil y extrae estructura TS/JS.
- `packages/repository-index/src/snapshot.ts` ya produce un snapshot y digest
  deterministas con estados de inspección parciales.
- `packages/contracts/src/canonical-reference.ts` ya define
  `RepositorySnapshotRef` y `RepositoryViewRef`.
- Los contratos distinguen `ResourceClaim` semántico de `RuntimeLeaseClaim`.
- `packages/task-graph` ya falla cerrado cuando el overlap entre claims no se
  puede decidir.
- `apps/daemon/src/current-lifecycle-adapters.ts` construye el snapshot exacto
  antes de invocar al planner transicional.

### Gaps que Stage 4 debe cerrar

- No existe todavía el `RepositoryModel` productivo descrito por el plan.
- No existe una `RepositoryView` inmutable que componga base y overlays
  adoptados con identidad exacta.
- No existe el `ResourceCatalog` completo con alias, containment y overlap
  tri-state para recursos generales del repositorio.
- No existe un puerto de queries con presupuesto y provenance; el planner actual
  recibe el snapshot completo.
- El index actual está orientado a TypeScript/JavaScript y no resuelve de forma
  general generados, renames, symlinks, gitlinks y recursos no-source.
- Consumidores de `packages/decomposer` leen directamente
  `repositorySnapshot.index` y `repositorySnapshot.evidence`; son inventario de
  migración futura, no permiso para cortar el planner en Stage 4.

## Límites de stage

Stage 4 **no** debe:

- implementar el planner semántico o su compiler (Stage 5);
- hacer el cutover productivo del planner ni retirar todos sus scans (Stage 6);
- introducir manifests de artifacts de Stage 7 como arquitectura paralela;
- ejecutar el smoke live de Stage 8;
- iniciar el estudio post-`GProd`;
- crear una representación V3 paralela a los contratos canónicos.

Los overlays de Stage 4 deben aceptar referencias exactas mínimas y testeables,
sin anticipar la materialización final de artifacts. Los scans ad hoc se retiran
sólo cuando existe la query equivalente y el consumidor correspondiente migra en
su stage normativo.

## Plan TDD recomendado

### 1. Preflight y cartografía

- confirmar Git root, branch, HEAD/tree, status y diff;
- comprobar ancestry del candidate GR y preservar cambios ajenos;
- recorrer `repository-index`, contracts, task graph, daemon y consumidores del
  snapshot;
- inventariar cada lectura directa, cache, acceso al filesystem y supuesto de
  ausencia de conflicto.

### 2. Congelar contratos y REDs de GRepo

Antes de producción, crear regresiones para:

- digest o respuesta no determinista con base/overlay/budget idénticos;
- overlay que lee una versión distinta de la adoptada;
- rename, alias o nesting que produce dos identidades incompatibles;
- generated file, symlink o gitlink tratado implícitamente como source común;
- query agotada que convierte `unknown`/`partial` en `known` o `no`;
- overlap desconocido que permite readiness concurrente;
- claim sin provenance;
- cache reutilizada después de cambiar la derivación sin cambiar su perfil.

### 3. Slice vertical mínima

Una primera slice adecuada es:

```text
exact Git base + declared overlay refs
  -> immutable RepositoryView identity
  -> deterministic facts with provenance
  -> view-scoped ResourceCatalog
  -> one budgeted query
  -> canonical digest and fail-closed overlap result
```

Validar cada tramo antes de ampliar lenguajes o tipos de recurso. Mantener la
dirección `apps -> packages/repository-index -> contracts/shared` y evitar que
framework, daemon o planner definan una segunda autoridad.

### 4. Gate y retiro acotado

- fixtures y repos Git reales pequeños para determinismo;
- matriz rename/nesting/generated/symlink/gitlink;
- repetición en proceso fresco para cache/digest;
- typecheck/build de paquetes afectados, root TypeScript, lint acotado, suite
  completa con `--retry=0` y `git diff --check`;
- una revisión independiente, read-only y limitada a GRepo;
- documentar `docs/audits/stage-4/README.md`, actualizar el plan a `pass`, crear
  commits focales y detenerse antes de Stage 5 salvo nueva autorización.

## Presupuesto y criterio de corte

Usar como orientación un máximo del **15% de la cuota disponible antes del
20/8** para Stage 4, preservando la reserva global descrita en el estudio. No es
una obligación de gastar esa cantidad. Para contener costo:

- máximo dos workers simultáneos y sólo con archivos disjuntos;
- tests focales primero y suite completa en el gate;
- no repetir un fallo determinista sin cambiar su causa;
- una única revisión independiente acotada;
- deuda posterior se registra si no viola GRepo; no se expande recursivamente el
  gate.

Si no puede cerrarse GRepo correctamente dentro del margen, conservar REDs,
diffs y hallazgos y declarar el stage incompleto. No reducir la semántica de
`unknown`, provenance o identidad para cumplir una fecha.
