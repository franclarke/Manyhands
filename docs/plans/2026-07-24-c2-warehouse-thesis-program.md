# C2 and Warehouse Longitudinal Thesis Program Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rediseñar la política adaptativa como C2, estabilizarla mediante una construcción piloto de Warehouse Control Tower y producir evidencia final con una reconstrucción limpia y una comparación controlada sobre una versión congelada de ManyHands.

**Architecture:** El Planner conserva la responsabilidad de proponer un árbol semántico; C2 evalúa de forma determinista estrategias posibles sobre ese mismo árbol y elige una frontera ejecutable sin inventar cortes por rutas. El programa experimental separa desarrollo, freeze y evidencia: un Warehouse piloto permite corregir ManyHands; luego una versión congelada reconstruye Warehouse desde el mismo seed técnico y se evalúa con oráculos externos idénticos entre condiciones.

**Tech Stack:** TypeScript, Zod, pnpm monorepo, Vitest, event log de ManyHands, Node.js, React, Vite, SVG, Server-Sent Events, Playwright, Git worktrees y scripts reproducibles en Node.js.

---

## 1. Decisión ejecutiva

Sí conviene construir Warehouse de manera incremental con ManyHands, pero no como una única construcción que mezcle versiones del orquestador.

El programa tendrá dos construcciones separadas:

1. **Warehouse Pilot:** banco de desarrollo de C2. Se permiten cambios en ManyHands, prompts, métricas y protocolo. Sus resultados son formativos y nunca se mezclan con la evidencia final.
2. **Warehouse Final:** reconstrucción desde el mismo seed técnico con una única versión congelada de ManyHands, C2, prompts, modelo, toolchain y oráculos. Esta construcción y el estudio controlado asociado son la evidencia principal de la tesis.

El resultado científico que se busca no es “demostrar que C2 siempre gana”. La pregunta final será:

> ¿En qué condiciones una política adaptativa basada en utilidad selecciona una granularidad que preserva entrega verificada y evita costos innecesarios de coordinación durante la construcción incremental de un sistema no trivial?

Una respuesta final negativa seguirá siendo publicable si el sistema, protocolo y medición funcionaron correctamente. “Resultado final” significa resultado obtenido con sistema congelado y medición válida, no resultado necesariamente favorable.

## 2. Hechos de partida que gobiernan el plan

- El G5 vigente usó un repositorio objetivo de 215 líneas y cuatro archivos; es insuficiente para observar cuándo la presión de contexto o el paralelismo compensan la coordinación.
- En T1, A fue más rápida, barata y entregó 2/2; B y C entregaron 1/2. Ese resultado no se borra ni se reetiqueta como éxito.
- La política actual decide con `C_task`, cuyos insumos son mayormente estimaciones del Planner y cuyo único clamp estructural fuerte es el alcance por paths.
- La política actual sólo puede conservar, colapsar o reconfigurar el árbol semántico que recibió. Ante un corte semántico ausente o unario, no puede producir una división coherente.
- A compiló cinco criterios y B/C catorce para la misma tarea T1. La cantidad de obligaciones internas cambia con la topología y contaminó la comparación de costo.
- La ruta productiva usa `dist/`; toda prueba de ejecución posterior a un cambio de paquete debe hacer `pnpm build` y verificar el símbolo nuevo en el artefacto compilado.
- Los runs consumen varios GB. No se inicia el piloto ni el estudio final con el espacio libre actual sin ampliar o reubicar el pool.

El G5 existente quedará en la tesis como **estudio piloto que motivó el rediseño**, no como tabla principal de resultados de C2. Ocultarlo sería metodológicamente incorrecto; presentarlo como resultado final de C2 también lo sería.

## 3. Alcance y criterios de éxito

### Incluido

- C2 como selector determinista de estrategias sobre un árbol semántico.
- Señales estructurales medidas desde `RepositorySnapshot` cuando existan.
- Replan semántico explícito cuando no exista un corte viable; nunca partición artificial por paths.
- Asignación no duplicada de criterios de aceptación a la frontera elegida.
- Evidencia de decisión persistida, replayable y visible en la UI.
- Seed técnico reproducible de Warehouse sin código de dominio.
- Ocho incrementos funcionales de Warehouse y oráculos externos por incremento.
- Construcción piloto, freeze, reconstrucción final y comparación A/B/C2.
- Derivación automática de métricas, figuras, tesis y presentación final.

### Excluido

- Ajustar C2 hasta que “gane” sobre los resultados finales.
- Forzar divisiones para justificar el uso de múltiples agentes.
- Microservicios, cloud, autenticación, multitenancy o despliegue productivo de Warehouse.
- Presentar screenshots, fixtures o mocks como prueba funcional.
- Reescribir el Planner o el Graph Compiler completos.
- Borrar o sobrescribir la evidencia histórica de G4/G5.
- Inferencia estadística de población a partir de un estudio exploratorio pequeño.

### Definición de terminado

- C2 satisface invariantes unitarios y verticales, emite explicación completa y no fabrica cortes.
- Dos runs de estabilidad sobre el mismo commit de ManyHands terminan y se verifican en clones limpios.
- El piloto completa los ocho incrementos o identifica y corrige todas las clases de defecto que impidan hacerlo.
- Existe un commit/tag de freeze con suites, typechecks y builds verdes.
- Warehouse Final se reconstruye desde el seed con el freeze sin cambiar ManyHands durante la serie.
- Cada incremento final pasa su oráculo externo en un clon limpio del commit entregado.
- La comparación controlada A/B/C2 usa las mismas bases, objetivos, árboles candidatos por bloque, oráculos y modelo.
- Todas las tablas se regeneran desde journals y manifiestos; no hay cifras transcritas a mano.
- `docs/tesis/main.tex`, la matriz de claims y la presentación sólo sostienen afirmaciones respaldadas por la evidencia final.

## 4. Diseño conceptual de C2

### 4.1 Responsabilidades

```text
RepositorySnapshot + objetivo + aceptación
                    |
                    v
Planner semántico produce árbol candidato y relaciones justificadas
                    |
                    v
C2 evalúa fronteras posibles del mismo árbol
  - A: raíz como hoja
  - B: frontera semántica válida más fina
  - C2: mejor utilidad esperada
                    |
                    v
WorkBreakdown seleccionado
                    |
                    v
Graph Compiler + contratos + ejecución + evidencia
```

El árbol candidato no es un segundo grafo de ejecución. Es la salida intermedia vigente del Planner. Sólo la frontera seleccionada llega al Graph Compiler.

### 4.2 Alternativas evaluadas por nodo

Para cada composite semántico, C2 compara:

- **Leaf:** ejecutar el objetivo del nodo como una unidad cohesiva.
- **Split:** ejecutar una combinación de estrategias elegidas recursivamente para sus hijos.
- **Semantic replan:** si Leaf es inviable y no hay al menos dos hijos semánticos válidos, pedir al Planner un corte mejor con una crítica estructurada.

La selección se calcula bottom-up mediante programación dinámica. Esto permite, por ejemplo, conservar `domain` como una hoja y expandir solamente `web-realtime`, en lugar de aceptar o rechazar todo el árbol con un único umbral global.

### 4.3 Rasgos normalizados en `[0, 1]`

Beneficios de dividir:

- `contextRelief`: reducción del mayor contexto estimado entre hijos respecto de la hoja padre.
- `parallelism`: ancho ejecutable del DAG candidato después de relaciones de artefactos.
- `faultIsolation`: proporción de resultados y criterios que pueden verificarse sin involucrar siblings.

Costos de dividir:

- `coordination`: densidad de `CandidateArtifact` y `CandidateSeam` entre unidades.
- `pathOverlap`: Jaccard promedio entre scopes de siblings.
- `validationDuplication`: criterios asignados a más de una unidad antes de normalizar ownership.
- `uncertainty`: proporción de paths nuevos o sin tamaño, evidencia de baja confianza y relaciones no justificadas.

La primera fórmula piloto será deliberadamente simple:

```text
benefit = mean(contextRelief, parallelism, faultIsolation)
cost    = mean(coordination, pathOverlap, validationDuplication, uncertainty)
splitAdvantage = benefit - cost
```

Una hoja viable se divide sólo si `splitAdvantage >= minimumAdvantage`. El valor inicial de piloto será `0.15`; podrá cambiar durante el piloto con justificación versionada. Después del freeze ningún peso, normalizador o margen cambia.

La viabilidad de hoja es una restricción separada, no otro término escondido:

- snapshot disponible o incertidumbre explícita;
- contexto estimado dentro del presupuesto efectivo versionado del executor;
- scope representable por contratos honestos;
- aceptación verificable en una sola unidad.

### 4.4 Contrato de salida

```ts
export const ADAPTIVE_UTILITY_POLICY_VERSION = "adaptive-utility/2.0.0-pilot";

export interface GranularityStrategyAssessment {
  unitKey: string;
  candidateTreeHash: string;
  selected: "leaf" | "split" | "semantic_replan";
  leafFeasible: boolean;
  features: {
    contextRelief: number;
    parallelism: number;
    faultIsolation: number;
    coordination: number;
    pathOverlap: number;
    validationDuplication: number;
    uncertainty: number;
  };
  benefit: number;
  cost: number;
  splitAdvantage: number;
  minimumAdvantage: number;
  evidenceRefs: string[];
  rationale: string;
}
```

El resultado debe incluir el hash del árbol candidato, configuración efectiva, estimator version, frontera seleccionada y razones de descarte de alternativas.

## 5. Diseño de Warehouse Control Tower

### 5.1 Seed técnico

Warehouse no comienza con un directorio literalmente vacío porque ManyHands necesita un repositorio válido y comandos verificables. El seed contiene únicamente:

```text
warehouse-control-tower/
  .gitignore
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  apps/
  packages/
  tests/
```

`README.md` sólo explica comandos y alcance del seed. No contiene arquitectura de dominio, componentes, endpoints, tipos de Warehouse ni soluciones anticipadas.

Se crean tres clones a partir del mismo seed commit:

- `warehouse-control-tower-pilot`
- `warehouse-control-tower-final`
- clones temporales por celda controlada

### 5.2 Arquitectura objetivo del sistema construido

```text
apps/web                 React + Vite + SVG control tower
apps/api                 Node HTTP + Server-Sent Events
packages/domain          bins, inventory, orders, reservations
packages/simulation      clock, events, deterministic scenarios
packages/routing         pick paths, waves, congestion costs
packages/persistence     append-only event log + snapshots
packages/contracts       shared API/event schemas
tests/integration        cross-package and API checks
tests/e2e                browser user journeys
```

No se fija esta estructura como solución obligatoria en los prompts. Es el diseño de referencia para construir oráculos y evaluar si el resultado entregado cubre las capacidades; ManyHands puede elegir nombres o boundaries equivalentes mientras respete interfaces observables.

### 5.3 Experiencia visual final

- plano SVG del depósito con zonas, pasillos y bins;
- heatmap de ocupación y stock crítico;
- flujo de órdenes por estado;
- rutas de picking superpuestas al plano;
- timeline reproducible de eventos;
- alertas de stock, bloqueo y congestión;
- controles de play, pause, step y reset con seed determinista;
- estados accesibles que no dependan sólo de color y respeten `prefers-reduced-motion`.

Las capturas y un posible video de demo sólo ilustran un commit ya verificado. El oráculo funcional inspecciona estado, API, eventos, DOM accesible y determinismo.

### 5.4 Incrementos

| Incremento | Objetivo observable | Presión de granularidad esperada, no obligatoria |
|---|---|---|
| W0 | Seed técnico instalable, build y test vacíos verdes | Fuera de ManyHands; precondición |
| W1 | Modelo de layout, bins e inventario con escenario determinista | Hoja probable |
| W2 | Primer control tower visual que renderiza mapa y heatmap | Hoja o corte vertical pequeño |
| W3 | Ingreso de órdenes, reserva de stock y estados visibles | Corte domain/web posible |
| W4 | API + stream SSE + simulación con play/pause/step/reset | Varias interfaces y paralelismo |
| W5 | Cálculo y visualización de rutas de picking | Routing, dominio, UI y tests |
| W6 | Waves, capacidad de pickers y congestión | División semántica esperable |
| W7 | Persistencia, replay temporal y analytics operativos | Integración multi-paquete |
| W8 | Hardening E2E, accesibilidad, errores y documentación | Frontera de validación amplia |

Cada incremento tiene un prompt, criterios externos, seed de simulación y límite de scope versionados antes del freeze.

## 6. Diseño experimental final

### 6.1 Dos líneas de evidencia

**Línea longitudinal productiva:** ocho runs C2 consecutivos construyen Warehouse Final. Cada run usa el commit entregado anterior como base. Mide cómo cambian tamaño del repositorio, estrategia elegida, topología, costo, reparaciones y entrega.

**Línea controlada de política:** tres tareas representativas se ejecutan desde checkpoints congelados bajo A, B y C2. Su objetivo es aislar la decisión de granularidad, no demostrar por sí sola el camino productivo completo.

### 6.2 Bloqueo del árbol candidato

La variación del Planner puede dominar la comparación de políticas. Por cada tarea y repetición se genera en vivo un `WorkBreakdown` candidato neutral, se persiste con hash y se usa como bloque común para A, B y C2.

- La generación del candidato es real y queda trazada.
- La ejecución, validación, integración y entrega de cada condición son reales.
- El replay del candidato se declara como control experimental de componente; no se presenta como prueba de que la planificación productiva sea determinista.
- La línea longitudinal, sin replay, aporta la evidencia del camino productivo end-to-end.

### 6.3 Matriz controlada

- Tareas: `S` pequeña, `M` mediana, `L` grande.
- Condiciones: A, B, C2.
- Repeticiones/bloques: 3.
- Total: `3 × 3 × 3 = 27` runs.
- Orden de condiciones: aleatorizado con seed preregistrado dentro de cada bloque.
- Modelo, executor, reasoning effort, paralelismo y toolchain: constantes.
- Base commit, prompt, restricciones y oráculo: idénticos dentro de cada tarea.

No se harán tests de significancia con `n=3`. Se reportarán valores individuales, mediana, rango, tasas y patrones por tarea.

### 6.4 Variables

Primarias:

- entrega verificada por oráculo externo (`0/1`);
- tiempo hasta entrega o fallo terminal;
- tokens totales, incluidos intentos fallidos;
- costo reportado o `unavailable`, nunca cero inventado.

Secundarias:

- número de hojas, profundidad y ancho máximo;
- estrategia C2 y `splitAdvantage` por unidad;
- context relief, seams, solapamiento e incertidumbre;
- reparaciones, reintentos, conflictos e integraciones;
- cantidad de criterios únicos y validaciones internas ejecutadas;
- divergencia entre topología propuesta y seleccionada.

### 6.5 Hipótesis exploratorias preregistradas después del piloto

- H1: C2 conserva una hoja en S salvo que la hoja sea inviable.
- H2: C2 selecciona más de una hoja en al menos una de M/L cuando existe alivio de contexto y paralelismo con bajo solapamiento.
- H3: C2 reduce costo o tiempo respecto de B sin menor entrega verificada.
- H4: C2 no es uniformemente peor que A en M/L; si lo es, la política no aporta valor en este entorno.

El falsador se fija antes de iniciar Warehouse Final. No se reescribe después de ver los datos.

## 7. Gates y reglas de invalidez

| Gate | Cierra cuando |
|---|---|
| C2-G0 | diseño, variables, seed e invariantes aprobados |
| C2-G1 | selector puro y señales medidas pasan tests |
| C2-G2 | ruta productiva, eventos, replay y UI pasan vertical tests |
| C2-G3 | ownership de aceptación y métricas no censuradas pasan tests |
| WH-G0 | seed, prompts y oráculos de W1-W8 están versionados |
| WH-G1 | piloto W1-W8 completo; defectos bloqueantes cerrados |
| FREEZE | suites, typechecks, builds, dos runs de estabilidad y manifiesto verdes |
| WH-G2 | reconstrucción final W1-W8 completa sin cambios de ManyHands |
| EXP-G1 | 27 celdas ejecutadas o falladas con evidencia completa |
| THESIS | tablas derivadas, claims auditados, PDF y slides compilados |

Una serie final queda inválida y debe reiniciarse desde W0 si cambia cualquiera de estos elementos después del primer run:

- código, `dist/` o configuración efectiva de ManyHands;
- versión o parámetros de C2;
- prompts W1-W8;
- seed repo;
- criterios u oráculos;
- executor, modelo o reasoning effort;
- lógica del driver o derivación que afecte qué se ejecuta o mide.

Un fallo transitorio previsto no invalida automáticamente la serie si el protocolo ya fijó su tratamiento y se preserva toda la evidencia. Un defecto de ManyHands que requiere código nuevo sí obliga a volver al piloto y reiniciar la serie final completa.

## 8. Plan de implementación por tareas

### Task 1: Registrar el nuevo diseño y preservar la interpretación histórica

**Files:**
- Create: `docs/adr/0012-utility-based-granularity-selection.md`
- Create: `docs/tesis/evidence/warehouse/README.md`
- Create: `docs/tesis/evidence/warehouse/pilot/README.md`
- Create: `docs/tesis/evidence/warehouse/final/README.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/design/03-adaptive-decomposer.md`
- Modify: `docs/tesis/claim-evidence-matrix.md`

**Step 1: Escribir la ADR**

Documentar alternativas descartadas: mantener C1, subir/bajar umbral, forzar número mínimo de hojas y particionar paths. Fijar que el Planner propone semantics y C2 selecciona fronteras.

**Step 2: Marcar evidencia histórica sin alterarla**

Agregar un índice que enlace el G5 actual como `formative pilot / C1`, sin mover ni editar journals.

**Step 3: Verificar links y terminología**

Run:

```powershell
rg -n "C_task|C2|adaptive-utility|formative pilot" docs/DECISIONS.md docs/design/03-adaptive-decomposer.md docs/tesis
git diff --check
```

Expected: todas las referencias distinguen C1 de C2 y `git diff --check` no informa errores.

**Step 4: Commit**

```powershell
git add docs/adr/0012-utility-based-granularity-selection.md docs/DECISIONS.md docs/design/03-adaptive-decomposer.md docs/tesis
git commit -m "docs(thesis): define C2 warehouse study"
```

### Task 2: Agregar masa de contexto medible al índice

**Files:**
- Modify: `packages/repository-index/src/index.ts`
- Modify: `packages/repository-index/src/source-parser.ts`
- Modify: `packages/repository-index/src/fast-indexer.ts`
- Test: `tests/repository-index.test.ts`
- Test: `tests/repository-fast-indexer.test.ts`
- Test: `tests/repository-snapshot.test.ts`

**Step 1: Escribir tests rojos**

Agregar casos que exijan que cada archivo nuevo incluya, de forma determinista:

```ts
expect(index.files[0]).toMatchObject({
  byteSize: Buffer.byteLength(source, "utf8"),
  lineCount: 3
});
```

Agregar un fixture histórico sin esos campos y comprobar que el schema aún lo acepta para replay.

**Step 2: Ejecutar la regresión**

Run:

```powershell
pnpm vitest run tests/repository-index.test.ts tests/repository-fast-indexer.test.ts tests/repository-snapshot.test.ts
```

Expected: FAIL porque `byteSize` y `lineCount` no existen.

**Step 3: Implementar el mínimo**

Extender `RepositoryFileIndexSchema` con campos opcionales para compatibilidad histórica. Los indexers actuales siempre deben emitirlos. Calcular bytes UTF-8 y líneas desde el texto realmente indexado, no desde una segunda lectura.

```ts
byteSize: z.number().int().nonnegative().optional(),
lineCount: z.number().int().nonnegative().optional()
```

**Step 4: Verificar determinismo y hashes**

Run:

```powershell
pnpm vitest run tests/repository-index.test.ts tests/repository-fast-indexer.test.ts tests/repository-snapshot.test.ts
pnpm --filter @manyhands/repository-index typecheck
```

Expected: PASS; dos índices del mismo commit tienen el mismo hash.

**Step 5: Commit**

```powershell
git add packages/repository-index tests/repository-index.test.ts tests/repository-fast-indexer.test.ts tests/repository-snapshot.test.ts
git commit -m "feat(repository-index): record source size metrics"
```

### Task 3: Implementar el perfil estructural de una estrategia

**Files:**
- Create: `packages/decomposer/src/granularity/repository-context-profile.ts`
- Create: `tests/granularity-context-profile.test.ts`
- Modify: `packages/decomposer/src/index.ts`

**Step 1: Escribir tests rojos**

Cubrir existing paths, planned paths, snapshots parciales y scopes superpuestos. El estimator debe declarar su versión:

```ts
expect(profile.estimatorVersion).toBe("utf8-bytes-div-4/1.0.0");
expect(profile.measuredExistingTokens).toBe(Math.ceil(totalBytes / 4));
expect(profile.unmeasuredPlannedPathCount).toBe(2);
expect(profile.uncertainty).toBeGreaterThan(0);
```

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/granularity-context-profile.test.ts`

Expected: FAIL por módulo inexistente.

**Step 3: Implementar funciones puras**

El módulo recibe `WorkBreakdown`, `RepositorySnapshot` y un unit key. No lee filesystem ni llama al LLM. Usa `byteSize / 4` sólo como estimación versionada; paths nuevos aumentan incertidumbre en vez de recibir tamaño cero fingido.

**Step 4: Verificar**

Run:

```powershell
pnpm vitest run tests/granularity-context-profile.test.ts
pnpm --filter @manyhands/decomposer typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add packages/decomposer/src/granularity/repository-context-profile.ts packages/decomposer/src/index.ts tests/granularity-context-profile.test.ts
git commit -m "feat(decomposer): derive measured context profiles"
```

### Task 4: Implementar el selector bottom-up C2

**Files:**
- Create: `packages/decomposer/src/granularity/utility-policy.ts`
- Create: `packages/decomposer/src/granularity/strategy-selector.ts`
- Create: `tests/granularity-utility-policy.test.ts`
- Modify: `packages/decomposer/src/index.ts`

**Step 1: Escribir los tests de decisión**

Casos obligatorios:

1. tarea pequeña viable queda hoja;
2. dos hijos independientes con fuerte context relief se seleccionan;
3. siblings con los mismos paths y seams densos colapsan a hoja;
4. un composite unario nunca cuenta como split;
5. hoja inviable sin corte devuelve `semantic_replan`;
6. un árbol de dos niveles puede conservar un hijo y expandir otro;
7. A fuerza raíz única;
8. B elige la frontera semántica válida más fina;
9. C2 no crea unit keys ni paths ausentes del candidato;
10. input idéntico produce assessment y hash idénticos.

Ejemplo central:

```ts
const result = selectGranularityStrategy({
  condition: "C2",
  breakdown,
  repositorySnapshot,
  config: PILOT_UTILITY_POLICY
});

expect(result.selectedBreakdown.root.kind).toBe("composite");
expect(result.assessments.root.selected).toBe("split");
expect(result.assessments.root.splitAdvantage).toBeGreaterThanOrEqual(0.15);
```

**Step 2: Ejecutar rojo**

Run: `pnpm vitest run tests/granularity-utility-policy.test.ts`

Expected: FAIL por exports inexistentes.

**Step 3: Implementar tipos, normalizadores y scoring**

Mantener funciones puras y configuración inyectada. Rechazar números no finitos y clamp explícito a `[0, 1]`. No incluir métricas observadas después de ejecutar la tarea.

**Step 4: Implementar programación dinámica y remapeo**

Reutilizar las reglas vigentes de absorción de relaciones cuando una subtree queda hoja. El selector sólo conserva units existentes; no sintetiza `:part-N`.

**Step 5: Verificar**

Run:

```powershell
pnpm vitest run tests/granularity-utility-policy.test.ts tests/decomposer-adaptive-planning.test.ts tests/granularity-policy-conditions.test.ts
pnpm --filter @manyhands/decomposer typecheck
```

Expected: nuevos tests PASS; C1 histórico sigue parseable y sus tests no cambian de significado.

**Step 6: Commit**

```powershell
git add packages/decomposer/src/granularity packages/decomposer/src/index.ts tests/granularity-utility-policy.test.ts
git commit -m "feat(decomposer): select granularity by expected utility"
```

### Task 5: Solicitar replan semántico sin fabricar particiones

**Files:**
- Modify: `packages/decomposer/src/planner/work-breakdown.ts`
- Modify: `packages/decomposer/src/planner/prompt.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Test: `tests/decomposer-work-breakdown.test.ts`
- Test: `tests/planning-v2-adaptive.test.ts`

**Step 1: Escribir test rojo del feedback**

Simular un primer breakdown con hoja inviable y sin hijos; C2 debe devolver una crítica con razones medibles. El segundo request al Planner debe incluir esa crítica y aceptar un corte semántico de dos hijos.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/decomposer-work-breakdown.test.ts tests/planning-v2-adaptive.test.ts`

Expected: FAIL porque `granularityFeedback` no existe.

**Step 3: Extender el input de Planner**

Agregar un campo opcional versionado, incluido en el cache key:

```ts
granularityFeedback?: {
  unitKey: string;
  reason: "leaf_context_infeasible" | "missing_semantic_cut";
  evidence: string[];
};
```

El prompt pide un corte semántico, no un número de hijos ni una división por carpetas.

**Step 4: Integrar un único replan acotado**

`planning-host.ts` ejecuta C2 después del Planner. Si recibe `semantic_replan`, llama una vez más al Planner con feedback y vuelve a evaluar. Si persiste, falla planning explícitamente; no despacha una hoja que C2 declaró inviable.

**Step 5: Verificar**

Run:

```powershell
pnpm vitest run tests/decomposer-work-breakdown.test.ts tests/planning-v2-adaptive.test.ts tests/planning-v2-pipeline.test.ts
pnpm --filter @manyhands/decomposer typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
```

Expected: PASS; se observan dos planning attempts y ninguna unidad sintética.

**Step 6: Commit**

```powershell
git add packages/decomposer/src/planner apps/web/src/lib/server/runs/v2/planning-host.ts tests/decomposer-work-breakdown.test.ts tests/planning-v2-adaptive.test.ts
git commit -m "feat(planning): replan infeasible semantic cuts"
```

### Task 6: Evitar multiplicación topológica de criterios

**Files:**
- Create: `packages/decomposer/src/compiler/acceptance-allocation.ts`
- Modify: `packages/decomposer/src/compiler/contract-compiler.ts`
- Modify: `packages/decomposer/src/index.ts`
- Create: `tests/contract-acceptance-allocation.test.ts`
- Modify: `tests/planning-v2-pipeline.test.ts`

**Step 1: Escribir tests rojos**

Construir el mismo breakdown con cinco acceptance intents y fronteras A, B y C2. Exigir:

```ts
expect(uniqueIntentIds(conditionA.contracts)).toHaveLength(5);
expect(uniqueIntentIds(conditionB.contracts)).toHaveLength(5);
expect(uniqueIntentIds(conditionC2.contracts)).toHaveLength(5);
expect(duplicateIntentIds(conditionB.contracts)).toEqual([]);
```

Además, un criterio referenciado por dos siblings debe pertenecer a su lowest common ancestor; uno exclusivo de una hoja debe quedarse en esa hoja.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/contract-acceptance-allocation.test.ts`

Expected: FAIL mostrando duplicación en la frontera dividida.

**Step 3: Implementar ownership determinista**

Después de seleccionar la frontera y antes de compilar contratos:

1. recolectar unidades seleccionadas que referencian cada intent;
2. asignarlo a su lowest common ancestor;
3. compilarlo una sola vez;
4. emitir trace `intentId -> ownerUnitKey`;
5. mantener checks técnicos locales separados de los criterios de usuario.

**Step 4: Verificar**

Run:

```powershell
pnpm vitest run tests/contract-acceptance-allocation.test.ts tests/planning-v2-pipeline.test.ts
pnpm --filter @manyhands/decomposer typecheck
```

Expected: PASS; cinco intents producen cinco obligaciones de usuario en todas las condiciones.

**Step 5: Commit**

```powershell
git add packages/decomposer/src/compiler packages/decomposer/src/index.ts tests/contract-acceptance-allocation.test.ts tests/planning-v2-pipeline.test.ts
git commit -m "fix(contracts): allocate acceptance criteria once"
```

### Task 7: Persistir C2 como hecho de dominio y proyectarlo

**Files:**
- Modify: `packages/run-coordinator/src/domain/events.ts`
- Modify: `packages/run-coordinator/src/reducer.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Modify: `apps/web/src/lib/run-model/presentation.ts`
- Test: `tests/run-granularity-assessed.test.ts`
- Test: `tests/run-events-replay.test.ts`
- Test: `tests/run-model-presentation.test.ts`
- Test: `tests/cockpit-granularity-explanation.test.ts`

**Step 1: Escribir tests rojos de schema y replay**

Agregar `planning.granularity_strategy_selected` sin cambiar la forma del evento C1 histórico. Comprobar round-trip de configuración, alternativas, features, selección y candidate hash.

**Step 2: Verificar rojo**

Run:

```powershell
pnpm vitest run tests/run-granularity-assessed.test.ts tests/run-events-replay.test.ts tests/run-model-presentation.test.ts
```

Expected: FAIL por tipo de evento desconocido.

**Step 3: Agregar evento y reducer**

El evento nuevo es append-only y versionado. `planning.granularity_assessed` queda intacto para C1. El reducer conserva la última selección C2 y la UI la deriva sólo desde eventos.

**Step 4: Exponer explicación útil**

Mostrar en inspector:

- estrategia elegida;
- beneficio, costo y margen;
- dos rasgos más influyentes;
- advertencias de incertidumbre;
- enlace a detalles completos.

No agregar auto-focus ni `fitView`.

**Step 5: Verificar**

Run:

```powershell
pnpm vitest run tests/run-granularity-assessed.test.ts tests/run-events-replay.test.ts tests/run-model-presentation.test.ts tests/cockpit-granularity-explanation.test.ts
pnpm --filter @manyhands/web exec tsc --noEmit
```

Expected: PASS y replay C1/C2 compatible.

**Step 6: Commit**

```powershell
git add packages/run-coordinator apps/web/src/lib tests/run-granularity-assessed.test.ts tests/run-events-replay.test.ts tests/run-model-presentation.test.ts tests/cockpit-granularity-explanation.test.ts
git commit -m "feat(runs): persist C2 strategy decisions"
```

### Task 8: Integrar A/B/C2 y el árbol candidato bloqueado

**Files:**
- Modify: `packages/decomposer/src/granularity/policy.ts`
- Modify: `apps/web/src/lib/server/runs/v2/planning-host.ts`
- Modify: `apps/web/src/lib/server/runs/v2/run-coordinator-host.ts`
- Modify: `apps/web/src/lib/server/runs/schema.ts`
- Modify: `apps/web/src/app/api/runs/route.ts`
- Create: `tests/planning-candidate-replay.test.ts`
- Modify: `tests/granularity-policy-conditions.test.ts`
- Modify: `tests/run-record-schema.test.ts`

**Step 1: Escribir tests rojos**

Exigir condiciones explícitas `A`, `B`, `C1`, `C2`; default productivo `C2`; y un input experimental `candidateBreakdown` con hash que debe coincidir con snapshot, goal y aceptación.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/granularity-policy-conditions.test.ts tests/planning-candidate-replay.test.ts tests/run-record-schema.test.ts`

Expected: FAIL porque C2 y candidate replay no existen.

**Step 3: Implementar configuración efectiva**

- `C1` conserva `c-task/1.0.0` para replay histórico.
- `C2` es default nuevo.
- A y B usan el selector nuevo sobre el mismo árbol candidato.
- candidate replay sólo se habilita mediante configuración experimental explícita y persiste source hash.
- Validar que un candidato de otro snapshot, objetivo o aceptación sea rechazado.

**Step 4: Verificar**

Run:

```powershell
pnpm vitest run tests/granularity-policy-conditions.test.ts tests/planning-candidate-replay.test.ts tests/run-record-schema.test.ts tests/planning-v2-adaptive.test.ts
pnpm --filter @manyhands/web exec tsc --noEmit
```

Expected: PASS; ninguna condición requiere editar código entre runs.

**Step 5: Commit**

```powershell
git add packages/decomposer/src/granularity/policy.ts apps/web/src/lib/server/runs apps/web/src/app/api/runs/route.ts tests/granularity-policy-conditions.test.ts tests/planning-candidate-replay.test.ts tests/run-record-schema.test.ts tests/planning-v2-adaptive.test.ts
git commit -m "feat(experiment): control C2 policy per run"
```

### Task 9: Hacer completa y no censurada la derivación de métricas

**Files:**
- Create: `docs/tesis/evidence/scripts/derive-warehouse-metrics.mjs`
- Create: `docs/tesis/evidence/scripts/lib/study-metrics.mjs`
- Create: `tests/fixtures/thesis-metrics/failed-after-usage.events.jsonl`
- Create: `tests/fixtures/thesis-metrics/completed-c2.events.jsonl`
- Create: `tests/thesis-study-metrics.test.ts`
- Modify: `docs/tesis/evidence/scripts/derive-metrics.mjs`

**Step 1: Escribir tests rojos con un run fallido**

Exigir que tokens y tiempo de intentos fallidos se conserven, que delivery sea `0`, y que external-oracle coverage sea `NA` si el commit nunca se entregó.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/thesis-study-metrics.test.ts`

Expected: FAIL porque no existe el derivador nuevo.

**Step 3: Extraer un lector compartido**

No duplicar parsing de journals. El lector debe distinguir `0`, `unavailable` y `not_applicable`.

**Step 4: Emitir datos tidy**

Una fila por run y una fila por assessment. Salidas:

- `runs.csv`
- `strategy-assessments.csv`
- `longitudinal-results.md`
- `comparison-results.md`
- SVGs derivados

**Step 5: Verificar**

Run:

```powershell
pnpm vitest run tests/thesis-study-metrics.test.ts
node docs/tesis/evidence/scripts/derive-metrics.mjs --runs docs/tesis/evidence/experiment/runs --out $env:TEMP\manyhands-old-g5-check
```

Expected: nuevos fixtures PASS; la rederivación histórica sigue funcionando.

**Step 6: Commit**

```powershell
git add docs/tesis/evidence/scripts tests/fixtures/thesis-metrics tests/thesis-study-metrics.test.ts
git commit -m "feat(thesis): derive uncensored C2 study metrics"
```

### Task 10: Cerrar C2-G2 con gates amplios y runs de estabilidad

**Files:**
- Create: `docs/tesis/evidence/gates/c2-g1-results.md`
- Create: `docs/tesis/evidence/gates/c2-g2-results.md`
- Create: `docs/tesis/evidence/c2-stability/README.md`
- Modify: `docs/tesis/evidence/progress-log.md`

**Step 1: Ejecutar checks enfocados**

```powershell
pnpm vitest run tests/granularity-context-profile.test.ts tests/granularity-utility-policy.test.ts tests/contract-acceptance-allocation.test.ts tests/planning-candidate-replay.test.ts tests/planning-v2-adaptive.test.ts tests/run-granularity-assessed.test.ts
```

Expected: PASS.

**Step 2: Ejecutar gates amplios**

```powershell
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

Expected: todos PASS sobre el mismo commit.

**Step 3: Verificar que dev usa C2 compilado**

```powershell
Select-String -Path packages/decomposer/dist/index.js -Pattern "adaptive-utility/2.0.0-pilot"
```

Expected: al menos una coincidencia.

**Step 4: Ejecutar dos runs válidos sobre el mismo objetivo y commit**

Usar un target mediano separado de Warehouse Final. Ambos deben entregar, validar en clon limpio y persistir C2 completo. Topologías pueden variar; la explicación y el oráculo deben ser completos.

**Step 5: Commit de evidencia**

```powershell
git add docs/tesis/evidence/gates docs/tesis/evidence/c2-stability docs/tesis/evidence/progress-log.md
git commit -m "test(thesis): record C2 stability gate"
```

### Task 11: Crear seed, prompts y oráculos de Warehouse

**Files:**
- Create: `docs/tesis/evidence/warehouse/protocol/longitudinal-protocol.md`
- Create: `docs/tesis/evidence/warehouse/protocol/comparison-protocol.md`
- Create: `docs/tesis/evidence/warehouse/protocol/prompts/W1.md` through `W8.md`
- Create: `docs/tesis/evidence/warehouse/oracles/W1/` through `W8/`
- Create: `docs/tesis/evidence/warehouse/seed/README.md`
- Create: `docs/tesis/evidence/warehouse/seed/seed-manifest.json`
- Create: `docs/tesis/evidence/scripts/prepare-warehouse-repos.mjs`
- Create: `tests/warehouse-study-assets.test.ts`

**Step 1: Escribir el test de integridad**

Validar que cada prompt tiene goal, acceptance, constraints y oracle id; que cada oracle tiene comando, timeout y hash; que W1-W8 forman una cadena; y que el seed manifest no contiene código de dominio.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/warehouse-study-assets.test.ts`

Expected: FAIL por assets inexistentes.

**Step 3: Crear el seed repo técnico**

Directorio recomendado fuera de ManyHands:

```text
C:\Users\franc\Documents\Proyectos\warehouse-control-tower-seed
```

Inicializar Git, fijar Node/pnpm, instalar y demostrar build/test verdes. Registrar commit, tree hash y lockfile hash en `seed-manifest.json`.

**Step 4: Escribir W1-W8 y oráculos externos**

Los oráculos viven fuera del target entregado y se aplican después del run sobre un clon limpio. Cada uno prueba observables, no nombres internos.

**Step 5: Verificar assets**

Run:

```powershell
pnpm vitest run tests/warehouse-study-assets.test.ts
node docs/tesis/evidence/scripts/prepare-warehouse-repos.mjs --verify-only
```

Expected: PASS y hashes coincidentes.

**Step 6: Commit**

```powershell
git add docs/tesis/evidence/warehouse docs/tesis/evidence/scripts/prepare-warehouse-repos.mjs tests/warehouse-study-assets.test.ts
git commit -m "feat(thesis): add Warehouse benchmark assets"
```

### Task 12: Construir el driver longitudinal con preflight estricto

**Files:**
- Create: `docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs`
- Create: `docs/tesis/evidence/scripts/run-warehouse-oracle.mjs`
- Create: `tests/warehouse-longitudinal-driver.test.ts`

**Step 1: Escribir tests rojos del driver**

Cubrir modo dry-run, disco insuficiente, target dirty, hash de seed incorrecto, `dist` stale, fallo de oracle y adopción del commit anterior como siguiente base.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/warehouse-longitudinal-driver.test.ts`

Expected: FAIL por scripts inexistentes.

**Step 3: Implementar preflight**

Abortar antes de crear worktrees si:

- espacio libre menor a 25 GB;
- ManyHands o target tienen cambios no declarados;
- commit/toolchain/model/config no coinciden con manifest;
- `dist/index.js` no contiene la versión C2 esperada;
- seed o prompt hash difieren.

No borrar automáticamente pools o repos del usuario. Informar paths exactos para una limpieza aprobada.

**Step 4: Implementar la cadena de runs**

Por W1-W8: crear run, esperar terminal, exportar journal/snapshot/diff/result, clonar commit entregado, ejecutar oracle externo y sólo entonces avanzar la base.

**Step 5: Verificar dry-run y tests**

```powershell
pnpm vitest run tests/warehouse-longitudinal-driver.test.ts
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode pilot --dry-run
```

Expected: PASS; imprime ocho celdas, hashes y destinos sin mutarlos.

**Step 6: Commit**

```powershell
git add docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs docs/tesis/evidence/scripts/run-warehouse-oracle.mjs tests/warehouse-longitudinal-driver.test.ts
git commit -m "feat(thesis): automate Warehouse longitudinal runs"
```

### Task 13: Ejecutar Warehouse Pilot y corregir por clases de defecto

**Files:**
- Populate: `docs/tesis/evidence/warehouse/pilot/runs/`
- Create as needed: `docs/tesis/evidence/warehouse/pilot/defects/<slug>/README.md`
- Modify: `docs/tesis/evidence/warehouse/pilot/README.md`
- Modify: `docs/tesis/evidence/progress-log.md`

**Step 1: Resolver capacidad operativa**

```powershell
Get-PSDrive -PSProvider FileSystem | Select-Object Name,Free,Used
```

Expected: volumen del pool con al menos 25 GB libres. Si no, detenerse y pedir decisión para liberar o reubicar; no iniciar runs.

**Step 2: Build fresco**

```powershell
pnpm build
Select-String -Path packages/decomposer/dist/index.js -Pattern "adaptive-utility/2.0.0-pilot"
```

Expected: build PASS y símbolo presente.

**Step 3: Ejecutar W1-W8 en pilot**

```powershell
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode pilot
```

**Step 4: Ante cada defecto conductual, volver a TDD**

Crear regresión roja por la causa exacta, hacer fix mínimo, gates enfocados y commit. No continuar la cadena fingiendo que versiones distintas forman evidencia final.

**Step 5: Cerrar piloto**

El piloto termina sólo cuando una versión candidata completa W1-W8 y cada oracle pasa. Registrar también intentos fallidos y versiones usadas.

**Step 6: Commit por defecto y commit final de evidencia**

Usar commits pequeños por fix. Al cerrar:

```powershell
git add docs/tesis/evidence/warehouse/pilot docs/tesis/evidence/progress-log.md
git commit -m "test(thesis): close Warehouse pilot"
```

### Task 14: Congelar C2 y preregistrar la serie final

**Files:**
- Modify: `packages/decomposer/src/granularity/utility-policy.ts`
- Create: `docs/tesis/evidence/warehouse/freeze-manifest.json`
- Create: `docs/tesis/evidence/gates/c2-freeze-results.md`
- Finalize: `docs/tesis/evidence/warehouse/protocol/longitudinal-protocol.md`
- Finalize: `docs/tesis/evidence/warehouse/protocol/comparison-protocol.md`

**Step 1: Convertir configuración piloto en versión final**

Cambiar una sola vez la versión a `adaptive-utility/2.0.0` y copiar valores finales justificados por defectos del piloto, no por resultados de Warehouse Final.

**Step 2: Ejecutar regresión y gates amplios**

```powershell
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

Expected: todos PASS.

**Step 3: Crear manifest inmutable**

Incluir hashes de commit, tree, dist, seed, prompts, oráculos, drivers, modelo, executor, effort, policy config, orden aleatorio y toolchain.

**Step 4: Verificar dos runs de estabilidad finales**

Ambos sobre el mismo commit congelado, sin editar nada entre ellos, verificados en clones limpios.

**Step 5: Commit y tag local**

```powershell
git add packages/decomposer/src/granularity/utility-policy.ts docs/tesis/evidence/warehouse docs/tesis/evidence/gates/c2-freeze-results.md
git commit -m "chore(thesis): freeze C2 study configuration"
git tag thesis-c2-freeze-2026-07-24
```

No push.

### Task 15: Reconstruir Warehouse Final desde el seed

**Files:**
- Populate: `docs/tesis/evidence/warehouse/final/longitudinal/runs/`
- Create: `docs/tesis/evidence/warehouse/final/longitudinal/series-ledger.json`
- Modify: `docs/tesis/evidence/warehouse/final/README.md`
- Modify: `docs/tesis/evidence/progress-log.md`

**Step 1: Verificar manifest y target nuevo**

```powershell
node docs/tesis/evidence/scripts/prepare-warehouse-repos.mjs --mode final --verify-only
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode final --dry-run
```

Expected: seed hash exacto, target sin commits de dominio y freeze intacto.

**Step 2: Ejecutar la serie**

```powershell
node docs/tesis/evidence/scripts/run-warehouse-longitudinal.mjs --mode final
```

**Step 3: Aplicar regla de invalidez**

Si se descubre un defecto de ManyHands, detener. No parchear y continuar. Mover la serie completa a `discarded-attempt-N`, volver al piloto, corregir, crear freeze nuevo y reiniciar desde W0.

**Step 4: Verificar el commit final**

Fresh clone del target, install congelado, suite del target, oráculo W8 y recorrido Playwright completo. Registrar screenshots sólo después del PASS.

**Step 5: Commit de evidencia**

```powershell
git add docs/tesis/evidence/warehouse/final/longitudinal docs/tesis/evidence/warehouse/final/README.md docs/tesis/evidence/progress-log.md
git commit -m "test(thesis): record final Warehouse reconstruction"
```

### Task 16: Ejecutar la comparación A/B/C2 bloqueada

**Files:**
- Create: `docs/tesis/evidence/scripts/generate-warehouse-cells.mjs`
- Create: `docs/tesis/evidence/scripts/run-warehouse-comparison.mjs`
- Create: `tests/warehouse-comparison-driver.test.ts`
- Populate: `docs/tesis/evidence/warehouse/final/comparison/candidates/`
- Populate: `docs/tesis/evidence/warehouse/final/comparison/runs/`

**Step 1: Escribir tests rojos del manifiesto**

Exigir 27 IDs únicos, tres bloques por tarea, hash candidato compartido por A/B/C2 dentro del bloque, mismo base/oracle y orden reproducible por seed.

**Step 2: Verificar rojo**

Run: `pnpm vitest run tests/warehouse-comparison-driver.test.ts`

Expected: FAIL por generator inexistente.

**Step 3: Implementar generación y preflight**

Cada bloque primero obtiene un candidato live y luego crea tres celdas. Una celda nunca puede regenerar el candidato por su cuenta.

**Step 4: Ejecutar dry-run**

```powershell
node docs/tesis/evidence/scripts/generate-warehouse-cells.mjs --dry-run
```

Expected: 27 celdas, nueve hashes candidatos y balance 9/9/9.

**Step 5: Ejecutar comparación**

```powershell
node docs/tesis/evidence/scripts/run-warehouse-comparison.mjs
```

No borrar fallos. Exportar uso, journal, diff, snapshot, assessment y oracle result de todas las celdas.

**Step 6: Commit de evidencia**

```powershell
git add docs/tesis/evidence/warehouse/final/comparison docs/tesis/evidence/progress-log.md
git commit -m "test(thesis): record A B C2 warehouse comparison"
```

### Task 17: Derivar resultados y auditar claims

**Files:**
- Generate: `docs/tesis/evidence/warehouse/final/results/runs.csv`
- Generate: `docs/tesis/evidence/warehouse/final/results/strategy-assessments.csv`
- Generate: `docs/tesis/evidence/warehouse/final/results/longitudinal-results.md`
- Generate: `docs/tesis/evidence/warehouse/final/results/comparison-results.md`
- Generate: `docs/tesis/evidence/warehouse/final/results/*.svg`
- Modify: `docs/tesis/claim-evidence-matrix.md`
- Modify: `docs/tesis/evidence/progress-log.md`

**Step 1: Derivar a un directorio temporal**

```powershell
node docs/tesis/evidence/scripts/derive-warehouse-metrics.mjs --evidence docs/tesis/evidence/warehouse/final --out $env:TEMP\warehouse-study-check
```

Expected: exit 0 y ninguna celda ausente.

**Step 2: Comparar con outputs versionados**

```powershell
node docs/tesis/evidence/scripts/derive-warehouse-metrics.mjs --evidence docs/tesis/evidence/warehouse/final --out docs/tesis/evidence/warehouse/final/results
git diff --exit-code -- docs/tesis/evidence/warehouse/final/results
```

Después de versionar por primera vez, la segunda ejecución debe producir diff vacío.

**Step 3: Auditar cada claim**

Clasificarlo como supported, bounded, falsified o not measured. No usar “mejor”, “óptimo” o “más eficiente” sin una comparación que lo sostenga.

**Step 4: Commit**

```powershell
git add docs/tesis/evidence/warehouse/final/results docs/tesis/claim-evidence-matrix.md docs/tesis/evidence/progress-log.md
git commit -m "docs(thesis): derive final C2 evidence"
```

### Task 18: Reescribir tesis y presentación con el resultado final

**Files:**
- Modify: `docs/tesis/main.tex`
- Modify: `docs/tesis/presentacion.tex`
- Modify: `docs/tesis/referencias.bib` only if new sources are actually cited
- Modify: `docs/tesis/README.md`

**Step 1: Reestructurar el relato**

Orden sugerido:

1. problema de granularidad y arquitectura de ManyHands;
2. C1 y estudio formativo negativo;
3. requisitos derivados del piloto;
4. diseño C2;
5. Warehouse como caso longitudinal y banco de pruebas;
6. protocolo final congelado;
7. resultados longitudinales;
8. comparación A/B/C2;
9. amenazas a validez y límites;
10. conclusión proporcional a los datos.

El G5 viejo ocupa contexto metodológico breve; las tablas principales usan exclusivamente evidencia final.

**Step 2: Insertar figuras derivadas**

Priorizar:

- tamaño del repo vs hojas seleccionadas;
- context relief y split advantage por incremento;
- timeline W1-W8 con entregas y costo;
- comparación por tarea de entrega, tiempo y tokens;
- una captura final del control tower claramente marcada como ilustración.

**Step 3: Compilar y revisar visualmente**

Usar el mecanismo LaTeX vigente del repositorio. Verificar que `main.log` y `presentacion.log` no contengan warnings nuevos, overfull boxes ni referencias indefinidas. Inspeccionar PDFs, no sólo exit code.

**Step 4: Verificar claims y limpieza**

```powershell
rg -n "óptim|superior|demostr|significativ|siempre" docs/tesis/main.tex docs/tesis/presentacion.tex
git diff --check
```

Expected: cada formulación fuerte tiene evidencia o se acota.

**Step 5: Commit**

```powershell
git add docs/tesis/main.tex docs/tesis/presentacion.tex docs/tesis/README.md docs/tesis/referencias.bib
git commit -m "docs(thesis): report final C2 warehouse study"
```

## 9. Orden recomendado de ejecución

```text
Task 1
  -> Tasks 2-4
  -> Tasks 5-8
  -> Tasks 9-10
  -> Tasks 11-12
  -> Task 13 (pilot, iterativo)
  -> Task 14 (freeze)
  -> Task 15 (final longitudinal)
  -> Task 16 (controlled comparison)
  -> Tasks 17-18
```

No conviene implementar Warehouse antes de Tasks 1-10. Si se usa Warehouse para descubrir defectos mientras C2 todavía carece de señales medidas, replan y criterios no duplicados, se repetirá el problema de mezclar una demo con el instrumento experimental.

## 10. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| C2 queda calibrada para Warehouse | invalida generalización | usar rasgos genéricos, tareas S/M/L, declarar estudio de caso y congelar antes del final |
| El Planner no propone cortes útiles | A/B/C2 convergen | semantic replan explícito y candidate hash; nunca inventar cuts |
| Candidate replay parece fixture | confusión sobre ruta real | separarlo como estudio controlado; demostrar producción con longitudinal live |
| Más nodos multiplican validación | comparación sesgada | ownership por LCA y oráculo externo idéntico |
| Disco lleno parece fallo del sistema | falsos negativos | preflight >=25 GB y pools fuera del target |
| `dist` stale | se ejecuta C1 creyendo C2 | build obligatorio + marker check |
| Defecto descubierto tras freeze | mezcla de versiones | invalidar serie, volver a pilot y reiniciar desde W0 |
| Costos altos: 8 + 27 runs finales | serie inconclusa | presupuestar antes del freeze; no reducir N después de mirar resultados |
| Una sola familia de sistema/modelo | validez externa limitada | declarar alcance; no extrapolar a todos los repos o modelos |
| Warehouse se vuelve demasiado grande | tesis deriva a producto | mantener ocho capacidades cerradas y excluir cloud/auth/microservices |

## 11. Primer bloque concreto para comenzar

La primera sesión de implementación debe cerrar únicamente Tasks 1-4:

1. ADR + separación C1/C2.
2. `byteSize` y `lineCount` en repository index.
3. perfil de contexto puro.
4. selector C2 con tests de estrategia.

No debe tocar todavía drivers experimentales, Warehouse ni tesis. El checkpoint esperado es un selector puro, testeable y discutible con ejemplos sintéticos antes de conectarlo a la ruta productiva.
