# Registro duradero de progreso — Cierre de tesis (Etapas 2–6)

> Registro continuo exigido por GOAL.md. Permite reanudar el trabajo si la
> sesión se interrumpe. Se actualiza al cerrar cada hito, no solo al final.
> Inicio de ejecución: 2026-07-23 (UTC). Commit de partida: `5355d4b`.

## Estado por etapa

| Etapa | Gate | Estado | Evidencia |
|---|---|---|---|
| 1 — Congelar alcance | G1 | **PASS** (aprobado por Francisco, D-1..D-4) | `docs/tesis/*.md`, `evidence/baselines/stage-1-baseline.md` |
| 2 — Toolchain y gates | G2 | in_progress | `evidence/gates/` (pendiente) |
| 3 — Aporte adaptativo | G3 | pending | — |
| 4 — Run canónico | G4 | pending | — |
| 5 — Experimento | G5 | pending | — |
| 6 — Tesis y presentación | G6 | pending | — |

## Decisiones adoptadas

- **D-1..D-4:** aprobadas por Francisco (ver `research-questions.md` §4).
- **D-5:** escenario del run canónico — se confirma al iniciar Etapa 4; default:
  feature vertical sobre app TS pequeña externa (GOAL.md sugiere escenarios tipo
  división de gastos / tareas / inventario).
- **D-6 (adoptada):** pnpm 7.29.3 + lockfile 5.4. **Limitación local:** Node 22
  no está instalado (nvm local solo tiene 18/19; Node activo = 24.16.0 de
  instalación directa; instalar 22 requeriría descarga/elevación). Gates locales
  corren sobre Node 24.16.0; CI queda como autoridad de Node 22; `engines` se
  fija `>=22`.
- **D-7 (adoptada):** señales de complejidad híbridas — LLM propone, validador
  determinista acota contra `RepositorySnapshot`.
- **D-8 (adoptada):** el `RecursiveDecomposer` emite señales y delega la frontera
  leaf/composite a la política adaptativa (un solo planificador).

## Bitácora

### 2026-07-23 — Sesión de ejecución (inicio)

1. G1 cerrado `PASS` (Francisco aprobó D-1..D-4). Entregables G1 listos para commit.
2. Etapa 2 iniciada: verificación de toolchain local (Node 24.16.0, pnpm 7.29.3,
   git 2.40.1; nvm presente pero sin Node 22).

## Siguiente acción exacta

- Commit de cierre G1 (docs/tesis + GOAL.md excluido o incluido según diff).
- Alinear `packageManager` a `pnpm@7.29.3`, agregar `engines` y `.nvmrc`.
- Fresh install en clon aislado + gates completos; registrar en
  `evidence/gates/g2-*`.
