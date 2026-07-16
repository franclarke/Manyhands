# ManyHands — Auditoría de frontend UI/UX

> Fecha: 2026-07-16 · Alcance: `apps/web` (Command Center, Run Workspace, sistema visual, modelo derivado).
> Método: lectura de `docs/design/`, `docs/system/10-web-app.md`, código completo del frontend, y prueba
> manual con la app corriendo (`pnpm --filter @manyhands/web dev`) en 1440×900, 1280×800, 1024×768,
> 800×500 y 390×844, en ambos temas, sobre runs reales existentes (`ec9a495e` plan pendiente,
> `e1885451` fallido, `880dba1d` completado) y fixtures golden (`/runs/proto/*`).
> Esta auditoría es solo análisis: **no se modificó ningún archivo de producción**.

---

## 1. Executive summary

### Evaluación general

El frontend de ManyHands está muy por encima del promedio de "dashboard generado": tiene un
sistema de tokens de tres capas con paridad dark/light verificada por script, una identidad
propia ("ember sobre grafito") sin AI-tells clásicos, un modelo de UI derivado por completo del
event log (reducer + selectores puros con fixtures golden), y decisiones de diseño genuinamente
buenas: estado por silueta (dot hueco/lleno/cuadrado/dashed), edges tipados, skeleton streaming
del plan sin reflow, `prefers-reduced-motion` respetado en todo.

El problema central **no es estético: es de veracidad de estado**. La capa de proyección
(fase, atención, recovery) contradice al estado durable en los casos que más importan a un
operador: un run fallido sigue pidiendo "Aprobar plan", el rail marca "Ejecución" cuando el plan
no fue aprobado, el header cuenta conflictos ya resueltos, y la etapa aparece como `running` en
inglés crudo. El segundo problema es la **dispersión del canal de decisiones** (la misma decisión
aparece 3–5 veces con labels que prometen acciones distintas). El tercero es **pulido de sistema**:
tokens referenciados que no existen, vocabulario interno filtrado a la UI, plurales rotos y
componentes con deuda de duplicación.

### Cinco problemas principales

1. **P0 — Un run fallido queda enmascarado por una decisión pendiente obsoleta**: el selector de
   recovery prioriza `gated` sobre `failed`, el Recovery Center no se muestra, y el banner primario
   invita a "Aprobar plan" en un run muerto sin ninguna explicación del fallo ni botón de reintento.
2. **P0 — La fase derivada contradice el gate del plan**: con `approve_plan` pendiente el rail marca
   "Ejecución 0/11 verificadas" activa y "Plan" completada, y el header muestra "Etapa running" (raw,
   en inglés) — el usuario no puede saber en qué punto del ciclo de vida está el run.
3. **P1 — Canal de decisiones disperso y con labels engañosos**: la misma decisión vive en header
   (pill no clickeable), banner (botón "Aprobar plan" que en realidad navega al chat), outline
   (card Attention) y chat (dos gate cards con acciones reales distintas).
4. **P1 — Métricas de atención cuentan historia como presente**: "2 conflictos" en el header y
   "Attention 2" junto a "Nada requiere atención" en un run completado, porque se cuentan conflictos
   resueltos.
5. **P1 — Vocabulario interno y bilingüe filtrado a la superficie**: `idle · fresh`, `Planning:
   generating`, `connected`, `MEDIUM`, filtros "Needs attention" — conviven con copy español, y hay
   plurales rotos ("1 tareas avanzando", "9 parte del run afectada").

### Cinco fortalezas que deben preservarse

1. **El sistema de tokens y el vocabulario de estado** (`--status-*` + `STATUS_META` como única
   fuente, pills siempre con texto, contraste AA verificado por `contrast-check.mjs` en ambos temas).
2. **Estado por forma, no solo color**: dot hueco = no arrancó, lleno = activo/done, cuadrado =
   fallo, ring dashed = bloqueado, mano = gate humano. Legible en escala de grises.
3. **El grafo como superficie viva**: branch rails por subárbol, edges tipados por trazo
   (jerarquía/dependencia/seam/conflicto), skeleton nodes que reservan el footprint final y el
   settle pulse ember — la generación en streaming del plan es de lo mejor del producto.
4. **UI derivada del event log**: reducer y selectores puros, fixtures golden reproducibles,
   la actividad y el estado nunca se persisten duplicados. Ese fundamento hace baratas todas las
   correcciones que esta auditoría propone.
5. **Disciplina de motion y accesibilidad base**: 150–250 ms ease-out, todo colapsa bajo
   `prefers-reduced-motion`, focus ring global visible, outline del run como espejo accesible
   y navegable por teclado del canvas.

### Dirección recomendada

Conservar la identidad y la arquitectura; invertir en **veracidad** (el estado durable manda sobre
cualquier proyección; decisiones obsoletas se archivan al morir el run), **un solo canal de
decisiones** (el chat del orquestador es el lugar donde se decide; banner/header/outline solo
señalan y navegan, nunca duplican la acción con el mismo label), **evidencia como protagonista en
Revisión** (hoy la fase final muestra una card colapsada), y **pulido de sistema** (tokens rotos,
un solo idioma de superficie, un solo primitivo de icon-button, virtualización de logs).
No hace falta un rediseño visual: hace falta terminar el que ya está diseñado y documentado en
`docs/design/design-system.md` e `interaction-model.md`, que la implementación sigue en ~80%.

---

## 2. Product and design read

ManyHands es un **control plane técnico** para orquestación multi-agente de ingeniería: el usuario
describe una feature, supervisa un DAG vivo de subagentes ejecutando en worktrees, responde
decisiones bloqueantes y se lleva un diff verificado.

- **Audiencia primaria**: ingenieros de software que operan agentes (hoy, Francisco; mañana, un
  perfil senior acostumbrado a CI, git y terminales). Leen mono, quieren densidad y causalidad.
- **Tareas principales**: crear run → juzgar plan → supervisar wavefront → resolver gates →
  investigar fallos → recuperar → revisar evidencia y exportar.
- **Atributos de marca**: control, calma instrumental, trazabilidad, calor solo donde hay vida
  (ember = actividad). "Sala de control nocturna", no dashboard SaaS.
- **Densidad adecuada**: alta pero jerarquizada — signos vitales compactos en la superficie,
  profundidad bajo demanda (focus/dock/drawer).
- **Motion adecuado**: comunicación de estado únicamente (pulso de vida, marching edges, settle de
  nodos). Nada decorativo. Lo actual está bien calibrado.
- **Lenguaje visual recomendado**: el ya documentado — grafito profundo, tinta beige, un solo acento
  ember, sage/ámbar/violeta/rust semánticos, Geist + JetBrains Mono, radios 2–10 px, sombras mínimas.

**Dials de Taste Skill (solo descriptivos, no reglas):**

| Dial | Valor leído del producto | Valor objetivo |
|---|---|---|
| DESIGN_VARIANCE | 3 (grillas consistentes, cero asimetría decorativa) | 3 — correcto para control plane |
| MOTION_INTENSITY | 3–4 (motion solo semántico) | 3–4 — mantener |
| VISUAL_DENSITY | 6–7 (cockpit con paneles densos) | 6–7 — mantener; subir jerarquía, no bajar densidad |

Nota de método: `design-taste-frontend` declara los dashboards y product UIs densas fuera de su
scope; se usó solo como detector de AI-tells y disciplina de consistencia. `minimalist-ui` se usó
como referencia de sobriedad (bordes 1px, sombras casi nulas), no como receta (sus serifs
editoriales, bento grids y whitespace de landing no aplican acá). `redesign-existing-projects`
aportó el protocolo scan → diagnose → prioritize.

---

## 3. Current-state map

### Rutas

| Ruta | Superficie |
|---|---|
| `/` | Command Center: composer de intención + workspace CRUD + selección de modelos/effort/granularidad/autonomía |
| `/runs/[runId]` | Run Workspace (cockpit): header, decision banner, recovery center, phase rail, chat/outline, canvas, dock, bottom drawer |
| `/runs/proto/[fixture]` | Playback de fixtures golden sobre el layout viejo (hero serif + graph + timeline) |
| `not-found` | 404 propia |

### Estructura del cockpit (`run-model-view.client.tsx`)

```
RunHeader (id · título · pill estado · connection · etapa · elapsed · vitals · control · CTA)
DecisionBanner (si hay atención primaria)
OperationalRecoveryCenter (si el estado operativo lo requiere)
RunTimeline (rail de 5 fases + dock toggles)
┌─ Panel chat (24%): ChatRail colapsado | RunOutline | ChatThread (orquestador)
├─ Panel artifacts: DeliveryPanel (en review) + RunCanvasToolbar (4 lentes) + MinimalRunGraphCanvas
└─ Panel dock (26%, hasta 2 slots): Agentes | Plan | Nodo | Archivos | Diff | Contrato | Riesgos | Evidencia | Worktree
BottomDrawer / BottomBar: Actividad | Eventos | Terminal | Validación | Archivos
```

### Modelo derivado (lib/run-model)

`RunEvent[]` → `reducer.ts` → `RunModel` → selectores puros:
`selectPhase` (framing→disposition), `selectHealth`, `selectWorkspaceView` (nodos + edges +
wavefront), `buildDecisionChannelView`, `selectMinimalWorkspaceView` (stage + attention),
`selectRunTimeline` (rail), `selectOperationalRecovery`, `buildFocusView` (inspector),
`buildTimelineView` (actividad), `selectRunCanvasProjection` (lentes tasks/scheduling/
integration/interfaces), `selectRunOutline`.

### Estados representables (dominio)

Run: `created, generating, needs_review, approved, paused, running, cancelling, interrupted,
completed, completed_with_accepted, partial, unverified, needs_delivery, failed_artifact,
failed_delivery, failed`. Nodo (vital): `idle, planning, running, verifying, repairing, gated,
done, obsolete, blocked, failed`. Seam: `draft, frozen, amended`. Decision: `pending/resolved ×
blocking/advisory`. Conexión SSE: `connecting, connected, reconnecting, degraded, disconnected`.

### Acciones disponibles

Crear/editar/eliminar workspace y run; generar plan; aprobar/rechazar plan; editar plan (Plan
surface: calidad/tarea/estructura/operaciones, CAS `expectedVersion`); responder clarify/gates;
pausar/reanudar/reintentar; cancelar; resolver conflictos; fork; terminal real por contexto;
export patch; delivery.

---

## 4. Findings

Prioridades: **P0** bloquea comprensión/control/accesibilidad · **P1** deteriora el flujo ·
**P2** inconsistencia o deuda visible · **P3** refinamiento.

| ID | Prio | Área | Evidencia | Impacto en usuario | Recomendación | Esfuerzo | Riesgo |
|---|---|---|---|---|---|---|---|
| F-01 | P0 | Modelo mental / recovery | Run `e1885451` (Fallido): banner "Aprobá el plan para comenzar la ejecución" + pill header "Aprobar plan"; sin causa de fallo ni botón Reintentar. Causa: [operational-recovery.ts:57](../apps/web/src/lib/run-model/operational-recovery.ts) prioriza `gated` sobre `failed`; `DecisionBanner` no filtra por estado terminal; `RunControlButton` no cubre `failed_artifact/failed_delivery` | El operador puede "aprobar" un run muerto; no entiende que falló ni cómo recuperarlo | En estados terminales: archivar/atenuar decisiones pendientes (mostrarlas como historia), priorizar `failed` sobre `gated` en el selector, mostrar Recovery Center con causa + Reintentar para todo `failed_*` | M | Bajo (selector puro, testeable) |
| F-02 | P0 | Modelo mental / fase | Run `ec9a495e` (plan pendiente): rail "Plan ✓ · Ejecución 0/11 activa"; header "Etapa running". Causa: [selectors.ts:66](../apps/web/src/lib/run-model/selectors.ts) `approvePlanResolved \|\| hasGroundingSignals` ignora el gate pendiente; `RUN_STAGE_LABEL` en [run-model-view.client.tsx:565](../apps/web/src/app/runs/%5BrunId%5D/_components/run-model-view.client.tsx) no tiene clave `running` y cae al raw inglés | El usuario cree que el run ejecuta cuando está esperando su aprobación; pierde confianza en todo el rail | `selectPhase` nunca avanza más allá de `proposal` con `approve_plan` pendiente; mapear `ProductStage` completo a labels españoles | S | Bajo |
| F-03 | P1 | Canal de decisiones | La decisión "Aprobar plan" aparece en: pill header (no clickeable), banner (botón "Aprobar plan" que **navega** al chat), Attention card del outline, y en el chat 2 gate cards ("Aprobar/Rechazar" y "Aprobar plan e iniciar subagentes"). Screenshots 1280×800 y 800×500 | Cinco instancias del mismo intent, tres con affordances distintas; el botón del banner promete la acción y hace otra cosa | Una sola superficie resolutiva (gate card del chat). Banner/outline: label de navegación ("Revisar y decidir →"); pill del header clickeable o eliminada | M | Medio (tocar banner, outline, header) |
| F-04 | P1 | Métricas de estado | Run `880dba1d` (Completado): header "2 conflictos"; outline "Attention 2" junto a "Nada requiere atención". Causa: `RunHeader` cuenta `model.conflicts.size` y `RunOutline` suma `conflictCount + failedCount` sin filtrar `status !== "resolved"` | Un run exitoso parece tener problemas vivos | Contar solo conflictos no resueltos para "atención"; lo histórico va en Evidencia/Actividad | S | Bajo |
| F-05 | P1 | Lenguaje de superficie | `idle · fresh` (focus Resumen), `Planning: generating` (Actividad), `connected` (header), `MEDIUM` (gate card), filtros del outline en inglés ("Needs attention"), `draft r0`, `risk_aware` | Registro mixto inglés/español y enums internos sin traducir; sube la carga cognitiva y huele a prototipo | Diccionario de presentación único (como `STATUS_META.label`) para ejecución, freshness, planning states, conexión y granularidad; los enums crudos quedan para tooltips/Eventos | M | Bajo |
| F-06 | P1 | Copy / plurales | "1 tareas avanzando en paralelo" ([minimal-workspace-view.ts:94](../apps/web/src/lib/run-model/minimal-workspace-view.ts)); "9 parte del run afectada" ([run-cockpit-navigation.client.tsx:154](../apps/web/src/app/runs/%5BrunId%5D/_components/run-cockpit-navigation.client.tsx)); "N runs con datos dañados" sí pluraliza bien | Descuido visible en la línea de estado más leída del producto | Helper de pluralización es-AR y pasada por todos los interpolados | S | Nulo |
| F-07 | P1 | Fase Revisión | Run completado: la superficie principal es el root colapsado "+6" con minimap vacío; la evidencia (tests, narrativa, diff) solo existe vía dock. `interaction-model.md §2` exige evidencia protagonista en Disposition | El cierre del run — el momento de valor — no muestra el valor | En `stage === "review"`, superficie de evidencia por defecto (tests, commit, diff agregado, narrativa, invalidation trace) con el DAG como mapa secundario | L | Medio |
| F-08 | P1 | Layout / chat | A ≤1280px el panel del orquestador queda en `minSize 220px`: gate cards con CTAs envueltos en 2–3 líneas ("plan e iniciar"), stats apiladas, "GranularidadMEDIUM" sin espacio (screenshot 800×500) | El canal de decisión —el corazón del flujo— es lo primero que se rompe | Subir `minSize` a ~300px, colapsar antes a rail, y diseñar la gate card para columna angosta (stats en 2 col, CTAs full-width) | M | Bajo |
| F-09 | P1 | Fallos accionables | Run fallido: ninguna superficie primaria muestra la causa; hay que abrir Eventos y leer JSON. `COPY.failed` del Recovery Center dice "la causa está preservada en el historial" pero no la muestra | Investigar un fallo requiere arqueología | El Recovery Center debe citar el último error real (evento `*.failed` / `cause`) con link al nodo y a Eventos | M | Bajo |
| F-10 | P1 | A11y del DAG | Nodos React Flow: `tabindex=0, role=group`, sin `aria-label` (verificado en runtime); focusables pero mudos para AT. Controles del canvas solo con `title` | Usuario de teclado/lector recorre nodos sin saber cuáles son | `aria-label` = `título · rol · estado vital` por nodo; `aria-roledescription="tarea del plan"`; Enter ya selecciona (verificar) | S | Bajo |
| F-11 | P2 | Tokens rotos | `--status-success-fg` usado 2× en [run-cockpit-navigation.client.tsx:156,214](../apps/web/src/app/runs/%5BrunId%5D/_components/run-cockpit-navigation.client.tsx) — no existe (es `--status-completed-fg`); `--color-danger` en [operational-recovery-center.client.tsx:69](../apps/web/src/app/runs/%5BrunId%5D/_components/operational-recovery-center.client.tsx) — no existe (es `--danger`); `.mh-min-node-onpath` aplicada en [minimal-run-graph.tsx:670](../apps/web/src/components/run-model/minimal-run-graph.tsx) sin regla CSS | Checkmarks de integrado sin su verde; errores de recovery sin su rojo; "camino al root" sin estilo | Corregir referencias y agregar un check estático de tokens (grep de `var(--` contra tokens definidos) en CI | S | Nulo |
| F-12 | P2 | Tokens hardcodeados | Banner de runs dañados: `border-amber-500/35 bg-amber-500/10 text-amber-200` ([app-sidebar.tsx:207-218](../apps/web/src/components/app-sidebar.tsx)) — texto ámbar claro ilegible en tema light; terminal `bg-black` | Rompe la paridad de temas en el único banner que usa Tailwind crudo | Migrar a `--status-blocked-*`; el negro del terminal puede quedar como decisión explícita | S | Nulo |
| F-13 | P2 | Hydration | Console error en `/`: mismatch de `id` de `useId` en `WorkspacePicker` (verificado en runtime) | Ruido en consola, riesgo de bugs de hidratación futuros | Investigar el orden de render server/client del select (probable doble render con distinto árbol) | S | Bajo |
| F-14 | P2 | Código muerto | `interrupt-card.client.tsx` (570 líneas, 4 cards HITL) no se importa desde ningún lado (grep) | Mantenimiento fantasma; confunde sobre cuál es el canal HITL real | Eliminar o integrar; si LangGraph interrupts son el futuro, dejar ADR que lo diga | S | Nulo |
| F-15 | P2 | Dock chrome | Cada slot: select de superficie + Expandir + Cerrar vista, y adentro el FocusPanel repite "Foco · Nodo" + X "Cerrar foco" — dos cierres apilados con semántica distinta (uno cierra el slot, otro limpia el foco) | Chrome redundante y ambiguo en un panel angosto | El slot es dueño del ciclo de vida: un solo header (picker + expandir + cerrar); FocusPanel sin header propio cuando vive en dock | M | Bajo |
| F-16 | P2 | Focus panel | 7 tabs (Resumen…Actividad) siempre visibles; en un nodo `idle` 5 están efectivamente vacías ("aparecerá cuando…"); tabs envuelven a 2 líneas en ancho de dock | Profundidad presentada antes de existir; ruido | Tabs condicionales por disponibilidad de datos (o contador/estado en el tab), colapsar vacíos en una nota única | M | Bajo |
| F-17 | P2 | Canvas framing | Con viewport bajo, el fitView inicial (root + 4 hijos, `maxZoom 0.82`) deja el grafo minúsculo pegado al borde inferior (screenshot 800×500); minimap aparece como caja vacía cuando el root está colapsado (>12 nodos colapsados a 1) | Primer contacto con el DAG: espacio vacío | Fit a los nodos *visibles* tras colapso; ocultar minimap si `visibleNodes < umbral`; revisar padding en alturas chicas | S | Bajo |
| F-18 | P2 | Header vitals | `12 tareas · 0 conflictos` + etapa + elapsed + workspace + connection: seis clusters compiten; `connection` en texto crudo al lado del título | Escaneo lento del header | Un solo grupo de vitals; conexión como dot con tooltip (texto solo cuando ≠ connected); etapa ya está en el rail — evaluar quitarla del header | M | Bajo |
| F-19 | P2 | Sidebar badges | Riesgos de coordinación como número en cuadrado ámbar/rojo sin label (solo tooltip); en runs fallidos se tiñe rojo y compite con el dot de estado | Números flotantes sin explicación a primera vista | Icono + número (`⚠ 9`) o mover el riesgo al hover/detalle; una sola señal de color por fila | S | Bajo |
| F-20 | P2 | Fuentes | `@import url(fonts.googleapis.com…)` en [globals.css:1](../apps/web/src/app/globals.css) — render-blocking, sin fallback control; Next recomienda `next/font` | FOUT/parpadeo en frío, dependencia de red | Migrar a `next/font` (Geist, Newsreader, JetBrains Mono) con `display: swap` | S | Bajo |
| F-21 | P2 | Logs sin virtualizar | `RawEventsSurface` y `ActivitySurface` mapean todos los eventos ([run-workspace-surfaces.client.tsx:667-712](../apps/web/src/app/runs/%5BrunId%5D/_components/run-workspace-surfaces.client.tsx)); un run real ya genera cientos de eventos | DOM gigante, scroll pesado en runs largos | Virtualizar (react-virtuoso o similar) o paginar con "cargar anteriores"; la consola del nodo ya trunca a 200 chunks (bien) | M | Bajo |
| F-22 | P2 | Duplicación de primitivos | 6 icon-buttons casi idénticos: `IconAction` (command-center), `RailButton`/`RowAction` (sidebar), `IconButton`/`MiniAction` (surfaces), `DockToggle` (run-model-view); 3 resize-handles duplicados | Deriva visual inevitable (ya difieren en radio, hover y tamaño) | Un `IconButton` tokenizado en `components/ui` con variantes; un solo `ResizeHandle` orientable | M | Bajo |
| F-23 | P2 | Effort slider | Control custom `role=slider` con thumb de 12×20 px, tooltip solo on-hover del ícono "?" ([effort-control.client.tsx](../apps/web/src/app/(command-center)/_components/effort-control.client.tsx)); teclado OK | Target chico (WCAG 2.5.8), hint inaccesible por teclado | Ampliar hit-area, `aria-describedby` para el hint, mostrar hint on-focus | S | Bajo |
| F-24 | P2 | Proto vs cockpit | `/runs/proto/*` renderiza el layout viejo (hero serif + página), no el cockpit; los estados de conflicto/fallo/enmienda no se pueden ensayar visualmente en la UI real sin pagar un run | Regresiones visuales del cockpit solo detectables en producción | Portar el playback de fixtures al cockpit real (mismo `RunModelView` alimentado por fixture) | M | Medio |
| F-25 | P3 | Identidad tipográfica | Newsreader (display) solo vive en el proto; el cockpit no tiene ningún momento display — el título del run es `text-sm` truncado | La marca editorial documentada casi no se ve en el producto real | Un momento display por pantalla (p.ej. intención del run en un header expandible o en Revisión) | S | Bajo |
| F-26 | P3 | Mobile phase rail | A 390px el rail queda en dots sin ningún label (el activo se trunca fuera) | Cinco puntos sin significado | Mantener siempre el label de la fase activa (ya intentado con `flex` — verificar por qué se corta) | S | Bajo |
| F-27 | P3 | Ergonomía ⌘K | `interaction-model.md §9` promete canal de comandos por teclado; no existe; tampoco hay shortcuts en el cockpit (solo ⌘↵ en composer y Esc en overlay) | El "steer por teclado" prometido no está | Backlog explícito: ⌘K con acciones del run (aprobar, pausar, abrir surfaces, saltar a nodo) | L | Medio |
| F-28 | P3 | Recovery reload | `window.location.reload()` tras acciones de recovery ([operational-recovery-center.client.tsx:44](../apps/web/src/app/runs/%5BrunId%5D/_components/operational-recovery-center.client.tsx)) | Full reload en una app cuyo orgullo es el estado vivo por SSE | Confiar en el event log (el modelo ya se actualiza solo) o refetch dirigido | S | Bajo |

### Desarrollo de los hallazgos mayores

**F-01 + F-02 (la verdad del estado).** Son el mismo defecto de fondo visto desde dos selectores:
las proyecciones (`selectPhase`, `selectOperationalRecovery`, `buildDecisionChannelView`) tratan
señales secundarias (decisión pendiente, seams frozen, waves persistidas) como si pudieran
adelantar o tapar el estado durable del run. La regla que falta es una jerarquía explícita de
verdad: `run.control.status` (durable) > gates pendientes > señales de grounding. Con ese
ordenamiento: un run `failed_*` archiva sus decisiones (se muestran como "quedó pendiente al
fallar", sin CTA), el rail no puede pasar de Plan mientras `approve_plan` esté `pending`, y
Recovery Center + causa + Reintentar son la única superficie de acción. Ambos fixes viven en
selectores puros con tests unitarios triviales — riesgo bajo, impacto máximo.

**F-03 (un canal, satélites que apuntan).** El principio de `interaction-model.md §4` es correcto
y la implementación lo traiciona por acumulación: cada superficie quiso su propia copia del gate.
La regla propuesta: la **resolución** vive solo en la gate card del chat (que ya tiene contexto
embebido, opciones y respuesta por composer); banner, pill y attention card son **indicadores de
navegación** con copy de navegación ("Revisar y decidir →", "1 decisión esperando"). Nunca dos
elementos con el mismo label y distinta acción.

**F-07 (Revisión evidence-first).** El modelo ya calcula todo lo necesario
(`MinimalReviewEvidence`, `EvidenceFocusView` con métricas e invalidation trace, `DeliveryPanel`,
export patch). Falta la composición: al entrar en `review`, el panel central debería mostrar
evidencia (tests, commit, diff agregado renderizado con el `DiffText` existente, narrativa) y el
DAG degradarse a mapa lateral/miniatura clickeable — exactamente lo que `interaction-model.md §2`
describe como Disposition.

---

## 5. State coverage matrix

| Domain state | Representado hoy | Calidad | Información faltante | Tratamiento recomendado |
|---|---|---|---|---|
| empty (sin workspaces) | Card "Todavía no hay workspaces" + CTA | Buena | — | Mantener |
| empty (sin runs) | "Sin ejecuciones previas" en sidebar | OK | — | Mantener |
| loading (ruta run) | `loading.tsx` + `.mh-skeleton` | Buena (skeletons, no spinners) | — | Mantener |
| initialising / planning | Card "Construyendo el grafo" + skeleton nodes streaming | **Excelente** | — | Preservar tal cual |
| planning retry/fallback | `planning.state` en focus + Actividad | Débil | No visible en el nodo del canvas | Micro-indicador "reintentando" en el skeleton |
| waiting for approval | Banner + rail + pill + chat | Rota por duplicación (F-03) y fase (F-02) | Fase correcta "Plan propuesto" | Rail en Plan; un canal |
| blocked (nodo) | Ring dashed ámbar + label | Buena | Por qué está bloqueado, a un click | Focus ya lo dice; agregar "espera a X" en el card |
| gated (nodo) | Glyph mano ámbar | Buena (forma ≠ blocked) | — | Mantener |
| running / verifying | Pulso ember + vital `build ✓ · tests 2/3 · retry 1/3` + wave wash | **Excelente** | — | Preservar |
| retrying (verify-loop) | `retry n/m` en vital | Buena | — | Mantener |
| integrated (nodo/run) | Dot sage + verde fuerte, commit corto | Buena, pero checkmarks del outline sin color (F-11) | — | Arreglar token |
| partially integrated | `completed_with_accepted` label propio + recovery `partial` | Adecuada | Qué se aceptó/omitió, enumerado | Lista de reservas en evidencia |
| failed (nodo) | Dot cuadrado rust + tinte + causa truncada | Buena | Causa completa accionable (F-09) | Recovery cita el error |
| failed (run) | Pill Fallido | **Rota**: enmascarada por gate (F-01), sin causa, sin retry para `failed_artifact` | Causa, acción | F-01 |
| cancelled / cancelling | `cancelling` → pill Bloqueado + recovery con supervivientes | Adecuada (allDead visible) | — | Mantener |
| interrupted | Pill "Omitido" + empty-state propio del canvas | Confusa: "Omitido" no comunica interrupción | Label "Interrumpido" | Renombrar `skipped`→ label propio para run interrupted |
| disconnected / reconnecting | Texto crudo en header + pill del chat "Reconectando…" | Débil (inglés, sin jerarquía) | Qué significa para los datos (stale) | Dot + banner solo cuando ≠ connected |
| stale / obsolete (nodo) | Ámbar + opacity 0.72, "superseded" | Buena (≠ rojo, como pide el modelo) | Afordancia de re-ejecución visible | Acción "re-ejecutar" en focus |
| conflict | Edge dashed rust + Riesgos surface + gate card | Aceptable (no reproducido en cockpit real) | Diagnóstico de dos lados prometido | Portar fixture al cockpit (F-24) y validar |
| recovery available | Recovery Center con acciones | Buena cuando se muestra | Suprimida por `gated` (F-01) | Reordenar precedencia |
| completed | Pill + CTA Descargar cambios | Buena | Evidencia protagonista (F-07) | Review evidence-first |
| completed but not delivered | `needs_delivery` → pill "Listo" + DeliveryPanel + recovery | Adecuada | — | Mantener |
| historial degradado | Banner ámbar en sidebar + recovery `degraded` | Funciona pero hardcodea colores (F-12) | — | Tokenizar |

---

## 6. Visual-system audit

- **Typography.** Geist (UI) + JetBrains Mono (datos, eyebrows con tracking) bien aplicadas; escala
  fija 11–40 px con roles (`--fs-eyebrow/micro/meta/label`) y `tabular-nums` consistente. Deudas:
  Newsreader casi ausente del producto real (F-25); mono-uppercase se usa correctamente como
  metadato, no como decoración. El piso de 11 px es agresivo pero aceptable para cockpit.
- **Color.** Identidad ember disciplinada (vivo = ember, ≤10% de superficie, cero cyan, cero
  AI-purple). Status tokens completos con fg/bg/border por tema; light tiene paridad real.
  Deudas: tokens fantasma (F-11), hardcodes ámbar (F-12), tres generaciones de nombres conviviendo
  (`--cu-*`, `--color-*`, legacy `--copper/--coral/--done/--error`) — funciona, pero invita al error
  exactamente como F-11 demuestra.
- **Surfaces.** Escalera bg → bg-subtle → surface → raised → overlay coherente; elevación por
  sombra con catch-light superior sutil; el grid de 28px del body da textura sin ruido. Bien.
- **Spacing.** Base 4px respetada; densidad pareja. Sin quejas mayores.
- **Radius.** 2/4/8/10/12 px; pills solo en chips/kbd como manda el sistema. El canvas controls usa
  `rounded-xl`/`rounded-lg` Tailwind crudos en vez de `--r-*` (menor).
- **Borders.** El "de-cage" (bordes susurro + `--color-border-control` ≥3:1 solo en interactivos)
  es un patrón maduro. Los dock surfaces todavía encajonan cada item en card+border (leve card soup
  en Agentes/Riesgos/Contratos; aceptable, vigilar).
- **Iconography.** Lucide 12–16 px stroke uniforme. Los skills externos desaconsejan Lucide como
  default; en un control plane funciona y no amerita migración — sí auditar iconos-sin-significado
  (Sparkles para "ejecutores" es el más débil).
- **Semantic states.** `STATUS_META` + StatusPill (dot forma+color+texto) es la joya del sistema.
  Nunca color-solo. Preservar.
- **Motion.** Vocabulario completo (`mh-working`, `mh-node-pulse`, `edge-flow`, `dashMarch` reverso
  para integración bottom-up, settle de nodos) con reduced-motion global. Motivado y calmo. Nota
  operativa: los pulsos infinitos dificultan captura de screenshots automatizada (los tooling de
  captura esperan estabilidad); un modo `data-freeze-motion` para tests visuales ayudaría.
- **Density.** Correcta para operador. El problema no es cantidad sino duplicación (header vitals +
  rail + banner repiten estado).

---

## 7. UX-flow audit

1. **Crear un run.** Composer excelente: contexto repo/branch visible, costo estimado, readiness de
   ejecutores con checks detallados en tooltip, razones de bloqueo del CTA explícitas
   (`startBlockReasonFor`), ⌘↵, persistencia del prompt en sessionStorage, handoff animado al run.
   Fricción: los dos iconos de estado (repo/ejecutores) comunican solo por tooltip; effort slider
   (F-23).
2. **Aprobar o corregir el plan.** El gate card del chat tiene el contexto correcto (tareas, hojas,
   costuras, conflictos previstos, granularidad) y "Revisar grafo"/"Ver plan". Pero: fase mentirosa
   (F-02), canal quintuplicado (F-03), chat angosto rompe la card (F-08), y la edición del plan
   (PlanControlSurface, con CAS y crítico) está enterrada como surface opcional del dock — el flujo
   "corregir antes de aprobar" no tiene camino evidente desde el gate.
3. **Monitorear ejecución.** Fuerte: wavefront con wash+pulso, vitals compactos, lente Scheduling
   con wave label y serializados, Agentes agrupados por estado, consola por nodo lazy. El header
   duplica lo que el rail ya dice.
4. **Identificar bloqueos.** Nodo blocked/gated distinguible por forma; el outline filtra por
   estado; falta el "espera a X" inline en el card (hoy: abrir focus → Scheduling).
5. **Resolver decisiones.** Inline en chat, con respuesta por composer para clarify — bien. Las
   opciones del gate viajan como labels exactos (frágil pero funcional). Falta jerarquía visual
   entre bloqueante y advisory en el propio card.
6. **Investigar fallos.** El punto más débil del producto (F-01, F-09): sin causa visible, sin
   camino guiado nodo-fallido → log → decisión.
7. **Recuperar el run.** Recovery Center bien pensado (estados y copy operativo serio) pero
   suprimido justo cuando más se necesita (F-01) y con full-reload (F-28).
8. **Revisar el resultado.** Export patch + DeliveryPanel + Validación con commits por nodo
   funcionan; falta la composición evidence-first (F-07) y el diff agregado como vista primaria.

---

## 8. Target experience

No se propone un rediseño: se propone **cerrar la brecha entre la implementación y su propio
modelo de interacción documentado**, más una capa de veracidad.

### Layout macro (sin cambios estructurales)

```
┌────────┬──────────────────────────────────────────────────────────────┐
│sidebar │ HEADER  id · título · [estado] · ● conexión │ vitals │ CTA   │
│(runs)  ├──────────────────────────────────────────────────────────────┤
│        │ ATTENTION STRIP (solo si hay): "1 decisión esperando →"      │
│        │  · en terminal: RECOVERY (causa + Reintentar/Exportar)       │
│        ├──────────────────────────────────────────────────────────────┤
│        │ PHASE RAIL  Intención ─ Plan ─ Ejecución ─ Integración ─ Rev │
│        ├──────────┬────────────────────────────────────┬──────────────┤
│        │ ORQUESTA │  SUPERFICIE PHASE-ADAPTIVE         │ DOCK (0–2)   │
│        │ DOR/     │  proposal: grafo-hipótesis         │ nodo/diff/   │
│        │ OUTLINE  │  running:  wavefront               │ plan/…       │
│        │ (≥300px) │  review:   EVIDENCIA (diff+tests)  │              │
│        │          │            + DAG miniatura         │              │
│        ├──────────┴────────────────────────────────────┴──────────────┤
│        │ BOTTOM BAR  Actividad · Eventos · Terminal · Validación · …  │
└────────┴──────────────────────────────────────────────────────────────┘
```

- **Jerarquía de paneles.** Igual que hoy; el cambio es de *contenido por fase*: el panel central
  obedece a `stage` (ya existe la maquinaria en `selectRunCanvasProjection`), y en `review` cambia
  de canvas-first a evidence-first.
- **Rol del canvas.** Protagonista de proposal→integration; mapa contextual en review. Fit sobre
  nodos visibles; minimap solo cuando aporta.
- **Rol del inspector (dock).** Profundidad on-demand de UN objeto; un solo header por slot; tabs
  según datos disponibles.
- **Rol del activity/event stream.** Drawer inferior como hoy; Actividad humanizada como default,
  Eventos crudos como herramienta forense; ambos virtualizados.
- **Navegación.** Sidebar (runs) + rail (fase) + outline (estructura) ya cubren los tres ejes;
  agregar ⌘K como capa de comando (F-27) sin tocar la estructura.
- **Command surface.** El chat sigue siendo el canal de intención/decisión. El composer contextual
  (responde al gate activo) es un buen patrón — explicitarlo en el placeholder ("Respondé a la
  pregunta del planner…" ya existe una variante).
- **Decisiones.** Un solo lugar resolutivo (chat); attention strip global única que navega; estados
  terminales archivan decisiones.
- **Errores.** Causa siempre visible en la superficie del estado (nodo → vital; run → recovery),
  con link al log crudo. Nunca "hay un error, buscalo".
- **Estados.** Completar la matriz de §5 (interrupted con label propio, conexión degradada con
  aviso de datos stale).
- **Sistema visual.** El actual, con los tokens fantasma corregidos y la capa legacy en extinción
  programada (codemod `--copper/--coral/--done/--error` → `--status-*`).
- **Motion.** El actual. Ninguna adición decorativa.
- **Densidad.** La actual, menos las duplicaciones de estado.

---

## 9. Preserve / retire / introduce

**Preservar**
- Token system de 3 capas + `STATUS_META` + contrast check en CI.
- Glyph dial por forma; pills con texto obligatorio; branch rails; edges tipados.
- Skeleton streaming del plan (ghost nodes, settle, no-reflow) y `edge-flow` reverso de integración.
- Outline accesible como espejo del canvas; drawer inferior con Terminal real por contexto.
- Composer del Command Center completo (readiness, costo, block reasons, ⌘↵).
- Reduced-motion global y focus rings.
- Chat como canal de decisión con contexto embebido.

**Retirar**
- Decisiones pendientes activas en runs terminales (archivarlas).
- Duplicación del gate en banner/pill/outline/chat con labels idénticos y acciones distintas.
- Tokens fantasma y hardcodes (`--status-success-fg`, `--color-danger`, ámbar del sidebar,
  `.mh-min-node-onpath` sin regla).
- `interrupt-card.client.tsx` (muerto) o integrarlo con decisión documentada.
- Enums crudos y registro inglés/español mezclado en superficie.
- `window.location.reload()` post-recovery.
- Los 6 icon-buttons duplicados (consolidar).
- El conteo de conflictos históricos como señal de atención.

**Introducir**
- Jerarquía de verdad de estado en selectores (terminal > gate > señales) con tests golden.
- Diccionario de presentación (ejecución/freshness/planning/conexión) — un solo registro es-AR.
- Superficie de evidencia para `review` (diff agregado + tests + narrativa + reservas).
- Causa de fallo citada en Recovery Center + link forense.
- `aria-label` por nodo del DAG + roledescription.
- Virtualización de Eventos/Actividad.
- Check estático de tokens en CI.
- Playback de fixtures sobre el cockpit real (reemplaza al proto como banco de pruebas visual).
- (Backlog) ⌘K command palette.

---

## 10. Proposed implementation plan

> Todas las fases en TDD (el proyecto ya lo exige): cada fix de selector nace de un test rojo
> sobre fixtures; cada fix visual, de un test de render o snapshot del view-model.

**Phase 0 — Foundations & tokens (S, sin dependencias)**
- Archivos: `globals.css`, `run-cockpit-navigation.client.tsx`, `operational-recovery-center.client.tsx`, `app-sidebar.tsx`, `minimal-run-graph.tsx`, script nuevo `scripts/token-check.mjs`, migrar fuentes a `next/font` (`layout.tsx`).
- Riesgos: casi nulos. Pruebas: token-check + contrast:check + snapshot visual manual ambos temas.
- Aceptación: cero `var(--*)` sin definición; cero clases de color Tailwind crudas en componentes de producto; fuentes self-hosted.

**Phase 1 — Truthful state (S/M, depende de 0 solo logísticamente)**
- Archivos: `lib/run-model/selectors.ts` (`selectPhase`), `operational-recovery.ts` (precedencia), `decision-channel-view.ts` (archivado en terminal), `run-model-view.client.tsx` (`RUN_STAGE_LABEL` completo, `RunControlButton` cubre `failed_*`), `minimal-workspace-view.ts` + `run-cockpit-navigation` (conteos sin resueltos, plurales), diccionario de presentación nuevo en `lib/run-model/presentation.ts`.
- Dependencias: fixtures golden existentes; agregar fixture "failed con decisión pendiente".
- Riesgos: cambiar `selectPhase` afecta stage→superficies; cubrir con los 7 fixtures.
- Aceptación: en el fixture failed+gate, la UI muestra Fallido + causa + Reintentar y ninguna CTA de aprobación; con `approve_plan` pendiente el rail marca Plan activa; cero strings de enum crudo en superficie primaria.

**Phase 2 — Run control plane / canal de decisiones (M, depende de 1)**
- Archivos: `run-model-view.client.tsx` (DecisionBanner → attention strip navegacional), `run-cockpit-navigation.client.tsx` (attention card), `chat/thread.tsx` (gate card jerarquía blocking/advisory, layout angosto), `RunHeader` (pill clickeable o fuera; vitals consolidados; conexión como dot).
- Riesgos: el banner es el punto de entrada actual al chat — mantener la navegación, cambiar solo semántica de labels.
- Aceptación: un solo elemento con label de acción resolutiva por pantalla; test de "no dos CTAs con el mismo intent"; gate card legible a 300px.

**Phase 3 — DAG & inspector (M, independiente de 2)**
- Archivos: `minimal-run-graph.tsx` (aria-labels, fit sobre visibles, minimap condicional, "espera a X" en blocked), `run-workspace-surfaces.client.tsx` + `focus-panel.tsx` (un header por slot, tabs condicionales), consolidación `IconButton`/`ResizeHandle` en `components/ui`.
- Riesgos: ReactFlow a11y — verificar interacción Enter/Espacio.
- Aceptación: lector de pantalla anuncia título·rol·estado por nodo; dock sin doble cierre; grep de icon-buttons duplicados vacío.

**Phase 4 — Decisions, failures & recovery / evidencia (L, depende de 1–2)**
- Archivos: `operational-recovery-center.client.tsx` (causa citada, sin reload), superficie nueva `review-evidence` en el panel central para `stage === "review"` (reusa `DiffText`, `EvidenceFocusView`, `DeliveryPanel`), `plan-control-surface` accesible desde el gate ("Corregir plan →").
- Riesgos: composición nueva del panel central; hacerlo aditivo (fallback al canvas).
- Aceptación: fixture failed muestra causa real; run completado abre en evidencia con diff y tests; desde el gate del plan hay camino directo a edición.

**Phase 5 — Responsive, a11y & polish (M, transversal, al final)**
- Archivos: `run-model-view` (minSize chat 300px, colapso temprano), `run-timeline` (label activo en mobile), `effort-control` (hit target + aria-describedby), virtualización de Eventos/Actividad, fixture playback sobre cockpit (`/runs/proto` v2), fix hydration `WorkspacePicker`, skip-link.
- Aceptación: sin CTAs envueltos a ≥768px; axe-core sin violaciones serias en home y run; 1000 eventos scrollean fluido; los 7 fixtures reproducibles en el cockpit real.

---

## 11. Quick wins versus structural changes

**Quick wins (alto impacto, bajo riesgo — se pueden hacer ya)**
- Corregir los 3 tokens rotos y el ámbar hardcodeado (F-11, F-12).
- `RUN_STAGE_LABEL` completo + labels de conexión (parte de F-02/F-05).
- Plurales (F-06).
- No contar conflictos resueltos (F-04).
- `aria-label` en nodos del DAG (F-10).
- Borrar `interrupt-card.client.tsx` (F-14).
- Precedencia `failed` > `gated` en recovery + Reintentar para `failed_*` (núcleo de F-01).
- `next/font` (F-20).

**Cambios estructurales (planificar como fases)**
- Gate del plan que retiene la fase (F-02 completo, toca `selectPhase`).
- Canal de decisiones unificado (F-03).
- Revisión evidence-first (F-07).
- Diccionario de presentación (F-05 completo).
- Consolidación de primitivos + virtualización (F-21, F-22).
- Fixtures sobre el cockpit (F-24).

**Ideas atractivas que NO se recomiendan**
- Rediseño estético estilo Linear/shadcn: el sistema propio es más fuerte que un template; sería
  regresión de identidad.
- Serif editorial y "momentos display" por todos lados (sugerencia natural de minimalist-ui): un
  control plane denso no los necesita; a lo sumo uno por pantalla como ya documenta el design system.
- Reemplazar el DAG por lista/board como vista par: el interaction model ya lo prohíbe con razón
  (el grafo es el escenario; timeline/board son lentes).
- Esconder los raw events o el terminal para "limpiar": son la herramienta forense; la solución es
  jerarquía (drawer), no eliminación.
- Migrar de Lucide a otra familia de iconos: costo real, beneficio cosmético.
- Animaciones adicionales (spring physics, parallax, etc.): contra la energía "calma instrumental".

---

## 12. Open questions

1. **¿El header debe conservar "Etapa" si el phase rail ya la muestra?** Propuesta: quitarla del
   header; decidir si el elapsed (hoy derivado de timestamps de eventos) merece quedarse.
2. **Decisiones en runs terminales**: ¿archivarlas visiblemente ("quedó pendiente al fallar") o
   ocultarlas por completo? La propuesta es archivado visible por trazabilidad, pero es una
   decisión de producto.
3. **`interrupted` se etiqueta "Omitido"**: ¿es intencional agrupar interrupted con skipped, o
   merece label y color propios ("Interrumpido", neutral fuerte)?
4. **El proto route**: ¿se mantiene como demo del layout viejo o se retira al portar fixtures al
   cockpit? (Hoy es la única forma de ver estados caros sin pagar un run.)
5. **⌘K / steer por teclado**: prometido por el interaction model — ¿entra en el roadmap del
   producto o se retira del documento de diseño?
6. **Newsreader**: ¿la identidad editorial (un momento display por pantalla) es algo que querés en
   el cockpit, o se acepta que el producto real sea 100% Geist/Mono y se actualiza el design system?

---

## Apéndice A — Limitaciones de esta auditoría

- No se ejecutaron runs nuevos ni se aprobaron planes (evitar gasto de agentes); los estados
  `running` en vivo, conflicto activo en cockpit real, enmiendas con blast radius y el
  `InterruptCard`/gates de ejecución se evaluaron por código + fixtures del proto, no en el
  cockpit de producción (ver F-24).
- Los screenshots se tomaron con animaciones desactivadas vía CSS inyectado (los pulsos infinitos
  impiden la captura estable del tooling); no reflejan el motion real.
- El screenshot capture del entorno limita la resolución efectiva a 800×500; las verificaciones a
  1440/1280/1024 se complementaron con lectura del accessibility tree y mediciones por JS.

## Apéndice B — Evidencia de sesión (reproducible)

- Home dark/light 1440×900: composer, ejemplos, sidebar con badges de riesgo.
- `/runs/ec9a495e…` (needs_review): triple "Aprobar plan", rail en Ejecución, "Etapa running",
  "9 parte del run afectada", dock node focus con "idle · fresh", 7 tabs.
- `/runs/e1885451…` (failed): banner de aprobación sobre run fallido, sin causa ni retry, root
  "Integrado" con commit.
- `/runs/880dba1d…` (completed): "2 conflictos" en header, "Attention 2" + "Nada requiere
  atención", root colapsado "+6", minimap vacío, Validación con commits por nodo.
- `/runs/proto/golden-behavioral-conflict` evento 33/40: "1 tareas avanzando en paralelo", vital
  verify-loop correcto.
- Console: hydration mismatch en `WorkspacePicker` (ids `useId`).
- `pnpm -F @manyhands/web contrast:check` → "AA+ contrast check passed (dark + light)".
