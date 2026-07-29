# Handoff — cierre de ManyHands y escritura de la tesis

> Prompt de contexto para un agente que retoma en frío. Leer entero antes de
> tocar nada. Comunicación con Francisco en **español**; código, identificadores
> y mensajes de commit en **inglés**.

---

## 1. Para qué existe todo esto

El objetivo final **no es** construir el sistema perfecto. Es **cerrar el
desarrollo lo suficiente como para escribir la tesis con evidencia defendible**.

Cada decisión debe evaluarse contra esa vara: ¿esto acerca una afirmación que la
tesis pueda sostener frente a un jurado, o es ingeniería que se siente
productiva? Si es lo segundo, no se hace.

**El aporte de la tesis es la política C** (`adaptive-utility/3.1.0-pilot`), una
política adaptativa de granularidad que decide, para cada unidad de trabajo
propuesta por el Architect, si ejecutarla como una hoja o dividirla.

Dos hipótesis:

- **H1 — calidad de la política.** ¿C toma buenas decisiones de granularidad
  cuando el grafo puede ser grande?
- **H2 — arquitectura de grafos.** ¿Sirve esta arquitectura para desarrollar
  software real a tamaños representativos?

---

## 2. Estado del repositorio

- `C:\Users\franc\Documents\Proyectos\Manyhands`, rama `main`.
- Muchos commits locales por delante de `origin/main`. **NUNCA hacer push.**
- Suite al último cierre: **210 archivos, 1392 passed, 2 skipped, 0 fallos.**
  Typecheck y build PASS.

Actualización operativa 2026-07-28:

- Gate P0 PASS sobre `5623e6014858b038764320d3c9746d00c07ac3e3`
  en clon aislado con Node `22.23.1` y pnpm `7.29.3`: 211 archivos de test,
  1395 passed, 2 skipped; typechecks de paquetes y web, build de paquetes y
  web build PASS.
- El `node_modules` del checkout activo no es un laboratorio válido: lecturas
  de `zod` y `next` fallan por ACL/`EPERM`. No se borró ni reparó; la
  verificación se trasladó a un clon y store aislados.
- Ticket 05 cerrado con Standards/Spec PASS. Implementación:
  `4ab5f9d6db7e0c528ca18be674a27a78d52caba8`; evidencia durable:
  `74156cf875b40781c95979ed4fb79d1df4cc8133`. El specimen ancho se re-deriva
  desde el blob W1 `71f61c9e`, y sus 16 valores coinciden automáticamente con
  el catálogo.
- Ticket 08 cerrado con Standards/Spec PASS. Implementación en
  `c9aab46fe15d7744a08ec2939307d30f2a2830e9` a
  `f366c2043ab7f9fd98e498ba6a95bb018b0119b0`. El manifest declara la selección,
  `run-g5.mjs` valida homogeneidad y disponibilidad antes del run, y las series
  nuevas quedan restringidas a `codex-cli/gpt-5.5/high`. Retry-7 se preserva
  como freeze histórico no ejecutado.
- Ticket 06 cerrado con Standards/Spec PASS. Implementación:
  `2ecad62e96e3d670ed9dd5d59906508121e15b46` y
  `16a8104d47ff8aceec6bbef992c5aac3125ab7a2`. Protocolo, driver y plan dry-run
  coinciden en `codex-cli/gpt-5.5/high`; el protocolo conserva la reversión por
  capacidad y declara tokens como piso y costo no medible. W1–W8 pasaron
  preflight dry-run sin abrir células.
- Scope refinado por Francisco: el objetivo operativo es probar ManyHands real y
  producir un veredicto defendible sobre la política C, no perfeccionar
  infraestructura intermedia. 07 y 09 quedan cerrados por retiro explícito del
  mínimo; 13 cierra la cadena longitudinal en 1/8 sin otro W2. La única
  corrección histórica pendiente es 02, porque evita reinterpretar evidencia C1
  bajo la política C actual; debe cerrar antes de la síntesis, no antes del
  freeze de células C nuevas.
- Ruta activa: `10 -> 11 -> 12 -> 02 -> 14 -> 15`. Ticket 02 no bloquea
  células nuevas C; protege la síntesis de journals C1 históricos.
- Checkpoint Git del recorte de alcance: root
  `C:\Users\franc\Documents\Proyectos\Manyhands`, branch `main`, HEAD limpio
  observado `885c69fdf1675a82cc3b66b83a1d1c6185f94bc0`, 154 commits adelante de
  `origin/main`, con `origin/main` ancestro y sin push. El commit que contiene
  este snapshot sólo agrega evidencia documental, por lo que no altera código,
  protocolo ni resultados ya verificados.
- Último gate: `git diff --check` → exit `0`.
- Revisión inicial del recorte:
  - Standards FAIL por una definición de terminado que exigía resultados
    favorables, una dependencia 02→10 no declarada por los tickets y falta de
    closure records.
  - Spec PASS para 07/09 y PARTIAL para 13 por no distinguir publicación
    interna de verificación externa.
  - Correcciones fijadas en
    `f8e615eb9b822d5c98f4a58de96f8e08261dd3ab` y
    `885c69fdf1675a82cc3b66b83a1d1c6185f94bc0`.
  - Re-review final: Standards PASS y Spec PASS, sin P0/P1/P2/P3.
- Reanudación: leer completo
  `.scratch/code-review-remediation/issues/10-run-retry7-n04.md`, ejecutar el
  gate de freeze y abrir primero N=4. Ticket 02 se resuelve antes de 14, sin
  reconstruir una política legacy.
- Ticket 10 cerrado con Standards/Spec PASS:
  - `retry-8` quedó congelado con Codex en
    `c38a976712f5145002667f0b0f6686136b13b190`, condición C explícita y tres
    targets W1 independientes;
  - Gate P0 completo, hashes, policy marker, clean tree y mutación autenticada
    PASS en el clon aislado `manyhands-thesis-freeze-2`;
  - N=4, run `9bd2e8fc-0e7c-4342-b908-d6a25818382f`, terminó `failed` en
    compiled plan review por outputs duplicados y ciclos de artefactos;
  - no hubo candidato, receipt ni SHA para el oráculo; se preservó
    `oracle-disposition.json` con `not_run`;
  - no se reintenta N=4. El siguiente frente es 02/11 y se prioriza N=8/N=16
    bajo el mismo freeze para evitar sesgo de parada.
- Retry-8 completó también las observaciones N=8 y N=16:
  - N=8 run `0b6b5781-42e4-49ad-b662-f5ab700df118`: FAIL pre-candidate por
    planned outputs duplicados; el segundo intento interno persistió un grafo C
    de 11 hojas y `splitAdvantage=0.1898`;
  - N=16 run `b8e114ef-72a9-495f-82ae-6c92ca6906d2`: FAIL pre-candidate por la
    misma clase; persistió 19 hojas y `splitAdvantage=0.0719`;
  - los tres targets quedaron intactos en W1 y los tres oracle dispositions son
    `not_run`;
  - Francisco autorizó corregir defectos del sistema. Próximo paso: TDD sobre
    ownership de `plannedPaths`, fix productivo, gates/reviews y nueva serie
    completa desde N=4. Retry-8 no se borra ni se reinterpreta.
- Fix productivo de ownership jerárquico en `28efda8`:
  - la regresión no vacua falló primero con `1 failed / 6 passed` porque el
    crítico trataba el resumen de outputs del composite como ownership
    independiente de cada descendiente;
  - el crítico ahora permite únicamente solapamiento ancestro-descendiente y
    conserva el rechazo entre ramas incomparables; GREEN `38/38`, typecheck y
    build de `@manyhands/decomposer` PASS;
  - no se tocaron ciclos de artefactos, policy C, fórmulas, umbrales, estímulo
    ni oráculo. Standards y Spec independientes dieron PASS, sin P0/P1/P2/P3;
    Spec contrastó los journals reales: N4 `13/13`, N8 `20/20` y N16 `37/37`
    duplicados eran pares ancestro-descendiente, sin pares independientes;
  - los requirements se instalaron completos en el clon aislado
    `manyhands-planned-path-fix-2`: 629 paquetes, lockfile frozen, modo offline,
    `Done in 30.4s`. El intento anterior se conserva porque entró en resolución
    intensiva sin materializar `node_modules`.
- Serie sucesora `retry-9` congelada para ejecución:
  - commit exacto `faead8546a9d447200a66b0167836536d558bba4`, clon aislado
    `manyhands-thesis-freeze-3`, policy marker y hashes registrados en
    `retry-9/freeze.json`;
  - Gate P0 exacto PASS: 211 archivos, 1405 tests passed, 2 skipped; typechecks
    de paquetes y web, build de paquetes y web build PASS;
  - tres targets nuevos e independientes `warehouse-control-tower-wide-codex-r9-*`
    están limpios sobre W1 `71f61c9e`; executor homogéneo
    `codex-cli/gpt-5.5/high`, condición C, tamaños `{4, 8, 16}`;
  - un web typecheck anterior al freeze final falló porque aún no existían los
    `dist` de los paquetes. Se preservó la clasificación; después de `pnpm
    build`, el mismo comando pasó. No fue un defecto de producto ni se cambió
    código para obtener el PASS.

- `retry-9` N=4 se ejecutó parcialmente y queda preservado como intento
  descartado por defecto productivo:
  - run `3340ab0b-b255-43b5-af33-870e8872b00e`, workspace
    `510aeb2f-0e12-4cfe-9ae3-0972751983e3`, journal inmutable en
    `C:\Users\franc_rgy\.codex\tmp\manyhands-thesis-freeze-3\repo\.manyhands\runs\3340ab0b-b255-43b5-af33-870e8872b00e.events.v2.jsonl`;
  - el plan compiló y fue aprobado: el fix de `plannedPaths` sí alcanzó el
    camino productivo. Se persistieron siete hojas y comenzó la primera,
    `Projection Contract`;
  - el intento 1 produjo trabajo, pero `SimpleGitRunner.commit()` falló con
    `Author identity unknown`. El journal conserva
    `failure.classified` 30, `attempt.failed` 31,
    `decision.raised(resolve_conflict)` 32 y `readiness.observed` 33;
  - se configuró identidad Git **sólo localmente** en los tres targets r9 para
    corregir el entorno inmediato, sin cambiar HEAD ni dirty state;
  - la respuesta `retry` quedó persistida como `decision.resolved` 34, pero la
    route devolvió 409 al intentar reclamar una segunda ejecución antes de que
    el runner anterior liberara su lease. Después de liberarlo, el lifecycle
    quedó `waiting_for_input` sin decisión pendiente y `/run`/`/resume` no
    ofrecían una transición válida;
  - no hubo candidate, final SHA, receipt ni entrada para el oráculo. N=8 y
    N=16 de `retry-9` **no se iniciaron**. No completar ni reinterpretar esta
    serie: el cambio de código posterior obliga a congelar una sucesora desde
    N=4.
- Corrección causal fijada en `60eb12f` (`fix(execution): resume resolved
  decisions safely`):
  - `SimpleGitRunner.commit()` conserva una identidad efectiva existente y,
    sólo cuando falta nombre o email, usa por comando
    `ManyHands <manyhands@local>`; no escribe configuración local ni global;
  - `decision.resolved` quita únicamente el ID resuelto de
    `readiness.pendingDecisionIds` y no inventa un nuevo readiness;
  - la continuación de una decisión puede reclamar `running` o
    `waiting_for_input`; si todavía existe un runner activo, se agenda después
    de todos los predecessors del run. El nuevo driver es quien recalcula y
    persiste `readiness.observed`;
  - TDD identidad: RED `1 failed / 3 passed` con el error exacto de autor;
    GREEN incluido en `4/4`;
  - TDD lifecycle/handoff: RED inicial `1 failed / 1 passed` por el dead-end,
    RED de re-review por la transición optimista, GREEN final enfocado
    `17/17`; suite afectada anterior `29/29`;
  - typecheck `@manyhands/run-coordinator`, `@manyhands/execution-core` y web
    PASS; packages build, web typecheck y `web:build` PASS en el clon aislado
    `manyhands-decision-recovery-fix-2`. El `web:build` fue anterior al último
    ajuste de lifecycle; después de ese ajuste los tres typechecks volvieron a
    pasar. El próximo freeze debe ejecutar P0 completo fresco;
  - primera review: Standards FAIL con P1 de carrera cache/lease y P2 de
    readiness optimista; ambos fueron corregidos. Re-review final Standards
    PASS y Spec PASS, sin P0/P1/P2/P3.
- Estado operativo al relevo:
  - rama `main`; commit productivo más reciente `60eb12f`; el commit documental
    posterior se consulta con `git rev-parse HEAD`;
  - el proceso Node histórico de `retry-9`, PID `38392`, todavía existía al
    último control, pero ya no apareció un listener en el puerto 3000. Proviene
    del freeze inmutable `manyhands-thesis-freeze-3`. Verificar ambos estados
    antes de reutilizar el puerto; puede terminarse ese proceso, pero no borrar
    el clon ni sus artefactos;
  - no hay driver N=4 vivo. El run histórico permanece
    `waiting_for_input`, sequence 34, y no debe mutarse;
  - laboratorio válido para el fix:
    `C:\Users\franc_rgy\.codex\tmp\manyhands-decision-recovery-fix-2\repo`,
    con 629 paquetes instalados offline. El clon `...fix-1` quedó contaminado
    por CRLF durante checkout; se conserva y no se usa;
  - ticket activo: 11. Frente adicional desbloqueado: 02. Ruta prioritaria:
    `11 -> 12 -> 02 -> 14 -> 15`;
  - siguiente acción exacta: crear un freeze sucesor nuevo (recomendado
    `retry-10`) desde un HEAD limpio que incluya `60eb12f` y este handoff;
    instalar offline, ejecutar P0 completo secuencial, verificar policy marker,
    hashes y mutación autenticada, crear **tres targets nuevos** sobre W1 y
    ejecutar N=4/N=8/N=16 sin cambiar bytes entre celdas. No reutilizar las
    celdas ni targets r9 como si fueran comparables.

Comandos de verificación (protocolo del proyecto):

```bash
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
```

---

## 3. Las dos líneas de evidencia

### Línea A — Warehouse longitudinal (W1…W8)

Incrementos acumulativos sobre un repo objetivo; cada uno verificado por un
oráculo externo antes de ser base del siguiente.

**Estado: 1/8.** W1 entregó `71f61c9efa222103ca2fb2f67692434ab493d75c` y pasó sus
seis checks. W2 no produjo una entrega **externamente verificada**. `series-15`
sí publicó internamente el candidato `38b511817b0ab0a8df1855d28f0e9455f5dac0fd`,
pero el oráculo externo falló por lockfile congelado; otros intentos terminaron
en timeout o fallo de infraestructura sin entrega verificable. La cadena W3–W8
no avanza.

Esta línea alimenta H2, y hoy es su parte débil.

### Línea B — Grafos anchos sobre la base W1 verificada

N módulos independientes contra un contrato fijo, barriendo N.

**Resultados con el estímulo VIEJO** (hoy retirado): N=4 PASS, N=8 PASS con
oráculo externo, N=16 falló en integración. **No usar estos números como
evidencia de H2** sin la advertencia de la sección 5.

**Estímulo NUEVO** congelado en `retry-7` para `{4, 8, 16}` — **nunca
ejecutado**. Ese freeze declaró un executor que ya no está disponible y se
preserva sin reescribir como intento histórico. La próxima medición debe
congelar una serie sucesora con Codex.

---

## 4. Secuencia científica inmediata

Antes de la medición deben repetirse los gates aplicables y congelarse un único
commit limpio. Ticket 02 no bloquea N=4/N=8/N=16 porque esas células nacen con
la política C actual; sí debe cerrar antes de que ticket 14 sintetice journals
C1 históricos. 07 y 09 ya no forman parte del mínimo y no justifican demorar
el experimento.

### Primera célula de la sucesora Codex — N=4

`retry-8` ya ejecutó N=4 una vez. El run
`9bd2e8fc-0e7c-4342-b908-d6a25818382f` produjo un resultado terminal
atribuible: ManyHands persistió el grafo y los assessments de C, pero el Graph
Compiler rechazó outputs duplicados y ciclos antes de candidate. No hubo SHA,
receipt ni entrada válida para el oráculo externo.

Las celdas históricas en
`docs/tesis/evidence/warehouse/wide-graph/retry-7/cells/` no se ejecutan ni se
reescriben. `retry-8` usa la base W1 `71f61c9e` y
`codex-cli / gpt-5.5 / high`, con estímulo y oráculo versionados.

N=8 y N=16 ya se observaron bajo el mismo freeze y fallaron antes de candidate
por la misma clase de output duplicado. La serie `retry-8` queda cerrada como
evidencia adversa y **no se reintenta ni reescribe**.

El paso siguiente es una serie sucesora nueva `{4, 8, 16}` desde N=4, con nuevos
targets independientes y un freeze que incluya el fix revisado. Esto no
reinterpreta `retry-8`: verifica si la corrección causal elimina el bloqueo
productivo. Cada celda sucesora debe conservar su resultado terminal; sólo una
entrega recibe oráculo y un fallo pre-candidate conserva `not_run`.

### Paso 2 — La medición que le falta a H1

**Éste es el punto más importante de toda la tesis y hoy está abierto.**

Sobre el único grafo ancho real medido (N=16, 19 hijos), la política C computó:

    contextRelief 0.2511  parallelism 0.8889  faultIsolation 0.2008  -> benefit 0.4469
    coordination  1       pathOverlap 0.5759  validationDuplication 0.8947
    uncertainty   0.3508                                             -> cost    0.7054
    splitAdvantage -0.2584   minimumAdvantage 0.15

Dividió, **pero no por utilidad**: la razón registrada es
`"Leaf is infeasible; C selected the available semantic split."`

Un contrafáctico con control (reproduce exactamente los valores del journal sobre
la topología original, así que es confiable):

| Escenario | coordination | splitAdvantage | decisión |
|---|---:|---:|---|
| Como se planifico (loop de compatibilidad) | 1 | −0.2584 | leaf |
| Con el seam alineado contrafactualmente | 0.1053 | **−0.0347** | leaf |
| …y `validationDuplication` = 0 | 0.1053 | +0.1889 | split |

**C sigue sin aprobar por utilidad un fan-out de 19 módulos independientes cuyo
paralelismo ella misma mide en 0.8889.** El término que liga es
`validationDuplication = 0.8947` (19 hijos × 2 intents, 4 únicos).

Detalle completo en
`docs/tesis/evidence/warehouse/pilot/defects/policy-c-refuses-a-clean-wide-cut/README.md`.
Hay dos lecturas y **un solo caso no las separa**:

1. El término está bien y lo que está mal es que el planner asigne criterios de
   objetivo completo a las hojas.
2. El término está mal y debería medir duplicación de verificación *propia* de
   cada hoja, no cobertura heredada compartida.

El esquema actual no distingue las dos cosas: `acceptanceIntentIds` es una lista
plana que mezcla lo que la unidad posee con lo que hereda.

**Cómo resolverlo:** el N=16 de la serie sucesora Codex da la segunda medición. El estímulo
nuevo asigna a cada módulo una pregunta propia, así que los intents deberían
quedar efectivamente particionados por hoja. Si con intents particionados
`validationDuplication` cae y el advantage se vuelve positivo, la lectura (1) es
la correcta y C queda defendida. Si no cae, hay que rediseñar el término.

> **No tocar el umbral ni la fórmula antes de esa medición.** Ajustar cualquiera
> de los dos ahora es ajustar al resultado, y arruina el aporte.

### Paso 3 — Declarar el límite longitudinal

La cadena longitudinal queda en 1/8. W1 entregó; W2 produjo intentos distintos
pero ninguna base verificable: candidato con lockfile inconsistente, hard
timeout sin receipt y fallo de infraestructura. No se ejecuta otro W2. La tesis
los presenta como límite y no atribuye esos fallos a la política C.

### Paso 4 — `maxLeafPlannedPaths`

Vale 12 y está **declarado provisional**. Medido: W1 entregó con 10 planned paths
y W2 falló con 6, así que **ninguna cota separa los dos casos**. O se ancla con
evidencia nueva, o queda declarado como provisional en la tesis. No inventar un
anclaje.

---

## 5. Advertencia sobre los resultados N=4 y N=8 viejos

El estímulo original pedía N módulos que derivaban **los mismos tres valores** y
sólo se diferenciaban por un id, y daba a las N hojas **un único
`projections.test.ts` compartido**.

Eso medía la maquinaria del grafo sobre un fan-out sintético e imposibilitaba la
integración. Codex lo construyó sin objetar; Claude se detuvo a preguntar si la
anchura tenía contenido semántico — evidencia en
`wide-graph/retry-6/runs/warehouse-wide-n16/README.md`.

**Los PASS de N=4 y N=8 son evidencia de mecánica, no de H2.** Si se citan en la
tesis, tiene que ser con esa etiqueta. Sólo la serie sucesora Codex puede
sostener H2; `retry-7` permanece como freeze histórico no ejecutado y **no es
comparable** con las series anteriores ni con su sucesora.

---

## 6. El instrumento nuevo (cómo funciona)

- **`scripts/lib/wide-graph-metrics.mjs`** — catálogo congelado de 16 preguntas
  analíticas sobre `thesis-seed-2026`. Como el seed está congelado, cada pregunta
  tiene **una sola respuesta correcta**, declarada ahí. Es **fuente única** del
  estímulo y del oráculo: ninguno deriva por su cuenta, que es la contradicción
  que hundió los primeros W1.
- Los valores fueron **derivados del blob real** de `71f61c9e`, no transcritos.
  Los tests fijan los invariantes que un error de transcripción rompe.
- **El estímulo nunca enuncia una respuesta esperada** — hay un test que lo
  impide. Decirla permitiría hardcodear.
- **El oráculo compara valores**, no sólo forma. El determinismo por sí solo no
  distingue un módulo correcto de un stub: dos corridas de un stub son tan
  idénticas entre sí como dos de una implementación real.
- Los tamaños `{4, 8, 16}` son **prefijos exactos** del catálogo: entre dos puntos
  cambia la anchura del grafo y nada más. **N=24 retirado** — el seed no sostiene
  24 preguntas genuinas sin relleno, y enriquecerlo invalidaría el oráculo de W1.

Sustrato real de W1: 4 zonas, 16 bins, 5 SKUs, 8 colocaciones, **170 unidades**
(no 240 — ese número era el *ejemplo* del contrato, no el valor del seed).

---

## 7. Conocimiento operativo que cuesta caro redescubrir

- **El servidor resuelve `@manyhands/*` desde `dist/`.** Correr `pnpm build` y
  **verificar el símbolo o marcador en `dist`** antes de cualquier run, o se
  ejercita código viejo sin darse cuenta.
- **`export MANYHANDS_SESSION_TOKEN` NO se propaga** al proceso lanzado en
  background. Usar `env MANYHANDS_SESSION_TOKEN="$TOKEN" nohup node ...`. Éste es
  el muro que bloqueó una sesión entera.
- **`/api/health` no exige auth**, y los GET tampoco. Sólo las mutaciones. Un 200
  en health **no prueba** que el token coincida — probar con un POST.
- Levantar el servidor con `node scripts/manyhands-dev.mjs --plain` (puerto 3000).
  Recompila paquetes al arrancar. Levantarlo con `next dev` crudo deja los
  ejecutores sin verificar.
- **No correr la suite completa en paralelo con un build o un run**: produce
  timeouts que parecen fallos reales. Si aparece un fallo, re-correr limpio antes
  de atribuirlo a un cambio.
- **`run-experiment.mjs` sólo responde `approve_plan` y la entrega.** Rechaza
  `clarify_goal` y parkea en cualquier otra cosa, por diseño: responder una
  aclaración sería improvisar estímulo que la celda pre-registrada no autoriza.
- **No monitorear un run con polling cada 30–60 s.** Quema el contexto sin
  aportar nada. Lanzar el run detached y usar **un solo** vigía en background que
  salga al llegar a estado terminal.

---

## 8. Restricciones que no se negocian

- **NUNCA hacer push.** Sólo commits locales, chicos y coherentes.
- **TDD para todo cambio conductual**: regresión roja que falle **por la razón
  correcta** antes del fix. Verificar que el rojo sea el esperado, no cualquier
  rojo.
- **No presentar fixtures, mocks ni capturas como evidencia** de un camino
  productivo real. No inventar datos ni extrapolar resultados inexistentes.
- **No ajustar un umbral hasta que el caso motivador dé el resultado buscado.**
  Corregir lo que esté *probadamente* mal medido, y reportar aparte si el caso
  sigue fallando.
- Antes de cambiar una fórmula o un valor para arreglar un fallo observado,
  **identificar invirtiendo la salida registrada cuál término es el que liga**, y
  cambiar ése. Un fix plausible a un término que no ligaba cuesta un run entero.
- Si un fix apunta a un caso observado, **verificarlo contra ese caso** antes de
  reportarlo como fix. Si la entrada necesaria no está registrada, decirlo y
  enumerar las entradas admisibles.
- **No borrar pools, worktrees ni artifacts sin autorización explícita.**
- Cada defecto se documenta en
  `docs/tesis/evidence/warehouse/pilot/defects/<slug>/README.md`, **incluyendo una
  sección "Qué no se concluye"**. Si se corrige una afirmación ya publicada en el
  repo, corregirla **en el documento**, no sólo en el chat.
- `docs/UNI (NO LEER)/` está **fuera de alcance**.
- Los journals persistidos son **evidencia inmutable**: la etiqueta `C2` sobrevive
  ahí y no se renombra. En prosa, la política se llama **C**.

---

## 9. Defectos corregidos que conviene conocer

Todos con TDD y documentados en `pilot/defects/`:

| Defecto | Qué era |
|---|---|
| `seam-bindings-escape-cycle-detection` | Diagnostico corregido: agregar seams al DAG contradijo A5 y produjo falsos `artifact_cycle`. Los seams vuelven a ser compatibilidad no ordenante; artifacts/legacy/hierarchy gobiernan ciclos. |
| `contested-planned-output` | 16 hojas declaraban el mismo archivo de test como output propio. El compilador emitió 120 conflict constraints y la revisión las aceptó como remedio. Ahora el plan **no compila**. |
| `leaf-feasibility-ignored-production` | La factibilidad medía sólo lo que una hoja debía leer, no lo que debía producir. La cota agregada **no discrimina** W1 de W2. |
| `worktree-pool-orphan-recovery` | Slot huérfano de un run abortado; además mal clasificado como `code_test`. |
| `wide-graph-integration-timeout-not-enforced` | La integración no respetaba su deadline y colgaba indefinidamente. Corregido, pero **el deadline nunca se ejerció**: el único reintento posterior terminó a los 178 s porque falló la reparación semántica, muy por debajo del límite. Sigue sin verificarse. |

También: el rediseño de `parallelism` y `coordination` (`3.1.0-pilot`) quedó
**validado sobre datos productivos** — un fan-out de 19 unidades medía **0** de
paralelismo con la fórmula vieja y **0.8889** con la nueva.

---

## 10. Qué necesita la tesis para cerrarse

Mínimo defendible:

1. **H1** — la medición del Paso 2, con veredicto explícito sobre
   `validationDuplication`. Sin eso, la afirmación "C toma buenas decisiones"
   queda contradicha por la única evidencia ancha que existe.
2. **H2** — la serie sucesora Codex completa `{4, 8, 16}` con resultados
   terminales atribuibles; receipt/oráculo para toda entrega y disposición
   `not_run` para fallos anteriores a candidate, más los N viejos
   re-etiquetados como evidencia de mecánica.
3. La cadena longitudinal declarada como 1/8 **con las causas documentadas**.
4. Los parámetros sin anclar (`maxLeafPlannedPaths`, `minimumAdvantage`)
   declarados como provisionales, no presentados como derivados.

Los resultados **adversos son parte del aporte**. Que la política no apruebe un
fan-out limpio, medido y explicado, vale más que un número cómodo sin respaldo.
No maquillar nada.

---

## 11. Actualización operativa — preparación de `retry-10`

Checkpoint 2026-07-28 antes de la instalación y Gate P0:

- root `C:\Users\franc\Documents\Proyectos\Manyhands`, branch `main`, HEAD
  limpio observado `8668fd1a563ebf1854985a6de72f556148885833`; `60eb12f` es
  ancestro y el único commit posterior agrega ticket, handoff y evidencia
  documental;
- el frente canónico recalculado es `{11, 02}` y se mantiene la prioridad
  `11 -> 12 -> 02 -> 14 -> 15`;
- el servidor histórico de `retry-9`, PID `38392`, continúa como único listener
  de `127.0.0.1:3000`. `Stop-Process -Force` y `taskkill /F` fueron rechazados
  por ACL; no se tocó su proceso padre, clon ni artefactos y no se harán
  reintentos ciegos;
- se creó el clon aislado limpio
  `C:\Users\franc\.codex\tmp\manyhands-thesis-freeze-4\repo` desde ese HEAD,
  con `core.autocrlf=false`;
- se instaló un runtime aislado Node `22.23.1`; el archivo oficial
  `node-v22.23.1-win-x64.zip` verificó SHA-256
  `7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29`.
  Corepack resuelve pnpm `7.29.3` y el store offline documentado es
  `C:\Users\franc\AppData\Local\pnpm\store\v3`;
- próxima acción exacta: avanzar el clon a este checkpoint documental, ejecutar
  `pnpm install --frozen-lockfile --offline` con ese runtime/store y luego Gate
  P0 completo secuencial. El bloqueo del puerto no impide instalación ni P0;
  debe resolverse o aislarse de forma atribuible antes de la mutación
  autenticada y del run.

Diagnóstico de instalación posterior al checkpoint:

- el primer comando offline fue interrumpido por el timeout de 10 s del host,
  no por pnpm; `install.log` conserva la salida hasta 6 paquetes reutilizados;
- la única repetición, con timeout suficiente, confirmó `Packages: +629` pero
  terminó con `ERR_PNPM_NO_OFFLINE_TARBALL`: el store accesible del perfil
  actual carece de `esbuild-0.27.7.tgz`. `install-resume.log` preserva la
  salida; no quedó un proceso instalador activo;
- el checkout principal sí contiene `esbuild@0.27.7`, pero copiar su
  `node_modules` mezclaría el laboratorio con la instalación dañada por ACL.
  Próxima acción: poblar únicamente el store declarado desde el lockfile con
  `pnpm fetch`, preservar el log y repetir la instalación en modo offline. Esto
  corrige disponibilidad de dependencias; no cambia HEAD, lockfile, estímulo,
  instrumento ni oráculo.

Resolución de la instalación:

- `pnpm fetch` bajo Node `22.23.1` reprodujo una incompatibilidad del cliente
  HTTP de pnpm `7.29.3` (`ERR_INVALID_THIS` en
  `URLSearchParams.getAll`) y enumeró siete tarballs de Windows ausentes;
- se descargaron esos siete tarballs exactos con `curl`, se verificó para cada
  uno el SHA-512 declarado en `pnpm-lock.yaml` y pnpm `7.29.3`/Node `22.23.1`
  los incorporó localmente al mismo store. No se cambió el lockfile;
- la instalación final se ejecutó nuevamente en modo offline con Node
  `22.23.1`, pnpm `7.29.3` y el store declarado: `629 reused`, `0 downloaded`,
  exit `0`, `Done in 16s`. El log durable es `install-final.log` junto al clon;
- próxima operación larga: avanzar el clon al commit documental de este
  checkpoint y ejecutar Gate P0 completo, secuencial y sin otras cargas, sobre
  un único HEAD limpio.

Checkpoint durante Gate P0 del clon, que permanece en
`d534dfc51c89981283a5f03b38eea1c5d75ab878`:

- `pnpm test` PASS: 212 archivos, 1408 passed, 2 skipped; packages typecheck
  PASS;
- el primer web typecheck falló porque un clon fresco aún no tenía los `dist`
  a los que apuntan los exports de paquetes. `pnpm build` PASS materializó esos
  artefactos y el mismo web typecheck pasó sin cambios de fuente;
- el primer `pnpm web:build` fue terminado por el timeout externo de 300 s.
  Packages build había pasado, Next compiló en 63 s y quedó en `Linting and
  checking validity of types`; no quedó ningún hijo activo. El log es
  `gate-p0-web-build.log`;
- próxima acción diagnóstica: ejecutar sólo `pnpm --filter @manyhands/web
  build` con ventana de 600 s y cache preservada. Si termina, repetir el gate
  original con timeout suficiente; si vuelve a colgar, instrumentar la fase de
  Next antes de cualquier nuevo intento. El clon no avanzará al commit de este
  checkpoint hasta cerrar P0.

Resolución y freeze sucesor:

- el build focalizado de web PASS en 57.8 s y el rerun exacto de `pnpm
  web:build` PASS en 118.2 s; la causa fue el timeout externo insuficiente del
  primer build frío, no un deadlock persistente;
- Gate P0 quedó completo en `d534dfc`: 212 archivos, 1408 tests passed, 2
  skipped; typechecks, packages build y web build PASS. Todos los logs se
  preservan junto al clon;
- se crearon tres targets nuevos e independientes `r10-n04`, `r10-n08` y
  `r10-n16`, limpios sobre W1 `71f61c9e`, tree `f1592137`, sin reusar targets
  de `retry-9`;
- las células `retry-10` se congelaron en
  `91d5ae3aa4b865fbc64fe0b325c14938727f5908`, condición C y selección homogénea
  `codex-cli/gpt-5.5/high`. Entre el P0 anterior y ese SHA sólo cambiaron este
  handoff y los JSON de la nueva serie; no cambió ningún byte ejecutable;
- próxima operación larga: repetir Gate P0 completo y secuencial sobre el SHA
  exacto `91d5ae3`, sin avanzar el clon a commits documentales posteriores.
  Después se fijarán `freeze.json`, marker/hash de `dist`, manifest, clean tree
  y mutación autenticada antes de abrir N=4.

Reasignación del endpoint antes de ejecutar:

- al verificar el freeze, el PID histórico `38392` volvió a escuchar en 3000 y
  respondió como `manyhands-web` development. Windows continúa devolviendo ACL
  denegada para su terminación y no expone owner/command line; `retry-9` no se
  reanudó ni mutó;
- se descartó usar ese servidor porque ejecuta bytes y token del freeze
  histórico. El puerto 3001 está libre y el launcher admite URL/entorno de
  puerto sin cambiar el producto;
- los tres JSON de `retry-10` cambiaron únicamente `baseUrl` de 3000 a 3001.
  Targets, W1, goals/hashes, condición, selección, timeouts, budgets, estímulo
  y oráculo permanecen iguales. El draft 3000 queda preservado en `91d5ae3`;
- el freeze ejecutable sucesor es
  `643a32dada8e46af9edad1dcfc7ebbf6571aca78`. Próxima operación larga: Gate P0
  completo y secuencial sobre ese SHA exacto; luego iniciar
  `node scripts/manyhands-dev.mjs --plain --url http://127.0.0.1:3001` con
  `PORT=3001` y comprobar una mutación autenticada antes de N=4.

Diagnóstico durante el P0 exacto de `643a32d`:

- la suite completa quedó roja por un solo caso:
  `integration-real-git > rejects and removes a commit created unexpectedly by
  the repair executor`; agotó 30 s y el cleanup informó `EBUSY` en dos
  temporales. Los otros 1407 tests pasaron y los artefactos se preservaron;
- no quedaron procesos Git/Node del test. El repro focalizado del mismo caso,
  sin carga concurrente y sin cambios, pasó en 10.6 s (16.3 s total);
- se clasifica provisoriamente como contención transitoria de filesystem, no
  defecto productivo. Próxima acción: la única repetición limpia permitida de
  la suite completa. Sólo un PASS completo permite continuar P0; una nueva
  falla exige diagnóstico adicional y no se seleccionará el resultado verde.

Freeze ejecutable de `retry-10` listo para N=4:

- La unica repeticion limpia de la suite completa paso sobre el mismo
  `643a32d`: 212 archivos, 1408 tests passed y 2 skipped. El fallo inicial, el
  repro focalizado verde y el repeat verde permanecen juntos en
  `retry-10-final-p0-*.log`; no se descarto evidencia adversa.
- En ese mismo commit pasaron secuencialmente packages typecheck, web
  typecheck, `pnpm build` y `pnpm web:build`. El ultimo termino en 109.8 s.
- `freeze.json` fija commit `643a32d`, tree `cc8a5274`, marker
  `adaptive-utility/3.1.0-pilot`, hash de `dist/index.js` `6ebbc2c7`, lockfile,
  manifest, las tres celdas y todos los instrumentos. El preflight de
  seleccion homogenea paso con cero celdas ejecutadas.
- Los tres targets continuan limpios sobre W1 `71f61c9`, tree `f1592137`. El
  clon de ejecucion sigue limpio y fijado en `643a32d`; no avanzara con los
  commits documentales posteriores.
- El servidor aislado responde health en `127.0.0.1:3001`; el listener actual
  es PID `38908`, perteneciente al runtime Node 22.23.1 del clon retry-10. Una
  mutacion autenticada creo el workspace
  `f38dff28-46be-4c9e-95cb-e5fcf711bc1c` para el target N=4 y un GET posterior
  verifico la identidad fisica persistida. El PID historico `38392` sigue
  aislado en 3000.
- Proxima operacion larga exacta: ejecutar solo `warehouse-wide-n04` con
  `run-g5.mjs`, celdas del freeze y salida durable en
  `docs/tesis/evidence/warehouse/wide-graph/retry-10/runs`. No cambiar codigo,
  freeze, estimulo, seleccion, oraculo ni target antes de N=8/N=16.

Preflight operativo inmediatamente anterior a N=4:

- El primer launcher habia vencido por el timeout externo del host y dejo un
  child de Next que luego dejo de responder. N=4 no se habia lanzado: el gate
  aborto ante `/api/health`. Se termino solo ese arbol Node identificado por la
  ruta del clon retry-10.
- El launcher completo se reinicio con una ventana de ocho horas y token
  conocido. Health y el workspace autenticado volvieron a responder; su id
  durable correcto termina en `bc1c` y el listener nuevo es PID `38908`.
- La proxima accion sigue siendo N=4 detached con un unico vigia detached. El
  incidente de servidor queda fuera de la celda porque ocurrio antes de crear
  el run y no modifico target, freeze ni instrumento.

Resultado terminal de `retry-10` N=4:

- run `86ad7617-827e-401f-8215-13faf58933c0`, observado por el unico vigia
  detached PID `37384`, termino `failed` durante compiled plan review;
- el planner genero el artefacto registry en direccion
  `analytics-registry -> study-wide-graph-script`, pero el seam del comando en
  direccion inversa. El review trató incorrectamente el artifact acíclico más
  el seam no ordenante como un ciclo de dos nodos y rechazo el plan;
- no hubo execution, candidate, receipt ni mutacion del target W1. El oraculo
  queda durablemente `not_run`; no se reintenta ni se corrige el producto entre
  celdas;
- la instrumentacion es valida y el resultado adverso es atribuible. Conforme
  al protocolo, la proxima operacion larga es N=8 sobre su target nuevo con el
  mismo freeze, servidor, seleccion y vigia unico detached.

Resultado terminal de `retry-10` N=8:

- run `d31b219b-4a92-4cef-a452-f58e3f27bda8`, vigia unico detached PID
  `45568`, termino `failed` durante compiled plan review;
- reprodujo independientemente el mismo falso `artifact_cycle` entre el
  artifact registry -> study script y el seam no ordenante inverso. No hubo
  execution, candidate, receipt ni cambio del target W1;
- journal, snapshot, result y disposicion `not_run` quedan preservados. No se
  cambia producto, freeze, formula, umbral, estimulo ni oraculo;
- proxima operacion larga: N=16 secuencial sobre el tercer target nuevo. Su
  assessment de granularidad se deriva del evento productivo aun si el plan es
  rechazado antes de candidate.

Resultado terminal de `retry-10` N=16 y cierre de ejecucion de la serie:

- run `ad5dd07a-4181-4baf-9b23-ff6215a89c2b`, vigia unico detached PID
  `19028`, termino `failed` durante compiled plan review con el mismo falso
  positivo artifact + seam;
- las tres celdas se ejecutaron secuencialmente sobre el freeze y targets
  nuevos. Las tres quedaron pre-candidate, sin receipt; cada una tiene
  disposicion de oraculo `not_run`. Como no hubo entrega, se ejecutaron cero
  oraculos y no se asigno el oraculo a un resultado inexistente;
- N=16 preservo el evento de granularidad checksum `b60fe54c`, 19 hojas y 20
  assessments. La raiz selecciono split por `leafFeasible=false`, aunque
  `splitAdvantage=-0.4604` quedo bajo el umbral inmutable `0.15`;
- features raiz N=16: contextRelief `0.6359`, parallelism `0`, faultIsolation
  `0`, coordination `1`, pathOverlap `0.2806`, validationDuplication `0.9474`,
  uncertainty `0.4614`; benefit `0.212`, cost `0.6724`;
- proximo paso: validar integridad/hashes de los tres resultados y someter el
  cierre del ticket 11 a reviews independientes Standards y Spec con la orden
  `No implementes correcciones` antes de marcar sus tres casillas.

Reapertura de remediacion despues de `retry-10`:

- Reviews independientes del fixed point `67a16a1`: Standards FAIL P1 y Spec
  P1. La integridad/comparabilidad de retry-10 pasa, pero no se puede cerrar
  ticket 11 con el defecto productivo reproducido 3/3.
- Causa raiz corregida tras la auditoria de implementacion: el validador habia
  agregado `SeamBinding` al DAG pese a que A5 y el contrato de task graph dicen
  que no impone readiness. Retry-10 reprodujo un falso `artifact_cycle`; el
  crítico rechazó incorrectamente una relación material acíclica combinada con
  un seam no ordenante inverso.
- TDD en `cbb8cdb`: RED 2/2 para artifact mas seam inverso y loop solo de
  seams; GREEN 2/2 al quitar seams de la adyacencia y conservar self/participant
  validation. Suite afectada 69/69 y typechecks task-graph/decomposer PASS.
- El prompt aclara producer -> consumer y omite comandos/API sin consumidor
  interno para reducir seams semanticamente espurios, sin convertir callbacks
  legitimos en dependencias de ejecucion.
- La auditoria integral agrego P0 de verdad de validacion, test integrity y UI
  honesta. El plan ejecutable esta en
  `docs/plans/2026-07-28-manyhands-correctness-closure.md`; no se abre un nuevo
  freeze hasta cerrar esos P0 y sus reviews. Ticket 11 sigue abierto.

Corrección de gobernanza después de la review Standards del fixed point
`da81bc7`:

- Standards FAIL por mantener blockers en el plan y por omitir P2 de la
  aceptación final; Spec PASS para el fix de seams.
- Los tickets locales 16--26 pasan a ser la única fuente canónica de estado,
  blockers y aceptación. El plan queda como runbook no autoritativo.
- Frente recalculado: ticket 16. Ticket 11 queda bloqueado transitivamente por
  16--26; no se crea otro freeze ni se ejecuta otra serie antes de cerrarlos.
- También se corrigen las frases históricas que llamaban ciclo material al
  falso positivo artifact + seam; retry-10 y sus journals no se modifican.

Corrección Spec del fixed point `da802ba`:

- Spec FAIL P1 porque CLAIM-040/041/053 seguían `implemented` pese a que la
  auditoría demostró controles de validación y recovery no cableados.
- CLAIM-020/021/040/041/053 quedan provisionalmente `partial`; tickets 18, 19,
  21, 23, 24 y 25 contienen la aceptación canónica para reevaluarlos.
- No se eleva ningún claim por existencia de módulos o tests aislados. Frente
  vigente permanece ticket 16 hasta obtener re-reviews Standards/Spec PASS.

Cierre ticket 16:

- Estado canónico: `closed`; fixed point `1745c0c`.
- TDD y gates: RED 2 fallos; GREEN 69/69; typechecks task-graph/decomposer PASS
  con Node 22.23.1 y pnpm 7.29.3.
- Reviews finales independientes con “No implementes correcciones”:
  Standards PASS y Spec PASS, cero P0/P1/P2; Spec cero P3.
- Retry-9/retry-10 permanecen adversos e inmutables. No hay freeze nuevo.
- Frente recalculado desde tickets locales: 17 (`ui-evidence-honesty`).

Checkpoint ticket 17 antes del gate amplio:

- TDD RED: 2 fallos válidos por fallback `Verified [evidence recorded]` y por
  aceptar final candidate sin matriz verificada exacta.
- GREEN focal 23/23; regresiones delivery/crash/driver/model 18/18;
  typechecks run-coordinator y web PASS con Node 22.23.1/pnpm 7.29.3.
- El reducer conserva outcome + candidate commit por matrix id y rechaza
  `final_candidate.verified` ausente, no verificado o de otro commit.
- UI muestra estados verified/incomplete/failed/pending, criterios y refs;
  publicación queda deshabilitada salvo matrix-id y commit exactos verificados.
- Próxima operación larga: `pnpm test` completo sobre este working tree; si
  falla, aplicar `diagnosing-bugs` y no reintentar a ciegas.

Diagnóstico del primer gate amplio de ticket 17:

- el wrapper cortó `pnpm test` a los 124 s con exit 124, sin resumen terminal;
  no es PASS ni fallo de test;
- inspección de procesos confirmó que no quedó Vitest activo; el único Node
  coincidente es el servidor preservado retry-10 en 3001;
- working tree limpio en `07b789d`; no hubo mutación ni reintento ciego;
- próxima operación larga: una ejecución única de `pnpm test` con timeout 300 s
  usando el mismo Node 22.23.1/pnpm 7.29.3.

Diagnóstico terminal del gate amplio de ticket 17:

- el suite completo terminó en 217.5 s con 2 timeouts de 30 s sólo en
  `integration-real-git`, más cleanup `ENOTEMPTY/EBUSY` de `%TEMP%`;
- ambos casos pasaron focalmente y secuencialmente sin cambios de código:
  redundant patch 1/1 en 12.12 s; unexpected repair commit 1/1 en 12.35 s;
- clasificación: contención Windows bajo paralelismo del suite, patrón ya
  preservado en retry-10; no hay evidencia de regresión del ticket 17;
- próxima operación larga autorizada por el diagnóstico: una única repetición
  limpia del suite completo. No habrá más reintentos ciegos.

Resultado de la repetición limpia del gate amplio de ticket 17:

- el suite completo terminó en 200 s con un solo fallo: timeout de 30 s y
  cleanup `EBUSY` en el caso `rejects and removes a commit created
  unexpectedly by repair executor` de `integration-real-git`;
- el otro caso que había fallado en la corrida anterior pasó dentro de este
  suite. El caso remanente ya había pasado focalmente 1/1 en 12.35 s, sin
  cambios de código entre las ejecuciones;
- el resultado amplio no se declara PASS. Se preserva como evidencia de
  contención Windows y no se ejecuta un tercer reintento;
- `git diff --check` y working tree están limpios en `b076da1`. Próximo paso:
  reviews independientes Standards y Spec con “No implementes correcciones”.

Reapertura de ticket 17 por reviews del fixed point `d5bf07f`:

- Standards y Spec coincidieron en un P1: la entrega estaba correctamente
  ligada a `matrixId + commit`, pero medalla y detalle elegían sólo por commit;
  dos matrices distintas del mismo SHA podían sobreafirmar `Verified` o mostrar
  criterios ajenos. Ningún reviewer implementó correcciones;
- TDD RED reprodujo 2 fallos: una matriz `unverified` canónica seguida por otra
  `verified` para el mismo commit mostraba `Verified [1/1 passed]`, y el detalle
  final no recibía el ID exacto;
- fix `6ee3026`: la medalla resuelve el ID durable de nodo/integración y el
  detalle final exige la identidad exacta `matrixId + candidateCommit`;
- GREEN 15/15 focal; conjunto afectado 28/28; typecheck web PASS con Node
  22.23.1/pnpm 7.29.3. Próximo paso: re-reviews independientes Standards/Spec.

Cierre ticket 17:

- estado canónico `closed`; fixed point revisado `e9b1dd9`;
- re-reviews independientes con “No implementes correcciones”: Standards PASS
  y Spec PASS, cero P0/P1/P2/P3;
- RED/GREEN, 28/28 afectados y typecheck web PASS. El suite global conserva su
  resultado NO PASS por un timeout `EBUSY` focalmente verde; no se reintentó ni
  se presentó como validación exitosa;
- frente recalculado desde tickets locales: 18 (`validation-test-integrity`).

Checkpoint ticket 18 antes del gate afectado amplio:

- TDD RED: 5 fallos válidos; candidato verde con test borrado, `skip`, `only`
  o assertion removida quedaba `verified`, y el detector no cubría contenido;
- fix productivo `5819af6`: V2 deriva archivos/scripts de baseline y candidato
  exactos, detecta los cuatro debilitamientos y materializa tests candidatos
  sobre la base previa para el negative control;
- un control que también queda verde en baseline falla la matriz. Findings y
  controles quedan durables con IDs y output digests; el schema rechaza una
  matriz `verified` contradictoria;
- GREEN focal 24/24; typechecks execution-core/run-coordinator PASS con Node
  22.23.1/pnpm 7.29.3. CLAIM-040/041 siguen `partial` hasta evidencia productiva
  y rederivación posterior. Próxima operación larga: gate afectado amplio.

Gate afectado amplio de ticket 18:

- 44/44 PASS en 11 archivos: weakening, exact validation/cache, evidence
  matrix, recipe, V2 node executor, coordinator facts/lifecycle, V2 e2e/crash y
  delivery;
- typechecks execution-core, run-coordinator, orchestrator-graph y web PASS;
- no se ejecutó el suite global como sustituto del gate focal: su contención
  Windows previa sigue preservada. Próximo paso: reviews independientes
  Standards/Spec del punto fijo, sin implementar correcciones.
