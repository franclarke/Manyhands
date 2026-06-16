# ManyHands — Design System

> Sistema visual de la sala de control de ManyHands. Registro: **product** (la UI sirve a la tarea).
> Dos temas con paridad total — dark es el default. Los componentes consumen **solo tokens semánticos/de estado**
> (`--color-*`, `--status-*`); las primitivas `--mh-*` nunca se usan directo en componentes.
> Implementación: `apps/web/src/app/globals.css` (capas: primitivas → semánticas → estado).

## Theme

**Identidad: "ember sobre grafito".** La llama del logo es la marca: el calor señala lo que está vivo.
Dark mode (default) es una sala de control nocturna — grafito profundo, tinta beige cálida, y un único
color de marca **ember** (naranja fundido, hue ~55) reservado para actividad viva y acción primaria.
Light mode es papel neutro (no crema) con la misma alma. Deliberadamente distinto del clay-sobre-papel
de Anthropic: más caliente, más saturado, sobre fondo oscuro.

- Estrategia de color: **Restrained** — ember ≤10% de la superficie. Neutrales cálidos cargan el resto.
- **Prohibido**: celestes/cianes en cualquier rol (incluidos estados), gradient text, glassmorphism,
  side-stripes decorativos nuevos (el rail izquierdo de nodos del grafo es semántica de branch existente, 2px máx).
- Cambio de tema vía `[data-theme="dark" | "light"]` en `<html>`; default dark sin atributo.

## Colors

Formato OKLCH (fuente de verdad); hex derivado al implementar. Misma tabla semántica en ambos temas.

### Marca

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--color-accent` | `oklch(0.74 0.145 55)` | `oklch(0.54 0.145 45)` | Acción primaria, selección, foco, "vivo" |
| `--color-accent-hover` | `oklch(0.79 0.15 57)` | `oklch(0.49 0.145 45)` | Hover (aclara en dark, oscurece en light) |
| `--color-accent-deep` | `oklch(0.55 0.13 50)` | `oklch(0.44 0.13 45)` | Bordes/énfasis profundo |
| `--color-accent-contrast` | `#201409` (tinta oscura) | `#FFFFFF` | Texto/icono SOBRE superficie ember |
| `--color-accent-glow` | ember al 24% alpha | ember al 14% alpha | Halo de actividad (solo semántico) |

El ember dark es demasiado claro para texto blanco: los botones rellenos usan
`--color-accent-contrast` (nunca `#FFF` hardcodeado). `contrast-check.mjs` valida
ambos temas, incluido el par accent/accent-contrast.

### Neutrales

| Token | Dark | Light |
|---|---|---|
| `--color-bg` | `oklch(0.17 0.005 70)` grafito | `oklch(0.985 0.002 70)` papel neutro |
| `--color-bg-subtle` | `oklch(0.19 0.005 70)` | `oklch(0.97 0.003 70)` |
| `--color-surface` | `oklch(0.22 0.005 70)` | `#FFFFFF` |
| `--color-surface-raised` | `oklch(0.25 0.006 70)` | `oklch(0.98 0.002 70)` |
| `--color-text` | `oklch(0.93 0.025 85)` beige cálido | `oklch(0.18 0.005 70)` |
| `--color-text-muted` | `oklch(0.76 0.03 85)` | `oklch(0.42 0.008 70)` |
| `--color-text-subtle` | `oklch(0.66 0.03 85)` | `oklch(0.55 0.008 70)` |
| Bordes | alpha de la tinta (8–50%) | alpha de la tinta (6–22%) |

Regla: el tinte de los neutrales apunta al hue de marca (~55–85), chroma ≤0.03. Nunca tinte frío.

### Estados (`--status-*`, vocabulario fijo de UiStatus)

El eje "vivo" usa ember; **cyan y celeste quedan eliminados**. Cada status define `fg / bg / border`.

| Status | Familia (hue OKLCH) | Semántica |
|---|---|---|
| `planning`, `running`, `integrating` | **ember 50–55** (lo vivo es la marca) | Actividad del orquestador ahora |
| `ready` | neutral cálido fuerte (tinta, border marcado) | Listo para despachar, aún no vivo |
| `idle`, `pending`, `skipped` | neutrales cálidos tenues | Sin actividad |
| `completed` | sage `oklch(0.72 0.09 145)` / light `oklch(0.45 0.09 145)` | Hoja verificada |
| `integrated` | verde fuerte `oklch(0.78 0.11 135)` / light `oklch(0.40 0.10 140)` | Mergeado al baseline |
| `blocked`, `obsolete` | ámbar `oklch(0.76 0.09 90)` / light `oklch(0.52 0.10 85)` | Espera/invalidado — **nunca rojo** |
| `review` | violeta `oklch(0.74 0.09 300)` / light `oklch(0.45 0.10 300)` | Gate humano (HITL) |
| `failed`, `conflict` | rust `oklch(0.68 0.13 25)` / light `oklch(0.50 0.15 27)` | Fallo real |

- Running además lleva **pulso de halo ember** (animado) y progreso en ember, no cyan.
- Branch lanes (`--mh-branch-1..6`): paleta cálida sin celestes y **sin ember** (el calor es solo de lo vivo, P1) — violeta, sage, ámbar, terracota apagado, ciruela, piedra.
- Contraste AA verificado en ambos temas (`pnpm -F @manyhands/web contrast:check`).

## Typography

| Rol | Fuente | Uso |
|---|---|---|
| UI / cuerpo | **Geist** (400–700) | Todo el chrome, labels, botones, prosa |
| Display | **Newsreader** (500–600) | Solo títulos de run (hero) y momentos editoriales — máx. 1 por pantalla |
| Datos | **JetBrains Mono** (400–600) | IDs, métricas, coordenadas, kbd, eyebrows de fase |

- Escala fija rem (no fluida): 12 / 13 / 15 / 16 / 20 / 28 / 40 px. Ratio ~1.2.
- Datos numéricos siempre `tabular-nums`.
- Mono uppercase con tracking (0.06–0.14em) se reserva para **metadatos de fase/estado**, no como eyebrow decorativo de secciones.
- Prosa a 65–75ch máx; tablas y paneles densos pueden correr más anchos.

## Components

- **Botones** (`components/ui/button.tsx`): `primary` (relleno ember, texto blanco/grafito según tema), `ghost` (borde control, fondo translúcido), `danger` (tinta failed). Estados: default/hover/focus/active/disabled/busy. Radio `--r-md`/`--r-lg` (4–8px), alturas 36/40px.
- **Nodos del grafo** (`mh-min-node`): card 200px, borde 1px, rail izquierdo 2px = color de branch; el **estado** vive en el dot + label + halo, no en el rail. Seleccionado: ring ember 3px al 9%.
- **Skeleton nodes** (nuevos, ver Motion): mismo footprint que `mh-min-node`, borde dashed, barras shimmer donde irán título/meta. El skeleton ES el nodo — al materializarse no cambia de posición ni tamaño.
- **DecisionChannel / banners**: una sola acción primaria ember por pantalla; banner blocking con tinte warning al 4%, nunca rojo salvo fallo.
- **Chips de estado**: `bg/border/fg` del status correspondiente, siempre con texto.
- **Focus inspector**: panel lateral sticky, entrada `mh-panel-enter` (180ms slide). En mobile: sheet fijo con `--shadow-sheet`.
- Radios: 2/4/8/10px (técnico, contenido). Cards 8px. Pills solo chips/kbd. **Nada ≥16px.**
- Sombras: mínimas — `--shadow-lift` sutil; la elevación se comunica por superficie (`surface → raised → overlay`), no por sombras anchas.

## Layout

- App shell: sidebar fija (workspaces + runs recientes) + columna principal. Workspace de run: paneles redimensionables (`react-resizable-panels`) — chat/comandos | canvas del grafo | inspector de foco.
- Grid base 4px (`--space-1..8`). Densidad de operador: tablas y listas compactas permitidas.
- Responsive estructural: colapso de sidebar y stack de paneles <980px; el inspector pasa a sheet.
- Canvas React Flow: fondo `--color-surface`, dots sutiles theme-aware, edges `--mh-graph-edge`, seams en ember translúcido.

## Motion

Energía: **calma instrumental**. 150–250ms, `ease-out` (quart). El movimiento comunica estado, nunca decora.
Todo colapsa bajo `prefers-reduced-motion` a crossfades/estáticos.

### Sistema de generación en vivo del grafo (skeletons)

El plan se construye en streaming (`plan.node.proposed`); el grafo lo proyecta sin saltos:

1. **Propuesta**: al conocerse que un nodo tendrá hijos, aparecen skeleton nodes (borde dashed, shimmer ember-tenue `mh-working`) en su posición final de layout, stagger 60ms entre hermanos.
2. **Título conocido**: el título real cruza en fade 120ms sobre la barra shimmer; el resto sigue en skeleton.
3. **Nodo completo**: borde pasa de dashed a sólido con un settle pulse ember→neutral (250ms); meta y rol aparecen.
4. **Edges**: se dibujan con `dashMarch` mientras el padre sigue planificando; al completarse el subárbol, pasan a trazo sólido.
5. El layout reserva espacio desde el paso 1: **los nodos nunca se reposicionan al materializarse** (el skeleton ya ocupa el footprint final).

### Vocabulario existente

- `mh-working`: shimmer ember para chrome pensando/ejecutando.
- `mh-node-pulse`: halo ember en nodos running (1.8s ease-in-out).
- `edge-flow` (`dashMarch`): flujo activo en edges.
- `mh-panel-enter`: entrada del inspector (180ms).
- Hover de nodos/botones: translateY(-1/-2px) 150–180ms.
