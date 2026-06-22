# Bitácora — Loop de elevación del sistema de diseño (v2)

> Spec: [`docs/superpowers/specs/2026-06-20-design-system-elevation-loop-design.md`](../superpowers/specs/2026-06-20-design-system-elevation-loop-design.md).
> Base vigente: [`docs/design/design-system.md`](../design/design-system.md).
> Flujo "A": autoreo cards **actual** + **v-next** en el proyecto Claude Design,
> Francisco cura/aprueba por componente, porto a React. Secuencia: foundation →
> núcleo → cockpit.

Proyecto Claude Design: `ManyHands Design System`
(`c9d6f0e9-c2fe-4778-ac37-9861b56e562c`). Espejo local fiel en `design-system/`
(`tokens.css` extraído de `globals.css` + cards `.html` con `@dsCard`).

---

## Fase 1 — Sembrar (hecho)

- Proyecto creado con `DesignSync.create_project`.
- `tokens.css` extraído de `globals.css` (capa `--cu-*`/`--color-*`/`--status-*`
  + utilidades `.mh-*`), sin el `@import "tailwindcss"`.
- Harness de preview: cada `.html` importa `../tokens.css` y carga
  `@tailwindcss/browser@4` (Tailwind Play CDN), `data-theme="dark"` en `<html>`.
- **Smoke test:** `foundation/00-tokens.html` subido y verificado fiel en
  claude.ai/design antes de seguir (local + on-platform).

---

## Fase 2/3 — Foundation v-next (hecho · aprobado · portado)

Cubre los gaps **F1** (proliferación de tamaños fuera de escala) y **F2**
(spacing ad-hoc) del brief. Card de propuesta: `foundation/02-typography-vnext.html`.

### Decisión de diseño

Escala tipográfica **por rol de operador**, no por números sueltos. Set chico,
documentado, con un piso de sistema en 11px (nada por debajo):

| Token        | Valor | Rol                                                        |
|--------------|-------|------------------------------------------------------------|
| `--fs-eyebrow` | 11px (mono, `--ls-eyebrow` 0.10em) | metadata UPPERCASE        |
| `--fs-micro`   | 11px | label sans más chico — piso del sistema                     |
| `--fs-meta`    | 12px | copy sans secundaria (alias `--fs-xs`)                      |
| `--fs-label`   | 13px | workhorse de UI densa: controles, filas, chat, tabs (alias `--fs-sm`) |
| base/md/lg/xl/2xl | 15/16/20/28/40 | sin cambios                                       |

Line-heights y tracking por rol: `--lh-tight 1.2`, `--lh-snug 1.45`,
`--lh-relaxed 1.6`, `--lh-display 1.05`, `--ls-eyebrow 0.10em`. Rol serif
explícito: `--font-display: var(--font-serif)` (display only, máx 1/pantalla).

### Aplicación a React (port)

- **`globals.css`:** tokens de rol agregados a `:root`; bloque `@theme` que expone
  utilidades `text-eyebrow/micro/meta/label` (cada una con su `--line-height`) y
  `font-display`, **sin** pisar las utilidades default de Tailwind
  (`text-xs/sm/base/lg/xl/2xl` intactas → estrategia aditiva, la app rinde en cada
  paso).
- **Defectos de token corregidos en el camino:** `font-weight: 650` → `600`
  (×4, fuera de la rampa 400/500/600/700); `font-size: 17px` → `var(--fs-md)`.
- **Barrido de 14 componentes:** `text-[Npx]` arbitrarios → utilidades de rol;
  spacing fuera de grilla `2.5`→`3`, `3.5`→`4` (excepción documentada: textarea
  del composer). Sub-grid sancionado `0.5/1/1.5` intacto. Dimensiones de íconos
  (`h-3.5 w-3.5`) NO se tocaron (no son spacing).
  - Mapeo: `9–10.5px` → `text-eyebrow` si mono/uppercase, si no `text-micro`;
    `11px` → `text-eyebrow` (mono/uppercase) / `text-meta`; `11.5–12px` →
    `text-meta`; `12.5–13px` → `text-label`; `14px` → `text-sm`; `15/17px` →
    `text-base`.

### Verificación

- **Guard TDD** `tests/typography-scale.test.ts` — 5/5 verde. Asegura: tokens de
  rol definidos + `@theme` los expone; sin `font-weight: 650`; sin `font-size:17px`;
  sin `text-[Npx]` en componentes; sin spacing fuera de grilla (`2.5`/`5.5`).
- `pnpm web:typecheck` → exit 0.
- `contrast:check` → AA+ en dark y light.
- Suite completa → exit 0.
- UI real a 1440px (cockpit + focus panel) en dark y light: consola limpia, sin
  regresiones; jerarquía tipográfica más legible y consistente.
- `tokens.css` resincronizado y empujado al proyecto Claude Design.

---

## Núcleo C1 — legibilidad de estados del nodo DAG (hecho · aprobado · portado)

Cards: `components/01-dag-node-current.html` (antes) + `components/01-dag-node-vnext.html`
(propuesta), lado a lado en el grupo **Núcleo**.

### Diagnóstico

El estado del nodo se codificaba casi solo por el **color** de un punto de 8px (más
tinte de borde en estados terminales). Falla: codificación solo-color (`pending`
gris y `done` sage son ambos discos sólidos, se distinguen solo por matiz), target
chico, y "arrancado vs no arrancado" sin señal de forma.

### Decisión de diseño — "Glyph dial" (forma primero)

Ganadora **unánime** de un panel de 3 jueces (lentes: legibilidad+accesibilidad /
guardrails+identidad / costo+densidad). La **silueta** del glifo carga el estado;
el color solo confirma (legible en escala de grises y a 0.35x):

| Estado | Glifo v-next |
|--------|--------------|
| pending | anillo **hueco** (único sin relleno → "no arrancado") |
| active (planning/running/verifying/repairing) | disco ember relleno + pulso (sin cambios) |
| done | disco sage relleno + **anillo de reposo** estático (asentado) |
| failed | **cuadrado** rust (única silueta no circular) |
| gated | glifo **Hand** (Lucide) en el mismo slot — espera a una persona |
| blocked/obsolete | anillo **punteado** ámbar |

`gated` y `blocked` comparten el token ocre (`--gated` = `--warning` =
`--status-blocked-fg` = `--cu-ochre`), así que la **forma** (Hand vs anillo
punteado) + la palabra del vital label los separan — no el color.

Tipografía interna refinada: rol → eyebrow mono UPPERCASE (`--fs-eyebrow` +
`--ls-eyebrow`); `<small>` mono 10→11px (piso del sistema, `--fs-micro`).

Curaduría de Francisco (flujo A): **aprobado y portado tal cual** (incluye cuadrado
en failed, Hand en gated y rol en mayúsculas).

### Aplicación a React (port)

- **TDD:** helper puro `apps/web/src/lib/run-model/node-glyph.ts` (`nodeGlyph(status)`
  → descriptor `{kind:'dot',variant}` | `{kind:'hand'}`). Test `tests/node-glyph.test.ts`
  primero en rojo → verde (7/7), exhaustivo sobre los 10 `VitalStatus`.
- **`minimal-run-graph.tsx`:** el dot inline `style={{background:dotColor}}` se
  reemplaza por `nodeGlyph(status)` → clase `mh-min-node-dot--{variant}` (o glifo
  `Hand` 14px para gated). `STATUS_DOT` se mantiene para el color del MiniMap.
- **`globals.css`:** base `.mh-min-node-dot` 8→12px + `box-sizing:border-box`;
  variantes `--pending/--active/--done/--failed/--blocked`; `.mh-min-node-glyph`
  (slot del Hand, color `--gated`); `.mh-min-node-role` → mono uppercase con tokens
  de rol. Cero ember nuevo; una sola animación (el pulso activo, ya con
  `prefers-reduced-motion`).

### Verificación

- `tests/node-glyph.test.ts` 7/7 · `tests/typography-scale.test.ts` 5/5.
- `pnpm web:typecheck` → exit 0.
- `contrast:check` → AA+ dark + light.
- `tokens.css` resincronizado (incluye las variantes nuevas) y empujado; la card
  "actual" fija su punto a 8px para seguir siendo un "antes" fiel.

---

## Núcleo C3 — focus inspector: secciones + duración + deps (hecho · aprobado · portado)

Cards: `components/03-focus-inspector-current.html` (antes, lista plana) +
`components/03-focus-inspector-vnext.html` (4 secciones), grupo **Núcleo**.

### Diagnóstico

El `NodeBody` era una lista plana de ~13 filas key-value con jerga ("Rol · prof.",
"… · derived/guessed"), sin jerarquía, sin duración ni dependencias explícitas.

### Decisión de diseño (aprobada tal cual por Francisco)

**4 secciones** con header eyebrow: **Estado** (Situación · Signo vital · Duración ·
Verificación) · **Contrato** (Rol humanizado · Objetivo · Alcance + origen como chip) ·
**Dependencias** (Depende de · Consume · Produce · Padre) · **Evidencia** (Commit ·
Archivos · Construido contra · Produce rev. · Banderas · refs). Rol humanizado
(leaf/composite/root → Hoja/Grupo/Raíz), origen humanizado (derived/guessed →
derivado/inferido).

### Datos: derivados, nunca inventados

El modelo **no** tiene una duración de ejecución de primera clase (`durationMs` solo
existe en telemetría de planning). Las dos adiciones son **derivadas honestas**:

- **`dependencies`** (`FocusNodeSummary[]`): nodos upstream, de `consumes →
  seam.producerNodeId → node`. Deduplicado, self excluido, orden de consumo. Pura
  derivación del modelo.
- **`timing`** (`NodeTimingView`): de eventos `node.execution.started` (primero) →
  terminal `node.verify.passed`/`node.execution.failed` (último), spanning
  re-ejecución. Si arrancó sin terminal → `running:true` sin número fabricado; si no
  arrancó → sin timing (el panel muestra "—").

### Aplicación a React (port)

- **TDD:** helpers puros `deriveNodeDependencies(model, ws)` y
  `deriveNodeTiming(events, nodeId)` en `focus-view.ts`; test
  `tests/run-model-focus-node-deps-timing.test.ts` primero en rojo → verde (9/9),
  incl. no-contaminación entre nodos y span de re-ejecución.
- **`focus-view.ts`:** `NodeFocusView` gana `dependencies` (requerido) y `timing?`;
  `buildNodeFocus` los completa.
- **`run-model-view.client.tsx`:** se pasan los `events` a `buildFocusView`
  (`{ events }`) — antes se omitían, así que esto **además enciende la consola del
  agente** en el cockpit (estaba apagada por falta de eventos) y habilita el timing.
- **`focus-panel.tsx`:** componente `Section` (header eyebrow + hairline), `Field`
  con `tag` opcional (origen como chip), helpers `humanizeRole/humanizeOrigin/
  formatTiming/formatDuration`; `NodeBody` reorganizado en las 4 secciones sin perder
  ningún campo.

### Verificación

- `tests/run-model-focus-node-deps-timing.test.ts` 9/9 · `run-model-focus-view` 19/19
  (sin regresiones) · `typography-scale` 5/5.
- `pnpm web:typecheck` → exit 0 · `contrast:check` → AA+ dark + light.
- Suite completa → verde.

---

## Núcleo C2 — StatusPill: lenguaje de estado unificado (hecho · aprobado · portado)

Cards: `components/02-status-pill-current.html` + `components/02-status-pill-vnext.html`
(md + mini), grupo **Núcleo**.

### Diagnóstico

El `StatusPill` ya tiene label obligatorio (nunca es solo-color), pero su punto era
sólido para todo y lo vivo usaba `animate-pulse` (blink genérico de Tailwind),
distinto del pulso del nodo del DAG. Vocabulario de estado inconsistente entre nodo
y pill.

### Decisión de diseño (aprobada tal cual)

Alinear el pill con el **Glyph dial** del nodo:
- **Punto hueco** para estados no-arrancados (idle · pending · skipped) — la única
  distinción de forma que se lee a 4–6px y que ya significa "no arrancado".
- **Pulso unificado**: lo vivo usa el mismo `coral-pulse` del nodo.
- **Scope honesto**: NO se mete cuadrado/forma para failed/conflict — a tamaño de
  pill no se lee; el color rust + el label los cargan.

### Aplicación a React (port)

- **TDD:** `tests/status-pill-language.test.ts` (3/3, rojo→verde) sobre el nuevo campo
  `hollow` de `STATUS_META`.
- **`status.ts`:** `StatusMeta` gana `hollow: boolean`; idle/pending/skipped → true,
  resto → false (single source of truth).
- **`status-pill.tsx`:** punto hueco vía `boxShadow inset` cuando `meta.hollow`
  (1.5px md / 1.25px mini); `animate-pulse` → `coral-pulse`.

### Verificación

- `status-pill-language` 3/3 · `pnpm web:typecheck` exit 0 · `contrast:check` AA+
  dark + light · suite completa verde.

---

## Núcleo — cierre

- **C4 (Button):** revisado, ya está a nivel v2 (tokenizado, 4 variantes, 3 tamaños,
  estados default/hover/focus/active/disabled/busy, `mh-lift`/`mh-press`). **No tiene
  gap real** → no se toca (evitar re-skin, CLAUDE.md §1/§5).
- **Empty states:** ya cubiertos en el loop UI/UX previo (`GraphEmptyState`
  planning/failed/interrupted + `MissingBody` del focus panel). No se duplican.

Núcleo completo: C1 (nodo) · C3 (inspector) · C2 (pill).

---

## Cockpit S3 — Tabs: estado activo más claro (hecho · aprobado · portado)

Card de comparación directa: `cockpit/01-tabs-active.html` (las dos barras apiladas),
grupo **Cockpit**.

### Diagnóstico

El tab activo se señalaba casi solo por un subrayado accent de 2px + semibold. Con 6
tabs, sutil (gap S3 del brief).

### Decisión de diseño (aprobada tal cual)

Activo a **4 canales**: subrayado accent + peso + **ícono tintado accent** + **lift
neutro tenue** (`color-mix(text 4%)` + esquinas superiores `--r-md`). Sin sumar ember
de relleno (el ícono accent es la única ember nueva, mínima). Hover sutil agregado a
inactivos para affordance.

### Aplicación a React (port)

- **`artifact-tabs.client.tsx`:** rama activa del tab gana `rounded-t` + bg lift; el
  ícono se envuelve en un span `text-accent` cuando activo; `bg-transparent` movido del
  base a las ramas para evitar colisión de utilidades. Cambio **puramente visual** (sin
  lógica nueva → sin test rojo, por el patrón de la spec §4).

### Verificación

- `pnpm web:typecheck` → exit 0 · `contrast:check` → AA+ dark + light · suite completa
  verde (sin regresión de markup de tabs).

---

## Cockpit S2 — Timeline: lift de fase activa (hecho · portado)

Card: `cockpit/02-timeline-active.html`. El `run-timeline.tsx` ya hablaba el lenguaje
unificado; el único refuerzo (consistencia con el tab activo de S3) es darle a la fase
activa el mismo **lift neutro tenue**. Port: la fase activa gana
`bg-[color-mix(text 4%)] rounded-[--r-md] px-2 py-1 -mx-0.5` (px-2 on-grid, no px-2.5
por el guard). Cambio puramente visual. Verde: typecheck 0 · typography 5/5 · contrast
AA+ · suite.

## Cockpit S1 — Header: colapso de vitals en anchos chicos (hecho · portado)

Card: `cockpit/03-header-narrow.html` (comparación a 720px). El cluster derecho ya
estaba mitigado (workspace oculto < lg, título truncado); el refuerzo extiende ese
patrón: las **palabras** de los vitals (tareas/conflictos/activos) colapsan < md
(`hidden md:inline`), dejando números + tooltips, para que el cluster respire <~900px.
Port en `run-model-view.client.tsx` (3 spans). Verde: typecheck 0 · contrast AA+ · suite.

---

## Estado — loop de design-system

Completo y portado: **Foundation** (tipografía/escala/tokens) · **Núcleo** C1 nodo ·
C3 inspector · C2 pill · **Cockpit** S3 tabs · S2 timeline · S1 header. Button ya
estaba en v2 (no se tocó); empty states ya cubiertos. Todo verde (typecheck, suite,
contraste) y sincronizado con el proyecto Claude Design.

Posible próximo (fuera de este loop): pase de screenshots reales del cockpit a
1440/1100/768px cuando el extension del navegador esté conectado, para validar en UI.
