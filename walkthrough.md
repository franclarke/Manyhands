# Walkthrough — Sistema de diseño "ember sobre grafito" + grafo en vivo

> Sesión 2026-06-10. Define e implementa el sistema de diseño dual-theme de ManyHands
> y el sistema de skeletons del grafo en tiempo real. Specs: `PRODUCT.md` y `DESIGN.md` (raíz).

## 1. Sistema de tokens (apps/web/src/app/globals.css)

- **Marca ember** (naranja fundido, OKLCH hue 45–55): reemplaza al copper apagado en dark
  y al accent negro `#111` en light. Nuevo token `--color-accent-contrast` para texto sobre
  superficies ember (tinta oscura en dark, blanco en light) — el ember dark no soporta texto blanco AA.
- **Celestes eliminados** (`--cu-cyan`, `--cu-blue`, `--cu-slate` y los tints `#E1F3FE`):
  el eje vivo (`planning` / `running` / `integrating`) ahora es ember; `ready` pasa a
  neutral cálido fuerte. Aliases legacy (`--running`, `--ready`, `--copper`, `--coral`)
  se mantienen apuntando a los nuevos primitives.
- **Branch lanes** sin celestes: ember / violeta / sage / ocre / terracota profunda / piedra.
- Tints con `color-mix(in srgb, …)` en vez de rgba hardcodeado donde el valor deriva del accent.
- Light: `--color-border-control` sube a alpha 0.47 (≥3:1 WCAG 1.4.11, antes fallaba en 1.6).
- Controles/minimap de React Flow y `mh-kbd`/`mh-recent-row` ahora theme-aware (antes dark hardcodeado).
- `.mh-planning-root-node`: side-stripe (patrón prohibido) → borde completo + tinte ember 4%.

## 2. Tema dual con persistencia

- `app/layout.tsx`: default `data-theme="dark"`, script blocking en `<head>` que aplica
  el tema persistido (`localStorage["mh-theme"]`) antes del primer paint (sin flash).
- `components/theme-toggle.tsx` (nuevo): switch sol/luna en el header del sidebar;
  placeholder estable hasta el mount para no romper la hidratación.

## 3. Grafo en vivo: skeletons y materialización

- `lib/run-model/workspace-view.ts`: `NodeVital.planningState` expone el lifecycle crudo
  de planning (`generating` / `retrying` / …) — la señal que dispara los skeletons.
- `components/run-model/minimal-run-graph.tsx`:
  - **Ghost nodes** (`skeletonTask`): mientras un nodo expande hijos (`generating`/`retrying`),
    un placeholder con borde dashed ember y barras shimmer reserva el lugar del próximo hijo,
    conectado con un edge punteado en marcha (`edge-flow`). Participa del tidy layout, así
    los hijos reales llegan sin reflow.
  - **Materialización**: los nodos recién propuestos entran con `mh-min-node-enter`
    (fade-up + settle ring ember que decae, 520ms). Se trackean ids vistos con un ref.
  - **Relayout suave**: `.mh-run-graph .react-flow__node { transition: transform 360ms }` —
    los reposicionamientos del layout se deslizan en vez de teletransportarse (nodos no draggables).
  - Los ghosts no son clickeables ni roban branch colors (excluidos de la asignación de lanes).
  - Edges hacia subárboles aún en expansión marchan punteados; sólidos al completarse.
- CSS nuevo en globals: `.mh-skel-node`, `.mh-skel-node-bar`, `mh-node-settle`,
  `mh-skel-in`; todo colapsa bajo `prefers-reduced-motion`.

## 4. Canal de decisión único

- `runs/[runId]/_components/run-model-view.client.tsx`: el header ya no duplica el botón
  de acción de decisiones (auto-resolvía con choice default y sin contexto); ahora muestra
  un chip de atención (violeta review, pulso). La acción vive solo en el chat
  (`PlanApprovalCard` / `DecisionCard`). Se eliminó `defaultChoiceFor` + `onResolve`.

## 5. Limpieza de colores hardcodeados

- `text-white` sobre accent → `text-[var(--color-accent-contrast)]` (thread, sidebar,
  page, artifact-tabs, button primitive).
- `bg-amber-500` / `text-amber-800` → tokens de estado; `StatusPill` (panel.tsx) usa
  los `--status-*` en vez de rgba fijos; fallbacks celestes `#5a9bd0` eliminados
  (run-frame, workspace-surface, focus-panel).

## 6. Contrast gate dual

- `apps/web/scripts/contrast-check.mjs` reescrito: parsea los bloques dark Y light
  (anclando en el selector real, no en menciones en comentarios), soporta `oklch()`
  (conversión OKLab→sRGB) y agrega el chequeo del par accent/accent-contrast.

## Verificación

- `pnpm web:typecheck` ✅ · `pnpm test` ✅ (868 pass / 3 skip) ·
  `pnpm -F @manyhands/web contrast:check` ✅ (dark + light).
- Visual en browser: home dark/light, toggle con persistencia, playback de
  `golden-planning-fallback` mostrando ghost "generando…" → materialización → plan listo.
- `pnpm -F @manyhands/web lint`: 5 errores PREEXISTENTES en
  `lib/server/runs/execution-pipeline.ts` (vars sin uso) y `planning-pipeline.ts`
  (3 × `any`) — archivos de backend de otra sesión, fuera del alcance de este cambio.
