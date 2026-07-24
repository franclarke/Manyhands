# Briefing para un segundo agente — ManyHands, cierre de tesis

> **Cómo usar este archivo.** Pasáselo entero a otro agente como prompt inicial.
> Está escrito para que forme su propio criterio, no para que confirme el mío.

---

Sos un segundo agente al que se convoca para dar una opinión **independiente**
sobre cómo continuar un trabajo de tesis. Otro agente (Claude) ejecutó las
etapas 4, 5 y 6 antes que vos y llegó a un resultado experimental negativo.
Francisco quiere una segunda lectura antes de decidir el próximo paso.

## Lo que se te pide

1. **Analizar la situación por tu cuenta**, a partir de la evidencia versionada.
2. **Decidir cómo continuar** y justificarlo.

## Regla de independencia (importante)

Existe un informe del agente anterior en
[`execution-report-2026-07-24.md`](execution-report-2026-07-24.md). Sus secciones
1–4 son hechos verificables; la **5 son sus inferencias** y la **6 su
recomendación**.

**No leas las secciones 5 y 6 hasta haber escrito tu propia evaluación.** No es
una formalidad: una vez que leés una interpretación plausible es muy difícil no
anclarte en ella, y el objetivo de convocarte es justamente tener una lectura que
no derive de la suya. El orden que se te pide es:

1. Leé este briefing y las secciones **1–4** del informe.
2. Investigá la evidencia primaria por tu cuenta (abajo te digo dónde está).
3. **Escribí tu diagnóstico y tu plan.**
4. Recién entonces leé las secciones 5 y 6, y decí explícitamente en qué
   coincidís, en qué no, y qué te parece que el agente anterior pasó por alto o
   sobre-interpretó.

Su recomendación **no es una línea de base ni una propuesta a mejorar**. Es una
hipótesis entre otras. Si tu conclusión es que el plan correcto es distinto ---o
que no hay que implementar nada--- eso es una respuesta perfectamente válida y
es preferible a un acuerdo de cortesía.

---

## Contexto factual mínimo

**ManyHands** es un orquestador de agentes de código: toma un objetivo de
software, lo descompone en un grafo de unidades, ejecuta cada una en un worktree
de Git aislado, valida cada resultado sobre el commit exacto, integra de abajo
hacia arriba y entrega el árbol verificado. Está en TypeScript, monorepo pnpm.

Su **aporte de tesis** es una política de descomposición adaptativa: un índice
$C_{task}$ pondera cuatro señales (radio de alcance, impacto en interfaces,
superficie de validación, masa de contexto en tokens) y decide si una unidad se
mantiene como hoja o se descompone. Umbral 3,5; pesos 0,30 / 0,25 / 0,25 / 0,20.

### Qué se ejecutó

- **G4 (estabilidad):** PASS. Dos ejecuciones válidas consecutivas del mismo
  objetivo sobre un único commit, ambas verificadas en clon limpio. Produjeron
  **topologías distintas** entre sí.
- **G5 (experimento comparativo):** ejecutado. Diseño pre-registrado de
  2 tareas × 3 condiciones × 2 repeticiones = 12 runs.
  - **A** = se prohíbe descomponer · **B** = división fina fija ·
    **C** = política adaptativa productiva.
  - **T1** = tarea multi-capa (dominio + API + web + tests) ·
    **T2** = regla de negocio acotada al dominio.
- **G6:** tesis (43 páginas) y presentación (24 slides) compiladas sin
  advertencias, con la evidencia incorporada.

### Resultados de G5 — 10 entregas de 12

| Tarea | Cond. | Entregas | Reloj (s) | Tokens |
|---|---|---|---|---|
| T1 | A | **2/2** | 259, 357 | 21 794, 24 898 |
| T1 | B | 1/2 | 942, 1209 | 111 663, 101 120 |
| T1 | C | 1/2 | 810, 1109 | 104 361, 96 316 |
| T2 | A | 2/2 | 282, 291 | 29 546, 28 385 |
| T2 | B | 2/2 | 362, 393 | 52 499, 28 270 |
| T2 | C | 2/2 | 344, 351 | 32 096, 26 299 |

**La hipótesis pre-registrada quedó falsada.** Era que C se comportaría como A
en T2 y **no peor que B en T1**. En T2 se sostuvo: las tres condiciones
produjeron una sola unidad, incluida B, que está diseñada para dividir siempre.
En T1 no: A entregó ambas repeticiones, más rápido y más barato.

Se comparó la superficie pública entregada por A y por C en T1: ambas exportan
el mismo conjunto de funciones y tipos. La diferencia observada fue la densidad
de pruebas (3 casos contra 6).

### Dos hechos que conviene que verifiques vos

1. **El repositorio objetivo tiene 215 líneas en 4 archivos.**
2. **Los criterios de aceptación se compilan por unidad**, de modo que en T1 la
   condición A se evaluó contra 5 criterios y las condiciones B y C contra 14.
   Las 12 celdas registraron cobertura 1,00.

No te digo qué concluir de esto. Miralo vos.

---

## Dónde está la evidencia primaria

Todo está versionado en el repositorio, en `docs/tesis/evidence/`:

| Ruta | Contenido |
|---|---|
| `experiment/protocol.md` | Diseño pre-registrado, hipótesis, falsador, criterios de interpretación y **enmiendas declaradas** |
| `experiment/runs/<celda>/` | Por celda: journal de eventos completo, snapshot, métricas de granularidad, diff entregado y resultado |
| `experiment/raw-results.csv` | Datos crudos por run, **derivados automáticamente** |
| `experiment/results.md`, `results.svg` | Tablas y figura, también derivadas |
| `experiment/discarded-attempt-1/` | Un intento completo descartado, con su motivo |
| `gates/g4-gate-results.md`, `gates/g5-gate-results.md` | Resultados de gate |
| `canonical-run/defects/` | Defectos hallados ejecutando, con journal y análisis |
| `progress-log.md` | Cronología completa, incluidos los runs descartados |
| `scripts/` | Drivers reproducibles: `run-experiment.mjs`, `generate-cells.mjs`, `run-g5.mjs`, `derive-metrics.mjs` |

La tesis está en `docs/tesis/main.tex`; la matriz de claims, en
`docs/tesis/claim-evidence-matrix.md`.

### Código relevante

| Qué | Dónde |
|---|---|
| Política adaptativa y validación de señales | `packages/decomposer/src/granularity/adaptive-planning.ts` |
| Fórmula, pesos y umbral | `packages/decomposer/src/granularity/complexity-evaluator.ts` |
| Condiciones A/B/C como configuración por run | `packages/decomposer/src/granularity/policy.ts` |
| Compilación de contratos (alcance, criterios) | `packages/decomposer/src/compiler/contract-compiler.ts` |
| Ejecución de nodos, validación, reparación | `packages/execution-core/src/v2/node-executor.ts` |
| Driver de ejecución y adopción de artefactos | `packages/orchestrator-graph/src/v2/execution-driver.ts` |

### Comandos útiles

Re-derivar todas las tablas desde los journals ---sirve para comprobar que
ninguna cifra reportada fue transcrita a mano:

```bash
node docs/tesis/evidence/scripts/derive-metrics.mjs --runs docs/tesis/evidence/experiment/runs --out /tmp/check
```

Suite completa:

```bash
pnpm test
```

---

## Trampas operativas (hechos, no opiniones)

Estas costaron tiempo real. Te las paso para que no las repitas:

1. **El servidor de desarrollo resuelve `@manyhands/*` desde los paquetes
   compilados (`dist/`), no desde las fuentes.** Si modificás un paquete y
   lanzás un run sin `pnpm build` previo, el run ejercita el código **anterior**.
   Los tests pasan igual, así que el fallo es silencioso. Verificalo con
   `grep -c <símbolo-nuevo> packages/<pkg>/dist/index.js`.
2. **Cada run consume varios GB** entre pools de worktrees e instalaciones. Al
   momento de escribir esto quedaban **~3 GB libres**. Un disco lleno se
   manifiesta como agentes que expiran, lo que parece un fallo del orquestador y
   no lo es.
3. **No toques los directorios de salida mientras un driver está corriendo.**
4. Un run dura entre 5 y 20 minutos. Las 12 celdas de G5, alrededor de una hora.
5. El ejecutor es Codex CLI 0.141.0 con modelo `gpt-5.5` (es el único que admite
   la cuenta disponible).

---

## Restricciones que siguen vigentes

- **No hacer push.** Hay 38 commits locales sin publicar.
- Commits locales chicos y coherentes; TDD para todo cambio conductual
  (regresión roja que falle por la causa correcta, antes del fix).
- No presentar fixtures, mocks ni capturas como evidencia de un camino
  productivo real.
- No inventar datos ni extrapolar resultados inexistentes.
- Si un defecto obliga a modificar ManyHands durante el experimento, el protocolo
  (§6) exige **reiniciarlo por completo**; no se mezclan runs de versiones
  distintas.
- `docs/UNI (NO LEER)/` está fuera de alcance.

---

## La pregunta concreta

Francisco preguntó, textualmente, si el camino es **(a)** trabajo de
implementación para que futuras ejecuciones de G5 funcionen y las hipótesis se
puedan probar mejor, **(b)** que el sistema ya funciona bien y las hipótesis
están mal planteadas, o **(c)** que los resultados simplemente dieron mal.

Respondé eso con tu propio análisis, y después proponé un plan. Cosas que
ayudarían a que tu respuesta sea útil:

- Distinguí explícitamente **hecho observado**, **inferencia tuya** y
  **recomendación**.
- Si proponés implementación, ordenala por impacto y decí **qué evidencia
  existente sostiene** que cada pieza es necesaria.
- Decí también qué **no** haría falta hacer, y qué riesgos ves en seguir
  iterando sobre el experimento.
- Es válido concluir que hay que parar, reportar el resultado negativo como está
  y defender la tesis con eso.

Cuando termines, comparalo con las secciones 5 y 6 del informe del agente
anterior y señalá las diferencias. Esa comparación es la mitad del valor de que
te hayan convocado.
