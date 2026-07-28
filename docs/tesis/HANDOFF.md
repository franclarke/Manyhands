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
| Como se planificó (con un ciclo real) | 1 | −0.2584 | leaf |
| Con el ciclo corregido | 0.1053 | **−0.0347** | leaf |
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
| `seam-bindings-escape-cycle-detection` | Los seams nunca entraban al grafo de adyacencia: un ciclo cerrado por un seam compilaba. Lo detectó **sólo** el término `coordination` de la política. |
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
