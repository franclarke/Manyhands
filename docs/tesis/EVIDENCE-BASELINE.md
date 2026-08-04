# Evidencia ya establecida — línea de base al 2026-08-01

> **Para el agente que retoma:** esto ya está hecho, verificado y commiteado. **No
> lo repitas, no lo re-mididas y no lo re-interpretes.** Es el punto de partida
> del que arranca `GOAL-PLAN.md`.
>
> Commit de referencia: `efafeab`. Rama `main`. **Nunca se hizo push.**

---

## 1. Qué pregunta el trabajo

Dos preguntas, y una tercera instrumental:

- **PI-1** — ¿Puede construirse un orquestador que descomponga un objetivo de
  software en un DAG de unidades, las ejecute aisladas y concurrentes, y llegue a
  una entrega **verificada** con manifiesto y comprobante?
- **PI-2** — ¿Puede una política decidir **si** una unidad debe dividirse y
  **seleccionar** entre los cortes que el planificador semántico propone, hasta
  alcanzar hojas implementables por un agente dentro de su contrato?
- **PI-3** — ¿Qué modos de falla aparecen cuando la granularidad elegida no
  coincide con la forma real del trabajo?

**PI-2 dice «seleccionar», no «encontrar», deliberadamente.** Que una política
determinista no puede inventar el corte semántico es un **resultado** de este
trabajo, obtenido por refutación en un run real, no un supuesto de diseño.
Sostener la formulación fuerte haría que la tesis se contradijera con su propio
capítulo de metodología.

## 2. Estado de tickets

Los 26 tickets de `.scratch/code-review-remediation/issues/` están `closed`. El
informe de cierre está en `docs/tesis/evidence/FINAL-REPORT.md`.

**Excepción declarada:** los tickets 11, 12, 02, 14 y 15 se cerraron con TDD,
gates y evidencia, pero **sin las reviews independientes Standards y Spec** que
el protocolo del repositorio exige. Está registrado como desviación y hay una
etapa del plan dedicada a saldarlo.

## 3. Resultados ya establecidos

### 3.1 El sistema entrega (PI-1)

- Caso canónico: dos ejecuciones válidas consecutivas de punta a punta con commit
  final verificado, manifiesto y comprobante.
- W1: única entrega de la línea Warehouse verificada por oráculo externo, commit
  `71f61c9efa222103ca2fb2f67692434ab493d75c`.
- **Límite:** ninguna de las nueve celdas de grafo ancho (`retry-8`, `retry-10`,
  `retry-11`) entregó. La cadena longitudinal quedó en **1/8**. Cada causa
  terminal está documentada y **ninguna es una decisión de granularidad**.

### 3.2 La política decide y su término crítico mide bien (PI-2)

`retry-12-measure` (planning-only, `claude-code-cli/haiku`) midió, sobre el mismo
estímulo y **sin tocar término, fórmula ni umbral**:

| | piloto N=16 | retry-11 N=8 | retry-12 N=4 | retry-12 N=8 |
|---|---:|---:|---:|---:|
| intents por hoja | compartidos | compartidos | propios | propios |
| `validationDuplication` | 0.8947 | 0.8500 | **0.3750** | **0.4828** |
| `splitAdvantage` | −0.2584 | +0.0444 | **+0.1710** | **+0.3275** |
| razón registrada | infactibilidad | bajo el mínimo | **utilidad** | infactibilidad |

`retry-12` N=4 es el **único caso de las 18 evaluaciones de raíz preservadas**
cuya razón registrada es la utilidad. Veredicto del ticket 12: **sostiene la
lectura (1)** — el término mide lo que declara medir; lo que producía el rechazo
era el planner adhiriendo criterios de objetivo completo a las hojas.

**Límite:** el caso motivador (19 hijos) nunca se re-midió a su propia anchura.

### 3.3 La política no puede inventar el corte

Resultado negativo obtenido en un run real: cuando una versión anterior fabricaba
sub-unidades particionando rutas mecánicamente, **los tres candidatos violaron su
propio contrato de alcance**. La corrección fue quitar esa capacidad. Es el
aporte más transferible del trabajo.

### 3.4 Qué hace implementable a una hoja

Derivado de los journals con `scripts/derive-leaf-outcomes.mjs`:

- **84 intentos de hoja en 37 journals**: 70 candidatos, 10 fallos, 4 sin hecho
  terminal.
- Tasa de candidato sobre terminales: **87,5 %**. Excluyendo los seis fallos no
  atribuibles a la unidad: **94,6 %**.
- **Ningún proxy de tamaño separa entrega de fallo.** El alcance parece separar
  (mediana 5 contra 15) hasta que se leen las causas: seis de diez fallos le
  habrían ocurrido a una hoja de cualquier tamaño, y la diferencia de medianas
  mide de qué repositorio viene la hoja.
- El **único** fallo atribuible a la granularidad ocurrió en la hoja **más
  chica** del corpus (un solo path de alcance).

### 3.5 Parámetros sin anclar

`minimumAdvantage = 0.15` y `maxLeafPlannedPaths = 12` son **provisionales**.
Ninguna evidencia de este trabajo los deriva. Se mantuvieron inmutables durante
todas las mediciones **precisamente para no ajustarlos al resultado**.

## 4. G6 — el re-test justo

Pre-registro completo en `docs/tesis/evidence/g6-preregistration.md`.

### 4.1 Por qué existe

G5 falsó su hipótesis pre-registrada, y ese resultado **no se toca**. Pero no fue
una prueba justa por dos razones que el propio manuscrito identifica:

1. El repositorio objetivo tenía cinco pruebas: ningún agente se acercó a saturar
   su contexto, que es el régimen donde descomponer debería ganar.
2. La métrica primaria estaba confundida con la condición: los criterios se
   compilan por unidad, así que descomponer multiplica las obligaciones.

### 4.2 Diseño congelado

- **6 celdas**: 1 tarea multi-capa × 3 condiciones (A, B, C) × 2 repeticiones.
- Orden declarado: `g6-01-T1-A-r1`, `g6-02-T1-C-r1`, `g6-03-T1-B-r1`,
  `g6-04-T1-C-r2`, `g6-05-T1-A-r2`, `g6-06-T1-B-r2`.
- Objetivo: `warehouse-control-tower-compact`, rama `wc/compact`, base
  `5da60192cc788032c59c7e7be27696ca0e0a30d7`. 1650 líneas TS, 30 archivos, 14 de
  test, seis capas.
- Umbral `minimumAdvantage = 0.15` **inmutable durante todo G6**.
- Tarea T1 congelada en `docs/tesis/evidence/g6/task-t1.md`.
- Diez criterios externos en `docs/tesis/evidence/g6/criteria-t1.json`.

### 4.3 Enmiendas ya hechas, ambas antes de cualquier dato comparativo

1. **Métrica** (2026-07-31): se mide sobre el **candidato producido**, entregado
   o no. Razón: el compilador sólo vinculaba evidencia a unidades con un único
   criterio, así que la condición A no podía entregar nunca y habría perdido por
   construcción.
2. **Enunciado** (2026-08-01): la prioridad es opcional con `"standard"` por
   defecto. Razón: el planner pidió aclaración, con razón, y el driver no
   responde aclaraciones.

### 4.4 Evaluador externo

`docs/tesis/evidence/scripts/run-g6-evaluator.mjs` + `lib/g6-criteria.mjs`.
Clona el SHA exacto en un directorio limpio, corre los gates, e **importa los
módulos entregados para ejercitarlos** — no lee lo que el probe dice de sí mismo.
Regresión en `tests/g6-evaluator.test.ts`, incluido el caso de un probe que
auto-reporta éxito sin implementar.

**Veredicto base sobre el objetivo sin tocar: 5/10** (`baseline-verdict.json`).
Pasan los cuatro gates y la integridad; fallan los cinco de la tarea. Prueba que
la tarea no está hecha y que los criterios discriminan.

### 4.5 Celda 1 — ejecutada y entregada

| | |
|---|---|
| run | `5a5cb4e7-398d-4981-86db-391d68a524fe` |
| condición | **A** (hoja única forzada) |
| ejecutor | `claude-code-cli` / `sonnet` |
| lifecycle | `completed`, con receipt |
| SHA final | `cba28d817b3753ac8dea7d6975cbda8f093a5c6f` |
| **criterios externos** | **10/10** |
| duración | 13,7 min |
| planning / hojas / reparaciones | 1 / 1 / 0 |
| consumo | 6.375.736 tokens · **USD 3,01** |

Evidencia en `docs/tesis/evidence/g6/runs/g6-01-T1-A-r1/`.

**El chequeo de piso de capacidad quedó superado**: el ejecutor alcanza el
objetivo, así que la serie mide lo que se propuso medir.

**Una celda no es una comparación.** No dice nada todavía sobre granularidad.

### 4.6 Corridas preservadas que no son celdas

- `runs/discarded-c52f823e/` — primera corrida de la celda 1, `not_attributable`
  por el defecto del compilador. Su candidato ya satisfacía 10/10; se conserva
  como diagnóstico.
- `runs/clarify-check/` — chequeo planning-only que expuso la ambigüedad del
  enunciado.
- `runs/binding-check/` — chequeo planning-only que confirmó el arreglo del
  compilador antes de gastar una celda entera.

## 5. Defectos de producto corregidos en esta línea de trabajo

Todos con TDD, todos con su regresión:

1. **Decisión levantada parkeaba el run entero** — contradecía el modelo de
   decisiones locales no bloqueantes.
2. **Dead-end de scheduling** que ese parkeo tapaba: el driver re-observa
   readiness después de levantar la decisión.
3. **Idempotencia de hechos derivados** comparaba input crudo contra evento
   normalizado por schema.
4. **El host de planning descartaba la salida del CLI** — un fallo del planner no
   era atribuible. Estrenado en G6: capturó `"API Error: Response stalled
   mid-stream"`.
5. **El pool de worktrees no decía por qué** no podía remover un slot.
6. **Un run abandonado quedaba `running` para siempre** — el driver ahora lo
   cancela.
7. **El compilador de contratos no vinculaba evidencia** a una unidad con varios
   criterios: la condición A no podía entregar nunca. Ahora los tests que la
   unidad **declara que va a escribir** se vinculan como `shared_command`, con
   los ids de criterio y una razón que registra que la evidencia es compartida.
   La regla del ticket 19 —una referencia meramente *citada* no se vincula— queda
   intacta con su regresión.
8. **El evaluador de G6 invocaba `pnpm` sin `--silent`** y el eco del comando
   fallaba los criterios del probe sobre código correcto.

## 6. Gate del repositorio

Sobre `efafeab`, con Node `v22.23.1` y pnpm `7.29.3`, **build antes de test**:

| Comando | Resultado |
|---|---|
| `pnpm build` | PASS |
| `pnpm test` | **PASS** — 221 archivos, 1546 passed, 2 skipped |
| `pnpm -r --filter "./packages/*" typecheck` | PASS |
| `pnpm --filter @manyhands/web exec tsc --noEmit` | PASS |
| `pnpm web:build` | PASS |
| `git diff --check` | exit 0 |

**Patrón conocido de Windows:** bajo carga paralela, casos que spawnean procesos
(`integration-real-git`, `run-v2-cancellation`) y el microbenchmark del indexer
pueden vencer por contención. Pasan aislados. El protocolo admite **una única
repetición limpia**; nunca se declara PASS un resultado que falló dos veces, y
nunca se mueve un umbral para acomodarlo.

## 7. Conocimiento operativo que cuesta caro redescubrir

- **El servidor resuelve `@manyhands/*` desde `dist/`.** Correr `pnpm build`
  **antes** de `pnpm test` y de cualquier run, y verificar el marcador de
  política en `dist`. Correr la suite antes del build ejercita código viejo.
- **`MANYHANDS_RUNS_DIR` fuera del repositorio.** Si el servidor escribe dentro
  del checkout, editar archivos durante un run puede perturbarlo.
- **`export MANYHANDS_SESSION_TOKEN` no se propaga** a un proceso lanzado en
  background: usar `env VAR=... nohup node ...`.
- **`/api/health` no exige auth.** Un 200 ahí no prueba que el token coincida:
  probar con un POST.
- **Nunca correr la suite completa en paralelo con un build o un run.**
- **Nunca monitorear con polling cada 30–60 s.** Lanzar detached y usar **un solo
  vigía** que salga al llegar a estado terminal.
- **Finales de línea:** el índice usa LF con `core.autocrlf=false`, y las
  herramientas de edición escriben CRLF, produciendo diffs de archivo entero.
  Normalizar a LF antes de cada commit y verificar con `git diff --numstat`.
- **Puertos 3000, 3001, 3111 y 3141** pueden tener listeners históricos que
  Windows no deja terminar. Elegir uno libre y no tocar los demás.
- Los intentos de **planning no registran `usage`** en el journal: cualquier
  medición de costo por celda subestima, y hay que decirlo.

## 8. Restricciones que no se negocian

- **Nunca hacer push.** Sólo commits locales, chicos y coherentes.
- **TDD para todo cambio conductual**: regresión roja que falle **por la razón
  correcta** antes del fix.
- **No borrar pools, worktrees, clones, journals ni artefactos.** Nada de
  `reset`, `clean`, checkout destructivo ni `stash` global.
- **No presentar fixtures, mocks ni capturas como evidencia** de un camino
  productivo real.
- **No ajustar un umbral hasta que el caso motivador dé el resultado buscado.**
- Antes de cambiar una fórmula o un valor para arreglar un fallo observado,
  **identificar invirtiendo la salida registrada cuál término liga**, y cambiar
  ése.
- **Los resultados adversos se conservan sin reinterpretación favorable.**
- Cada defecto se documenta en
  `docs/tesis/evidence/warehouse/pilot/defects/<slug>/README.md` con una sección
  **«Qué no se concluye»**.
- `docs/UNI (NO LEER)/` está **fuera de alcance**.
