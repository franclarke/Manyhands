# Stage 1 — Baseline técnico y de Git

> **Gate:** G1 — Congelar alcance
> **Tipo:** baseline auditable (fotografía del checkout)
> **Fecha de auditoría:** 2026-07-23 (UTC 18:49) · zona local de captura: UTC−03:00 (Bahía Blanca, Argentina)
> **Autor de la auditoría:** agente responsable del cierre de tesis (Etapa 1)

Este documento registra el estado observado del repositorio en el momento de la
Etapa 1. No atribuye a esta auditoría ningún cambio de código: la Etapa 1 es
documental. Los únicos archivos nuevos son los cuatro entregables de G1 bajo
`docs/tesis/`.

---

## 1. Git root y revisión

| Campo | Valor observado |
|---|---|
| Git root | `C:/Users/franc/Documents/Proyectos/Manyhands` |
| Branch | `main` |
| HEAD (full) | `5355d4b103b44c1bbcde682f246471cc9b3648af` |
| HEAD (short) | `5355d4b` |
| HEAD subject | `chore: stop tracking agent orchestration scratch and private UNI docs` |

**Nota de procedencia (hecho observado):** al inicio de la sesión el working
tree contenía 193 entradas sin commitear (61 modificados, 33 borrados, 99 sin
trackear) pertenecientes a trabajo previo de Francisco. Francisco consolidó ese
trabajo en commits antes de que esta auditoría tocara ningún archivo. La
auditoría **no** generó, movió ni descartó esos cambios. Al momento de escribir
los entregables, `git status --short` reporta **0 entradas** (working tree
limpio salvo por los entregables de G1 que este trabajo crea).

Commits recientes relevantes al cierre (contexto, no evidencia de capacidad):

```
5355d4b chore: stop tracking agent orchestration scratch and private UNI docs
0587330 checkpoint: v2 execution, persistence, grounding and cockpit UI work
fe3d496 checkpoint: pending web UI, run-model and study-book generation work
e560f8d docs(presentation): add thesis defense study materials
38c68f2 fix(v2): harden fingerprint, scope enforcement, decision lifecycle and validation caching
```

---

## 2. Toolchain detectada

### 2.1 Entorno local auditado (hecho observado)

| Herramienta | Versión local |
|---|---|
| Node.js | `v24.16.0` |
| pnpm | `7.29.3` |
| Git | `2.40.1.windows.1` |
| Plataforma | Windows 11 Pro (win32, 10.0.26200) |

### 2.2 Versiones declaradas en el repositorio (hecho observado)

| Fuente | Node | pnpm | Formato lockfile |
|---|---|---|---|
| `package.json` → `packageManager` | — | **`pnpm@11.7.0`** | — |
| `.github/workflows/ci.yml` | **`22`** | **`7.29.3`** (`pnpm/action-setup@v4`) | — |
| `pnpm-lock.yaml` → `lockfileVersion` | — | — | **`5.4`** (generado por pnpm 7.x) |
| `.nvmrc` / `.node-version` | ausente | — | — |
| `package.json` → `engines` | ausente | ausente | — |

### 2.3 Divergencia de toolchain (hecho observado — corrección diferida a Etapa 2)

Existe una **incoherencia cuádruple** que impide una definición única de
toolchain:

1. `packageManager` fija **pnpm 11.7.0**, pero
2. el CI instala con **pnpm 7.29.3**, y
3. el `pnpm-lock.yaml` está en formato **5.4**, propio de pnpm 7.x (pnpm 11
   escribe lockfile `9.0`), y
4. el Node local (**24**) difiere del Node de CI (**22**).

Consecuencia: un `pnpm install --frozen-lockfile` con la versión declarada en
`packageManager` (11.7.0) muy probablemente re-generaría o rechazaría el
lockfile 5.4. **La alineación de toolchain NO es trabajo de G1**; queda
registrada aquí como línea base y es el primer trabajo autorizado de la
Etapa 2 (ver `docs/THESIS_COMPLETION_ROADMAP.md` §8). Esta auditoría **no**
ejecutó `pnpm install` para no mutar el lockfile ni `node_modules`.

---

## 3. Runs persistidos (estado observable)

**Decisión de alcance de Francisco (2026-07-23):** los runs persistidos actuales
**no se consideran evidencia** y son candidatos a eliminación. El run canónico
definitivo se producirá con la implementación final (Etapa 4). Se documentan
aquí solo como estado observable del checkout, no como prueba de capacidad.

| Hecho observado | Detalle |
|---|---|
| Ubicación | `.manyhands/runs/` y `.manyhands/_archive_old_runs/` |
| Versionado en Git | **No.** `git check-ignore .manyhands/runs` → ignorado. Los runs no están bajo control de versiones. |
| Formatos presentes | `*.events.jsonl` (schema V1 legacy) y `*.events.v2.jsonl` (schema V2, `schemaVersion:2`). |
| Runs V2 (`schemaVersion:2`) | Ninguno alcanza `completed`. El más avanzado (`613040c9`) llega a `graph.compiled` → `wave.selected` → `attempt.started` → `attempt.failed` + `decision.raised/resolved`. La mayoría termina en `planning.failed` / `planning.attempt_failed`. |
| Runs V1 legacy | Algunos (`880dba1d`, `e1885451`, varios en `_archive_old_runs`) contienen `run.completed`, `integration.completed` y ejecutor `codex`, pero usan el **schema de eventos V1 retirado**, no la ruta productiva V2, y no están versionados ni acompañados de paquete de evidencia reconstruible. |

**Conclusión (inferencia):** no existe un run canónico válido para la tesis. El
requisito de "run real con Codex hasta `completed`, con manifest y receipt
versionados" pertenece a la Etapa 4 y su gate G4. Para G1, la evidencia
persistida de todo claim end-to-end es `none`.

---

## 4. Comandos ejecutados durante la auditoría

Todos los comandos fueron de **inspección no mutante** (lectura de Git, búsqueda
de código, conteo de eventos). No se ejecutaron builds, `pnpm install`, ni la
suite completa (política de etapa documental, `docs/THESIS_COMPLETION_ROADMAP.md`
§16).

| Comando (resumen) | Propósito | Exit code |
|---|---|---|
| `git rev-parse --show-toplevel` / `git branch` / `git rev-parse HEAD` | Git root, branch, HEAD | 0 |
| `git status --short` / `git diff HEAD --stat` / `git diff --check` | Estado del working tree | 0 |
| `node --version` / `pnpm --version` / `git --version` | Versiones de toolchain | 0 |
| `git check-ignore .manyhands/runs` | Verificar versionado de runs | 0 (ignorado) |
| `grep`/`glob` sobre `packages/**`, `apps/web/**`, `.manyhands/**` | Trazar claims a código y runs | 0 |
| `head`/`tail`/`wc` sobre `.manyhands/runs/*.jsonl` | Inspeccionar lifecycle de runs | 0 |

No se ejecutó ningún gate de verificación (`pnpm test`, `pnpm build`,
`pnpm web:build`, typechecks). Su ejecución y registro pertenecen a la Etapa 2
(gate G2).

---

## 5. Limitaciones de esta auditoría

1. **Sin ejecución de gates.** El estado real de tests/typechecks/builds sobre
   `5355d4b` no fue medido; el roadmap lo reserva para G2. Ninguna clasificación
   `implemented` de la matriz de claims se apoya en "los tests pasan" salvo por
   la existencia y forma del test, no por su resultado en este commit.
2. **Trazado estático.** La correspondencia claim→código se hizo por lectura y
   búsqueda de símbolos, no por ejecución. Un claim marcado `implemented` puede
   ocultar defectos de comportamiento que solo un run o la suite revelarían.
3. **Runs descartados por decisión de alcance.** Los runs persistidos no se
   auditaron en profundidad porque Francisco los declaró no-evidencia.
4. **`docs/UNI (NO LEER)/` no fue leído** (instrucción explícita).
5. **Sin secretos.** No se registran tokens, claves ni rutas personales más allá
   del Git root necesario para la trazabilidad.

---

## 6. Referencias

- Plan rector: [`docs/THESIS_COMPLETION_ROADMAP.md`](../../../THESIS_COMPLETION_ROADMAP.md)
- Matriz de claims: [`claim-evidence-matrix.md`](../../claim-evidence-matrix.md)
- Preguntas de investigación: [`research-questions.md`](../../research-questions.md)
- Capacidades diferidas: [`deferred-capabilities.md`](../../deferred-capabilities.md)
