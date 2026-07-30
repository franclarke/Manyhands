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

Reapertura de ticket 18 por reviews del fixed point `6ab9bde`:

- Spec FAIL P1 por scripts test estrechados/reemplazados; Standards agregó P1
  de symlink y versionado durable, más P2 de cache, baseline exacto, bare
  `assert(...)` y cleanup. Ningún reviewer modificó archivos;
- TDD RED preservó 6 fallos observables en esas rutas. Fix `4fec620`: compara
  fail-closed scripts de test de cada manifest cambiado en baseline/candidate
  exactos, materializa sin atravesar symlinks, incluye policy+detector+findings
  en cache, cuenta bare assert y ejecuta cleanups con `allSettled`;
- el envelope durable pasa a schema v3; v2 tiene upcaster identidad porque los
  campos nuevos son opcionales. Tests prueban lectura checksummed v2, escritura
  v3 y rechazo de versión futura;
- GREEN 38/38; typechecks execution-core/run-store/run-coordinator PASS.
  CLAIM-040/041 permanecen `partial`. Próxima operación larga: repetir gate
  afectado amplio antes de re-review.

Gate afectado ampliado de ticket 18 después de remediation:

- 66/66 PASS en 16 archivos, agregando event upcast, event source, fencing,
  lock ownership y snapshot rebuild al conjunto de validation/V2/coordinator;
- typechecks execution-core, run-store, run-coordinator, orchestrator-graph y
  web PASS con Node 22.23.1/pnpm 7.29.3;
- working tree limpio en el punto fijo documentado. Próximo paso: re-reviews
  Standards/Spec con “No implementes correcciones”.

Segunda reapertura de ticket 18:

- Standards/Spec confirmaron resueltos los siete findings previos, pero ambos
  FAIL P1 por cobertura estrechable desde `vitest/jest` config o scripts
  indirectos sin nombre `test`;
- fix `6c1989d`: configs de discovery cambiadas producen finding durable y se
  comparan fail-closed todos los scripts de cada manifest cambiado, porque
  wrappers/workspaces impiden probar localmente que un script sea irrelevante;
- focal 24/24 y typechecks execution-core/run-coordinator PASS. CLAIM-040/041
  siguen `partial`. Próximo paso: re-review final del ticket 18.

Tercera remediation de ticket 18:

- re-review `40d2d2a` FAIL por Jest embebido/Mocha, wrapper externo y nuevo enum
  durable aún escrito como v3;
- fix `a33cf84` carga manifests exactos ancestros, congela config embebida e
  inputs referenciados por comandos (`node scripts/run-tests.mjs`), amplía
  nombres de config y escribe schema v4 con upcast v3;
- delta 32/32; typechecks execution-core/run-store/run-coordinator PASS.
  CLAIM-040/041 siguen `partial`; próximo paso: reviews finales.

Cuarta remediation de ticket 18:

- reviews `d2e6add` confirmaron resueltos los hallazgos anteriores y aislaron
  un P1: wrappers relativos a manifests anidados y selección transitiva aún
  podían estrechar cobertura;
- RED reprodujo el wrapper de workspace y el import transitivo. Fix `acb1b1b`
  resuelve referencias desde el directorio de cada manifest y recorre el cierre
  de imports/requires relativos en baseline y candidato exactos;
- focal 28/28 y typechecks execution-core/run-coordinator PASS. CLAIM-040/041
  permanecen `partial`. Próxima operación larga: reviews independientes finales
  Standards/Spec con "No implementes correcciones".

Reviews finales `7b19895` de ticket 18:

- Spec FAIL P1: imports bare/alias de paquetes workspace no entran al cierre;
- Standards FAIL con dos P1 y un P2: partir de todos los scripts produce falsos
  positivos sobre `dev`/`build`, el parser deja inputs dinámicos y NodeNext sin
  cerrar, y el recorrido carece de presupuesto/cancelación;
- ambos conservaron el punto fijo sin cambios. Decisión tras `grilling`: no
  enumerar más bypasses con regex. Próxima operación: RED para raíces de test,
  resolución workspace/fail-closed y límites explícitos. CLAIM-040/041 siguen
  `partial`.

Quinta remediation de ticket 18:

- RED: alias workspace, source NodeNext y loader dinámico opaco escapaban; el
  recorrido desde `dev` producía un rechazo falso;
- fix `85079da` parte sólo de scripts de test y su clausura, resuelve exports de
  paquetes workspace y equivalencias NodeNext, y falla cerrado si el loader no
  es analizable. El recorrido tiene cancelación y límites 256/16/1 MiB;
- focal 33/33 y typecheck execution-core PASS. CLAIM-040/041 continúan
  `partial`; próximo paso: reviews independientes del nuevo punto fijo.

Reviews `65e48f8` de ticket 18:

- Spec FAIL 2 P1: un loader opaco estable bloquea cambios productivos ajenos y
  el mapa workspace candidate pisa baseline, omitiendo redirects/tsconfig;
- Standards FAIL 2 P1 + P2: `spawn`/`make`, subpaths `exports`/`imports` y el
  límite de bytes antes del `git show` siguen incompletos;
- decisión: última remediation estructural sobre mapas declarativos separados,
  intersección real del cambio y lectura Git acotada/cancelable. No se cambia la
  política ni los claims, que siguen `partial`.

Sexta remediation de ticket 18:

- `ee9b78b`: mapas baseline/candidate se unen sin pisarse; exports, imports y
  tsconfig paths son inputs declarativos exactos; spawn/Makefile quedan ligados
  y un loader opaco estable no bloquea cambios productivos ajenos;
- `5e71d9f`/`18c0b5d`: `git show` recibe abort y maxBuffer antes de leer cada
  blob; presupuesto total, profundidad y cantidad permanecen fail-closed;
- 46/46 focales PASS. El primer typecheck falló por `signal: undefined` bajo
  exact optional types; corregido sin reintentar tests. Typechecks execution-core
  y run-coordinator PASS. CLAIM-040/041 siguen `partial`; próximo paso reviews.

Reviews `3746182` de ticket 18:

- Spec PASS, cero P0-P3, con 41/41 y ambos typechecks revalidados;
- Standards FAIL 2 P1 + P2: el grafo de scripts no cruza manifests, faltan
  imports sin package name y tsconfig JSONC/extends, y el presupuesto compartido
  aún no cubre lecturas iniciales;
- el ticket permanece abierto. Próximo delta se limita a esos tres puntos;
  CLAIM-040/041 permanecen `partial`.

Séptima remediation de ticket 18:

- RED reprodujo cuatro fallos: script workspace entre manifests, imports sin
  name, tsconfig JSONC/extends y lectura inicial fuera del budget;
- fix `1c99171` expande scripts referenciados globalmente, interpreta JSONC y
  extends relativos, conserva imports privados y usa un único presupuesto
  cancelable para tests/manifests/config/dependencias;
- 50/50 focales y typechecks execution-core/run-coordinator PASS. Próximo paso:
  re-review Standards y Spec del mismo punto fijo. Claims siguen `partial`.

Reviews `8ce8955` de ticket 18:

- Spec FAIL P1; Standards FAIL 2 P1 + P2. La expansión global pierde scope de
  `--filter`/manifest, omite puntos en script names, no aplica precedencia del
  wildcard tsconfig y mezcla aliases privados homónimos;
- imports/JSONC/extends y presupuesto compartido permanecen resueltos. Próximo
  delta conserva identidad y scope declarados. CLAIM-040/041 siguen `partial`.

Octava remediation de ticket 18:

- RED: script `unit.test`, precedencia de wildcard y falsos positivos por
  `--filter`/alias privado homónimo;
- fix `c3cb30e` conserva manifest origen y package name al expandir scripts,
  respeta filtros, y resuelve aliases configurados por scope y especificidad;
- 36/36 focales y typechecks execution-core/run-coordinator PASS. Próximo paso:
  reviews independientes del punto fijo; claims continúan `partial`.

Reviews `656423e` de ticket 18:

- ambos roles FAIL por shorthand/múltiples filtros/comillas de pnpm; Standards
  agregó preexpansión local homónima y scope heredado desde config externo;
- el próximo delta queda limitado a parser segmentado, evitar local expansion
  filtrada y transportar scope del proyecto por `extends`. Claims siguen partial.

Novena remediation de ticket 18:

- fix `c9a10f7` interpreta shorthand, filtros quoted y cadenas por segmento;
  una invocación filtrada no preexpande homónimos locales. El scope del proyecto
  se conserva al leer un tsconfig base externo;
- 37/37 y typechecks execution-core/run-coordinator PASS. Próximo paso reviews
  del punto fijo; CLAIM-040/041 continúan partial.

Décima remediation de ticket 18:

- reviews detectaron múltiples `--filter`, args tras `--` y falsos positivos de
  `exec`/`dlx`; RED reprodujo los tres;
- fix `9e4eda3` parsea opciones hasta el primer script, conserva todos los
  filters y excluye subcomandos no-script. 39/39 y ambos typechecks PASS;
- próximo paso reviews del punto fijo. CLAIM-040/041 siguen partial.

Undécima remediation de ticket 18:

- reviews aislaron targets por directorio/workspace y selector glob/negativo;
- fix `2b6da37` conserva `-C`/`--dir`/`--workspace` y evalúa filtros como
  positivos menos exclusiones sobre package name o manifest path;
- 39/39 y typechecks execution-core/run-coordinator PASS. Próximo paso reviews;
  claims siguen partial.

## Handoff por límite de cuota — 2026-07-28

Estado canónico:

- branch `main`; no hubo push, reset, clean ni borrado de artefactos;
- tickets 16 y 17 están `closed`; ticket activo 18 permanece
  `ready-for-agent`; 19–26, 11, 12, 02, 14 y 15 siguen abiertos según sus
  archivos locales;
- ruta crítica recalculada: `18 -> 19 -> 20 -> 21 -> 22 -> 23 -> 24 -> 25 ->
  26 -> 11 -> 12 -> 02 -> 14 -> 15`;
- `retry-9` y `retry-10` son evidencia adversa inmutable. No reanudar, borrar ni
  reescribir sus runs, targets, clones, pools, journals o artefactos;
- CLAIM-040/041 continúan `partial`; no promover ningún claim antes de evidencia
  productiva y rederivación en ticket 14.

Último estado de ticket 18:

- los últimos reviews completos fueron sobre `b4226b7` y dieron FAIL por dos
  brechas concretas de selector/target workspace;
- fix productivo posterior `448b295` distingue glob de package name vs manifest
  path, compone directory con selectors y resuelve `-C/--dir` desde el manifest
  que origina el comando;
- verificación posterior: 39/39 en
  `tests/execution-core-v2-node-executor.test.ts`; typechecks
  `@manyhands/execution-core` y `@manyhands/run-coordinator` PASS;
- todavía **no existen** reviews independientes Standards/Spec sobre `448b295`.
  Por eso ticket 18 sigue abierto y ninguna casilla debe marcarse todavía.

Primera operación de la próxima fase:

1. leer los documentos obligatorios y ticket 18 completos;
2. verificar root, branch, HEAD, ancestry, `git status --short` y
   `git diff HEAD`; exigir árbol limpio;
3. pedir en paralelo reviews independientes Standards y Spec del delta
   `b4226b7..HEAD`, ambas con “No implementes correcciones”;
4. si ambas dan PASS y cero P0-P3, marcar las cinco casillas de ticket 18,
   cambiarlo a `closed`, actualizar este HANDOFF y hacer commit local pequeño;
5. si aparece un finding, conservarlo, usar TDD/diagnosing-bugs y no iniciar
   ticket 19 hasta lograr el doble PASS;
6. recalcular el frente y leer ticket 19 completo antes de modificar archivos.

Trabajo restante para tesis y proyecto:

- 19: validación consciente de criterios;
- 20: congelar el oráculo externo;
- 21–26: autoridad/takeover, freshness, recovery/scheduling, integración y
  manifest durables, stores/traces/security y seams de policy/config;
- 11: generar un freeze sucesor nuevo desde evidencia limpia y ejecutar
  N=4/N=8/N=16 secuencialmente sobre un único commit, preservando resultados;
- 12: medir `validationDuplication` con fórmula/threshold intactos y emitir el
  veredicto honesto;
- 02: cerrar el límite C1 con rechazo mínimo explícito si no es reconstruible;
- 14: rederivar la matriz completa de claims desde evidencia cerrada;
- 15: terminar tesis, presentación, defensa y PDFs, ejecutar gate editorial y
  revisar visualmente cada página;
- finalmente ejecutar el gate completo sobre un único commit limpio y emitir el
  informe exigido por `AUTONOMOUS_CLOSURE_PLAN.md`.

No se alcanzó la definición de terminado. El goal debe continuar en una tarea
nueva usando `docs/tesis/NEXT_AGENT_GOAL_PROMPT.md`.

### Cierre final de ticket 18 — 2026-07-28

- después del handoff anterior, Standards y Spec revisaron `448b295` y ambos
  dieron FAIL P1 por la composición `-C/--dir` + `--filter`/`-r`;
- RED focal confirmó el bypass. Fix productivo `d593b53` interpreta el
  directorio como scope para paquetes descendientes cuando hay selectors o
  recursive, y como target exacto cuando no los hay;
- verificación posterior: 39/39 en
  `tests/execution-core-v2-node-executor.test.ts`; typechecks
  `@manyhands/execution-core` y `@manyhands/run-coordinator` PASS;
- las re-reviews Standards/Spec sobre `d593b53` se reanudaron y ambas dieron
  PASS con cero P0/P1/P2/P3, sin implementar correcciones;
- ticket 18 quedó `closed` con sus cinco casillas completas. CLAIM-040/041
  permanecen `partial`, como exige su aceptación;
- frente recalculado: ticket 19 es el siguiente `ready-for-agent`, pero no fue
  reclamado ni iniciado por límite de cuota. Ruta restante: `19 -> 20 -> 21 ->
  22 -> 23 -> 24 -> 25 -> 26 -> 11 -> 12 -> 02 -> 14 -> 15`;
- branch `main`, sin push. El siguiente agente debe exigir árbol limpio y
  verificar que `d593b53` sea ancestro de HEAD, leer ticket 19 completo y sólo
  entonces iniciar la próxima fase.

## Decisión de alcance: cierre Warehouse compacto — 2026-07-29

La tesis debe terminar con un demostrador Warehouse completo y, a la vez, usar
su construcción para descubrir fallas que sólo aparecen durante ejecuciones
end-to-end. No se retomará, sin embargo, la cadena original como ocho
incrementos: ese fraccionamiento agrega costo de preparación, ejecución y
oráculo sin aportar ocho fronteras técnicas realmente independientes.

### Evidencia histórica que no cambia

- W1 continúa siendo la única entrega externamente verificada de la serie
  longitudinal original, sobre el commit exacto
  `71f61c9efa222103ca2fb2f67692434ab493d75c`;
- el resultado original permanece en `1/8`. Los intentos W2 y la ausencia de
  W3–W8 no se reescriben, reanudan ni reinterpretan como éxito;
- los prompts, oráculos, receipts y artefactos W1–W8 existentes son evidencia
  histórica inmutable;
- el trabajo compacto será una serie sucesora nueva para completar y validar el
  producto. No eleva retrospectivamente el resultado del experimento original.

### Serie sucesora recomendada: W1 + tres incrementos

W1 se conserva como fundación verificada. Quedan sólo tres incrementos
acumulativos nuevos, cada uno con base exacta en la entrega verificada anterior:

1. **WC1 — Operación visible** — absorbe las capacidades previstas en W2–W4:
   pedidos y reservas atómicas, transiciones de estado validadas, torre de
   control SVG con heatmap y detalle textual, API versionada, SSE monotónico y
   controles deterministas de simulación (`play`, `pause`, `step`, `reset`).
2. **WC2 — Planificación de fulfillment** — absorbe W5–W6: rutas de picking
   conectadas y reproducibles, overlay visual y textual, olas con capacidad de
   pickers, pedidos no asignados explicados y costo sensible a congestión.
3. **WC3 — Durabilidad y cierre operativo** — absorbe W7–W8: journal append-only,
   snapshots y replay con hash exacto, timeline y errores de corrupción
   accionables, analytics derivados de eventos, alertas, estados
   loading/empty/error/connected, navegación completa por teclado, reduced
   motion y comunicación no dependiente sólo del color.

Esta es la granularidad mínima útil: WC1 prueba el plano transaccional y de
control, WC2 el plano de decisión operativa y WC3 el plano de persistencia,
observabilidad y calidad de producto. Reducirlo a uno o dos incrementos haría
los fallos demasiado difíciles de localizar; conservar siete incrementos
restantes multiplicaría el costo sin mejorar proporcionalmente el diagnóstico.

### Reglas de costo, diagnóstico y aceptación

- antes de ejecutar WC1 debe existir un ticket local sucesor y una enmienda
  explícita al plan/protocolo. La fuente de estado y aceptación continúa siendo
  exclusivamente `.scratch/code-review-remediation/issues/`;
- los tres prompts, probes y oráculos compactos deben congelarse antes de la
  primera ejecución. No se reutilizan ni se editan W2–W8 para acomodar esta
  serie;
- una sola candidate execution y una sola entrega/oráculo por incremento. No
  hay reintentos ciegos ni ajuste de fórmula, threshold, estímulo u oráculo para
  favorecer el resultado;
- todo fallo se preserva y se diagnostica como hallazgo de producto. La
  corrección se realiza con TDD y `diagnosing-bugs`, seguida por un nuevo
  protocolo sucesor explícito si hace falta otra medición;
- cada incremento debe tener presupuesto máximo de tiempo/tokens documentado,
  regla de corte y receipt completo. Un fallo pre-candidate recibe `not_run` en
  el oráculo;
- sólo se avanza desde el commit exacto externamente verificado del incremento
  anterior. Código, configuración y modelo permanecen fijos dentro de cada
  celda;
- Codex es el único ejecutor permitido. La condición continúa siendo C y la
  configuración de modelo/esfuerzo debe congelarse de manera uniforme antes de
  iniciar la serie;
- WC3 sólo pasa con tests, typechecks, builds, probe determinista, oráculo
  externo y revisión visual/accesible del recorrido completo.

### Integración con el cierre pendiente

La serie compacta debe ejecutarse con ManyHands ya endurecido por los tickets
19–26 y antes de rederivar claims o cerrar los artefactos académicos. La ruta de
alto nivel pasa a ser:

`19 -> 20 -> 21 -> 22 -> 23 -> 24 -> 25 -> 26 -> 11 -> 12 -> 02 -> serie
Warehouse compacta (WC1 -> WC2 -> WC3) -> 14 -> 15`.

El próximo agente **no debe iniciar WC1 desde este HANDOFF**. Primero debe
terminar la ruta técnica previa y, al llegar a esta frontera, crear/reclamar el
ticket local sucesor, reconciliar `AUTONOMOUS_CLOSURE_PLAN.md`, registrar los
claims nuevos o modificados y congelar el protocolo compacto. La definición de
terminado del demostrador exige las capacidades acumuladas de W1, WC1, WC2 y
WC3; la conclusión académica deberá distinguir claramente ese resultado final
del `1/8` histórico.

## Ticket 19 en curso — validación relevante por criterio — 2026-07-29

- trabajo aislado desde `bb9d102` en
  `C:\Users\franc_rgy\.codex\tmp\manyhands-ticket19-20260729-115928\repo`; el
  checkout principal y sus seis cambios ajenos permanecen intactos;
- RED confirmó que la receta asignaba el mismo `pnpm test` a obligaciones
  heterogéneas y luego sintetizaba evidencia distinta por obligación;
- GREEN introduce enlaces `focused_command`, `static_proof` y
  `shared_command`, compila referencias exactas desde tests planificados y falla
  cerrado cuando una obligación carece de evidencia pertinente;
- el validator deduplica comandos físicos compartidos y persiste observaciones
  con digest, duración, criterios, obligaciones y referencias; la matriz exige
  coincidencia exacta antes de marcar un criterio satisfecho;
- la fixture adversa `wide-graph-order` prueba que un comando verde no acredita
  orden de proyecciones si no ejecutó su prueba relevante;
- gates actuales: 12 archivos/89 tests afectados PASS; suite raíz 212
  archivos/1466 tests PASS con 2 skips preexistentes; typechecks de los cuatro
  packages afectados y web PASS; build de los 12 packages PASS;
- mutación autenticada productiva verificada sobre el servidor oficial local:
  GET con cookie `200`, POST de workspace `201` y lectura persistida con
  identidad física exacta del clon;
- CLAIM-040/041 siguen `partial`. Próxima operación: fijar el commit y pedir
  reviews independientes Standards/Spec con “No implementes correcciones”.

### Reviews de ticket 19 sobre `8eaf3fb`

- Standards FAIL: P1 por autoatribuir un test de unidad a todos sus criterios;
  P2 por representaciones paralelas de observación y por incluir duración de
  reloj en la identidad determinista de la matriz;
- Spec FAIL: el mismo P1 y P2 porque la fixture retry-2 no ejercitaba un oráculo
  value-aware real;
- ambas reviews fueron sólo lectura y no implementaron correcciones. Ticket 19
  continúa abierto. Próximo paso: regresiones RED y corrección causal antes de
  nuevos gates/re-reviews.

### Remediación de findings de ticket 19

- shared relevance dejó de inferirse por co-localización: múltiples criterios
  permanecen sin binding hasta una declaración explícita, cuyas referencias se
  ejecutan como selectors;
- la fixture retry-2 ahora contiene y ejecuta un oracle Node value-aware real;
- la observación durable tiene un único schema canónico en `shared`, con
  resultado, intento, digests, duración y atribuciones; registros históricos
  migran a `observations: []`;
- `matrixId` ignora únicamente duración de reloj y conserva los campos
  deterministas;
- un primer gate raíz pasó 211/212 archivos; detectó como único fallo que
  `run-coordinator` no puede depender de `contracts`. El schema se reubicó en
  `shared` y el test de frontera ya pasa;
- gates finales de la remediación: 13 archivos/104 tests afectados PASS; suite
  raíz 212 archivos/1472 tests PASS con 2 skips preexistentes; typechecks de
  `shared`, `contracts`, `decomposer`, `execution-core`, `run-coordinator`,
  `orchestrator-graph` y web PASS; build de los 12 packages PASS.
  Próximo paso: commit y re-reviews independientes Standards/Spec.

### Re-reviews de ticket 19 sobre `7b020e3`

- Standards PASS, 0 P0/P1/P2/P3, y confirmó resueltos los findings previos;
- Spec FAIL, 0 P0/P1, 1 P2, 0 P3: la frontera admitía bindings incompatibles
  con su capa o tipo aceptable, y el recipe podía etiquetar un comando con un
  tipo que no produjo;
- RED/GREEN posterior: contratos incoherentes ahora fallan en la frontera y el
  recipe deriva `static_analysis` o `test_result` del binding ejecutado, no de
  la primera alternativa en `acceptableEvidence`;
- gates posteriores: 14 archivos/132 tests afectados PASS; suite raíz 212
  archivos/1474 tests PASS con 2 skips preexistentes; seis typechecks de
  paquetes, web typecheck y build de los 12 packages PASS;
- ambos reviewers fueron sólo lectura. Próximo paso: commit y nuevas re-reviews
  independientes.

### Cierre de ticket 19

- commits productivos locales: `8eaf3fb`, `7b020e3` y `2cf5814`, todos
  descendientes de `bb9d102`;
- re-reviews finales independientes sobre `2cf5814`: Standards PASS y Spec
  PASS, ambas con 0 P0/P1/P2/P3 y sin modificaciones de reviewers;
- mutación autenticada, 14 archivos/132 tests afectados, suite raíz
  212/1474 con 2 skips, seis typechecks, web typecheck y build de 12 packages
  permanecen PASS;
- ticket 19 queda `closed`; CLAIM-040/041 siguen `partial` hasta evidencia
  externa formal. La frontera lista siguiente es ticket 20.

## Ticket 20 en curso — freeze del oráculo externo — 2026-07-29

- ticket 19 está integrado y `closed`; ticket 20 pasó a `agent-working` en el
  mismo clon aislado, sin tocar los seis cambios ajenos del checkout principal;
- RED mostró que las celdas no congelaban identidad/hash/mapeo del oráculo y el
  driver no podía invalidar atribución por drift;
- GREEN agrega contrato externo hashable, manifest/celdas v2 y preflight
  fail-closed antes del run; delivery sólo se aprueba después de un único PASS
  atribuible al SHA exacto y un restart reutiliza el receipt preservado;
- 10 archivos/80 tests afectados pasan. Pendientes: gate amplio, commit, freeze
  material con P0/mutación autenticada y reviews Standards/Spec.

### Reviews y remediación de ticket 20

- reviews sobre `8c445ec`: Standards FAIL con 3 P1 (hashes transitivos,
  discriminante basado en `cellId`, receipt final no reconciliado); Spec FAIL
  con el P1 de discriminante y P2 por freeze/P0/mutación aún pendientes;
- RED/GREEN posterior congela las dependencias transitivas ejecutables, usa
  protocolo tipado v2 independiente del nombre de celda y valida otra vez el
  receipt `completed` contra el SHA aprobado por el oráculo;
- 10 archivos/80 tests afectados PASS. Ningún reviewer modificó archivos.
  Próximo paso: commit, re-reviews y freeze material sobre el punto aceptado.

### Segunda re-review de ticket 20

- Spec de código PASS, 0 P0/P1/P2/P3;
- Standards confirmó los fixes previos pero aisló 1 P1: el receipt no fijaba
  `moduleCount`, permitiendo reutilización cruzada N=4/N=8 con igual SHA/outDir;
- RED/GREEN ahora atribuye por contrato, evaluator, SHA, `moduleCount`, outcome
  y checks tanto antes de delivery como en `completed`; 2 archivos/7 tests
  focales PASS. Pendiente gate afectado, commit y nuevas re-reviews.

### Freeze material de ticket 20

- commit de código aceptado `4fe8544`; re-reviews Standards y Spec PASS, ambas
  con 0 P0/P1/P2/P3;
- `docs/tesis/evidence/warehouse/wide-graph/oracle-freeze-v2.json` fija el
  source/tree aceptado, marker y hash de dist, lockfile, contrato transitivo,
  mapeos y receta exacta;
- test de reconciliación del freeze PASS (7/7). Próximo paso: commit del freeze
  y ejecutar sobre ese SHA exacto P0 secuencial más mutación autenticada.

### Gate y mutación de ticket 20 sobre `9d1c7d7`

- el freeze material quedó en
  `9d1c7d72f29782a7aafcf69958d0fc9785b7a14a`, con árbol limpio;
- Gate P0 secuencial exacto PASS: 213 archivos, 1481 tests passed, 2 skipped;
  seis typechecks de paquetes, web typecheck, build de los 12 packages y web
  build PASS con Node `v22.23.1` y pnpm `7.29.3`;
- el servidor oficial del mismo commit aceptó una mutación autenticada:
  landing/read 200, `POST /api/workspaces` 201 y read-after-write 200. El
  workspace `6c77f06e-80ca-4c93-a9b6-0138b289186e` conserva la identidad del
  clon físico distinto fijado a `9d1c7d7`;
- el intento previo contra el clon ya registrado por ticket 19 devolvió 500 por
  conflicto de identidad; se preservó como evidencia adversa y se corrigió la
  fixture, sin borrar ni mutar el workspace previo;
- shutdown verificado: siete procesos del servidor detenidos y puerto 3020
  libre. Checkout aún limpio, dist SHA-256
  `f95b81959faf0a23b9f3a0c8814dd90cf894db8907ef17f8430419499bed16bc`
  y test de freeze 7/7 PASS;
- evidencia completa fuera del repo en
  `C:\Users\franc_rgy\.codex\tmp\manyhands-ticket19-20260729-115928\runtime-logs`.
  Las reviews finales independientes sobre `6355ffd` dieron Standards PASS y
  Spec PASS, ambas con 0 P0/P1/P2/P3 y sin modificaciones;
- ticket 20 queda `closed`. La frontera recalculada habilita ticket 21
  (`ready-for-agent`); ticket 26 continúa bloqueado por 25.

## Ticket 21 en curso — autoridad atómica y takeover — 2026-07-29

- ticket 21 pasó a `agent-working` en el mismo clon aislado; el `main` original
  fue adelantado por fast-forward a `663c756` y conserva exactamente sus seis
  cambios ajenos;
- RED produjo 3 fallos: no existía una interfaz unificada de claim/fence y la
  repository lease no podía abortar el efecto protegido;
- GREEN introduce el módulo profundo `RunOperationAuthority`: bajo el mutex
  durable del record, el event store acuña primero el fence canónico; sólo tras
  reconciliar procesos y obtener `allDead=true` se publica una lease de
  takeover con receipt durable;
- un crash simulado entre fence y publicación rechaza al dueño viejo y el
  claim siguiente salta el fence huérfano. Un child real fue terminado y
  verificado antes de devolver autoridad; `allDead=false` bloquea el takeover;
- la pérdida de repository lease aborta ejecución/delivery supervisadas y el
  runner registry usa `operationId`, evitando que cleanup viejo borre al nuevo;
- la primera review independiente halló P2: el receipt se fechaba antes de la
  verificación, y P1: delivery no registraba un controller de operación. Tres
  RED focales reprodujeron ambos huecos;
- remediación GREEN: receipt/heartbeat posterior a `allDead`, controllers de
  execution/delivery identificados por `operationId` y rechazo de todo spawn
  supervisado antes de crearlo si la operación ya fue abortada;
- gate ampliado 8 archivos/35 tests PASS; typechecks de `@manyhands/run-store`
  y web PASS. Suite raíz exacta: 215 archivos, 1490 tests passed, 2 skipped;
  build de los 12 packages y web build PASS con Node `v22.23.1` y pnpm `7.29.3`;
- la re-review Standards halló P2 de compatibilidad HMR: la nueva forma del
  abort registry reutilizaba su clave legacy. RED reprodujo el TypeError;
  GREEN versiona la clave `run-abort-registry:v2`, con 3 archivos/7 tests y
  web typecheck PASS;
- la re-review Spec halló P1 cross-host: `allDead` no impedía que un host viejo
  sin child actual despachara luego. La remediación usa la repository lease
  durable como barrera para execution/delivery, persiste
  `repositoryQuiescent=true` y exige revalidar el fence tras adquirirla. Una
  prueba Git real retiene la lease vieja y confirma que el takeover espera;
- gate final: 9 archivos/38 tests y ambos typechecks PASS. Una suite raíz
  adversa encontró tres tests de lease con el target ficticio histórico;
  reparado el fixture con Git real, la reejecución original pasó 216 archivos,
  1493 tests, 2 skipped y 0 failed. Los 12 packages y web build pasan;
- tercera review: Standards halló que el receipt nuevo rompía lectura de
  archivos v2 ya escritos. El campo queda tolerado como legacy, pero sólo
  `repositoryQuiescent=true` habilita handoff;
- Spec halló el mismo hueco cross-host en planning. Planning ahora mantiene la
  repository lease durante inspección/modelo/compilación, registra controller,
  combina señales y revalida el fence tras adquirirla; su update del record
  ocurre después de liberar la lease para evitar inversión de locks;
- gate ampliado final: 15 archivos/62 tests y ambos typechecks PASS. La suite
  raíz paralela preserva un fallo adverso del microbenchmark del indexer bajo
  contención (95–109 ms > 25 ms); el archivo aislado pasa 9 + 1 skipped y la
  suite raíz secuencial pasa 216 archivos, 1495 tests, 2 skipped, 0 failed;
  build de los 12 packages y web build PASS;
- CLAIM-053 permanece `partial` por los gaps de tickets 23–25;
- reviews finales independientes sobre `184eeac`: Standards PASS y Spec PASS,
  ambas con 0 P0/P1/P2/P3 y sin modificaciones;
- ticket 21 queda `closed`. La frontera recalculada habilita ticket 22
  (`ready-for-agent`); ticket 26 continúa bloqueado por 25.

## Ticket 22 en curso — adopción con freshness vigente — 2026-07-29

- ticket 22 pasó a `agent-working` en el mismo clon aislado;
- RED demostró que el driver V2 adoptaba y producía candidato final aunque la
  revisión material del contrato cambiara durante el intento;
- GREEN hace obligatorio el puerto de inputs actuales, recarga en el host
  productivo el plan aprobado y recalcula el fingerprint dentro de
  `RunCoordinator.recordDerived`;
- el append optimista vuelve a ejecutar la derivación tras contención, por lo
  que un cambio canónico entre chequeo y persistencia no puede adoptar con una
  decisión vieja;
- `adoptAttemptResult` es el único gate: su transacción produce
  `artifact.adopted` o `attempt.stale`; el driver ya no construye adopciones
  directamente. Un stale conserva candidato y evidencia, pero no registra
  artifacts ni `final_candidate.verified`;
- gates focales: 8 archivos/27 tests de driver, fingerprints, adopción,
  amendments y contención PASS; fencing/exact-candidate: 6 archivos/39 tests
  PASS; typechecks de `run-coordinator`, `orchestrator-graph` y web PASS.
  Pendientes: gate raíz, commit y reviews independientes Standards/Spec.

### Primera review y remediación de ticket 22

- Spec PASS, 0 P0/P1/P2/P3;
- Standards FAIL aisló P1: el primer stale detenía el runner `running` sin
  trigger y los stale históricos detenían invocaciones futuras; y P2: una
  respuesta perdida después de un append durable podía recalcular timestamps y
  chocar con los mismos event IDs;
- RED reprodujo ambos casos. GREEN recarga los inputs vigentes y reencola sólo
  ante un stale nuevo; el intento viejo conserva `stale`, el nuevo adopta y
  produce el resultado. Los stale históricos ya no frenan waves;
- `recordDerived` reconoce primero su lote durable exacto después de una
  respuesta ambigua y sólo vuelve a derivar cuando avanzó el journal por hechos
  ajenos;
- gate posterior: 14 archivos/67 tests afectados, fencing y exact-candidate
  PASS. Pendientes: typechecks/builds, commit y re-review Standards.

### Segunda review y remediación de ticket 22

- Spec volvió a pasar con 0 P0/P1/P2/P3;
- Standards confirmó resueltos los dos findings anteriores, pero halló P1:
  refresh actualizaba grafo/contratos/fingerprint y conservaba capacidades y
  constraints del scheduler inicial, pudiendo dejar nodos nuevos sin executor
  ni base materializable;
- el puerto de freshness ahora reemplaza como una unidad grafo, contratos,
  snapshot, perfil, nodos materializables, executors disponibles y constraints.
  El presupuesto default de waves también crece si la revisión vigente amplía
  el grafo;
- una regresión habilita inicialmente sólo `node-api`, vuelve stale su primer
  intento, refresca todas las capacidades y prueba que el run ejecuta los cuatro
  nodos y alcanza `result_ready`. Pendientes: gates, commit y re-reviews finales.

### Cierre de ticket 22

- commits locales: `390b7bd`, `b7250ec` y `6e0bec3`, descendientes de
  `a48bb3a`;
- reviews finales independientes sobre `6e0bec3`: Standards PASS y Spec PASS,
  ambas con 0 P0/P1/P2/P3 y sin modificaciones;
- gate afectado final: 14 archivos/68 tests PASS; typechecks de
  `run-coordinator`, `orchestrator-graph` y web PASS;
- suite raíz secuencial final: 544 suites, 1499 tests passed, 2 skipped,
  0 failed. El run adverso anterior conservó 1497 PASS y el único fallo del
  append ambiguo antes de su remediación;
- build de los 12 packages y web production build PASS con Node `v22.23.1` y
  pnpm `7.29.3`;
- evidencia JSON adversa y final preservada fuera del repo en
  `C:\Users\franc_rgy\.codex\tmp\manyhands-ticket19-20260729-115928\runtime-logs`;
- ticket 22 queda `closed`. La frontera recalculada habilita ticket 23;
  ticket 26 continúa bloqueado por 25.

## Reconciliación de cierre autónomo - 2026-07-30

Los estados durables actuales reemplazan los checkpoints históricos anteriores
de este HANDOFF cuando haya conflicto:

- Los tickets 19, 20, 21, 22, 23, 24, 25 y 26 están `closed` en
  `.scratch/code-review-remediation/issues/`.
- `retry-9`, `retry-10` y `retry-11` permanecen inmutables. `retry-11` es
  instrumento inválido/no entregado: sus procesos Codex terminaron sin evento
  terminal, candidate SHA, receipt ni delivery. Sus journals, snapshots,
  runtime-runs y ledger se conservan bajo
  `evidence/warehouse/wide-graph/retry-11/` y no se reutilizan.
- El ticket sucesor local 27 cubre la convergencia terminal cuando el ejecutor
  termina inesperadamente. No se inicia una nueva corrida N=4/N=8/N=16 antes
  de cerrar ese ticket con RED, GREEN y revisiones Standards/Spec.
- La ruta vigente es `27 -> 11 -> 12 -> 02 -> WC1 -> WC2 -> WC3 -> 14 -> 15`.
  W1 conserva históricamente el resultado `1/8`.
- WC1, WC2 y WC3 requieren tickets sucesores, claims y freeze de
  prompts/probes/oráculos antes de ejecutar el primer incremento.

## Estado posterior a retry-12 N=4 - 2026-07-30

El freeze sucesor `retry-12` quedó registrado sobre `e1a411d`, con base W1
`71f61c9`, condición C, Codex `gpt-5.5/high` y celdas N=4/N=8/N=16. La celda
N=4 se ejecutó una sola vez y produjo candidate
`7a08eebdf5a3c929097b57a617f9d1fe9f45893b`, pero la validación fue
`unverified` y el run levantó una decisión real `resolve_conflict`.

El driver pre-registrado solo autoriza aprobar el plan y la entrega; no
autoriza contestar decisiones de conflicto ad hoc. Por eso preservó la celda
con lifecycle `waiting_for_input`, `finalSha: null`, `receipt: null` y sin
delivery en `evidence/warehouse/wide-graph/retry-12/runs/warehouse-wide-n04/`.
No es PASS ni resultado terminal entregado. N=8 y N=16 no se inician, y ticket
11 permanece abierto hasta definir un protocolo sucesor explícito para esta
clase de decisión, sin reutilizar ni repetir silenciosamente N=4.

La tesis no puede presentar retry-12 como evidencia positiva: solo demuestra
que el ciclo llega a una decisión durable y conserva la evidencia de una
validación no verificada. W1 continúa siendo `1/8` histórico.

## Avance compacto Warehouse - WC1 implementado - 2026-07-30

Se creó el sucesor limpio `C:\Users\franc\Documents\Proyectos\warehouse-control-tower-compact`
desde W1 `71f61c9efa222103ca2fb2f67692434ab493d75c`, con `core.autocrlf=false`.
WC1 quedó implementado en el commit externo `8ce6e98`:

- dominio de pedidos y reservas atómicas con transiciones válidas;
- API versionada `/api/v1`, stream SSE monotónico y simulación determinista;
- torre SVG con heatmap, bins vacíos y detalle textual equivalente;
- controles `play`, `pause`, `step`, `reset`, teclado y estados explícitos;
- probe determinista `study:wc1-probe` y smoke HTTP reproducible.

Verificación del sucesor: 33 tests PASS, typecheck PASS, build PASS, probe
byte-identical PASS y `scripts/wc1-http-smoke.ps1` PASS. Este commit demuestra
la implementación funcional del demostrador, pero todavía no es una candidate
execution de ManyHands ni cierra ticket 28: faltan freeze, receipt, delivery y
oráculo externo. Próximo paso: congelar protocolo WC1 y ejecutar el flujo
atribuible antes de iniciar WC2.

## Avance compacto Warehouse - WC2 implementado - 2026-07-30

WC2 quedó implementado acumulativamente sobre WC1 en el commit externo
`4da4a45`. Incluye planificación de fulfillment con rutas conectadas y
reproducibles, waves limitadas por capacidad de pickers, explicaciones
accionables para pedidos no asignados, costo sensible a congestión y overlays
visuales/textuales integrados en la API y la interfaz.

Verificación acumulada: 37 tests PASS, typecheck PASS, build PASS y probe
`study:wc2-probe` determinista PASS. WC2 todavía no es una candidate execution
atribuible ni cierra ticket 29: falta freeze, receipt, delivery y oráculo
externo. Próximo paso: implementar WC3 sobre `4da4a45`, luego congelar y
ejecutar la serie compacta de forma atribuible.

## Avance compacto Warehouse - WC3 implementado - 2026-07-30

WC3 cerró la implementación acumulativa en el commit externo `5da6019` sobre
`4da4a45`. Incluye journal append-only, snapshots con hash canónico, replay,
timeline, analytics derivados de eventos, alertas y errores accionables ante
corrupción. La interfaz expone estados loading/empty/error/connected, soporte
de teclado, reduced motion y estados textuales que no dependen sólo del color.

Verificación final del sucesor: 41 tests PASS, typecheck PASS, build PASS,
probes WC1/WC2/WC3 deterministas PASS, smoke HTTP PASS y revisión visual
Playwright PASS en `output/playwright/wc3-home.png`. La implementación del
demostrador compacto está completa; no se cierra aún la evidencia de tesis:
faltan freeze, candidate execution, receipt, delivery y oráculo externo para
WC1, WC2 y WC3. Próximo paso: congelar el protocolo compacto sobre `5da6019`,
ejecutar las tres celdas atribuibles en secuencia y actualizar claims sólo con
esa evidencia.

## Freeze compacto WC1 - 2026-07-30

Antes de consumir cuota quedó congelado el protocolo en
`docs/tesis/evidence/warehouse/compact/wc1-freeze.json` sobre ManyHands
`3625434`/tree `0171657`, base W1 `71f61c9`, Codex `gpt-5.5/high`, condición C,
un ejecutor en serie, budget de 30 minutos por operación y corte de 2 horas.
El prompt, la celda y el oráculo tienen hashes registrados. El target limpio
es `warehouse-control-tower-wc1-candidate`.

La candidate execution WC1 es el próximo paso. Sólo se aprobarán el plan y la
entrega; cualquier otra decisión real deja la celda preservada sin respuesta
ad hoc. Tras un candidate SHA se ejecutará una única evaluación del oráculo
compacto; sin candidate SHA el resultado será `not_run`.

## Checkpoint WC1 candidate execution y defecto de teardown - 2026-07-30

La primera candidate execution atribuible WC1 quedó preservada en
`evidence/warehouse/compact/runs/wc1/` con run
`3f5cf275-85c7-49ce-9fef-12744e1846d8`. La primera hoja produjo candidate
`68a06db4b8c9640aa15d603c80795c98df42100a`, validación `verified` y dos
artefactos adoptados. La segunda hoja no produjo candidate: su Codex quedó
inactivo hasta el timeout, que sí emitió `failure.classified` y
`attempt.failed` a las 08:21:22 UTC.

La causa observada fue productiva y no se interpreta como PASS: el smoke test
dejó vivo `node src/server/start.ts --port 43117`, manteniendo abiertos
`start-smoke.out.log` y `start-smoke.err.log`; el reciclado del pool falló con
`git clean -fdx ... Invalid argument`. El siguiente `WorktreePool.acquire()`
no recibe `AbortSignal` ni timeout y espera indefinidamente por el slot,
manteniendo el lease del repositorio y dejando el run en `running`. El control
normal tampoco pudo hacer takeover porque `repository quiescent` era falso.
El proceso smoke fue terminado con sus PIDs exactos y el servidor de prueba
fue apagado; no se borraron locks ni artefactos manualmente.

La ejecución no tiene candidate final, receipt ni delivery y no se ejecutó el
oráculo WC1. Quedó una decisión real de conflicto por el `git clean` fallido;
no se respondió ad hoc. El nuevo trabajo pendiente es el ticket sucesor 31:
TDD para teardown supervisado, release seguro del pool, propagación de
cancelación/timeout a `acquire()` y takeover después de un executor o smoke
huérfano. Después de cerrar 31 se debe repetir WC1 una sola vez con un freeze
sucesor explícito; no reutilizar este run como medición positiva.

Estado de reanudación: el lease stale del target quedó sin renovación desde
aprox. 08:28 UTC y no debe eliminarse a mano; esperar la política de stale o
usar el camino normal de takeover. El worktree ManyHands está en
`f87f089` antes de la corrección del ticket 31. La secuencia vigente pasa a
`31 -> WC1 candidate sucesor -> WC2 -> WC3 -> 14 -> 15`.

## Checkpoint ticket 31: correccion parcial revisada - 2026-07-30

Se implementaron y probaron los commits `8f8dca1`, `dedf0ff` y `6c71214`:

- el timeout de leaf cubre adquisicion de base, executor, validacion y repair;
- el timeout de integracion cubre adquisicion de base, manifest, validacion y
  repair del composite;
- `WorktreePool.acquire()` recibe y respeta cancelacion durante init, topology,
  polling y antes de publicar el lease;
- un release que no puede sanear/recrear el slot libera el fence y elimina el
  lease activo, y un abort posterior a `worktreeAdd` limpia worktree, prune y
  branch;
- una inicializacion cancelada elimina los slots creados y no conserva una
  capacidad parcial como pool valido.

Verificacion acumulada: `@manyhands/execution-core` typecheck PASS;
WorktreeManager, WorktreePool, V2NodeExecutor y ExecutionBaseBuilder focales
PASS; suites de proceso/cancelacion existentes PASS; `git diff --check` PASS.

La review Standards/Spec no permitio cerrar 31 todavia: faltan una regresion
con timeout real dentro de operaciones Git, la integracion especifica entre
smoke/descendientes, evidencia durable y teardown verificado antes de limpiar
el worktree, y la convergencia completa de procesos huerfanos/restart. La
candidate WC1 adversa queda intacta y no se reejecuta; tampoco se inicia
N=4/N=8/N=16.

Estado exacto para reanudar: resolver las aceptaciones restantes del ticket 31
desde `6c71214`, cerrar con reviews nuevas, crear un freeze sucesor WC1 y
ejecutar solo WC1. La secuencia posterior sigue siendo
`31 -> WC1 sucesor -> WC2 -> WC3 -> 14 -> 15`.

## Checkpoint gate raiz y compatibilidad de proyecciones - 2026-07-30

La suite `tests/execution-driver-concurrency.test.ts` revelo que algunas
proyecciones legacy de pruebas no traian `recoveryHistory` y algunos drivers no
pasaban `now`. El commit `6251751` agrega defaults compatibles; la suite queda
en 10/10 PASS y `@manyhands/orchestrator-graph` typecheck PASS.

En ese momento la corrida completa `pnpm test` quedaba detenida con 6 fallos.
Los problemas de `finalManifest`, lifecycle de decision y expiracion de
decisiones fueron resueltos posteriormente y quedan detallados en el
checkpoint siguiente. No se modifican freezes historicos ni se declaran
resultados positivos mientras reste cualquier fallo del gate; ticket 31 y la
candidate WC1 sucesora siguen sin cerrar.

## Checkpoint compatibilidad de decisiones y manifest - 2026-07-30

El commit `5b398e9` corrige dos incompatibilidades reales descubiertas al
reducir y ejecutar las regresiones del gate:

- una propuesta de revision puede llegar desde `waiting_for_input` y vuelve a
  `needs_approval`; la transicion ahora esta explicitamente permitida;
- las pruebas del driver V2 ahora construyen una `finalManifest` completa y
  coherente con `validationRecipeDigest`, y una integracion fallida con
  decision pendiente verifica correctamente `waiting_for_input`.

Verificacion: las regresiones de artefactos y facts de ejecucion pasan (2 files,
3 tests); `pnpm test` queda en 220 files PASS, 1537 tests PASS y 2 tests FAIL.
Los dos fallos restantes pertenecen a `wide-graph-oracle-contract`: el hash de
un freeze historico no coincide con el `dist` actual y el smoke del oracle
externo termina con codigo Windows `3221226505` en vez del codigo esperado.
No se modifica el freeze historico ni se interpreta el fallo externo como
evidencia positiva. Ticket 31, candidate WC1 sucesora y N=4/N=8/N=16 siguen
detenidos.

Estado de reanudacion: inspeccionar esos dos fallos, documentar si son un
desfase historico o un defecto productivo, y volver a revisar las aceptaciones
pendientes de ticket 31. Si se completa un avance, agregar otro checkpoint aqui
antes de continuar con WC1 sucesor.

## Checkpoint runner externo en Windows - 2026-07-30

La prueba aislada de `wide-graph-oracle-contract` reprodujo que el segundo
fallo no era del oracle: `run-experiment.mjs` llamaba `process.exit(1)` mientras
handles HTTP/IPC de Node aun se estaban cerrando. Windows abortaba libuv con
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` y codigo
`3221226505`, ocultando el estado fallido esperado.

El commit `2421e10` cambia el cierre a `process.exitCode`, dejando que el event
loop cierre sus handles normalmente. Verificacion aislada: 6/7 tests PASS; el
test de delivery/restart vuelve a PASS. El unico fallo restante es la
reconciliacion del `dist` historico no versionado (`expected f95b...`, actual
`cce468...`). El freeze historico no se reescribe ni se cuenta como PASS.

Estado de reanudacion: decidir una materializacion reproducible del artefacto
historico o mantenerlo como bloqueo documentado; despues continuar con las
aceptaciones restantes de ticket 31. Todavia no se repite WC1 y no se ejecuta
N=4/N=8/N=16.

## Checkpoint teardown de validacion y Git cancelable - 2026-07-30

El commit `1df4548` avanza dos aceptaciones de ticket 31:

- `WorktreePoolGit` acepta `AbortSignal` en add, validate, reset/clean, remove,
  prune, common-dir y update-ref; el pool propaga la señal durante la
  inicializacion y adquisicion, y el runner nativo la entrega a `execFile(git)`.
  Una regresion reproduce un sanitation Git bloqueado y confirma que acquire
  rechaza por cancelacion en vez de esperar indefinidamente;
- una validacion supervisada enumera descendientes al cerrar el proceso,
  termina cada descendiente y verifica su salida antes de devolver el resultado.
  Si la inspeccion, terminacion o verificacion falla, la validacion devuelve
  exit `125` y no PASS. Las regresiones cubren smoke exitoso y descendiente
  sobreviviente.

Verificacion de este checkpoint: `tests/worktree-recycling-pool.test.ts` y
`tests/execution-core-worktree.test.ts` pasan 30/30; la suite de validation
runner pasa 18/18; typecheck de `@manyhands/execution-core` PASS;
`git diff --check` PASS. El proceso root ya queda registrado por el journal
durable existente bajo supervision; el teardown de descendientes ocurre antes
de que V2NodeExecutor entre en la limpieza del worktree.

Queda abierto para ticket 31: demostrar en una candidate real la evidencia
durable smoke->pool, completar convergencia de huérfano/restart/heartbeat y
obtener nuevas reviews Standards/Spec. El freeze `dist` histórico sigue siendo
el único fallo del test contractual aislado; no se reescribe. No se repite WC1
ni se inicia N=4/N=8/N=16.

Estado de reanudacion: integrar el escenario de teardown con la ruta V2 real,
cerrar la revisión de lifecycle 27/31 y sólo entonces crear el freeze sucesor
WC1.
## Checkpoint fallo de ejecucion independiente con decision pendiente - 2026-07-30

La regresion RED de `tests/run-background-terminal-failure.test.ts` mostro que
`markRunFailedAfterBackgroundTask` ignoraba cualquier fallo si existia una
decision pendiente, aunque esa decision afectara a otro nodo. El run podia
quedar en `waiting_for_input` despues de que un ejecutor hubiera terminado con
error.

El commit `4a0be8d` separa ambos casos: los fallos de ejecucion ahora registran
el `run.failed` causal aun cuando exista una decision no relacionada; los
fallos de planner/dominio, artifact o delivery conservan la espera legitima.
La decision pendiente no se elimina. La regresion queda en 6/6 PASS, el
typecheck de `@manyhands/web` y `git diff --check` pasan.

Esto corrige una causa real de lifecycle, pero no cierra ticket 31: aun falta
demostrar teardown smoke->pool en una candidate real, convergencia completa de
huerfano/restart/heartbeat y review Standards/Spec final. No se repite WC1
todavia y no se inicia N=4/N=8/N=16.

Estado de reanudacion: ejecutar las aceptaciones restantes de ticket 31,
actualizar HANDOFF despues de cada checkpoint, y solo con ese ticket cerrado
crear el freeze sucesor y la candidate WC1.
## Checkpoint evidencia durable de descendientes - 2026-07-30

La regresion de ticket 31 cubre ahora el caso que produjo el bloqueo WC1:
un ejecutor padre sigue vivo mientras aparece un smoke server descendiente,
el padre termina y el descendiente debe continuar siendo recuperable desde un
host nuevo. El commit `63ce478` agrega un watchdog de tabla de procesos al
journal durable: registra descendientes con PID, comando y label antes del
exit del padre, conserva la evidencia abierta y permite que
`killRunProcessesVerified` los mate y verifique antes del teardown.

Verificacion: la regresion de evidencia queda en 6/6 PASS; process supervisor,
takeover atomico y leases pasan (17 tests); typecheck de web y
`git diff --check` PASS. La implementacion es conservadora: la inspeccion de
procesos es best-effort y nunca bloquea el camino productivo; si no puede
observar o verificar un proceso, el takeover sigue sin declararse seguro.

Ticket 31 sigue abierto hasta ejecutar el escenario integrado con una
candidate real, demostrar la convergencia durable de huÃ©rfano/restart/
heartbeat y completar las reviews Standards/Spec. No se repite WC1 todavia y
no se ejecuta N=4/N=8/N=16.

Estado de reanudacion: revisar este watchdog contra los contratos de
supervision, cerrar las aceptaciones restantes de ticket 31 y actualizar este
documento antes de crear el freeze sucesor WC1.
## Checkpoint release del pool cancelable - 2026-07-30

La regresion RED del pool mostro que el `AbortSignal` se propagaba durante
`acquire()` pero se perdia al devolver un worktree. En consecuencia, una
sanitizacion Git bloqueada durante `release()` podia conservar una operacion
activa mientras el run intentaba avanzar.

El commit `cf13028` propaga la senal desde `V2NodeExecutor` y
`ExecutionBaseBuilder` hasta `PooledExecutionWorkspaceProvider` y todas las
operaciones Git de release/recreate. Si el release se cancela, el fence se
libera, la lease activa se elimina y el slot queda disponible para una nueva
adquisicion controlada.

Verificacion: WorktreePool 18/18, execution-core-worktree 13/13,
execution-driver-produced-artifacts 1/1, typecheck de execution-core y web,
`git diff --check` PASS.

Ticket 31 todavia no se cierra: queda ejecutar una candidate WC1 integrada,
verificar heartbeat/restart/huerfano y completar reviews Standards/Spec. No se
repite WC1 ni se inicia N=4/N=8/N=16.

Estado de reanudacion: hacer la revision independiente del punto fijo de
lifecycle/worktree y, si no quedan defectos de instrumento, crear el freeze
sucesor y ejecutar solamente WC1.
## Checkpoint gate raiz tras lifecycle/worktree fixes - 2026-07-30

`pnpm test` se ejecuto despues de `cf13028`: 220 archivos pasan, 1544 tests
pass y 2 skipped. El unico fallo restante es el hash del `dist` historico de
`wide-graph-oracle-contract` (`expected f95b...`, actual `cce468...`), que ya
existia por el cambio de ticket 02 y no se reinterpreta como PASS ni se
reescribe silenciosamente.

Las regresiones nuevas de fallo terminal, evidencia de descendientes y release
cancelable pasan dentro del gate. No aparecieron regresiones de lifecycle,
leases, takeover, supervisor ni worktree. Ticket 31 sigue abierto por la
candidate integrada y reviews Standards/Spec; WC1 sucesor y N=4/N=8/N=16 aun
no se ejecutan.

Estado de reanudacion: resolver o materializar de forma reproducible el
artefacto `dist` historico sin alterar su semantica, completar la review
independiente de 31 y luego crear el freeze sucesor WC1.
## Checkpoint freeze historico reproducible - 2026-07-30

El fallo restante de `wide-graph-oracle-contract` no era una deriva del
oraculo sino un `dist` generado e ignorado que no estaba versionado. Se
reconstruyo el paquete desde el commit exacto del freeze
`4fe854425fa04341f123b13c93a3bc08b9223702`; el hash coincide con
`f95b81959faf0a23b9f3a0c8814dd90cf894db8907ef17f8430419499bed16bc`.

La copia durable queda en
`docs/tesis/evidence/warehouse/wide-graph/frozen-dist/packages/decomposer/dist/index.js`
y `oracle-freeze-v2.json` apunta explicitamente a ella. La prueba contractual
queda en 7/7 PASS. Esto conserva la evidencia historica sin cambiar su
semantica ni reinterpretar recibos.

Estado de reanudacion: ejecutar nuevamente el gate raiz para confirmar cero
fallos contractuales, luego completar la review independiente de ticket 31 y
crear el freeze sucesor de WC1. Todavia no se repite WC1 ni se inicia
N=4/N=8/N=16.

## Checkpoint gate raiz verde y freeze historico cerrado - 2026-07-30

El gate raiz se repitio despues de versionar el `dist` historico. Resultado:
221 archivos pasan, 1545 tests pasan y 2 quedan skipped. El contrato del
freeze historico pasa 7/7 y ya no hay fallos de hash. Los mensajes de stderr
son los errores esperados de regresiones que verifican estados terminales y
no reducen el resultado del gate.

El commit durable es `a42ebaf`. Ticket 31 sigue abierto: falta la review
independiente Standards/Spec y la candidate integrada que demuestre la
convergencia del ejecutor, del huerfano, del restart, del heartbeat y del
pool. WC1 sucesor y N=4/N=8/N=16 siguen detenidos.

Estado de reanudacion: revisar ticket 31 contra los contratos de supervision,
ejecutar una candidate WC1 nueva solamente si el preflight queda verde y
preservar cualquier fallo sin reinterpretarlo como resultado positivo.

## Checkpoint watchdog tras exit del root - 2026-07-30

La review independiente encontro una ventana real: el watchdog exigia que el
PID root siguiera presente para buscar descendientes. Si el executor terminaba
entre dos muestras, un smoke server vivo podia quedar fuera del journal
durable. La regresion nueva reprodujo el caso en RED y el commit siguiente la
corrige buscando descendientes por `ppid` aunque el root ya no figure en la
tabla.

Verificacion: `tests/process-evidence-journal.test.ts` queda en 7/7 PASS,
`@manyhands/web` typecheck PASS y `git diff --check` PASS. Ticket 31 sigue
abierto: falta candidate integrada para verificar el comportamiento en el
host real, recovery de orphan/restart/heartbeat/pool y reviews finales.

Estado de reanudacion: ejecutar las suites focales de supervision/takeover,
versionar esta regresion y despues congelar WC1 sobre el HEAD corregido. El
orden vigente queda WC1 -> WC2 -> WC3 antes de N=4/N=8/N=16.

## Checkpoint freeze sucesor WC1 - 2026-07-30

Se creo el freeze `warehouse-compact-v2` sobre ManyHands commit
`e6d21b53fa5fc5c5f22422ef128c2d11d2a2505a`, con el contrato de descendientes
corregido, Codex CLI/gpt-5.5/high, condicion C, `maxParallel=1`, una sola
candidate, una sola entrega/oraculo y reglas de corte explicitas. La celda y
el freeze quedan en `docs/tesis/evidence/warehouse/compact/wc1-cell-v2.json`
y `wc1-freeze-v2.json`; el hash de la celda queda registrado en el freeze.

La base externa esta limpia en W1 `71f61c9` bajo
`warehouse-control-tower-wc1-candidate`. No se ejecuto todavia la candidate.
Ticket 31 permanece abierto hasta que esta ejecucion demuestre teardown,
evidencia durable y recovery integrado.

Estado de reanudacion: ejecutar el preflight de la celda WC1 v2 y luego una
sola candidate. Preservar todos los journals, incluso si no hay candidate SHA;
no iniciar WC2 hasta emitir el veredicto de WC1.

## Checkpoint estabilidad de regresion - 2026-07-30

El gate completo bajo carga revelo que la nueva regresion del watchdog usaba
una espera fija de 30 ms. El producto no fallo: el test podia afirmar antes
de que el timer muestreara cuando Vitest ejecutaba 221 archivos. Se cambio la
regresion a una espera observable y acotada de 1 s; la suite focal queda 7/7
PASS y `git diff --check` PASS.

Estado de reanudacion: repetir `pnpm test` una sola vez, serialmente, para
confirmar el gate completo estable. Si queda verde, mantener el freeze WC1
v2, arrancar el servidor en 3112 y ejecutar la candidate una sola vez.

## Checkpoint preflight completo WC1 - 2026-07-30

El gate raiz serial queda verde despues de estabilizar la regresion: 221
archivos PASS, 1546 tests PASS y 2 skipped. El target W1 limpio pasa 25/25
tests, typecheck y build con su lockfile instalado. El probe WC1 no se exige
en W1 porque es parte del incremento que debe producir la candidate.

El freeze WC1 v2 sigue valido sobre `e6d21b5` y la celda conserva una sola
ejecucion secuencial. Ticket 31 sigue abierto hasta observar teardown y
recovery en el host real; no se inicia WC2 ni N=4/N=8/N=16 antes del veredicto
WC1.

Estado de reanudacion: iniciar el servidor ManyHands en `127.0.0.1:3112`,
ejecutar `wc1-cell-v2` una sola vez y preservar su resultado completo bajo
`docs/tesis/evidence/warehouse/compact/runs/wc1-v2/`.

## Checkpoint candidate WC1 v2 preservada - 2026-07-30

La candidate WC1 v2 se ejecuto una sola vez con el freeze vigente y queda
preservada bajo `docs/tesis/evidence/warehouse/compact/runs/wc1-v2/`.
El run es `d190b07d-d31e-454a-b9ea-7b36ff96ec1b`. La primera planificacion fue
rechazada por una validacion de schema; la segunda fue aprobada. El executor
termino correctamente y el orquestador produjo la candidate
`a8486539c5769430705ce06ef2de202b5a906964`, con 14 archivos dentro del scope
declarado.

La validacion exacta de esa candidate exigio una reparacion. La reparacion
fallo por `scope_violation` al modificar archivos fuera del scope declarado;
la candidate fue descartada y el run quedo en `waiting_for_input` sobre
`resolve_conflict`. No existe delivery receipt, SHA final entregado ni oraculo
ejecutado. `candidate.json` y `oracle-result.json` registran esta evidencia
adversa; el oraculo queda explicitamente `not_run`, no PASS.

Esto revela un defecto nuevo del instrumento en la ruta de code repair, no una
falla atribuible del producto Warehouse. No se responde la decision, no se
reintenta WC1 v2, y no se inicia WC2/WC3 ni N=4/N=8/N=16. El siguiente paso es
inspeccionar la enforcement de scope de la reparacion, reproducirla con TDD,
corregir la causa real y ejecutar las revisiones independientes antes de crear
un freeze WC1 sucesor.

## Checkpoint code repair con scope explicito - 2026-07-30

La regresion RED en `tests/execution-core-v2-node-executor.test.ts` reprodujo
que el prompt de code repair no enumeraba los paths del contrato canonico. La
correccion en `packages/execution-core/src/v2/node-executor.ts` ahora incluye
allowed paths, `outputRoots` y forbidden paths en el prompt de reparacion; la
razon de `scope_violation` tambien incluye `outOfScope` cuando la politica
strict rechaza un archivo no prohibido.

Verificacion: las suites focales de V2, recorder, run executor, integracion,
scope y clasificacion quedan en 149/149 PASS; `@manyhands/execution-core`
typecheck PASS y `git diff --check` PASS. Se creo el ticket 32 para completar
la regresion integrada y las reviews Standards/Spec. Ticket 31 sigue abierto.

Estado de reanudacion: revisar la enforcement productiva de repair con una
regresion integrada, cerrar tickets 31/32 y repetir el gate raiz. Solo despues
crear `wc1-freeze-v3` y ejecutar una nueva candidate WC1; no responder la
decision preservada ni iniciar WC2/WC3 o N=4/N=8/N=16.

## Checkpoint regresion integrada de code repair - 2026-07-30

La regresion productiva en `tests/execution-core-v2-node-executor.test.ts`
recorre `V2NodeExecutor -> ResultRecorder`: el primer candidato se registra,
la validacion falla, la reparacion intenta tocar
`docs/repair-regression.md`, y strict scope la rechaza con ese path exacto.
No se crea un segundo commit. La suite V2 queda 41/41 PASS y ticket 32 marca
cerrada esta aceptacion; aun faltan las reviews Standards/Spec y el gate raiz.

Estado de reanudacion: ejecutar las revisiones independientes sobre el punto
fijo de tickets 31/32, repetir el gate raiz serial y, si ambas revisiones y el
gate quedan verdes, crear `wc1-freeze-v3`. La candidate WC1 v2 sigue intacta,
sin decision resuelta, delivery ni oraculo.

## Checkpoint rollback de pool ante Git add parcial - 2026-07-30

La review Standards encontro y la regresion RED reprodujo otra ventana real de
lifecycle: `WorktreePool.initializeUnderTopologyLease()` agregaba la ruta a
`createdPaths` despues de `git.add()`. Si Git creaba parcialmente el worktree y
fallaba, el rollback no podia removerlo. La correccion registra la ruta antes
de invocar Git; el test productivo verifica la cuarentena de esa ruta.

Verificacion: regresion aislada 1/1 PASS, suite WorktreePool 19/19 PASS y
`git diff --check` queda pendiente de confirmar al consolidar el commit. Esto
avanza ticket 31, pero no lo cierra: aun faltan candidate real, evidencia
durable integrada, orphan/restart/heartbeat/takeover y reviews finales.

El prompt de code repair tambien fue ajustado para describir `outputRoots`
como subarboles recursivos, coherente con `ScopeChecker`; la suite V2 queda
41/41 PASS. No se crea `wc1-freeze-v3` hasta cerrar estas aceptaciones.
