# Demo reproducible para la defensa

> **Qué es esto.** El guion mínimo para reproducir en vivo un run completo de
> ManyHands, y el material de respaldo por si la red, la cuota del proveedor o
> el tiempo no acompañan. Todo lo etiquetado como **respaldo** es evidencia
> grabada de un run real; **nada de lo que aparece acá es una fixture ni una
> maqueta**.

## 0. Antes de empezar (una sola vez, no en vivo)

```bash
pnpm install --frozen-lockfile
pnpm build          # obligatorio: el servidor resuelve @manyhands/* desde dist
```

**Esto no es opcional.** El servidor de desarrollo consume los paquetes
compilados, no las fuentes: si se omite el build, el run demuestra el código de
la compilación anterior y no lo que se acaba de mostrar en el editor.

Verificar que el ejecutor está autenticado:

```bash
codex --version    # 0.141.0 verificado; modelo gpt-5.5
```

Verificar espacio en disco. Cada run materializa un pool de worktrees con sus
dependencias; **varios GB libres**, no unos pocos cientos de MB.

## 1. Estado inicial del repositorio objetivo

El objetivo es un repositorio **externo** a ManyHands, no un directorio de
prueba dentro del monorepo:

```bash
git -C ~/manyhands-thesis-targets/expense-splitter log --oneline -1
git -C ~/manyhands-thesis-targets/expense-splitter status --porcelain
```

Debe mostrar el commit base congelado y un árbol limpio (la única entrada
admisible es `?? .manyhands/`, el propio directorio de runtime del
orquestador).

Mostrar la línea de base verde:

```bash
cd ~/manyhands-thesis-targets/expense-splitter && npm test
```

## 2. Levantar ManyHands

```bash
export MANYHANDS_SESSION_TOKEN=<uuid>
pnpm --filter @manyhands/web exec next dev -p 3111
```

## 3. Lanzar el run

```bash
node docs/tesis/evidence/scripts/run-experiment.mjs \
  --config docs/tesis/evidence/canonical-run/cells/g4-series-1.json \
  --out /tmp/demo-run
```

El driver rechaza arrancar si el objetivo no está en el commit base, y solo
ejecuta las dos decisiones que el modelo de decisiones reserva al operador:
aprobar el plan y aprobar la entrega. **No auto-aprueba nada dentro del
orquestador.**

### Qué señalar mientras corre

| Momento | Qué mostrar |
|---|---|
| Planificación | El evento `planning.granularity_assessed`: $C_{task}$ por unidad, el origen de cada señal (`llm` / `clamped` / `derived`) y la decisión hoja/compuesto |
| Aprobación | La decisión es del operador, no del sistema |
| Ejecución | Cada hoja en su propio worktree; el agente **no** commitea |
| Validación | La matriz de evidencias sobre el commit exacto |
| Integración | Bottom-up, con reparación semántica si hay conflicto |
| Entrega | Manifiesto y receipt; `targetHeadBefore` → `targetHeadAfter` |

**Duración típica: 12–15 minutos.** Si el tiempo de la defensa no lo permite,
pasar directamente al respaldo.

## 4. Verificar el resultado (no confiar en el lifecycle)

Un run que dice `completed` no es evidencia por sí solo. La verificación se hace
sobre un **clon limpio** del commit entregado, porque el pool de worktrees
dentro del objetivo contamina el descubrimiento de tests si se corre en la raíz:

```bash
git clone ~/manyhands-thesis-targets/expense-splitter /tmp/verify
cd /tmp/verify && npm install && npm test && npx tsc --noEmit
```

## Material de respaldo (todo grabado de runs reales)

| Archivo | Qué muestra |
|---|---|
| `canonical-run/series/*/run.events.v2.jsonl` | Journal canónico completo de cada run de la serie |
| `canonical-run/series/*/result.json` | Lifecycle, `finalSha` y receipt confirmado |
| `canonical-run/series/*/final-diff.patch` | El diff exactamente entregado al objetivo |
| `canonical-run/series/*/run.granularity-metrics.json` | Métricas estructurales de la decisión de granularidad |
| `canonical-run/README.md` | Configuración congelada, defectos encontrados y limitaciones declaradas |
| `experiment/results.md` | Resultados del estudio comparativo, **derivados automáticamente** del journal |
| `experiment/raw-results.csv` | Datos crudos por run |
| `progress-log.md` | Bitácora, **incluidos los runs descartados y por qué** |

## Si algo falla en vivo

Es un sistema que ejecuta agentes remotos: puede fallar delante del tribunal.
Eso no es un problema para la defensa **si se lo trata con honestidad**, porque
los modos de falla son parte del resultado reportado.

| Síntoma | Qué decir y hacia dónde ir |
|---|---|
| El planificador pide una aclaración | El objetivo congelado no la contempla; el driver se detiene en lugar de improvisar una respuesta, porque contestar cambiaría el estímulo |
| Una hoja falla por alcance | Mostrar el motivo persistido: nombra las rutas que salieron del contrato. Es el modo de falla documentado en la tesis, no una sorpresa |
| El agente expira | Verificar disco y cuota antes de culpar al sistema; un run se descartó por esa causa y está registrado en la bitácora |
| El proveedor rechaza el modelo | La cuenta disponible solo admite `gpt-5.5`; está declarado en la configuración congelada |
