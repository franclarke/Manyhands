# Progreso — C2 + Warehouse

> **Plan rector:** [`../../../plans/2026-07-24-c2-warehouse-thesis-program.md`](../../../plans/2026-07-24-c2-warehouse-thesis-program.md)
> · **Inicio:** 2026-07-24 · **Estado general:** en ejecución.

## Reglas del ledger

- Un checkpoint requiere documentación, tests/comandos registrados y commit.
- Los cambios conductuales siguen TDD rojo → verde → refactor.
- `pilot` y `final` nunca comparten runs de versiones diferentes.
- Ningún resultado C2 se incorpora a la tesis antes del freeze y los gates.
- No se hace push.

## Checkpoints

| Checkpoint | Tasks | Estado | Commit | Verificación |
|---|---:|---|---|---|
| 1 — C2 core | 1–4 | **completed** | `74f001f`, `950dd18`, `e94b4b8`, `d9e5b41` | 45 tests PASS + 2 package typechecks |
| 2 — Productive integration | 5–8 | **completed** | `bf0ee82`, `d96cc24`, `a424ade`, `7f7d9b4`, `18e6aab` | 50 tests PASS + 3 typechecks + 2 builds |
| 3 — Metrics and stability | 9–10 | **completed** | `cf6db65`, `5584602`, commit de cierre | 2/2 entregas + clones limpios |
| 4 — Warehouse assets and drivers | 11–12 | **completed** | `550f81c`, `c0d4be8` | 26 tests + seed verify + 8-cell dry-run |
| 5 — Pilot construction | 13 | **in progress; external quota pause** | commits formativos versionados | 0/8 verificados; reanudar W1 después de 2026-07-30 00:37 |
| 6 — Freeze | 14 | pending | — | — |
| 7 — Final construction and comparison | 15–16 | pending | — | — |
| 8 — Results and thesis | 17–18 | pending | — | — |

### Checkpoint 3 — estado interno

| Task | Estado | Evidencia |
|---|---|---|
| 9 — métricas no censuradas | **completed** | `cf6db65`; fixtures de fallo/éxito y rederivación G5 |
| 10 — gates y estabilidad | **completed** | C2-G1/G2 PASS; 2/2 runs reales entregados y verificados |

## Registro cronológico

### 2026-07-24 — Inicio del checkpoint 1

- Se aceptó ADR 0012 como target de implementación piloto.
- Se preservó C1 como ruta histórica y G5 como resultado formativo negativo.
- Se fijó que Tasks 1–4 cierran juntas antes de integrar C2 al planning
  productivo.
- Siguiente evidencia: regresión roja para métricas de tamaño del índice.

### 2026-07-24 — Cierre del checkpoint 1

- Task 1: ADR 0012, separación C1/C2 y estructura de evidencia creadas.
- Task 2: `RepositoryFileIndex` incorpora `byteSize` y `lineCount`; el perfil de
  caché rápida se elevó a `exports-only-v2-size-metrics` para no reutilizar
  silenciosamente índices viejos sin medición.
- Task 3: estimator `utf8-bytes-div-4/1.0.0` implementado como función pura; los
  paths nuevos y snapshots históricos sin tamaño quedan explícitamente
  inciertos.
- Task 4: selector C2 bottom-up implementado con condiciones A/B/C2, selección
  parcial de subtrees, hash determinista y prohibición de units sintéticas.
- Verificación combinada: 45 tests PASS, 1 performance test omitido por su gate
  de entorno, typecheck de `repository-index` y `decomposer` PASS.
- Evidencia detallada: [`checkpoints/checkpoint-1.md`](checkpoints/checkpoint-1.md).
- Siguiente bloque: Tasks 5–8; C2 aún no gobierna la ruta productiva.

### 2026-07-24 — Cierre del checkpoint 2

- Task 5: el Planner acepta feedback estructurado y la ruta productiva permite
  un único replan semántico cuando la hoja medida es inviable.
- Task 6: cada criterio del usuario tiene un único owner; las obligaciones
  técnicas locales preservan validabilidad sin inflar la vara entre condiciones.
- Task 7: la selección C2 es un evento durable, replayable y visible con
  beneficio, costo, features, límites, evidencia y rationale.
- Task 8: A/B/C1/C2 son configuración explícita; C2 es el default y el replay
  bloqueado valida hash, snapshot, goal y aceptación.
- Verificación combinada: 50 tests, tres typechecks y dos builds PASS.
- Evidencia detallada: [`checkpoints/checkpoint-2.md`](checkpoints/checkpoint-2.md).
- Siguiente bloque: Tasks 9–10; métricas no censuradas y estabilidad real.

### 2026-07-25 — Cierre del checkpoint 3

- Task 9: la derivación conserva métricas de runs fallidos y distingue cero,
  `unavailable` y `not_applicable`; G5 histórico rederiva sus doce celdas.
- Task 10: dos ejecuciones C2 secuenciales sobre el mismo objetivo, commit y
  base terminaron `completed`, sin reparaciones, con receipts confirmados.
- Ambos commits entregados pasaron instalación, tests y typecheck en clones
  limpios independientes.
- C2 eligió una hoja en ambas repeticiones por ventaja de split negativa. La
  planificación viva produjo hashes candidatos distintos; el gate no exige
  identidad textual de topología.
- Evidencia detallada: [`checkpoints/checkpoint-3.md`](checkpoints/checkpoint-3.md).
- Siguiente bloque: Tasks 11–12; seed, prompts, oráculos y driver longitudinal.

### 2026-07-25 — Cierre del checkpoint 4

- Se creó y verificó el seed técnico externo `0f87e45`; contiene nueve archivos
  técnicos, cero source files de dominio y queda limpio tras install congelado.
- W1–W8 quedaron pre-registrados como estímulos acumulativos. Cada entrega debe
  exponer una sonda pública conectada al camino productivo; fixtures o valores
  hardcodeados están prohibidos.
- Los oráculos externos ejecutan install, test, typecheck, build, dos sondas y
  validaciones funcionales acumulativas; sus hashes están fijados.
- El driver aborta por preflight inválido y sólo avanza la base luego de un
  oráculo PASS en clon limpio. La ruta negativa se verificó contra el seed.
- Verificación: 26 tests PASS, seed verify PASS y dry-run W1–W8 PASS sin writes.
- Evidencia detallada: [`checkpoints/checkpoint-4.md`](checkpoints/checkpoint-4.md).
- Siguiente bloque: Task 13, Warehouse Pilot.

### 2026-07-25 — Task 13 en curso; pausa por cuota externa

- Primer W1: lifecycle completed pero oráculo FAIL. Se corrigieron con TDD el
  scope de `package.json` y la especificación oculta de la sonda; no se adoptó.
- Segundo W1: lifecycle completed sin repair y comandos reales, pero oráculo
  FAIL. Se corrigió el banner pnpm del instrumento; la reejecución diagnóstica
  confirmó además nesting y prefijo hash incorrectos. Se agregó preservación
  verbatim de secciones contractuales; no se adoptó.
- Tercer W1: no evaluable. Los tres attempts de planning fueron rechazados por
  cuota del proveedor antes de emitir un candidate. No hubo decisión C2 ni
  ejecución.
- Estado científico: 0/8 incrementos verificados; ninguna entrega fallida es
  base de W2. Task 13 sigue abierta.
- Reanudación: después de 2026-07-30 00:37, nuevo clon seed y nueva serie con la
  misma versión conductual (`f5b99f2`), assets fijados y preflight completo; el
  HEAD exacto se registra al reiniciar.

### 2026-07-25 — Endurecimiento del instrumento; se levanta el bloqueo de cuota

Bloque de robustez sobre el instrumento, motivado por que los tres W1 fallaron
por tres causas distintas y dos de ellas eran detectables sin gastar un run.

- **Contradicción prompt/oráculo.** Los ocho prompts declaraban `layout` e
  `inventory` junto a los campos de envoltura y, dos párrafos después, anidados
  en `capabilities`. El oráculo verificaba lo segundo. La entrega del segundo W1
  siguió lo primero. Se reclasifica una de sus dos causas como ambigüedad del
  estímulo; el `stateHash` sin prefijo sigue siendo fallo productivo. Detalle en
  [`pilot/defects/prompt-oracle-contradiction`](pilot/defects/prompt-oracle-contradiction/README.md).
- **Fuente única de verdad.** `oracles/probe-specimen.mjs` define forma, mínimos
  e invariantes. `pin-warehouse-assets.mjs` renderiza desde ahí la sección
  `## Probe contract` de los ocho prompts antes de hashear, y `oracle-core.mjs`
  deriva sus reglas del mismo módulo. Estímulo y regla ya no pueden discrepar.
- **Reglas probadas por mutación**, no por inspección: 85 casos que incluyen la
  deformación exacta que produjo el fallo, los límites de cada mínimo y cada
  invariante booleano.
- **Fallo rápido y completo.** `checkCommandSurface` rechaza desde
  `package.json` una superficie de comandos ausente o con los stubs del seed
  —que salen con código 0 y produjeron el `test:pass` falso del primer W1— y
  `checkProbeOutput` reporta todas las violaciones juntas. Contra el seed el
  oráculo ahora falla en 1,5 s nombrando las cuatro causas.
- **Reproducibilidad del instrumento congelado.** Un clon limpio con
  `core.autocrlf=true` invalidaba los nueve pins: el oráculo no corría fuera de
  la máquina que lo produjo. Verificado clonando `HEAD` a scratch, 9/9
  obsoletos antes y 0 después.
- **Executor.** El estudio pasa a Claude Code CLI `sonnet`. Codex declara
  `usageSource: "unavailable"`, lo que dejaría el costo sin medir y los tokens
  como cota inferior, siendo ambos variables del estudio; el envelope de Claude
  Code reporta tokens exactos y `total_cost_usd`, verificado contra el CLI real.
  Esto además levanta el bloqueo de cuota: **no hay que esperar al 2026-07-30**.
- **Matriz controlada reducida de 27 a 12 runs** (`S` y `L`, A/B/C2, 2
  repeticiones) con regla de discrepancia preregistrada y sin repetición de
  desempate. Justificación en §6.3 del plan rector.

- Verificación: 180 tests focales PASS; `pin-warehouse-assets --check` PASS;
  dry-run W1–W8 PASS con la nueva selección. Sin cambios en la ruta productiva
  de ManyHands.
- Estado científico sin cambios: **0/8 incrementos verificados**; ninguna
  entrega fallida es base de W2. Task 13 sigue abierta.
- Falla ajena preexistente, ya resuelta: `tests/runs-list-performance.test.ts`
  expiraba porque `GET /api/runs` resolvía alias con una lectura bajo lock por
  workspace. Corregido en `433d107`; la suite completa bajó de 282 s a 91 s.

### 2026-07-25 — Task 13: planning corregido; ejecución interrumpida por cuota

- Cuatro series nuevas (`series-4` a `series-7`) sobre el executor Claude Code
  `sonnet`. Tres defectos productivos hallados y corregidos con TDD:
  - `62564ef`: los envelopes `planning.node` contaminaban el feedback de
    reparación y enterraban la única causa accionable, así que los reintentos no
    convergían;
  - `635062e`: `plannedPaths` se decidía por intención de escritura y no por
    existencia en el snapshot, de modo que `package.json` se declaraba como
    creado y el review lo rechazaba;
  - `cdb3466`: la regla de fidelidad contractual quedó insatisfacible al
    renderizar el contrato desde el specimen —41 líneas y 1212 caracteres— y
    ahora exige verbatim sólo los bloques con fences.
- `series-7` es el primer run del piloto que **supera planning**: plan aprobado,
  ejecución iniciada y decisión C2 persistida sobre el instrumento endurecido
  (`totalLeafCount=1`, `maxGraphDepth=0`, `minimumAdvantage=0.15`).
- Se detuvo en `waiting_for_input` porque el agente de código agotó el límite de
  sesión de Claude Code. Interrupción externa, no defecto del sistema bajo
  estudio; documentada en
  [`pilot/interruptions/claude-session-limit-2026-07-25.md`](pilot/interruptions/claude-session-limit-2026-07-25.md).
- Estado científico sin cambios: **0/8 incrementos verificados**; ninguna entrega
  fallida es base de W2. Task 13 sigue abierta.
