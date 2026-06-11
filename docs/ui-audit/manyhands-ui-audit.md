# ManyHands — Auditoría UI/UX (junio 2026)

> Auditoría previa al pase de profesionalización ("UI/UX Professionalization Pass for Core ManyHands Flow").
> Capturas "before" en `docs/ui-audit/screenshots/before/` (1440×900, dark + light, generadas con `apps/web/scripts/ui-shots.mjs`).
> Sistema de diseño de referencia: PRODUCT.md / DESIGN.md ("ember sobre grafito", registro **product**).

---

## 1. Impresión general del producto

La app **ya tiene una identidad correcta** (ember sobre grafito, tokens semánticos de 3 capas, vocabulario fijo de estados) y el esqueleto de cockpit es el adecuado: sidebar + composer central en home, y chat | tabs/DAG | inspector en el run. El problema no es la dirección — es la **ejecución desigual**: conviven tres generaciones de código de UI (legacy `mh-*` con fallbacks hardcodeados, inline-styles masivos por componente, y Tailwind v4 con tokens). El resultado se siente como un prototipo avanzado, no como un producto: hay links muertos en la navegación primaria, el loading del run es una pantalla en blanco, el grafo "en reposo" está bañado en ember (el color que debería significar *vivo ahora*), el header del run muestra IDs crudos, y hay un bug real de SSR (500) en la página principal del producto.

**Veredicto anti-patterns (slop test de producto):** un usuario fluido en Linear/ChatGPT confiaría en la home, pero pausaría en el cockpit: tabs con label "LENTES", chat que detecta tipos de mensaje por `string.includes("⚠ …")`, badges de conflicto rojos en el sidebar para runs sanos, botón primario que cambia de texto según el bloqueo. No es slop genérico de IA (no hay gradientes púrpura ni glassmorphism); es **inconsistencia de ejecución**.

## 2. Scorecard (1–5)

| Dimensión | Score | Nota clave |
|---|---|---|
| Claridad de producto | 3 | La metáfora "compilador de trabajo" se entiende en home; en el cockpit el canal de decisión y el grafo compiten sin jerarquía clara. |
| Jerarquía visual | 2.5 | El grafo en reposo es 80% ember; el header del run mezcla 6 metadatos al mismo peso; el CTA de home salta de posición. |
| Layout / composición | 3 | Cockpit multipanel correcto (resizable); pero banda muerta bajo el canvas, hero de home con `justify-center` y vacío abajo. |
| Tipografía | 3.5 | Geist + JetBrains Mono bien elegidas y aplicadas; abuso de mono-uppercase como eyebrow decorativo (WORKSPACES, LENTES, PROBÁ). |
| Sistema de color | 3 | Tokens de 3 capas excelentes **en CSS**; en componentes hay `#FFF`, `#1A1915`, `text-gray-500`, `text-blue-600` hardcodeados que rompen el tema. |
| Consistencia de componentes | 2 | Tres vocabularios de botón (Button primitive, mh-primary-action, ad-hoc Tailwind); FocusPanel entero en inline styles con fallbacks legacy; primitivas muertas (`ui/`) sin usar. |
| Accesibilidad | 2.5 | Focus ring global bien; pero tabs sin roles ARIA, `window.confirm` para borrar, sin aria-live en chat, contraste de `--text-3` sobre `bg` al límite, decision-cards sin labels. |
| Feedback de interacción | 3 | Hover/active definidos en CSS legacy; botones Tailwind ad-hoc sin estado disabled coherente; sin toasts para errores de red (console.error silencioso). |
| Estados vacíos/carga/error | 2 | `loading.tsx` usa clase `.mh-skeleton` **que no existe** → pantalla en blanco; errores de aprobación van a `console.error`; empty states correctos en tabs. |
| Polish profesional | 2.5 | Detalles sueltos: "N" del dev-tools tapa el sidebar, callout de preflight en inglés, `(.../Proyectos/SimpleCounter)` como texto suelto, scrollbar del sidebar empuja contenido. |
| Sensación AI-native | 3 | El streaming del plan con skeletons en el grafo es de frontera; el chat no proyecta ejecución en vivo (queda vacío durante un run de 29 tareas). |

**Total: 30.5/55 — "prototipo avanzado con sistema de diseño correcto y ejecución inconsistente".**

## 3. Bugs funcionales encontrados durante la auditoría (P0)

1. **SSR 500 en `/runs/[runId]`** — `useDefaultLayout` (react-resizable-panels) lee `localStorage` en el servidor: `ReferenceError: localStorage is not defined` (visto en logs del dev server; la página devuelve 500 y el cliente recupera). Hay que pasar un `storage` seguro o montar el layout persistido solo en cliente.
2. **Loading del run invisible** — `apps/web/src/app/runs/[runId]/loading.tsx` usa `.mh-skeleton`, clase inexistente en `globals.css` → la navegación a un run muestra una pantalla vacía en lugar del skeleton.
3. **Navegación primaria muerta** — `/compare`, `/benchmarks`, `/settings` (sidebar) devuelven **404**. Tres de los cuatro destinos del nav no existen.
4. **Header del run muestra IDs crudos** — `Workspace: fab01372` (slice del UUID) cuando el workspace no se resuelve.
5. **Errores silenciosos en decisiones** — aprobar/rechazar un plan con fallo de red solo hace `console.error`; el usuario no recibe feedback.

## 4. Problemas principales por área

### 4.1 UX (top issues)

- **El CTA primario cambia de texto según el bloqueo** ("Describir tarea" / "Configurar repo" / "Generar plan"): el botón-como-status oculta la acción real y mueve el ancho del botón. La acción debe ser estable ("Generar plan") con el motivo de bloqueo al lado.
- **El chat queda vacío durante la ejecución**: para un run de 29 tareas en RUNNING, el panel de comandos muestra 3 mensajes de planificación y nada más. El "command center" no narra el progreso (eso vive solo en tabs Eventos).
- **Detección de tipo de mensaje por contenido**: `textContent.includes("⚠ Se requiere decisión humana")` y `startsWith("✓")` para decidir si un mensaje es decisión/conflicto/sistema. Frágil e imposible de i18n; el modelo de eventos ya tiene tipos.
- **DecisionCard busca "alguna decisión pendiente"** en el modelo en lugar de la decisión del mensaje → con dos gates simultáneos puede aprobar el equivocado.
- **`window.confirm()`** para borrar workspaces.
- **El run "RUNNING" eterno**: runs muertos del backend quedan como RUNNING para siempre en el sidebar y header (sin indicación de staleness). [Backend — fuera de alcance de este PR, se documenta]

### 4.2 Diseño visual

- **Ember en reposo**: branch lane 1 = ember y los role-labels de cada nodo toman el color de branch → un grafo quieto parece "en llamas". Viola el principio P1 del propio PRODUCT.md ("si todo brilla, nada brilla").
- **Badges de conflicto en el sidebar usan la paleta `failed`** (rust) para runs sanos con `conflictCount>0` histórico → la lista de runs parece llena de errores.
- **Banda muerta bajo el canvas**: `.mh-run-graph` mide `min(760px, dvh-220)` dentro de un panel `h-full` → franja de fondo distinta bajo el grafo (visible en light).
- **Mono-uppercase como eyebrow decorativo** en cada sección (WORKSPACES, RUNS RECIENTES, NUEVO RUN, LENTES, PROBÁ) — DESIGN.md lo reserva para metadatos de fase/estado.
- **El user-bubble del chat** pinta el *título del run* como si fuera un mensaje del usuario, en ember relleno.

### 4.3 Arquitectura de información

- **Header del run**: 6 metadatos al mismo peso (Run id, título, stage, workspace, granularidad, tareas, conflictos) sin agrupación; el id antes que el título.
- **"Lentes"** como etiqueta de las tabs: vocabulario interno del modelo proyectado a UI.
- **El inspector (FocusPanel)** vuelca 15+ campos técnicos planos (Construido contra, Produce rev., Banderas) sin agrupación progresiva; es un volcado del modelo, no una vista.
- **Plan/Evidencia tabs** muestran metric-cards con números heroicos centrados (anti-referencia explícita del PRODUCT.md).

### 4.4 Accesibilidad

- Tabs sin `role="tablist"/tab/tabpanel` ni navegación por flechas.
- Mensajes nuevos del chat sin `aria-live`; el estado "CONECTADO" sin texto alternativo cuando desconecta.
- `--text-3 (#a99d88)` sobre `--bg (#0f1012)` ≈ 4.6:1 — pasa, pero `--text-4` se usa para texto informativo (placeholders de sidebar) y no pasa.
- Iconos-botón del workspace (+/editar/borrar) de 24×24 px — target táctil insuficiente y sin `aria-label` (solo `title`).
- El tooltip de readiness es un `title` nativo con saltos de línea — inaccesible por teclado.

### 4.5 Dark mode / Light mode

- **Dark**: `--color-accent-contrast = #201409` correcto en Button primitive, pero el CTA de home fuerza `color: #FFF` sobre ember claro (contraste ~2.4:1, AA fail) y el empty-state usa `#1A1915` hardcodeado.
- **Light**: el canvas del grafo es `--color-surface` (blanco) y el resto de la página `--color-bg` → banda visible; `--cu-surface` referenciada directo en tabs (`background: var(--cu-surface)`) — primitiva cruda en componente (prohibido por DESIGN.md).
- `shadow-[-12px_0_24px_rgba(0,0,0,0.18)]` del focus panel no tiene variante light (sombra negra dura sobre papel).

### 4.6 Flujo New Run

- El callout de preflight viene del backend **en inglés** ("Repository has uncommitted changes; execution preflight will block.") dentro de UI en español.
- El pill de readiness concatena dos hechos ("Workspace listo · Gemini desconocido") en un solo chip con un solo color — estados independientes fundidos.
- "Opciones avanzadas" abre un row inline con 4 selects separados por pipes `|` literales — se siente DOM de los 2000.
- Los chips de ejemplo, el botón CTA y el pill de status saltan de fila según el ancho (flex-wrap impredecible).
- La fila workspace (select + 3 icon-buttons + path + branch) está fuera de la tarjeta del composer, flotando sin contenedor.

### 4.7 Cockpit del run

- Panel de chat: ancho por defecto 30% con `minSize 240px` OK; pero **el thread no agrupa** mensajes por fase ni distingue visualmente sistema vs narración vs gates más allá del borde.
- El input del chat **no hace nada** (`onUserMessage: async () => {}`) — un composer que traga texto sin feedback. O se conecta o se reemplaza por affordance de comandos reales.
- Tabs con contadores solo en Riesgos; Eventos/Diffs sin badge de novedad.
- La aprobación del plan vive en un card inline correcto, pero `DecisionCard`/`PlanApprovalCard`/`ConflictCard` duplican estructura (3 implementaciones del mismo patrón).
- El header poluciona con `mh-working` shimmer sobre el badge RUNNING permanentemente.

### 4.8 DAG

- Nodos: 200px de ancho fijo con title + vital label + role — correcto de base, pero: role-label en color de branch (ember masivo), dot de estado con `opacity: 0.45` (estado casi invisible), chips "bloqueado/fallido/completado" duplican lo que el dot ya dice, padding apretado (76px min-height).
- Raíz vs grupo vs tarea solo difieren por el texto del role-label — la raíz debería tener presencia propia.
- Edges: jerarquía (sólido) vs dependencia (dashed ember) — bien concebido, pero el dashed ember + arrows 13px + `edge-flow` permanente saturan.
- Sin minimapa para grafos de 29+ nodos; los controles custom (zoom/fit) bien, pero faltan atajos (fit al cambiar selección).
- El empty state de planning (root node + 3 pills) es bueno conceptualmente; las pills "Contexto del workspace / Primer nodo / Costuras candidatas" no se actualizan (decorativas).

### 4.9 Deuda de sistema (código)

- **Componentes muertos**: `app-nav.tsx`, `page-header.tsx`, `panel.tsx`, `ui/control-row.tsx`, `ui/modal-dialog.tsx`, `ui/metric-stat.tsx`, `ui/segmented-control.tsx`, `ui/status-badge.tsx`, `ui/signal.tsx`, `ui/empty-state.tsx`, `(command-center)/_components/{task-prompt,granularity-selector,recent-runs-strip}.tsx` — ninguno se importa desde rutas reales (solo entre sí). CLAUDE.md exige eliminación física.
- **`/counter`** (demo) y **`/runs/proto`** (fixtures) conviven con el producto. Los fixtures son valiosos para desarrollo; el counter es un demo de tutorial.
- **Inline styles vs Tailwind vs CSS clases**: `app-sidebar` y `command-center-shell` casi 100% inline styles; `chat/thread` 100% Tailwind; `focus-panel` inline styles con fallbacks pre-redesign (`var(--copper, #d08a5a)`).
- **Iconos duplicados**: lucide-react instalada y usada, y a la vez 6 SVGs inline hechos a mano en command-center-shell (Plus/Edit/Trash/Folder/Branch) y 2 en artifact-tabs (Loader2/CheckCircle redefinidos).
- `text-blue-600` (azul prohibido) en el spinner de Eventos; `text-gray-500` (gris frío) en labels de opciones avanzadas.

## 5. Recomendaciones concretas (priorizadas)

**P0 — corregir (bugs y rotura de confianza)**
1. Fix SSR de `useDefaultLayout` (storage seguro).
2. Definir `.mh-skeleton` y rehacer `loading.tsx` con el layout real del cockpit.
3. Sidebar: eliminar links muertos (o ruta real futura detrás de un solo item "Configuración" deshabilitado con tooltip "próximamente" — preferencia: eliminarlos).
4. Resolver nombre de workspace en header (fallback humano, no UUID slice).
5. Toast/feedback de error en decisiones (aprobación de plan).

**P1 — sistema (Loop A/B)**
6. Un solo vocabulario de botón (`ui/button.tsx` extendido: primary/ghost/danger/quiet + sm/md + busy) consumido por TODO el chrome; eliminar `mh-primary-action`/ad-hoc.
7. Migrar sidebar y command-center a Tailwind+tokens (cero inline styles salvo dinámicos).
8. Purga física de componentes muertos + `/counter`.
9. Reemplazar colores crudos (`#FFF`, `#1A1915`, `text-gray-500`, `text-blue-600`, `--cu-*` en componentes) por tokens semánticos.
10. Badge de conflictos del sidebar → paleta `blocked` (ámbar) salvo run realmente fallido.

**P2 — superficies (Loop C/D/E)**
11. New Run: composer como única tarjeta (workspace-row integrada arriba, opciones avanzadas como grid dentro de la tarjeta, CTA estable a la derecha con hint del bloqueo, separar pills de workspace y Gemini).
12. Cockpit: header con jerarquía (título → stage chip → métricas agrupadas mono), chat con renderizado por tipo de evento (no string-sniffing), aria-live, agrupar gates en un solo componente `GateCard`.
13. DAG: rail de branch sin ember en reposo (ember solo si vivo), role-label neutro, dot de estado a opacidad plena + halo solo en activos, raíz con tratamiento propio, minimapa para >15 nodos, fondo del canvas = `--color-bg` (sin banda).
14. Focus panel: migrar a tokens + secciones colapsables (Estado / Contrato / Artefactos), tipografía consistente.

**P3 — polish (Loop F)**
15. Tabs con roles ARIA y navegación por teclado.
16. `prefers-reduced-motion` ya cubierto en CSS; auditar animate-pulse de Tailwind (no cubierto).
17. Targets de 28px+ en icon-buttons con aria-labels.
18. Copy: unificar español rioplatense (callouts de preflight traducidos en el cliente), eliminar "Lentes".

## 6. Plan de implementación (PR-shaped)

**PR: UI/UX Professionalization Pass for Core ManyHands Flow**

- **Sensación objetivo**: sala de control nocturna precisa y calma — densidad Linear, conversación Claude/ChatGPT, grafo como artefacto central tipo herramienta de orquestación profesional.
- **Se cambia**: app shell (sidebar), home/new-run, cockpit (header, chat, tabs, focus panel), grafo (nodos/edges/canvas), tokens/primitivas compartidas, bugs P0.
- **NO se cambia**: rutas API, modelo de datos (`run-model/*` selectores), semántica de orquestación, endpoints, copy de eventos del backend, los fixtures proto (se mantienen como herramienta de desarrollo).
- **Dependencias**: ninguna nueva de producción. `puppeteer-core` agregada como devDependency raíz para el harness de capturas (`apps/web/scripts/ui-shots.mjs`).
- **Verificación**: `pnpm web:typecheck`, `pnpm -F @manyhands/web lint`, `pnpm test` (suite raíz vitest; el jest de apps/web estaba roto/vestigial y se eliminó), `pnpm -F @manyhands/web contrast:check`, capturas before/after, smoke manual de flujos (home → run → tabs → aprobación visible).
- **Riesgos / rollback**: cambios concentrados en componentes de presentación; el reducer/selectores no se tocan. Rollback = revertir el PR. El riesgo mayor es el fix de `useDefaultLayout` (afecta persistencia del layout de paneles) — se cubre con storage no-op en SSR.

Orden de loops: A (tokens/primitivas + purga) → B (shell/sidebar) → C (new run) → D (cockpit) → E (DAG) → F (polish + a11y) → verificación + after.

---

## 7. Resultados del pase (post-implementación)

### 7.1 Qué cambió

**Fundación (Loop A)**
- **Fix estructural de CSS**: los resets de elementos (`button { font: inherit }`, etc.) estaban *sin capa* y pisaban todas las utilidades de Tailwind v4 (que viven en `@layer utilities`) en form controls — la causa raíz de la proliferación de inline styles. Movidos a `@layer base`.
- `Button` primitive reescrito (primary/ghost/danger/quiet · sm/md/icon) con hover/active/disabled/busy reales; nuevos primitivos `StatusPill` y `ConfirmDialog`.
- `.mh-skeleton` definido (el loading del run era invisible); `loading.tsx` rehecho con el layout real del cockpit.
- Purga física: 18 componentes muertos + ruta `/counter` + jest vestigial roto de apps/web (`jest` ni siquiera estaba instalado) + ~180 líneas de CSS legacy sin consumidores.
- Fix SSR: `useDefaultLayout` recibía `localStorage` en servidor → 500 intermitente en `/runs/[runId]`. Storage no-op en SSR.
- Mensajes de readiness/preflight traducidos al español en el origen.

**Shell (Loop B)** — Sidebar reescrita a Tailwind+tokens: links muertos eliminados (/compare /benchmarks /settings daban 404), badge de conflictos en ámbar (rust solo si el run falló), workspaces con rama, jerarquía y hover limpios.

**New Run (Loop C)** — Composer como única tarjeta: barra de contexto (workspace + acciones + path + rama) integrada arriba, pills de estado separadas (Repo / Gemini), CTA estable "Generar plan" con razón de bloqueo al lado (ya no botón-como-status), opciones avanzadas como drawer con labels (sin pipes literales), callouts tokenizados con icono, borrar workspace con `ConfirmDialog` (chau `window.confirm`).

**Cockpit (Loop D)** — Header con jerarquía (id chip → título → stage pill en español → métricas mono agrupadas; workspace resuelto o "—", nunca UUID). Chat: renderizado por **id semántico de mensaje** (nunca sniffing de contenido), `GateCard` unificado para decisiones (apunta a la decisión correcta por id), wave-cards con **títulos reales de nodos** (no UUIDs), respuesta falsa del asistente **eliminada**, composer honesto: activo solo cuando hay una pregunta del planner pendiente (POST real a `/api/runs/[id]/answer`), errores de acciones visibles (banner role=alert), estado Conectado/Reconectando real, `aria-live` en el stream. Tabs con roles ARIA + navegación por flechas; sin "Lentes"; sin spinner azul; bug del dato falso "Profundidad: 3" corregido; métricas como filas calmas (sin hero-cards).

**DAG (Loop E)** — Lanes de branch **sin ember** (el calor queda reservado a actividad viva); role-labels neutros; raíz con tratamiento propio (más ancha, surface raised, sin rail); estados failed/blocked/obsolete tintan el borde de la card (obsolete atenuado, nunca rojo); minimapa para grafos >12 nodos; edges de dependencia menos saturados; canvas llena el panel (sin banda inferior, `mh-run-graph-fill`); empty state de planning sin pills decorativas.

**Polish (Loop F)** — FocusPanel migrado por completo a tokens semánticos (cero `var(--copper, #…)`); chips de banderas con paleta de estado; `prefers-reduced-motion` cubre también `animate-pulse` y `.mh-skeleton`; selects con caret custom y hover; targets de iconos 28px con `aria-label`.

### 7.2 Before / after

Capturas en `docs/ui-audit/screenshots/{before,after}/` (1440×900): `new-run-{dark,light}.png`, `run-detail-{dark,light}.png`. Observaciones clave: el grafo before es 80% ember en reposo; el after queda neutro con calor solo en lo vivo. El composer before saltaba de layout y el CTA cambiaba de texto; el after mantiene una fila estable. El run-detail before mostraba `Workspace: fab01372`; el after resuelve o muestra "—".

### 7.3 Verificación (comandos y resultados)

| Comando | Resultado |
|---|---|
| `pnpm test` (vitest raíz) | ✅ 925 passed, 3 skipped (96 files) — 1 assert actualizado por la traducción de readiness |
| `pnpm typecheck` (raíz) | ✅ limpio |
| `pnpm --filter @manyhands/web typecheck` | ✅ limpio |
| `pnpm --filter @manyhands/web lint` | ✅ limpio (se arreglaron 2 unused imports preexistentes en execution-pipeline.ts) |
| `pnpm web:build` (next build prod) | ✅ — **estaba roto antes del pase**: el patch de `@assistant-ui/tap` usaba accesos `React['useEffectEvent']` estáticamente analizables que webpack convierte en errores en prod; el patch se endureció con accessors opacos |
| `pnpm -F @manyhands/web contrast:check` | ✅ AA+ dark + light |
| `pnpm lint` (raíz) | ⚠️ 56 errores **preexistentes** en packages/, scratch/ y tests/ — fuera del alcance UI, documentado para PR aparte |
| Smoke manual | ✅ home carga, runs recientes abren (200), tabs cambian, DAG renderiza, focus panel abre al click, gate de aprobación presente en el thread, /runs/[runId] ya no devuelve 500 |

### 7.4 Issues restantes / follow-ups recomendados

1. **PR lint-debt**: limpiar los 56 errores de `pnpm lint` raíz (scratch/, packages/decomposer, tests).
2. **PR workspace-form-dialog**: migrar el dialog de workspace (591 líneas inline styles) a tokens + primitivas; incluir el folder-picker.
3. **PR interrupt-card**: `interrupt-card.client.tsx` es el único cliente de `/api/runs/[id]/resume` y no está cableado a ninguna vista — decidir si el gate nativo de LangGraph reemplaza al flujo `/decisions` y cablear uno de los dos.
4. **PR proto-chrome**: las rutas `/runs/proto/*` usan el chrome legacy (`mh-run-page`, hero serif). Útiles como fixtures; alinearlas al cockpit real o marcarlas dev-only.
5. **Runs muertos**: un run RUNNING cuyo proceso murió queda "Ejecutando" para siempre (backend) — heartbeat/staleness en el modelo.
6. **Responsive móvil del cockpit**: los paneles redimensionables no colapsan a stack <980px; el focus panel debería volverse sheet (CSS legacy lo hacía para el proto, no para el cockpit).
7. **404 page**: funcional pero usa el chrome legacy (`mh-primary-action`); migrar a `Button`.
8. **Minimap light**: nodos idle poco visibles sobre papel; subir contraste del trazo.
