# Spec — Loop de elevación del sistema de diseño (v2) con Claude Design

> Fecha: 2026-06-20 · Estado: aprobado (brainstorming) · Próximo paso: ejecución
> incremental por fases. Bitácora de ejecución: `docs/development/`.
> Base vigente: [`docs/design/design-system.md`](../../design/design-system.md).

## 1. Objetivo y guardrails

**Objetivo.** Elevar el sistema de diseño actual ("ember sobre grafito / Signal
Deck") a un **v2**: más calidad percibida en jerarquía, densidad, consistencia de
tokens, elevación y motion, usando **Claude Design** como superficie de
diseño/comparación y aplicando lo aprobado al **código React real**. Cada cambio
debe mejorar una tarea real del usuario (entender, controlar, auditar, depurar una
corrida), no ser re-skin cosmético.

**Decisiones del brainstorming.**
- **Ambición:** v2 dentro de guardrails, con libertad para **toques chicos de
  identidad** donde sumen (justificados + `contrast:check` revalidado).
- **Alcance (1ª vuelta):** foundation + componentes núcleo + el **cockpit** del
  run como superficie estrella.
- **Flujo:** "A" — yo autoreo en el proyecto las cards **actual** y **v-next**
  lado a lado; el usuario cura/aprueba **por componente**; yo porto a React.
  Secuencia: foundation → núcleo → cockpit.

**Guardrails que se mantienen.** Ember sobre grafito; ember ≤10% de superficie;
sin celestes/cianes en ningún rol; sin glassmorphism ni gradient text; radios
≤12px; sombras sobrias; paridad dark/light con contraste AA+; primitivas `--cu-*`
nunca se consumen directo en componentes (solo `--color-*`/`--status-*`).

## 2. Estructura del proyecto Claude Design

Proyecto nuevo `ManyHands Design System` (creado con `DesignSync.create_project`).
Cards (`<!-- @dsCard group="…" -->` en la primera línea) en tres grupos, cada una
con su variante **actual** y **v-next** para curar:

- **Foundation:** color/tokens, tipografía, escala de spacing, elevación
  (`mh-elev-*`/sombras), motion.
- **Núcleo:** Button, StatusPill, nodo del DAG, chips de estado, paneles/inspector
  (focus), empty states.
- **Cockpit:** workspace del run como composición (header + timeline + chat +
  canvas + focus).

**Espejo local fiel.** Previews en `design-system/` (repo root): `foundation/`,
`components/`, `cockpit/`, más un `tokens.css` extraído de `globals.css`
(variables `--color-*`/`--status-*`/`--cu-*` + utilidades `.mh-*`). Cada `.html`
importa `tokens.css` y carga **Tailwind Play CDN** para que las utilidades rindan
igual que en la app sin el build de Next. `design-sync` sincroniza
`design-system/` ↔ proyecto, **incremental, un componente por vez** (nunca
reemplazo masivo).

## 3. Fases

- **Fase 0 — Brief de elevación.** Auditar el sistema actual y fijar los gaps
  priorizados (sección 6). No toca código. *(Hecho en este spec.)*
- **Fase 1 — Sembrar.** Crear el proyecto; extraer `tokens.css`; **smoke test**
  (subir 1 card y confirmar que rinde fiel en claude.ai/design antes de seguir);
  autorear las cards del estado **actual** (foundation + núcleo + cockpit) y
  subirlas.
- **Fase 2 — Proponer v-next.** Autorear las versiones elevadas lado a lado; el
  usuario revisa y aprueba/ajusta por componente. Secuencia foundation → núcleo →
  cockpit (cada capa aprobada antes de la siguiente).
- **Fase 3 — Aplicar a React.** Portar lo aprobado, componente por componente.

## 4. Cómo se aplica a React

- TDD donde haya lógica nueva (selector/helper puro primero). Para cambios
  puramente visuales, la verificación es UI real con screenshots a 1440/1100/768px.
- Incremental: un componente por paso, manteniendo `tsc --noEmit`, suite de tests
  y `contrast:check` en verde en cada uno.
- Orden de propagación: tokens primero, luego componentes que los consumen, luego
  el cockpit.
- Bitácora por bloque en `docs/development/` con evidencia por componente.

## 5. Criterios de éxito y riesgos

**Éxito.** Foundation + núcleo + cockpit elevados y aplicados; tests/typecheck/
contrast verdes; consola limpia; identidad intacta o mejorada deliberadamente; el
cockpit se siente más claro y jerárquico en UI real.

**Riesgos / mitigación.** (a) previews no rinden fiel en claude.ai/design → el
smoke test de Fase 1 lo valida antes de invertir; (b) "elevar" deriva en re-skin →
cada cambio se justifica contra una tarea real; (c) deriva de identidad →
guardrails + `contrast:check` por cada toque de token; (d) doble fuente de verdad
(previews HTML vs React) → los previews son superficie de **diseño**, el código
React es la implementación; se sincroniza de a uno y se descartan previews que ya
no aportan.

## 6. Brief de elevación (Fase 0) — gaps priorizados

Evidencia: `globals.css` (capa de tokens), componentes (`button.tsx`,
`status-pill.tsx`, `minimal-run-graph.tsx`, `focus-panel.tsx`,
`artifact-tabs.client.tsx`, `run-model-view.client.tsx`) y screenshots del cockpit
real (runs `aaeb1bf7`, `run-gate-decision`, `88589e6f`).

**P0 — mayor impacto en calidad percibida**

- **F1 · Proliferación de tamaños fuera de escala.** La escala fija es
  12/13/15/16/20/28/40, pero los componentes usan muchos arbitrarios
  (`10.5/11/11.5/12.5px`). Elevación: definir un set chico de pasos "operador"
  (incl. un nivel meta ~11px documentado) y reemplazar arbitrarios por tokens.
- **C3 · Focus inspector denso y con jerga.** Lista plana key-value con copy
  técnico ("Rol·prof: leaf·d1", "Alcance: —·guessed"). Elevación: agrupar en
  secciones (estado · contrato · deps · evidencia) + agregar duración y
  dependencias explícitas (era el pendiente de la "dirección A" del audit original).
- **C1 · Legibilidad de estados del nodo DAG.** Verificar y reforzar que
  done=sólido+sage, active=ember+pulse, failed=rust, pending=hollow se lean sin
  ambigüedad; refinar la tipografía interna de la card y el rol ("tarea·d1").

**P1 — fricción real**

- **F2 · Spacing ad-hoc.** Paddings/gaps arbitrarios (`py-2.5`, `px-3.5`,
  `gap-2.5`) vs grid 4px. Elevación: consolidar a la escala; densidad por token.
- **S1 · Header del cockpit en anchos chicos.** El cluster derecho (vitals +
  acciones + pill de atención) envuelve incómodo <~900px. Elevación: jerarquía y
  colapso del cluster.
- **S3 · Tabs.** Estado activo (subrayado) algo sutil. Elevación: activo más claro.

**P2 — pulido**

- **F3 · Rampa de elevación/sombra:** refinar la distinción surface→raised→overlay
  y el catch-light superior. Bajo riesgo.
- **S2 · Timeline:** reforzar el énfasis de la fase activa.
- **Motion:** micro-interacciones de entrada/hover coherentes en todo el set.

**Secuencia de ejecución sugerida:** F1 → F2 (foundation) · C1 → C3 → C2/C4/empty
(núcleo) · S1 → S3 → S2 (cockpit).
