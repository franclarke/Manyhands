# Plan — Limpieza profunda del repositorio

- **Fecha:** 2026-06-16
- **Estado:** Propuesto (a revisar antes de ejecutar)
- **Alcance:** documentación basura, artefactos de sesión y archivos temporales.
  **NO** incluye refactor de código legacy (ver §"Fuera de alcance").
- **Criterio:** cada referencia entrante a un archivo a borrar fue verificada;
  todas provienen de archivos que también se borran → **no quedan links rotos**.

---

## Resumen de decisión

| Tier | Qué | Acción | Riesgo |
|------|-----|--------|--------|
| 1 | Logs/temp no trackeados (~356 KB) | `rm` de disco | Nulo (gitignored) |
| 2 | Artefactos de sesión trackeados | `git rm` | Bajo (historia en git) |
| 3 | Docs históricas de temas retirados | `git rm` | Bajo (criterio) |
| 4 | Consolidar docs de producto/diseño | `git mv` + fix refs | Bajo (cosmético) |

---

## Tier 1 — Basura no trackeada (`rm` de disco, no toca git)

Coinciden con `.gitignore` (`*.log`); solo ensucian el working dir.

```
manyhands-dev.log
.codex-temp/web-dev.err.log
.codex-temp/web-dev.out.log
.codex-temp/manyhands-web-dev.err.log
.codex-temp/manyhands-web-dev.out.log     (→ borrar carpeta .codex-temp/ completa)
```

- **NO se toca** `.manyhands/`: es estado runtime local vivo (`workspaces.json`,
  `runs/`). Está gitignored; sus logs sueltos se pueden limpiar aparte si querés,
  pero quedan fuera de este plan por seguridad.

## Tier 2 — Artefactos de sesión trackeados (`git rm`)

Ninguno está referenciado por README/CLAUDE/AGENTS; son notas de sesiones cerradas.

```
scratch/                          (6 scripts one-off, huérfanos: split-runner,
                                   chop-runner*, fix-imports, append*)
task.md                           (plan U1–U8, marcado 8/8 completo)
walkthrough.md                    (Walkthrough sesión 2026-06-12, PR-8 cerrado)
implementacion-frontera.md        (mapa sesión "UltraCode" 2026-06-10)
docs/design/FRONTIER-PROMPT.md    (prompt copy-paste de handover Fable 5)
```

## Tier 3 — Docs históricas de temas retirados (`git rm`)

Temas que `CLAUDE.md` declara retirados (tesis, benchmark, Lab Mode).

```
docs/thesis/project-evolution.md       (+ carpeta docs/thesis/ queda vacía → borrar)
docs/development/thesis-plan.md
docs/development/ui-vision.md           (se auto-marca "superseded"; tombstone-redirect)
docs/ui-audit/                          (manyhands-ui-audit.md + 9 screenshots before/after)
docs/design/handoff-walkthrough.md      (reading-map redundante con docs/design/README.md;
                                         sin refs entrantes)
```

**Fix de referencia requerido:** `docs/adr/0014-dag-canvas-read-only.md` enlaza a
`ui-vision.md`. Se actualiza la línea para apuntar a `docs/design/` (o se marca el
doc como removido). Es la única referencia sobreviviente a un archivo de Tier 3.

**Se CONSERVA (no es Tier 3):**
- `docs/adr/**` — los 30 ADR son historia de decisiones *por diseño* (CLAUDE.md);
  no se borran aunque mencionen experimentos viejos.
- `docs/superpowers/plans/2026-06-16-run-validation-backfill.md` — trabajo activo.
- `docs/superpowers/specs/2026-06-16-run-validation-backfill-design.md` — activo.
- `docs/superpowers/specs/2026-06-16-workspace-creation-ux-design.md` — "Aprobado",
  diseño del trabajo de workspace sin commitear.
- `docs/img/` — usado por `README.md`.

**Borderline (decisión tuya en la revisión):**
- `docs/development/doc-audit.md` — auditoría puntual ya cumplida, **pero** documenta
  el drift de código legacy aún no limpiado (lo de "Fuera de alcance"). Recomiendo
  **conservarlo** como registro de ese TODO. Su única ref entrante es la del punto
  siguiente (también candidata a borrar).
- `docs/superpowers/plans/2026-06-15-documentacion-repo-github.md` — plan del doc-pass
  ya completado. Borrable; recomiendo conservar junto a `doc-audit.md`.

## Tier 4 — Consolidación de docs de producto/diseño (cosmético)

`PRODUCT.md` y `DESIGN.md` están sueltos en la raíz pero son docs **vigentes**
(brand/design-principles y design-system). **No son duplicados** de
`docs/development/product-vision.md` (que es el product thesis) → **no se fusionan**;
solo se ordenan dentro de `docs/`.

```
git mv DESIGN.md   docs/design/design-system.md
git mv PRODUCT.md  docs/development/product-brand.md
```

**Fix de referencias requerido tras el move:**
- `apps/web/src/app/globals.css` (líneas ~59 y ~1015): comentarios que citan
  `PRODUCT.md` → actualizar a `docs/development/product-brand.md`.

> Tier 4 es el de menor valor y mayor churn (toca un archivo de código). Si preferís,
> lo dejamos para después y ejecutamos solo 1–3.

---

## Orden de ejecución y verificación

1. Tier 1 (`rm`) → no afecta git.
2. Tier 2 + Tier 3 (`git rm` + fix de ADR-0014).
3. Tier 4 (`git mv` + fix de `globals.css`).
4. **Verificación:**
   - `pnpm web:typecheck` y `pnpm build` (asegura que ningún import quedó colgado;
     solo `globals.css` referenciaba un doc movido, vía comentario).
   - Búsqueda final de links rotos a los paths borrados/movidos en `docs/**`, `README.md`.
5. Commit(s) separados por tier para revert granular:
   - `chore(repo): remove dev logs and scratch artifacts` (T1+T2)
   - `docs: drop retired thesis/benchmark/audit docs` (T3)
   - `docs: consolidate product/design docs into docs/` (T4)

---

## Fuera de alcance (Tier 5 — NO en esta limpieza)

Código legacy detectado pero que **sigue referenciado** → es refactor test-first,
no borrado:
- `MockDecomposer` / `SingleTaskDecomposer` / `MetadataDrivenMockDecomposer`
  (usados por `packages/core/src/mock-planning-flow.ts`, `regen/route.ts`,
  `decomposer-policy.ts`).
- `@manyhands/core` (barrel legacy importado en ~10+ archivos de `apps/web`).
- Campos legacy de `RunSnapshot` y eventos de trace legacy (ver `doc-audit.md`).
- No hay `knip`/`ts-prune`: un barrido real de dead-code requeriría añadir la
  herramienta primero.

Estos quedan para un trabajo separado, con tests, fuera de este plan.
