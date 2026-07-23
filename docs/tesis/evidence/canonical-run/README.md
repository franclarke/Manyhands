# G4 — Run canónico end-to-end

> **Fecha:** 2026-07-23/24 (UTC) · **Etapa 4** · Recorrido completo
> objetivo → planning adaptativo → ejecución aislada → validación exacta →
> integración bottom-up → entrega verificada.

## 1. Configuración congelada

| Campo | Valor |
|---|---|
| Commit de ManyHands | `673b32e` (run 1) → `9338419` (fix de delivery aplicado antes de publicar) |
| Repositorio objetivo | `expense-splitter` (creado para la tesis, **externo** al repo de ManyHands) |
| Base SHA del objetivo | `1da878de6edd38cefb1ea4d8ceecdceea0bb6acc` |
| Rama destino | `main` |
| Target fingerprint | `20665faf6a1c11f6` |
| Executor de planning | **Codex CLI 0.141.0**, modelo `gpt-5.5`, effort `high` |
| Executor de ejecución | **Codex CLI 0.141.0**, modelo `gpt-5.5`, effort `high` |
| Executor de reparación | idéntico al de ejecución |
| `maxParallel` | 2 |
| Timeout por agente | 300 000 ms |
| Timeout de paso de planning | 900 000 ms |
| Toolchain | Node v24.16.0 · pnpm 7.29.3 · git 2.40.1.windows.1 · Windows 11 Pro |
| Sandbox del agente | worktree aislado del pool; `--sandbox danger-full-access` **dentro del worktree**, nunca sobre el árbol del usuario |

**Nota sobre el modelo (hecho observado).** La cuenta ChatGPT disponible no
admite `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max` ni `gpt-5`
(`invalid_request_error: not supported when using Codex with a ChatGPT
account`), y el default del `config.toml` (`gpt-5.6-sol`) exige una CLI más
nueva. `gpt-5.5` se verificó operativo y es el modelo del run.

## 2. Objetivo del run

Agregar categorías de gasto al divisor de gastos: campo opcional `category` en
`Expense` con validación, `computeCategoryTotals` en el dominio,
`listCategoryTotals` en la API, `renderCategoryBreakdown` en la superficie web y
tests para las tres capas, preservando el comportamiento de balances existente.

El escenario satisface los requisitos del roadmap §10: toca dominio, API, UI y
tests; exige al menos un seam entre unidades; requiere integración de más de un
archivo; y es lo bastante acotado para completarse con presupuesto razonable.

## 3. Resultado (run 1 — `55f8ba9f-d0b7-40ff-88ef-578e9cb1bb5b`)

| Criterio del gate (roadmap §10) | Resultado |
|---|---|
| Termina en `completed` | **Sí.** `lifecycle: completed`; `outcomes: {execution: succeeded, artifact: verified, delivery: published}` |
| `finalSha ≠ baseSha` | **Sí.** `c48835a28c02b4fba62f2911e8d0335e2f83aa01` ≠ `1da878de6e…` |
| El diff final contiene el cambio pedido | **Sí.** 4 archivos, +104/−5 (`run-1.final-diff.patch`) |
| Ancestry y provenance explicables | **Sí.** `c48835a` (integración+reparación) ← `09dcf2e` (`mh-v2: node-api-category-support`) ← `1da878d` (base) |
| Sin criterio requerido `uncovered`/`failed` | **Sí.** Ambas hojas `validation.completed` con `outcome: verified`; integración `verified` |
| Manifest coincide con el candidato validado | **Sí.** `final-eda48c27ad571fb0` sobre `c48835a…` |
| Receipt confirma el mismo SHA | **Sí.** `receiptId delivery:55f8ba9f…:final-eda48c27ad571fb0:c48835a…`, `confirmed: true`, `targetHeadBefore: 1da878de6e…` |
| El target final pasa sus tests | **Sí.** Verificado en **clon limpio** del commit entregado: 1 archivo, **12 tests** (baseline: 5). `pnpm typecheck` exit 0 |

### Topología adaptativa observada

`planning.granularity_assessed` (`c-task/1.0.0`, umbral 3.5, pesos
`{0.3, 0.25, 0.25, 0.2}`):

| Unidad | `C_task` | Decisión | Origen de señales |
|---|---|---|---|
| `category-spending-breakdown` (raíz) | 4.50 | composite | `llm` |
| `domain-category-totals:web-category-breakdown` | 3.08 | leaf | `derived` (unidad fusionada) |
| `api-category-support` | 3.95 | leaf | `llm` |

Decisiones de críticos: `coalesced` (`domain-category-totals` +
`web-category-breakdown`) y `resplit_declined` (`api-category-support`).
Métricas estructurales: profundidad 1, 2 hojas, branching 2, 1 unidad fusionada.

Grafo compilado: 3 nodos, 1 `ConflictConstraint` (ambas hojas tocan
`src/domain/expense.ts` y `tests/expense.test.ts`), 3 waves seleccionadas — el
scheduler serializó correctamente las hojas en conflicto.

### Ejecución e integración

- 2 attempts, ambos con candidato y validación `verified`.
- Agentes Codex: exit 0 en worktrees aislados del pool (2 slots).
- Integración bottom-up con **1 pase de reparación semántica**
  (`integration.repair_attempted pass=1`) → `integration.completed` `verified`.
- 3 artefactos adoptados.

## 4. Artefactos

| Archivo | Contenido |
|---|---|
| `run-1.events.jsonl` | Journal canónico completo de eventos de dominio |
| `run-1.snapshot.json` | Proyección final (`lifecycle: completed`, receipt) |
| `run-1.granularity-metrics.json` | Métricas estructurales diagnósticas del run |
| `run-1.final-diff.patch` | Diff `baseSha..finalSha` del repositorio objetivo |

## 5. Defectos encontrados y corregidos (evidencia → causa raíz → corrección)

El run canónico no salió a la primera. Cada fallo se clasificó, se reprodujo con
una regresión y se corrigió en ManyHands; no se sustituyó el escenario ni se
usó una fixture (roadmap §10).

1. **Scopes idénticos en partes sintetizadas** (run `890f19e1`). 23
   `ConflictConstraint` para 9 nodos. *Causa raíz:* las partes heredaban todos
   los `evidenceIds` del padre, así que el contract-compiler les asignaba el
   scope completo del padre. *Corrección:* herencia de evidencia por slice.
   Commit `673b32e`.
2. **Relaciones colgantes tras el reshaping** (run `8074fd46`,
   `planning.failed`). *Causa raíz:* al fusionar o colapsar unidades no se
   remapeaban `candidateArtifacts`/`candidateSeams`. *Corrección:*
   `absorptionMap` + `remapRelations`. Commit `673b32e`.
3. **Particiones mecánicas incoherentes** (run `88263695`): los 3 agentes
   Codex terminaron exit 0 pero los 3 candidatos fueron rechazados por
   `scope_violation`. *Causa raíz sistémica:* la política determinista puede
   *detectar* exceso de complejidad, pero **no puede inventar el corte
   semántico**; una partición mecánica de paths produce unidades que no
   corresponden al trabajo real (a `part-2` le tocó solo
   `src/domain/expense.ts`, pero implementar el flujo de API exige también el
   tipo del dominio y el test). *Corrección:* se retiró `synthesizeUnits`;
   cuando el Architect no propone sub-unidades se conserva la hoja cohesiva y se
   registra `resplit_declined`. Commit `673b32e`. **Este es un resultado
   empírico del run, no una decisión de escritorio.**
4. **Delivery bloqueada por el propio runtime de ManyHands** (run `55f8ba9f`).
   Tras `final_candidate.verified`, la publicación falló con "The delivery
   target is dirty"; la única entrada de `git status --porcelain` era
   `?? .manyhands/`, el pool de worktrees que ManyHands materializa dentro del
   repositorio objetivo. *Causa raíz:* la verificación de limpieza contaba los
   artefactos del propio orquestador como trabajo del usuario. *Corrección:*
   `targetWorkingTreeIsClean` ignora el directorio runtime y sigue reportando
   sucio cualquier cambio real del usuario. Commit `9338419`.

## 6. Limitaciones y anomalías declaradas

- **Intervención humana:** la aprobación del plan y la aprobación de entrega se
  ejecutaron vía API (`decisions/<id>` y `deliver`) por el operador, como exige
  el modelo de decisiones de `DECISIONS.md` A13/A15. No hubo intervención en
  planning, ejecución, validación ni integración.
- **El pool contamina el descubrimiento de tests del objetivo.** Con
  `.manyhands/worktree-pool/` presente, `pnpm test` ejecutado en la raíz del
  repositorio objetivo descubre también las copias de los slots (15 tests en vez
  de 5 sobre el baseline). No afecta la validación de ManyHands —los slots son
  checkouts limpios del commit base y no contienen `.manyhands/`— pero sí
  invalida una verificación manual hecha en la raíz con el pool presente. **Toda
  verificación del resultado entregado en este documento se hizo en un clon
  limpio.** Recomendación registrada: que ManyHands escriba
  `.manyhands/.gitignore` con `*` para auto-excluirse.
- El fix de delivery (`9338419`) se aplicó **entre** `final_candidate.verified` y
  la publicación del run 1. El journal del run 1 conserva un `delivery.failed`
  previo al `delivery.published`, que es el registro honesto de esa secuencia.
- Reproducibilidad del planning: al ser un modelo remoto, dos runs del mismo
  objetivo producen topologías distintas (ver §7). El gate exige que ambas
  satisfagan los mismos criterios, no que produzcan el mismo commit.


## 7. Reproducibilidad: tres ejecuciones del mismo objetivo

| Run | Commit ManyHands | Planning | Resultado | Estado final |
|---|---|---|---|---|
| `88263695` | `3a52b8b` | 3 nodos, 1 conflicto | 3/3 agentes exit 0, **3/3 rechazados por scope** | `waiting_for_input` |
| **`55f8ba9f`** | `673b32e` (+ `9338419` para publicar) | 3 nodos, 1 conflicto | 2/2 verificados, integración con 1 reparación | **`completed`** |
| `be588dc3` | `a73c6ba` | 4 nodos, 3 conflictos (incluye unidad solo-tests) | 3/3 rechazados por scope | `waiting_for_input` |
| `4cefffbd` | `a73c6ba` | 3 nodos, 1 conflicto (misma topología que el exitoso) | 2/2 rechazados por scope | `waiting_for_input` |

**El gate G4 del roadmap exige dos ejecuciones válidas consecutivas. Se obtuvo
una.** Por lo tanto **G4 queda `PARTIAL`**, con un recorrido completo demostrado
y la causa de los fallos restantes caracterizada.

### Causa raíz de los fallos por alcance (caracterizada)

Bajo la política de alcance `strict`, `ScopeChecker` clasifica todo archivo
modificado que no coincide con `allowedPaths` como fuera de alcance, y el
`ResultRecorder` convierte esa condición en `scope_violation`. Los
`allowedPaths` compilados son las **rutas exactas** que la unidad declaró: las
citadas como evidencia del repositorio más las declaradas como salidas nuevas
(`plannedPaths`).

El objetivo del caso canónico pide explícitamente «cubrir el comportamiento
nuevo en `tests/`», lo que invita al agente a **crear archivos de prueba
nuevos**. El contrato exige que el planificador anticipe y declare toda ruta que
la unidad vaya a crear; el prompt lo indica de forma explícita. En la práctica,
el modelo no lo cumple de forma confiable: en el run exitoso los agentes
editaron únicamente archivos ya existentes, mientras que en los fallidos
crearon archivos no declarados.

**Esta no es una falla del verificador de alcance**, que se comportó según su
contrato en los cuatro runs, ni se corrigió relajando la política ---sería
debilitar un invariante de seguridad---. Es una limitación de la interacción
entre una política de alcance estricta y un planificador que debe predecir todos
los archivos que se crearán. Las líneas de solución, en orden de preferencia,
son: (a) reforzar la obligación de declarar `plannedPaths` y rechazar en los
críticos de plan toda hoja que prometa pruebas nuevas sin declararlas;
(b) permitir que una unidad declare un patrón de directorio acotado para sus
salidas nuevas; (c) convertir la violación de alcance en una propuesta de
enmienda del grafo en lugar de una falla terminal, aprovechando que la
clasificación ya identifica la causa correctamente.

### Mejora de diagnosticabilidad aplicada

El motivo persistido de una violación de alcance volcaba el diff del agente, lo
que hacía ilegible el journal. Ahora nombra las rutas que salieron del contrato
(`scope_violation: changed files outside the declared scope: <rutas>`), de modo
que la evidencia del fallo sea utilizable sin reconstruir el worktree.
