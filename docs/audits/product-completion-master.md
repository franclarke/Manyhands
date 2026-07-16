# Product completion master

Última actualización: 2026-07-15 (America/Buenos_Aires).

Este documento es el índice durable de la auditoría de terminación de producto. La evidencia estructurada y el estado de cada hallazgo viven en `product-completion-ledger.json`; la cobertura manual/E2E vive en `e2e-scenario-matrix.md`. No se considera terminado el trabajo mientras exista un P0, P1 o P2 confirmado abierto.

## Baseline seguro

- Git root confirmado: `C:\Users\franc\Documents\Proyectos\Manyhands`.
- Checkout preexistente muy dirty: 76 archivos tracked modificados al inicio, además de archivos nuevos. No se hizo reset, clean, checkout destructivo ni stash.
- Branch inicial: `main`, ahead 32.
- Runtime observado: Node 24.16.0; pnpm de shell 7.29.3 frente a `packageManager: pnpm@11.7.0`.
- Codex CLI disponible: 0.144.4.
- Servidor de desarrollo preexistente en `127.0.0.1:3000`; no se detuvieron procesos ajenos.
- Baseline de tests válido: 198 archivos, 193 pass, 4 fail, 1 skipped; 1567 tests, 1560 pass, 4 fail, 3 skipped. Las fallas iniciales fueron routing legacy, typography y dos timeouts sensibles a carga.

## Mapa productivo auditado

1. Workspace: creación/edición, identidad de repo, readiness y selección.
2. Planning: invocación LLM, grafo/contratos, critic, persistencia, revisión y aprobación.
3. Execution: target congelado, preflight, provisioning, leases/fencing, scheduler/waves, worktrees, executors y recorder Git.
4. Integration: cherry-pick, repair semántico, journal durable, parent/run validation y propagación bottom-up.
5. Artifact/delivery: final apply, manifest, evidencia, branch delivery, receipt y estados terminales.
6. Projection/UI: durable run events, reducer/selectors, command center, canvas, chat/timeline, approvals y browser de artefactos.
7. Recovery/cancellation: operation lease, repository lease, process supervision, reconciliation y fencing.

## Hallazgos confirmados prioritarios

| ID | Sev. | Subsistema | Estado | Resumen |
|---|---|---|---|---|
| PC-001 | P0 | Git/integration | closed | `isAncestor`, provenance y recovery ahora exigen evidencia Git física válida. |
| PC-002 | P0 | Integration | closed | El handoff explícito conserva el árbol completo, mainline y lineage física. |
| PC-003 | P1 | Terminal truth | closed | Evidencia y éxito terminal exigen artifact material, verificado y entregado; `failed_artifact` no publica éxito. |
| PC-004 | P1 | Delivery/decisions | closed | `/deliver` es la única confirmación, usa lease/CAS y receipt recuperable; `approve_merge` queda sólo como legacy retirado. |
| PC-005 | P1 | Plan approvals | closed | La identidad canónica `approve_plan:rN` atraviesa emitter, CAS, edits, route y recovery; revisiones stale se rechazan. |
| PC-006 | P2 | Windows Git | closed | `safe.directory` es repo-scoped, usa `/` y tiene guard de inventario productivo. |
| PC-007 | P2 | Workspaces | confirmed | Se aceptan múltiples workspaces para la misma identidad física de repo. |
| PC-008 | P1 | DAG execution | closed | D1 queda formalizado como `ordering_only`: ordena dispatch, conserva el mismo base y nunca promete archivos upstream. |
| PC-009 | P1 | Run model/UI | closed | D1, seams y conflictos tienen hechos/tipos/lentes separados; logs legacy recuperan D1 sin promover interfaces a scheduling. |
| PC-010 | P1 | Plan editing/events | confirmed | La proyección full-replacement ya converge en UI, pero runtime/amendment/replan/recovery aún tienen cuatro gaps de autoridad y orden confirmados. |
| PC-011 | P2 | Scheduling | confirmed | La regla compatible-seam ya está corregida y probada; falta evidencia de wave real E2E-022. |
| PC-012 | P2 | Scheduling/UI | confirmed | Ordinal 1..N está corregido en backend/canvas/timeline/chat; falta verificación Chrome. |
| PC-013 | P2 | Dev/runtime | closed | Poll single-flight con backoff y diagnóstico incremental indexado eliminan el crawl de la ruta caliente. |
| PC-014 | P2 | Routing/UI | confirmed | Fixed routing ya rechaza/oculta overrides y permite limpiar legacy; falta verificación Chrome. |
| PC-015 | P3 | UI | confirmed | Los cinco spacing offenders quedaron en escala y la regresión pasa; falta inspección visual Chrome. |
| PC-016 | P3 | Test/durability | confirmed | Poll temporal eliminado y `putWrites` concurrente coalescido; falta rerun full-suite para cierre. |
| PC-017 | P3 | Contracts | closed | Boundary, executable graph y critic bloquean self-seams; proyección legacy no pinta self-edge. |
| PC-018 | P2 | Integration durability | closed | Journal de integración usa CAS versionado, lock durable y fencing exacto. |
| PC-019 | P0 | Integration repair/D6 | closed | Commits inesperados del repair agent se rechazan y limpian antes del handoff. |
| PC-020 | P1 | Task attempts | closed | Throws/cancel de leaf, repair e integración terminalizan el attempt durable. |

## Evidencia y fixes ejecutados hasta ahora

- Reproducción roja real de `SimpleGitRunner.isAncestor` con commits hermanos; fix usa el exit code nativo y sólo interpreta 1 como “no ancestro”.
- `safeGitArgs` normaliza rutas Windows a `/`; smoke read-only contra un repo cross-owner devolvió exit 0.
- Todas las rutas Git directas identificadas en provisioning y final artifact reads usan la excepción exacta por repo, sin config global ni wildcard.
- Un guard estático recorre los subprocess Git productivos y falla ante cualquier invocación literal que omita `safeGitArgs`.
- Regresión Git real multinivel: antes faltaba `a.txt`; ahora el handoff conserva `a.txt` y `b.txt`, mantiene ancestry física y una reentrada conserva el mismo SHA.
- Provenance v2 rechaza commits inexplicados y journals legacy/corruptos; un receipt terminal (`completed`, `gated` o `failed`) se recupera exactamente sin repetir validación ni trazas.
- Cherry-picks redundantes se distinguen de conflictos, se abortan limpiamente y quedan registrados como `already_satisfied` sin contaminar la lineage física.
- Regresión Git real D6: un repair executor que commitea `forbidden.txt` es rechazado, su SHA no llega al handoff seguro y el worktree queda limpio.
- El journal de integración aplica CAS monotónico, lock de filesystem y coincidencia exacta `operationId`/`fencingToken`; el host terminaliza attempts ante throws/cancel.
- Terminal truth usa un predicado compartido de evidencia material: la regresión productiva `failed_artifact` ya no emite `run.evidence.ready`, `approve_merge` ni `run.completed`.
- Delivery valida el manifest antes del side effect Git, persiste receipt + manifest + eventos bajo lease/CAS, adopta reintentos idénticos y reconcilia el crash entre merge y RunRecord sin un segundo merge.
- Approval usa una identidad revisionada única; edición/replan retiran rN, levantan rN+1 y la route impide aprobar una revisión nueva desde un gate stale.
- Verificación actual de terminal/approval/delivery: 13 suites cruzadas, 134 tests pass y web typecheck pass. PC-003, PC-004 y PC-005 quedan cerrados.
- Verificación Git/integration: 68 tests pass; `@manyhands/execution-core` typecheck pass. PC-001, PC-002, PC-018, PC-019 y PC-020 quedan cerrados.
- Dependencias D1 usan una semántica única de extremo a extremo: planner, modelo, runtime, UI y docs declaran `ordering_only`. Una regresión Git real prueba que B conserva como parent el `baseCommit`, no contiene el archivo de A y que ambos cambios aparecen únicamente tras la integración. Las suites consumidoras suman 55 tests verdes y los typechecks de `task-graph`, `contracts`, `decomposer` y `execution-core` pasan. PC-008 queda cerrado.
- `plan.graph.projected` ya reemplaza la estructura completa y cubre tombstones/cold reload, pero una revisión read-only confirmó que ejecución aún podía tomar el planning graph sin patches, approve-amendment podía consumir el gate antes de persistir el seam, replan podía degradar composites a leaf y recovery no superaba hechos estructurales posteriores. PC-010 se reabrió hasta cubrir esos cuatro casos con regresiones.
- Scheduler/conflict-risk ahora considera una `sharedInterface` canónica compatible como evidencia de compatibilidad; incompatibilidades y overlap físico/símbolos concretos siguen siendo high risk. Ocho suites/60 tests y tres typechecks pasan; PC-011 espera un run real E2E-022.
- Los eventos de scheduling persisten ordinal humano separado de seq/correlación; canvas, timeline y chat derivan W1..N incluso con seq global 46/139/201. Treinta tests y web typecheck pasan; PC-012 espera Chrome.
- El launcher dev usa un ciclo single-flight con backoff exponencial. La ruta normal `/api/runs` sólo lee el índice pequeño de diagnósticos; navegación/refresh explícito inspeccionan lotes acotados por mtime/size. Cinco suites/24 tests y web typecheck pasan. En el server vivo, nueve muestras warm quedaron entre 242 ms y 1.12 s y el refresh diagnóstico acotado respondió 200 en 1.03 s. PC-013 queda cerrado.
- Fixed routing ya no expone una selección que runtime rechaza: API bloquea overrides no-null, UI explica herencia fija y permite limpiar metadata legacy; complexity queda sólo para runs históricos. Tres suites/30 tests y web typecheck pasan; PC-014 espera Chrome.
- La guardia tipográfica vuelve a 5/5 verde tras llevar cinco utilities de 10px a la escala de 12px; PC-015 espera inspección Chrome.
- Una interfaz ya no puede fingir coordinación dentro de la misma hoja: boundary y executable graph rechazan el overlap consumed/produced, SeamCritic lo eleva a error, el planner lo prohíbe y la proyección legacy elimina el self-edge. Cinco suites/34 tests pasan. PC-017 queda cerrado.
- El timeout de `putWrites` no era sólo ruido: 500 llamadas hacían 500 rewrites/fsync crecientes. El saver ahora coalesce llamadas concurrentes bajo el lock del thread y sólo resuelve callers tras persistir; el test bajó de 3.55 s aislado a 0.54 s bajo carga. El test de live-start usa una señal determinista del engine y pasó aun cuando el ingreso demoró 1.44 s. PC-016 espera el full-suite final.

## Criterio de cierre

Un issue sólo pasa a `closed` cuando tiene reproducción, causa raíz, solución sistémica, regresión automatizada verde, verificación manual cuando aplica y riesgo residual explícito. El objetivo completo exige además builds/typechecks amplios, auditoría Chrome, runs reales con Codex, matriz E2E cumplida y cero P0/P1/P2 confirmados abiertos.
