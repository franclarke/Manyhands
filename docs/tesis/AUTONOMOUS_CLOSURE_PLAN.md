# Plan autónomo de cierre técnico y académico

**Estado base:** 2026-07-28  
**Objetivo:** cerrar ManyHands en el grado necesario para producir una tesis
reproducible, verificable y defendible.  
**Launcher:** [`../../GOAL.md`](../../GOAL.md)  
**Estado científico actual:** [`HANDOFF.md`](HANDOFF.md)  
**Backlog ejecutable:** `.scratch/code-review-remediation/issues/`

Este documento es el controlador operativo del cierre. No crea una segunda
hipótesis ni reemplaza la evidencia existente:

- `HANDOFF.md` conserva la autoridad sobre el estado científico y operativo;
- los tickets locales conservan la autoridad sobre alcance, dependencias y
  aceptación de cada cambio;
- este plan fija orden, gates, verificaciones, tratamiento de fallos y
  definición de terminado;
- `THESIS_COMPLETION_ROADMAP.md` y `stage-execution-plan.md` explican el programa
  histórico, pero no deben hacer que se repitan etapas ya cerradas.

Si una afirmación de este plan deriva respecto del repositorio, el agente debe
verificar código, tests, commits y evidencia persistida, registrar la transición
y corregir el documento que quedó desactualizado. Nunca debe adaptar la realidad
para que coincida con el plan.

---

## 1. Posición actual

### 1.1 Trabajo ya cerrado

Los tickets 01, 03 y 04 están cerrados:

- **01:** la documentación dejó de contradecir la evidencia adversa;
- **03:** el oráculo ancho verifica un clon externo en el SHA entregado;
- **04:** el recibo declara versión del contrato y checks ejecutados.

La línea longitudinal tiene una entrega verificada:

- **W1:** PASS externo sobre
  `71f61c9efa222103ca2fb2f67692434ab493d75c`;
- **W2:** todavía no entregó;
- **W3–W8:** bloqueadas por W2.

La línea ancha anterior produjo información formativa, pero no una comparación
válida de H2:

- los N antiguos se conservan como evidencia mecánica;
- no son comparables con `retry-7`;
- `retry-7` para `{4, 8, 16}` todavía debe ejecutarse.

### 1.2 Preguntas que todavía impiden cerrar la tesis

1. **H1:** decidir con una segunda medición si
   `validationDuplication` representa duplicación real o aceptación heredada
   mal atribuida.
2. **H2:** medir el instrumento ancho rediseñado con tres puntos comparables.
3. **Longitudinal:** entregar W2 o demostrar honestamente por qué la cadena
   queda limitada a 1/8.
4. **Calibración:** mantener `maxLeafPlannedPaths` y `minimumAdvantage` como
   provisionales salvo que evidencia nueva los ancle.
5. **Narrativa:** llevar esos resultados —incluidos los adversos— a matriz de
   claims, tesis y presentación.

### 1.3 Frente de dependencias

```text
Gate P0 — baseline y toolchain
  ├─ 02 ───────────────────────────────────────────────┐
  ├─ 05 ─┐                                            │
  ├─ 06 ─┼───────────────┐                            │
  ├─ 07 ─┘               ├─ 13 ───────────────────────┤
  ├─ 08 ─┬─ 10 ── 11 ── 12 ──────────────────────────┤
  └─ 09 ─┘                                            │
                                                       ├─ 14 ── 15
  03 y 04 ya cerrados ─────────────────────────────────┘
```

Aunque varios tickets estén desbloqueados, el agente principal mantiene una
sola responsabilidad y un solo estado. Puede delegar investigación o revisión
acotada, pero no delega la decisión de cerrar un ticket ni permite que dos
agentes muten la misma superficie.

---

## 2. Contrato de autonomía

### 2.1 Lo que el agente puede decidir

Sin consultar a Francisco:

- inspeccionar, probar, diagnosticar y editar dentro del alcance;
- elegir entre alternativas técnicas reversibles cuando código y evidencia
  permitan distinguirlas;
- crear tests, documentación, scripts reproducibles y commits locales pequeños;
- corregir defectos productivos descubiertos durante la ejecución;
- atenuar o falsar un claim cuando la evidencia lo exija;
- continuar con trabajo independiente si un proveedor externo está
  temporalmente indisponible.

Debe pedir decisión antes de:

- borrar pools, worktrees, artefactos o datos materiales;
- gastar dinero o cambiar credenciales, cuotas o proveedores;
- publicar, hacer push o desplegar remotamente;
- ampliar el alcance científico o cambiar una hipótesis;
- alterar un estímulo, oráculo o protocolo ya congelado de una forma que cambie
  qué se está midiendo;
- escoger entre alternativas científicas que la evidencia disponible no
  distingue y que producirían conclusiones diferentes.

### 2.2 Invariantes no negociables

- Nunca hacer push.
- Preservar cambios ajenos y verificar `git status --short` y `git diff HEAD`
  antes de tocar un área y antes de cada commit.
- No usar `reset --hard`, `clean`, checkout destructivo ni stash global.
- No borrar pools, worktrees o artefactos sin autorización explícita.
- No mutar journals históricos; son evidencia inmutable.
- No presentar fixtures, mocks, screenshots o stdout como sustituto de un run
  productivo y una entrega verificable.
- No ajustar fórmula, umbral ni estímulo porque un caso no dio el resultado
  deseado.
- No ejecutar tests o builds pesados en paralelo con un run.
- No cambiar código que afecte la serie entre N=4, N=8 y N=16.
- No avanzar una base longitudinal hasta que el oráculo externo verifique el SHA
  entregado.
- No afirmar PASS por exit code aislado: inspeccionar recibo, manifest, SHA,
  ancestry, diff y resultado material.
- No entrar a `docs/UNI (NO LEER)/`.

### 2.3 Bucle del goal

Mientras el goal esté activo:

1. leer el estado durable y comprobar el estado Git real;
2. recalcular el frente de tickets cuyos blockers estén `closed`;
3. elegir el ticket de mayor prioridad en la ruta crítica;
4. cargar el ticket completo y las fuentes que gobiernan su superficie;
5. formular por escrito qué observación demostraría éxito y cuál refutaría la
   hipótesis de trabajo;
6. implementar con el ciclo indicado en la sección 3;
7. verificar en capas;
8. revisar por estándares y especificación;
9. corregir hallazgos y repetir la verificación afectada;
10. actualizar ticket, evidencia, progreso y handoff;
11. crear un commit local coherente;
12. recalcular el frente y continuar.

El agente no debe terminar el turno después de informar “el siguiente paso” si
puede ejecutarlo con seguridad. El siguiente paso se ejecuta.

---

## 3. Proceso de Pocock aplicado

Los skills aumentan rigor sólo si gobiernan una decisión concreta. No son una
ceremonia ni sustituyen evidencia.

### 3.1 Selección de skill

| Situación | Skill | Resultado exigido |
|---|---|---|
| Ticket conductual o fix | `tdd` | seam público acordado, rojo por causa correcta, verde mínimo, refactor |
| Fallo inesperado, hang o regresión | `diagnosing-bugs` | reproducción estrecha, hipótesis, causa raíz, regresión y rerun original |
| Cierre de un ticket | `code-review` | dos ejes independientes: Standards y Spec |
| Hecho externo o bibliografía | `research` | fuentes primarias y artefacto trazable |
| Contexto agotándose | `handoff` | estado durable, evidencia, comandos y acción siguiente |
| Nuevo esfuerzo todavía difuso | `wayfinder` y luego `to-tickets` | sólo si no pertenece a un ticket existente |

No usar `triage` sobre los tickets 02–15: ya fueron producidos como tickets
agent-ready. No usar `wayfinder` para redescubrir el cierre: el problema y el
backlog ya están delimitados.

### 3.2 TDD obligatorio

Para cada cambio conductual:

1. acordar la interfaz pública o seam observable que se quiere proteger;
2. escribir el test más estrecho que exprese el comportamiento faltante;
3. ejecutar el test y comprobar que falla por la razón esperada;
4. si falla por setup, dependencia o un error no relacionado, corregir el
   laboratorio antes de implementar;
5. hacer el cambio mínimo que vuelve verde el test;
6. refactorizar sin cambiar el comportamiento;
7. ejecutar suite enfocada, typecheck/build del área y gates amplios cuando
   corresponda;
8. conservar en el registro el comando RED, su causa y el comando GREEN.

Un test agregado después del fix no demuestra TDD. Un test que ya era verde no
es regresión. Debilitar assertions o cambiar el escenario para obtener verde
invalida el ciclo.

### 3.3 Diagnóstico obligatorio

Ante una falla no prevista:

1. congelar artefactos, logs, SHAs, configuración y comando exacto;
2. reducir a un bucle de reproducción barato;
3. separar “lo observado” de “lo inferido”;
4. enumerar de tres a cinco hipótesis ordenadas por poder explicativo;
5. instrumentar para distinguirlas, sin arreglar todavía;
6. identificar la primera divergencia causal;
7. agregar una regresión que la reproduzca;
8. aplicar el fix sistémico más pequeño;
9. rerun del test estrecho, suite afectada y comando original;
10. documentar el defecto y “Qué no se concluye”.

No se salta al fix más plausible. No se considera resuelto un defecto observado
en un run hasta volver a ejecutar el camino que lo reveló.

### 3.4 Revisión en dos ejes

Antes de marcar un ticket `closed`, fijar el commit anterior al ticket y revisar
el diff completo contra:

- **Standards:** `AGENTS.md`, `PRODUCT.md`, `docs/README.md`, decisiones y
  contratos aplicables, más smells de diseño;
- **Spec:** el archivo exacto del ticket y cualquier protocolo que cite.

Las revisiones son independientes y, cuando el entorno lo permita, las realizan
dos subagentes en paralelo. Todo hallazgo incluye archivo, línea, severidad y
razón. El agente principal:

- corrige todos los hallazgos confirmados P0, P1 y P2;
- justifica por escrito los falsos positivos;
- repite la revisión de las superficies corregidas;
- no cierra el ticket con hallazgos materiales abiertos.

---

## 4. Taxonomía de fallos y reintentos

ManyHands recupera por causa, no por un contador universal. Los siguientes son
presupuestos de diagnóstico, no una licencia para “reintentar hasta PASS”.

| Causa | Reintento permitido | Acción previa obligatoria | Efecto científico |
|---|---|---|---|
| Error transitorio de proceso, lock o antivirus | una repetición limpia | aislar carga concurrente y demostrar que no cambió input | conservar ambos resultados |
| Dependencia/ACL local dañada | ninguno a ciegas | diagnosticar; usar instalación o workspace aislado sin borrar el activo | no cuenta como celda |
| Rate/session limit antes de producir candidato | misma celda tras cambio real de disponibilidad | registrar error, proveedor y timestamp | interrupción externa, no intento semántico |
| Rate/session limit durante ejecución | misma celda sólo si el protocolo admite reanudación íntegra | preservar intento y probar que no se reutiliza salida parcial | etiquetar interrupción |
| Timeout de ManyHands | cero a ciegas | identificar fase y deadline; TDD si el timeout no se aplicó o clasificó bien | el run original permanece fallido |
| Test flaky sospechado | una repetición limpia para clasificar | después, bucle controlado que mida frecuencia | nunca elegir sólo el PASS |
| Defecto productivo | después de regresión, fix y gates | documentar causa raíz y rerun del escenario original | invalida celdas comparables posteriores al freeze |
| Defecto del estímulo u oráculo | después de versionar contrato y regenerar hashes | explicar contradicción y alcance | serie anterior no comparable |
| Salida semántica incorrecta con instrumento válido | no | preservar como resultado terminal | resultado adverso, no bug por definición |
| Oracle FAIL | no automático | clasificar entrega, checkout, contrato y observable fallido | PASS no puede fabricarse mutando el SHA |

### 4.1 Regla de serie comparable

N=4, N=8 y N=16 deben compartir:

- commit exacto de ManyHands;
- base SHA;
- executor, modelo y effort;
- estímulo y hashes;
- versión de oráculo;
- toolchain y configuración;
- timeouts y budgets;
- protocolo de decisiones humanas.

Si después de la primera celda cambia código que afecte planner, política,
executor, driver, estímulo u oráculo:

1. preservar la serie incompleta como intento descartado;
2. versionar el cambio;
3. volver a congelar manifest;
4. reiniciar desde N=4.

Una edición puramente explicativa que no cambia bytes ejecutados ni contratos no
obliga a reiniciar, pero debe quedar declarada.

### 4.2 Bloqueo del goal

Una indisponibilidad externa no bloquea mientras haya tickets, documentación,
tests, derivación o revisión independientes que puedan avanzar. El goal sólo se
marca `blocked` si la misma condición impide progreso material durante tres
turnos consecutivos y se agotaron las alternativas seguras. En ese caso el
handoff debe incluir:

- error exacto y tres observaciones consecutivas;
- qué trabajo quedó completo;
- qué evidencia es válida y cuál no;
- comando y precondición exactos para reanudar;
- archivos que deberán regenerarse.

---

## 5. Gates de verificación

### Gate P0 — baseline y toolchain

**Objetivo:** distinguir fallos del cambio de un workspace local dañado antes de
producir nueva evidencia.

1. Confirmar root, rama, HEAD, ancestry y cambios:

   ```powershell
   git rev-parse --show-toplevel
   git status --short --branch
   git diff HEAD --stat
   git diff HEAD --name-status
   node --version
   pnpm --version
   ```

2. Verificar Node 22 y pnpm 7.29.3 o registrar explícitamente el desvío.
3. Ejecutar de forma secuencial:

   ```powershell
   pnpm test
   pnpm -r --filter "./packages/*" typecheck
   pnpm --filter @manyhands/web exec tsc --noEmit
   pnpm build
   pnpm web:build
   ```

4. Si `node_modules` tiene módulos ausentes o `EPERM`, no atribuirlo al código y
   no borrar la instalación activa. Diagnosticar y preferir una instalación
   limpia aislada. Repetir los gates allí.
5. Registrar comandos, exit codes, entorno y si el resultado provino del
   workspace activo o del aislado.

No se ejecuta una celda científica con P0 rojo.

### Gate por ticket

Para todo ticket:

- RED y GREEN enfocados cuando hay conducta;
- suite enfocada completa;
- typecheck/build de paquetes afectados;
- `git diff --check`;
- revisión Standards/Spec;
- ticket y registro actualizados;
- diff sin archivos accidentales;
- commit local pequeño.

### Gate de freeze

Antes de `retry-7` y nuevamente antes de W2:

- P0 PASS;
- tickets de corrección requeridos cerrados;
- `pnpm build` fresco;
- marcador/version de política presente en `packages/decomposer/dist/index.js`;
- manifest con HEAD, tree, dist, seed/base, cells, prompts, oráculos, executor,
  modelo, effort, toolchain, timeouts y hashes;
- working tree limpio;
- prueba autenticada mediante una mutación, no sólo `/api/health`;
- servidor iniciado por `node scripts/manyhands-dev.mjs --plain`;
- un único vigía detached por run, sin polling manual repetitivo.

### Gate final del repositorio

Sobre el mismo commit candidato final y de forma secuencial:

```powershell
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

Un PASS histórico no reemplaza este gate.

### Gate editorial

- tesis y presentación compilan desde limpio;
- no hay referencias o citas indefinidas;
- no hay warnings nuevos relevantes ni overfull boxes sin resolver;
- tablas y figuras se regeneran desde datos crudos;
- revisión visual página por página de ambos PDFs;
- terminología y resultados coinciden entre matriz, tesis y slides;
- búsqueda explícita de afirmaciones fuertes sin sustento;
- segunda lectura contra H1, H2, limitaciones y “Qué no se concluye”.

---

## 6. Orden maestro

### Fase A — sanear semántica e instrumento

Ejecutar P0 y después cerrar 02, 05, 06, 07, 08 y 09. La prioridad de la ruta
crítica es:

```text
P0 -> 05 -> 08 -> 06 -> 07 -> 09 -> 02
```

El orden entre 06, 07, 09 y 02 puede cambiar si una causa descubierta lo exige,
pero todos deben cerrar antes de la síntesis; 05 y 08 deben cerrar antes del
primer run ancho. Para máxima comparabilidad, no comenzar `retry-7` hasta cerrar
todos los cambios conductuales de esta fase y congelar un único commit.

### Fase B — evidencia ancha

```text
10 (N=4) -> revisión del instrumento -> 11 (N=8, N=16) -> 12 (veredicto H1)
```

N=4 es un gate de instrumento y costo. N=8 y N=16 se ejecutan sólo si N=4
demuestra que la celda, checkout, receipt y oráculo son atribuibles. Entre las
tres celdas no se edita código ejecutable.

### Fase C — evidencia longitudinal

```text
13 (W2 desde W1 verificado)
```

No se requiere forzar W3–W8 para cerrar el mínimo defendible. Si W2 entrega y el
protocolo vigente autoriza continuar sin romper el freeze, se puede avanzar la
cadena mientras aporte evidencia proporcional al costo. Si W2 termina por una
causa válida y no corregible dentro del alcance, se fija el límite 1/8.

### Fase D — síntesis y escritura

```text
14 (claims) -> 15 (tesis + presentación + defensa)
```

La prosa final no se escribe sobre claims abiertos. Se puede preparar estructura
o tooling editorial antes, pero no cerrar tablas, conclusiones ni abstract hasta
que 14 esté cerrado.

---

## 7. Contratos detallados por tarea

### Ticket 02 — replay histórico honesto

**Objetivo:** impedir que un journal C1 sea reinterpretado silenciosamente bajo
la política C actual.

**Decisión previa:** inspeccionar readers, schema, eventos y consumidores. Elegir
replay fiel sólo si el código puede reconstruir la semántica histórica completa;
si no, rechazo explícito y eliminación de reachability legacy muerta.

**TDD y verificación:**

- regresión roja en la seam de replay con journal C1;
- `pnpm vitest run tests/planning-candidate-replay.test.ts tests/run-events-replay.test.ts`;
- typecheck de los paquetes/apps tocados;
- documentación de compatibilidad alineada.

**Cierre:** nunca hay fallback silencioso; el comportamiento elegido es
observable, testeado y documentado.

### Ticket 05 — specimen reproducible

**Objetivo:** demostrar que los dieciséis valores del catálogo se derivan del
blob real del commit W1 verificado.

**Trabajo:**

- localizar el blob y el algoritmo de derivación real;
- escribir script determinista, sin copiar el catálogo como input oculto;
- cubrir los siete valores hoy no protegidos por invariantes;
- comparar automáticamente output derivado contra catálogo congelado;
- registrar commit, blob/hash y comando.

**Verificación:**

```powershell
pnpm vitest run tests/wide-graph-metric-catalogue.test.ts tests/warehouse-study-assets.test.ts
node docs/tesis/evidence/scripts/pin-warehouse-assets.mjs --check
```

Agregar y ejecutar el comando de derivación documentado por el ticket.

**Cierre:** una mutación de cualquiera de los dieciséis valores hace fallar la
verificación; el script reproduce exactamente el catálogo desde W1.

### Ticket 06 — protocolo longitudinal consistente

**Objetivo:** hacer que protocolo, driver y manifest declaren el mismo executor
y la misma interpretación de costo/tokens.

**TDD:** test de contrato que falle cuando diverjan selección declarada y
efectiva.

**Verificación:**

```powershell
pnpm vitest run tests/warehouse-longitudinal-driver.test.ts tests/warehouse-study-assets.test.ts
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode pilot --dry-run
```

**Cierre:** executor real, consecuencia metrológica y reglas de reversión están
en protocolo, driver y artefactos; ninguna variable queda sólo en comentarios.

### Ticket 07 — fork declarado y guardado

**Objetivo:** impedir que una cadena final herede un prefijo generado con otra
versión del sistema sin declaración.

**TDD:** regresión roja sobre fork en modo final; reemplazar el test de
aislamiento vacuo por uno que compruebe versión/base/prefijo.

**Verificación:**

```powershell
pnpm vitest run tests/warehouse-longitudinal-driver.test.ts
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode final --dry-run
```

**Cierre:** modos permitidos explícitos; final rechaza el fork; el error explica
qué manifest o base no coincide.

### Ticket 08 — executor como variable controlada

**Objetivo:** impedir que dos celdas con executors distintos aparenten pertenecer
a la misma serie comparable.

**Trabajo:**

- declarar executor/model/effort en protocolo de barrido;
- incorporarlos al manifest y a cada `cell.json`;
- validar homogeneidad en preflight;
- marcar series históricas heterogéneas como no comparables.

**TDD y verificación:**

```powershell
pnpm vitest run tests/wide-graph-study.test.ts tests/warehouse-study-assets.test.ts
node docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs --help
```

Ejecutar además el dry-run o `--check` que exponga el manifest sin iniciar runs.

**Cierre:** cambiar executor en una celda hace fallar el preflight antes de
mutar un target.

### Ticket 09 — deduplicar aceptación heredada

**Objetivo:** conservar una única implementación canónica de propagación de
intents de ancestro sin cambiar decisiones.

**TDD:** caracterizar primero ambos llamadores con la suite existente; extraer
después la implementación compartida.

**Verificación:**

```powershell
pnpm vitest run tests/contract-acceptance-allocation.test.ts tests/granularity-utility-policy.test.ts tests/planning-candidate-replay.test.ts
```

Comparar assessments/fixtures antes y después para demostrar equivalencia.

**Cierre:** un solo módulo implementa la regla, ambos consumidores lo usan y no
cambia ningún resultado esperado.

### Ticket 10 — `retry-7` N=4

**Objetivo:** validar el instrumento rediseñado con la celda más barata antes de
gastar N=8/N=16.

**Precondiciones:** 03, 04, 05 y 08 cerrados; freeze gate PASS; se recomienda que
02, 06, 07 y 09 también estén cerrados para congelar una sola versión final de
la ruta.

**Ejecución:**

1. validar hashes y dry-run;
2. levantar servidor productivo compilado y probar auth con POST;
3. ejecutar exactamente la celda N=4 congelada;
4. esperar con un único watcher;
5. exportar journal, snapshot, result, diff y receipt;
6. correr el oráculo desde clon externo en el SHA entregado;
7. inspeccionar manualmente correspondencia entre manifest, commit y receipt.

**Cierre:** artefactos completos y veredicto atribuible. Un FAIL válido se
preserva; sólo se reintenta después de clasificar y corregir una causa real.

### Ticket 11 — `retry-7` N=8 y N=16

**Objetivo:** completar tres puntos de escala comparables.

**Precondición:** ticket 10 cerrado y ningún byte controlado cambió desde N=4.

**Ejecución:** N=8 y luego N=16, secuenciales, con el mismo freeze. Preservar
todo fallo. Exportar especialmente el assessment de N=16 y los
`acceptanceIntentIds` por hoja.

**Cierre:** tres celdas con manifests compatibles o una serie adversa completa
cuya interrupción esté metodológicamente explicada. No mezclar intentos de
freezes distintos.

### Ticket 12 — veredicto sobre `validationDuplication`

**Objetivo:** cerrar la cuestión central de H1 sin calibrar al resultado.

**Análisis:**

- comparar la evaluación nueva con el N=16 anterior;
- inspeccionar ownership vs herencia de cada intent;
- recalcular desde journals, no desde números transcritos;
- invertir términos de forma contrafáctica para identificar cuál liga;
- declarar si la evidencia sostiene lectura 1, lectura 2 o no distingue.

**Reglas:**

- si el término está bien y cae con intents propios, no tocar fórmula;
- si mide mal, empezar una nueva versión de política con TDD;
- una nueva fórmula exige protocolo y serie confirmatoria nuevos; no corrige
  retroactivamente `retry-7`;
- si no se resuelve, declararlo limitación;
- `minimumAdvantage` sigue provisional salvo evidencia independiente.

**Cierre:** veredicto reproducible, scripts/comandos registrados y ausencia de
ajuste post hoc.

### Ticket 13 — W2 entrega o fija el límite

**Objetivo:** ejecutar W2 bajo protocolo corregido desde W1 verificado.

**Precondiciones:** 06 y 07 cerrados; freeze gate PASS; leer antes todos los
defectos W2 documentados.

**Ejecución:**

1. probar preflight y base W1 exacta;
2. ejecutar una celda W2 sin polling manual;
3. conservar journal, result, diff y receipts;
4. si entrega, clonar el SHA y correr oráculo externo;
5. sólo con PASS adoptar W2 como nueva base.

**Tratamiento del fallo:** distinguir defecto ya corregible de resultado
terminal. Un defecto productivo vuelve a TDD y al escenario original. Una
indisponibilidad externa reanuda la misma celda según la tabla de retries. Una
salida inválida bajo instrumento válido se conserva.

**Cierre:** W2 verificado, o cadena declarada 1/8 con causas, alcance y “Qué no
se concluye”. No extrapolar W3–W8.

### Ticket 14 — síntesis de evidencia

**Objetivo:** producir un veredicto único y trazable para H1/H2.

**Trabajo:**

- rederivar resultados desde journals y receipts;
- enlazar cada claim a run ID, ManyHands SHA, base/final SHA y oracle receipt;
- clasificar claims como `supported`, `bounded`, `falsified` o `not measured`;
- etiquetar N antiguos como mecánicos/no comparables;
- conservar series descartadas y resultados adversos;
- declarar `maxLeafPlannedPaths` y `minimumAdvantage` provisionales si siguen
  sin anclaje;
- actualizar matriz, protocolos, resultados y HANDOFF para que no diverjan.

**Verificación:** ejecutar derivadores dos veces y exigir diff vacío en la
segunda; verificar enlaces relativos y buscar afirmaciones contradictorias.

**Cierre:** ninguna afirmación relevante depende sólo de prosa, stdout o
memoria; no quedan claims H1/H2 ambiguos.

### Ticket 15 — escritura y verificación

**Objetivo:** convertir la evidencia cerrada en una tesis y defensa coherentes,
no en documentación de producto.

**Trabajo:**

- revisar estructura y estándar académico ya relevado;
- reescribir resumen/abstract, método, resultados, discusión, amenazas,
  limitaciones y conclusiones;
- corregir capítulos 7–9 y toda sección anterior afectada por los resultados;
- regenerar tablas/figuras desde datos;
- alinear presentación, notas y demo;
- diferenciar resultado confirmado, adverso, provisional y no medido;
- verificar bibliografía sólo con fuentes que sostengan el claim citado.

**Verificación:** gate editorial completo más búsqueda de formulaciones fuertes:

```powershell
rg -n "óptim|superior|demostr|significativ|siempre|robust|escalab" docs/tesis
git diff --check
```

**Cierre:** PDFs revisables, sin referencias rotas, visualmente inspeccionados y
consistentes con matriz, H1, H2 y límites.

---

## 8. Evidencia y commits

### 8.1 Registro por ticket

Cada ticket cerrado debe dejar:

- objetivo y alcance;
- commit base y commit final;
- archivos cambiados;
- RED: comando, exit code y razón;
- GREEN: comando y resultado;
- gates enfocados y amplios;
- hallazgos Standards/Spec y resolución;
- defectos encontrados y documentación;
- evidencia producida;
- limitaciones y siguiente ticket desbloqueado.

Actualizar el ticket a `closed` sólo después de verificar estos datos. El commit
de cierre no puede incluir cambios ajenos.

### 8.2 Forma de los commits

- Un ticket o una causa coherente por commit.
- Mensajes en inglés.
- Nada de push.
- Antes de cada commit:

  ```powershell
  git status --short
  git diff HEAD
  git diff --check
  ```

- Después del commit, verificar que HEAD contiene los archivos esperados y que
  el ticket apunta al SHA correcto.

### 8.3 Handoff continuo

Después de cada ticket y antes de una operación larga, actualizar un registro
durable con:

- HEAD y estado Git;
- ticket activo y blockers;
- proceso background y cómo observarlo;
- último comando y resultado;
- artifacts/SHAs ya válidos;
- hipótesis descartadas;
- próxima acción exacta.

Un chat o resumen de agente no es handoff suficiente.

---

## 9. Definición de terminado

El goal está completo únicamente si se cumplen todas:

### Ingeniería

- tickets 01–15 en `closed`;
- working tree limpio;
- ningún hallazgo P0/P1/P2 confirmado abierto;
- gate final del repositorio PASS sobre el commit final;
- commits locales pequeños y trazables;
- cero push.

### Evidencia

- serie ancha `{4, 8, 16}` atribuible y comparable, o resultados terminales
  preservados sin presentar una serie incompleta como completa;
- veredicto explícito sobre `validationDuplication`;
- W2 verificado o límite 1/8 defendible;
- manifests, journals, diffs, commits y receipts enlazados;
- resultados adversos y series no comparables conservados;
- parámetros no anclados declarados provisionales.

### Tesis y defensa

- matriz de claims cerrada;
- tesis y presentación compiladas desde limpio;
- referencias, citas, figuras y tablas válidas;
- revisión visual completa;
- abstract, resultados, discusión y conclusión coherentes;
- demo y material de respaldo etiquetados correctamente.

### Informe final

El agente entrega:

1. estado de cada ticket y fase;
2. decisiones y causas raíz;
3. commits locales;
4. comandos y resultados de gates;
5. runs, executors, modelos, base/final SHAs y receipts;
6. veredictos H1/H2;
7. estado de tesis, presentación y PDFs;
8. limitaciones reales;
9. confirmación explícita de que no hizo push.

No son conclusiones aceptables “parece funcionar”, “los tests principales
pasan” o “está casi completo”. Cada conclusión referencia una prueba, commit,
artefacto o limitación.

---

## 10. Primera acción al iniciar `/goal`

1. Leer completos `GOAL.md`, este plan, `HANDOFF.md`, `PRODUCT.md`,
   `docs/README.md`, `docs/agents/issue-tracker.md` y el ticket 05.
2. Ejecutar Gate P0 sin modificar el workspace.
3. Si P0 revela el `node_modules` dañado ya observado, aplicar
   `diagnosing-bugs` y construir una verificación aislada sin borrar el árbol
   activo.
4. Reclamar ticket 05 y ejecutar su ciclo completo.
5. Continuar con ticket 08.
6. No iniciar N=4 hasta cerrar y revisar la Fase A y crear el freeze manifest.
