# G4 — Estabilidad reproducible: **PASS**

> **Fecha:** 2026-07-24 (UTC) · **Commit de ManyHands:** `db096d0` (único para
> ambas ejecuciones) · **Repositorio objetivo:** `expense-splitter`, base
> `1da878de6edd38cefb1ea4d8ceecdceea0bb6acc`, restablecido antes de cada run.

## Criterios del gate

| Criterio | `g4-series-1` | `g4-series-2` |
|---|---|---|
| Lifecycle `completed` | **sí** | **sí** |
| `finalSha ≠ baseSha` | **sí** (`4731cde7`) | **sí** (`4a974180`) |
| Manifest y receipt válidos | **sí**, `confirmed: true` | **sí**, `confirmed: true` |
| `targetHeadBefore` = base | `1da878de` | `1da878de` |
| Tests verdes en **clon limpio** | **13** (baseline 5) | **10** (baseline 5) |
| `tsc --noEmit` en clon limpio | exit 0 | exit 0 |
| Criterios requeridos sin `uncovered`/`failed` | sí | sí |
| Provenance y ancestry explicables | sí | sí |
| Defectos sistémicos, resultados stale adoptados o intervenciones por bug | ninguno | ninguno |

**Dos ejecuciones válidas consecutivas sobre un único commit. G4 = PASS.**

## Configuración congelada

| Parámetro | Valor |
|---|---|
| Executor de planificación | Codex CLI 0.141.0, `gpt-5.5`, effort `high` |
| Executor de ejecución y reparación | idéntico |
| `maxParallel` | 2 |
| `scopePolicy` | `strict` |
| Timeout por hoja / integración | 300 000 ms / 600 000 ms |
| `unexpectedCommitPolicy` | `reject` |
| Toolchain | Node 24.16.0 · pnpm 7.29.3 · git 2.40.1 · Windows 11 |
| Driver | `evidence/scripts/run-experiment.mjs`, celdas en `canonical-run/cells/` |

## Qué produjo cada ejecución

| | `g4-series-1` | `g4-series-2` |
|---|---|---|
| Duración | 20 min 50 s | 6 min 26 s |
| Topología | raíz compuesta ($C=5{,}05$) + **3 hojas** | raíz compuesta ($C=4{,}55$) + **1 hoja** |
| Intentos | 3 | 1 |
| Pases de reparación | 1 | 0 |
| Tokens reportados | 111 906 | 35 751 |
| Archivos entregados | 4 (+199/−10) | 4 (+126/−5) |

**Las dos topologías son distintas para el mismo objetivo.** Eso no invalida el
gate: el criterio exige que ambas satisfagan los mismos requisitos, no que
produzcan el mismo grafo ni el mismo commit. Es, además, la observación
central sobre la variabilidad del planificador remoto (§ tesis 7.5).

## Intervención humana

Únicamente las dos decisiones que el modelo de decisiones reserva al operador
(`DECISIONS.md` A13/A15): aprobar el plan y aprobar la entrega, ejecutadas por
el driver como operador. **Ninguna intervención en planning, ejecución,
validación, integración ni entrega.**

## Defectos corregidos para llegar acá

Cada uno con evidencia preservada, causa raíz identificada y regresión previa al
fix. Ninguno se encontró leyendo código: **los cuatro aparecieron ejecutando.**

| Defecto | Causa raíz | Commit | Evidencia |
|---|---|---|---|
| Trabajo correcto rechazado por alcance | `allowedPaths` son rutas exactas; un archivo de prueba nuevo no previsto invalidaba el candidato | `4bc0040` | `tests/scope-bounded-creation.test.ts` |
| **Deadlock silencioso** | un nodo adoptaba solo su artefacto de resultado; un artefacto declarado entre hermanos nunca se satisfacía | `c227205` | `defects/silent-artifact-deadlock/` |
| **No-op legítimo leído como fallo** | el heurístico de no-op era inalcanzable en la ruta V2 | `db096d0` | `defects/empty-diff-misread-as-failure/` |
| Consumo no registrado | Codex reporta un total que nadie leía, y a veces por stderr | `fe6d5ab`, `3bc253d`, `db096d0` | `tests/codex-usage-parsing.test.ts` |

## Runs descartados y por qué

| Run | Motivo del descarte |
|---|---|
| `16429274` | **Fallo de entorno**: disco a 0 bytes libres; un agente expiró. No es un fallo de ManyHands. |
| `0c0f066a` | Deadlock silencioso ⇒ defecto sistémico ⇒ serie reiniciada. |
| `5fe0aa27` | No-op legítimo leído como fallo ⇒ defecto sistémico ⇒ serie reiniciada. |
| `53dda539` | **Interferencia del operador**: se eliminó el directorio de salida mientras el driver escribía en él. No es un fallo del sistema; se declara para que el conteo de runs sea honesto. |

## Limitaciones que este gate **no** resuelve

1. **Un requisito de artefacto insatisfacible sigue sin detectarse.** La
   corrección evita la causa observada, pero el orquestador todavía espera en
   lugar de clasificar la condición como fallo. Solo el límite de reloj del
   driver externo la corta.
2. **Una unidad fusionada hereda rutas que solapan con las de su hermana**, así
   que puede hacer trabajo ajeno sin violar ningún contrato. Acotarlo exige una
   decisión semántica que —por el resultado negativo de esta misma tesis— la
   política determinista no puede tomar.
3. **El pool de worktrees contamina el descubrimiento de tests** si se ejecuta
   `npm test` en la raíz del objetivo. Toda verificación de este documento se
   hizo en **clon limpio**.
