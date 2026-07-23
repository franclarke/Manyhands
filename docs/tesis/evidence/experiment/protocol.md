# G5 — Protocolo del experimento comparativo de granularidad

> **Estado: NO EJECUTADO.** Este documento especifica el protocolo; los datos
> no fueron recolectados en esta sesión. Ver §6 para la razón y §7 para el
> procedimiento exacto de reanudación.

## 1. Preguntas

- **RQ1.** ¿Cómo varía la tasa de entrega verificada entre (A) hoja única
  forzada, (B) división fina fija y (C) política adaptativa?
- **RQ2.** ¿Qué trade-off existe entre éxito, duración wall-clock, tokens/costo
  y overhead de coordinación?
- **RQ3.** ¿Qué modos de falla, reintentos, resultados obsoletos o conflictos
  aparecen en cada configuración?

## 2. Condiciones

| Cond. | Descripción | Mecanismo |
|---|---|---|
| A | Hoja única: se prohíbe descomponer | Forzar `isLeaf` en la raíz (umbral efectivo $\infty$) |
| B | División fina fija | Umbral efectivo 0, sin coalescencia |
| C | Política adaptativa productiva | `c-task/1.0.0`, umbral 3.5, críticos activos |

Las tres condiciones deben ser seleccionables de forma reproducible. **Trabajo
pendiente de implementación:** hoy la política es fija; se requiere exponer
umbral y activación de críticos como configuración del run, persistida en el
evento `planning.granularity_assessed` (el campo `formulaVersion` ya permite
distinguir configuraciones).

## 3. Constantes

Repositorio y commit base, objetivo y criterios de aceptación, modelo
(`gpt-5.5`), esfuerzo, executor (Codex CLI 0.141.0), presupuesto y timeouts,
versión de ManyHands (commit exacto), comandos de validación, hardware.

## 4. Tamaño

- Mínimo aceptable: 3 tareas × 3 condiciones × 3 repeticiones = **27 runs**.
- Recomendado: 5 × 3 × 3 = **45 runs**.

El orden de las condiciones debe alternarse o aleatorizarse para reducir el
sesgo temporal del proveedor. Toda reducción del diseño debe documentarse
**antes** de observar resultados.

## 5. Métricas

**Primarias:** entrega verificada (booleano), cobertura de criterios, duración
wall-clock, tokens y costo, cantidad de intentos y reintentos, fallos de
validación e integración, decisiones humanas requeridas.

**Estructurales:** profundidad, cantidad de hojas, factor de ramificación,
unidades fusionadas, tamaño de contexto, resultados obsoletos, conflictos
evitados frente a materializados. Todas se persisten ya hoy en
`<runId>.granularity-metrics.json` y en el journal.

**Secundaria:** `GEI`, siempre acompañado de sus componentes, con fórmula,
unidades y tratamiento del denominador cero versionados. **No debe ser la única
base de comparación.**

## 6. Por qué no se ejecutó

1. **Precondición de implementación no satisfecha:** las condiciones A y B
   requieren parametrizar el umbral y los críticos, lo que hoy no es
   configuración del run.
2. **Precondición de estabilidad no satisfecha:** de cuatro ejecuciones del caso
   canónico, una completó. Con esa tasa, 27 runs producirían mayoritariamente
   celdas fallidas por una causa ya conocida y no por la variable en estudio
   (ver `../canonical-run/README.md` §7). Ejecutar el experimento antes de
   resolver la causa raíz de las violaciones de alcance produciría un dataset
   que no responde las preguntas planteadas.
3. **Costo:** 27–45 runs con un modelo remoto de razonamiento alto, a ~3–8
   minutos por run, exceden el presupuesto de esta sesión.

**Consecuencia declarada:** la tesis **no afirma** superioridad de la política
adaptativa. Afirma viabilidad del recorrido completo y reporta el resultado
negativo sobre la síntesis mecánica de particiones, que sí está respaldado por
evidencia.

## 7. Procedimiento exacto de reanudación

```bash
# 1. Precondición: resolver la causa raíz de las violaciones de alcance
#    (ver ../canonical-run/README.md §7, opciones a/b/c).

# 2. Parametrizar la política por run:
#    - agregar umbral y flags de críticos a ExecutionConfig
#    - propagarlos a applyAdaptiveGranularity
#    - versionar la configuración en formulaVersion

# 3. Levantar el entorno
export MANYHANDS_SESSION_TOKEN=<uuid>
export MANYHANDS_CODEX_BIN=codex
pnpm --filter @manyhands/web exec next dev -p 3111

# 4. Por cada celda (tarea, condición, repetición):
#    POST /api/workspaces   { name, repoPath }
#    POST /api/runs         { workspaceId, userPrompt, planningSelection,
#                             executionSelection, executionConfig }
#    POST /api/runs/<id>/decisions/<approve-plan-id>  { optionId: "approve" }
#    POST /api/runs/<id>/deliver { manifestId, finalSha, targetBranch,
#                                  targetHead, targetFingerprint, actor,
#                                  idempotencyKey }

# 5. Recolectar por run:
#    .manyhands/runs/<runId>.events.v2.jsonl
#    .manyhands/runs/<runId>.snapshot.v2.json
#    .manyhands/runs/<runId>.granularity-metrics.json
#    git -C <target> diff <base>..<final>
```

Los artefactos deben copiarse a `raw/run-artifacts/<runId>/` y una fila por run
a `raw/runs.csv`, con `runId`, commit de ManyHands, commit base, condición,
tarea, repetición y ruta a los artefactos. Los scripts de `scripts/` deben
regenerar `derived/summary.csv` y las tablas de la tesis desde `raw/`, sin
números escritos a mano.
