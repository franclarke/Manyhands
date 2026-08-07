# Prompt para implementar el handoff de fiabilidad

> **Documento histórico.** Describe el protocolo de candidatos
> (`PlanningEnvelope`, `CandidatePlan`, `planCandidates`, `WorkBreakdownPlanner`),
> **retirado el 2026-08-06** en la etapa 3F de
> [`docs/plans/2026-08-05-robust-graph-execution-redesign.md`](../plans/2026-08-05-robust-graph-execution-redesign.md).
> Los módulos que nombra ya no existen. Se conserva como registro de por qué
> se construyó y por qué se retiró; no es guía del sistema actual.

Copiá y pegá todo el bloque siguiente como instrucción para el agente que
retome el trabajo.

```text
Trabajá de forma autónoma en ManyHands.

## Fuente inicial

Buscá y leé completo, antes de modificar nada, este único archivo de handoff:

docs/audits/system-reliability-redesign-handoff.md

Repositorio esperado:
C:\Users\franc\Documents\Proyectos\Manyhands

El handoff es la fuente operativa inicial. Después de leerlo, inspeccioná sólo
los archivos, símbolos, tests y documentos que el handoff referencie o que sean
necesarios para verificar una decisión. No hagas un escaneo masivo ni inventes
contexto.

## Rama de trabajo y entrega

La rama de trabajo es:

codex/system-reliability-redesign

Para acceder desde la raíz del repositorio:

git switch codex/system-reliability-redesign

Si la rama no existe localmente pero existe en el repositorio local, verificá su
referencia antes de crear nada. No trabajes directamente sobre `main` hasta la
integración final.

Al finalizar toda la implementación y todos los gates, integrá localmente la
rama en `main`:

1. confirmá que no haya cambios ajenos sin guardar;
2. verificá que `main` exista y esté limpio;
3. ejecutá `git switch main`;
4. ejecutá `git merge --no-ff codex/system-reliability-redesign` con un mensaje
   claro;
5. verificá el resultado, el árbol y los tests/gates finales;
6. no hagas push.

Si `main` no está limpio, no borres ni escondas cambios: detené la integración,
documentá el bloqueo y dejá la rama de trabajo lista para continuar.

## Objetivo

Implementá lo pendiente del handoff para que el flujo sea:

envelope determinista
-> alternativas semánticas acotadas del Planner
-> validación fail-closed de candidatos
-> selección determinista y explicable
-> graph/contracts/seams/ownership inmutables
-> scheduler y ejecución sin reinterpretar intención
-> persistencia completa de decisiones y fallas

No te limites a proponer un plan: implementá el alcance posible, verificálo y
documentá con precisión cualquier bloqueo real.

## Preflight obligatorio, sin modificar archivos

git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff HEAD

Confirmá raíz, rama y cambios preexistentes. Preservá cualquier cambio ajeno y
trabajá alrededor de él. No uses `reset`, `clean`, checkout destructivo ni
stash global.

## Restricciones

- No hagas push.
- No modifiques `docs/tesis/main.tex` ni `docs/tesis/presentacion.tex`.
- No modifiques, borres ni reformules evidencia histórica de G6/Warehouse.
- No cambies fórmulas, estímulos, umbrales, oráculos, freezes o resultados G6.
- No ejecutes runs pagos ni experimentos nuevos con LLM.
- No agregues dependencias salvo necesidad demostrada.
- No agregues dependencias nuevas a `@manyhands/core`.
- No conviertas fallas en éxitos ni declares un gate verde sin ejecutarlo.
- Todo cambio conductual debe seguir TDD estricto.
- Ejecutá `pnpm build` antes de cualquier test que consuma `dist/`.

No edites sin coordinación explícita estos archivos del trabajo paralelo:

- `packages/decomposer/src/granularity/strategy-selector.ts`
- `packages/decomposer/src/granularity/adaptive-planning.ts`
- `packages/decomposer/src/granularity/planning-brief.ts`
- `packages/decomposer/src/planner/prompt.ts`
- `packages/decomposer/src/planner/work-breakdown.ts`

Si la integración exige tocar alguno, explicá primero la frontera y el cambio
mínimo; no sobrescribas trabajo paralelo silenciosamente.

## Método de trabajo

Usá un plan corto con una sola tarea en progreso. Para cada cambio:

1. inspeccioná código y tests relevantes;
2. describí causa raíz y comportamiento esperado;
3. escribí una regresión roja por la causa correcta;
4. corré `pnpm build` cuando corresponda;
5. implementá el fix mínimo y profundo;
6. repetí build y test focalizado hasta verde;
7. actualizá docs/ADR si cambia una frontera;
8. normalizá archivos propios a LF;
9. corré `git diff --check` y revisá `git diff --numstat`;
10. hacé un commit local pequeño y coherente;
11. recién entonces avanzá.

No hagas una reescritura preventiva. Preferí una migración vertical compatible.

## Orden de implementación

### A. Contrato tipado del candidato

Escribí primero una prueba roja que demuestre que un `WorkBreakdown[]` sin
ownership y seams completos no puede llegar a selección.

Definí la frontera mínima entre Planner y Graph Compiler. Cada candidato debe
conservar como datos tipados y serializables:

- identidad y hash estable;
- snapshot y digest del objetivo;
- unidades semánticas y scopes declarados;
- criterios `leafAcceptance`, `seamAcceptance` y `globalAcceptance`;
- owner local, owner de integración o ambos con roles compatibles;
- productor, consumidor, compatibilidad y validación de cada seam;
- obligaciones de contrato cross-layer;
- diagnóstico estructurado si no puede validarse.

Podés extender el resultado existente o usar un adaptador explícito, pero no
infieras ownership desde `acceptanceIntentIds`, paths compartidos o forma del
árbol. No escondas reglas de corrección únicamente en prompts.

### B. Exploración acotada y flujo productivo

Escribí una prueba roja que demuestre que, si el envelope exige un rango de
candidatos, el host no puede llamar una sola vez a `plan()` y continuar como si
hubiera comparado alternativas.

Conectá `planCandidates()` o la API equivalente respetando:

- presupuesto del envelope;
- deduplicación por hash;
- ausencia de retries semánticos abiertos;
- preservación de fallos pre-candidate;
- replay explícito de candidatos congelados;
- compatibilidad de lectura de runs históricos.

No fabriques candidatos separando paths o archivos mecánicamente.

### C. Validación fail-closed antes de seleccionar

Agregá regresiones para rechazar seam faltante, ownership ambiguo, criterio sin
dueño, criterio global duplicado como validación local incompatible, scope fuera
del grounding, contrato sin productor/consumidor/test de compatibilidad, hoja sin
validación observable y dependencia semántica representada sólo por paths.

Sólo candidatos estructuralmente válidos entran a la política. El scheduler
agenda; no reinterpreta intención. Executor e integrator ejecutan contratos
fijados; no inventan alcance.

### D. Selección reproducible y replan

Usá la selección determinista existente sobre el conjunto validado. No muevas la
fórmula, pesos, umbrales ni parámetros congelados de G6.

Persistí envelope, versión de política, hashes, gates, scores, ganador,
desempate y `replan_required` con una razón estructurada y acotada.

Probá que el mismo envelope, snapshot, conjunto, configuración y versión de
política producen la misma selección serializada. Probá también que A/B/C o una
política futura puedan evaluarse sobre candidatos idénticos, sin llamar otra vez
al LLM.

### E. Eventos, snapshots y diagnóstico

Extendé eventos y reducer para reconstruir candidatos, rechazos, scores, ganador
y motivo de replan. Conservá la clasificación de errores.

Si tocás UI, reutilizá el workspace existente. No agregues destinos primarios
Tasks/Planning/Integration/Interfaces ni estados imperativos de nodos. Un
diagnóstico contextual debe explicar por qué se eligió o rechazó un plan.

### F. Recuperación y verificación final

Probá que repairs, reconciliaciones y retries no borren intención física,
criterios, seams ni evidencia. Probá que las fallas de planning, compilación,
ejecución e integración no se conviertan en éxito.

Ejecutá en este orden:

pnpm build
pnpm exec vitest run <tests focalizados>
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm web:build
git diff --check
git diff --numstat

Si un comando falla, investigá la causa raíz y corregíla con TDD. Si es
preexistente o externo, preservalo y documentalo con evidencia.

## Subagentes

No hagas fan-out innecesario. Si usás subagentes, limitálos a tareas
independientes y preferentemente read-only: revisar un módulo, auditar tests o
verificar un diff. Nunca permitas dos ediciones simultáneas de los mismos
archivos. El agente principal debe verificar cada conclusión en código o tests.

## Documentación y commits

Actualizá cuando corresponda:

- `docs/audits/system-reliability-redesign.md` para hallazgos o cambios de
  arquitectura;
- un ADR si cambia una frontera arquitectónica;
- el handoff sólo para reflejar estado verificado, sin borrar límites ni
  reformular evidencia histórica.

Antes de cada commit: normalizá a LF, corré `git diff --check`, revisá
`git diff --numstat`, confirmá que no haya cambios ajenos y ejecutá el test
focalizado. Usá commits locales pequeños y descriptivos.

## Criterio de finalización

No termines sólo con un plan. Declaralo completo únicamente si los tests
demuestran que:

1. mismo conjunto y configuración producen la misma selección;
2. la política no inventa tareas, paths ni seams;
3. criterios globales no se duplican como obligaciones locales incompatibles;
4. seam incompleto u ownership ambiguo no llega a ejecución;
5. cambios cross-layer conservan obligaciones verificables;
6. una reparación conserva intención y evidencia;
7. existe replan con diagnóstico concreto;
8. A/B/C se comparan sobre candidatos idénticos;
9. eventos y snapshots reconstruyen la decisión;
10. decisiones pendientes no bloquean trabajo independiente;
11. errores clasificados no se convierten en éxitos;
12. todos los gates globales terminan correctamente.

Si algo queda pendiente, documentá qué se implementó, qué falló, causa raíz,
intentos de corrección, archivo/contrato/autorización faltante y siguiente paso
seguro. No lo presentes como terminado.

## Integración final en main

Antes de integrar, confirmá todos los commits locales y el resultado de todos los
gates. Luego:

git status --short
git switch main
git status --short
git merge --no-ff codex/system-reliability-redesign -m "merge: integrate system reliability redesign"
git status --short
git log --oneline --decorate -8

No hagas push. Si `main` tiene cambios, conflictos o no está limpio, no uses
operaciones destructivas: detené la integración, preservá la rama y documentá
el bloqueo.

## Informe final obligatorio

Respondé con:

- resumen de cambios;
- archivos modificados;
- commits locales y commit de integración en `main`;
- regresiones rojas y fixes aplicados;
- comandos de verificación y resultados exactos;
- limitaciones y deuda remanente;
- confirmación explícita de que no hiciste push.

No afirmes superioridad experimental de ninguna política ni reinterpretes G6.
```
