# Apunte técnico — Parte II: cierre de tesis

Este documento acompaña los slides 7-10 de `manyhands-presentacion.html`. Es el
material de estudio para poder explicar la propuesta de cierre con conocimiento
real: qué existe hoy en el código (verificado contra el repo, julio 2026, branch
`main`), qué se propone construir, y cómo se evaluaría. El apunte de la parte I
(sistema construido) es `apunte-tecnico-presentacion.md`.

Convención: **estado actual** = verificado leyendo el código; **propuesta** =
trabajo futuro, todavía no implementado. Los slides y este apunte mantienen esa
separación explícita.

---

## 1. El marco: asignación adaptativa de recursos

*Ya en el slide 7: la hoja de ruta de las slides 8-10 («08 diagnostica el estado
actual · 09 propone auto v2 · 10 el diseño para medirlo») y una versión corta del
argumento de «por qué es tema de frontera» (routing/esfuerzo ya los exploran los
labs, granularidad de descomposición no). Esta sección es la versión larga, para si
piden más.*

### La idea en una frase
ManyHands tiene tres perillas de recursos que hoy gira el usuario — cuánto
descomponer (granularidad), cuánto modelo gastar por tarea (routing), cuánto
razonar por tarea (esfuerzo) — y la tesis propone que las gire el sistema, con
evidencia, y medir si eso mejora el resultado.

### Por qué es un tema de frontera
- Los labs están invirtiendo exactamente en esto a nivel modelo: routing
  automático entre tiers y control de esfuerzo de razonamiento son features
  centrales de los stacks agénticos actuales.
- Lo que está mucho menos explorado es la **granularidad de descomposición**:
  ¿de qué tamaño conviene cortar el trabajo para un enjambre de agentes? Ese es
  el ángulo original de la tesis, y ManyHands es un vehículo inusualmente bueno
  para estudiarlo porque todo el pipeline (scheduler, integración, evidencia) es
  sensible al tamaño de las hojas.

### Qué significa «frontier» en esta propuesta (y qué no)
- **Sí**: que la decisión automática vea evidencia estructural del repo y el
  costo de sus opciones, en vez de solo el texto del goal. Decisión informada.
- **No**: RL, fine-tuning, modelos entrenados. Nada de aprendizaje automático.
  Si preguntan «¿van a entrenar algo?», la respuesta es no — y es deliberado:
  en un mes, un mecanismo determinista + LLM bien alimentado es defendible;
  un modelo entrenado no.

### El ancla en las decisiones del proyecto
`docs/DECISIONS.md` dice textualmente que «la forma de medir calidad se diseñará
después» y que los benchmarks viejos (Lab Mode, B0-B4, G3/G6/G9) quedaron
superseded. La sección PR-S1..S9 cierra con «Relación con tesis/evaluación
futura»: los eventos required y las guardas de lifecycle se construyeron para
poder **reconstruir decisiones y comparar runs**. Es decir: esta propuesta no
reintroduce los experimentos retirados; diseña la evaluación que el propio
proyecto dejó preparada. Frase útil si preguntan por los benchmarks viejos.

---

## 2. Estado actual: granularidad (verificado)

### El flujo completo, de la UI al prompt

```
RunCreateRequest.granularity          GranularityMode: auto|coarse|balanced|fine
  └─ apps/web/src/lib/server/runs/schema.ts (persiste en RunRecord)
       └─ planning-host.ts → resolveDecompositionMode(mode)   // identidad
            └─ RecursiveDecomposer.decompose(mode)
                 └─ modeToAggressiveness(mode)
                      coarse→low · balanced→medium · fine→high · auto→auto
                      └─ buildStepPrompt({ aggressiveness })  // step-prompt.ts
```

### Qué controla la perilla — y qué no
La aggressiveness **solo** sesga el umbral de atomicidad: la definición de
«unidad cohesiva» que el LLM aplica al juzgar cada nodo. No fija profundidad ni
cantidad de nodos — hay comentarios explícitos en el código: *"granularity is an
aggressiveness control, not a depth/count target"*. Cada rama corta cuando sus
hojas alcanzan el tamaño de la rúbrica, así que el árbol es asimétrico por
diseño. Existe un `depthBudget` pero es riel anti-runaway, no target: cuando se
alcanza, el nodo se fuerza atómico y el modelo nunca ve «niveles restantes».

### La rúbrica completa (`COHESIVE_UNIT`, step-prompt.ts)
Qué significa «una unidad cohesiva» en cada nivel — citas literales:

- **low**: *"a whole module or file (a group of related functions that ship
  together). Low pressure to split."*
- **medium**: *"a small group of closely-related functions. Balanced pressure."*
- **high**: *"a single function or a tightly-scoped pair of functions. High
  pressure: keep splitting until every leaf is small, concrete, assignable and
  verifiable."*
- **auto**: *"whatever size matches THIS node's complexity — you choose. First
  judge how complex this specific node is [...] Calibrate the split pressure per
  branch, not uniformly across the tree."*

### El diagnóstico de `auto` v1
`auto` es **el mismo LLM autocalibrándose el umbral, por nodo, sin evidencia**:
- No recibe señales estructuradas del repo para esa decisión (el decomposer sí
  recibe un digest del repo — `buildGroundingDigest`, top 15 archivos fuente con
  símbolos exportados — pero como hint genérico para diseñar seams, no como
  prior sobre el umbral de atomicidad).
- No tiene noción del costo de partir: la rúbrica nunca menciona que cada split
  agrega una integración, superficie de conflicto y overhead de contratos.
- No tiene feedback: nada de lo aprendido en runs anteriores vuelve a la
  decisión.

### `auto` como ciudadano de segunda (detalles que muestran madurez al contarlos)
- `replan-service.ts:133`: al replanificar, `auto` se degrada a `balanced`.
- `run-model-event-log.ts:226`: el evento de planning registra aggressiveness
  `medium` para `auto` (solo mapea fine→high y coarse→low).
- `aggressivenessToGranularity` y `granularityForMode`: la metadata del grafo
  registra `medium` para `auto` («neutral», comentado en el código).
Parte del trabajo v2 incluye arreglar estos tres puntos — son chicos y muestran
que `auto` nunca fue tratado como mecanismo de primera clase.

### Mecánica del paso recursivo (contexto que conviene manejar)
Un llamado LLM por nodo con salida `atomic | decompose | question`; si
descompone, define los seams que los hijos comparten; 3 intentos con backoff;
step cache reanudable; los fallos de LLM fallan el run (D3, sin fallback
silencioso). El prompt de cada paso incluye la rúbrica, seams heredados y hints
del workspace.

---

## 3. Estado actual: routing por complejidad (verificado)

### El scorer (`scoreNodeComplexity`, routing/complexity.ts)
Determinista y explicable — cada punto deja una señal legible que va a trazas:

| Señal | Puntos |
|---|---|
| Interfaces producidas | +2 por cada una |
| Interfaces consumidas | +1 por cada una |
| Archivos esperados (si >1) | +1 por archivo extra |
| Criterios de aceptación | +1 por cada 2 |
| Goal largo (>40 / >80 palabras) | +1 / +2 |
| Fan-in (dependencias, tope 3) | +1 c/u |
| Fan-out (dependientes, tope 3) | +1 c/u |
| Scope amplio (>2 / >4 globs) | +1 / +2 |
| Nodo integrador | +6 |
| Cerca de la raíz (depth ≤ 1) | +1 |

Tiers: `trivial ≤ 2` · `standard ≤ 5` · `complex ≤ 9` · `critical > 9`.

### Lanes por tier (`DEFAULT_TIER_ROUTES`, routing/policy.ts)
Orden = preferencia; CLIs no disponibles se saltean (degradación explícita):

- `trivial`: claude/haiku → codex/gpt-5-codex → claude/sonnet
- `standard`: claude/sonnet → codex/gpt-5-codex
- `complex`: claude/sonnet → codex/gpt-5-codex → claude/opus
- `critical`: claude/opus → codex/gpt-5-codex → claude/sonnet

**Escalación en repairs**: `attempt > 0` sube el tier (`escalateTier`) — el
comentario del código lo dice bien: *"if the cheap model failed the validation
loop, the retry deserves a stronger brain"*.

### Precedencia de selección (`resolveRoutedSelection`)
`metadata` del nodo (override explícito) → selección fija del run (`locked`;
un override contradictorio lanza error) → router → default del run.

### El punto clave: existe pero el camino productivo lo puentea
`execution-host.ts:223`: el router se construye **solo si** el run no tiene
`routing: "fixed"` **ni** selección explícita de executor/modelo. Como los runs
creados desde la UI llevan `model` explícito, en la práctica el router casi
nunca actúa. El schema de `ExecutionConfig` tiene default `routing:
"complexity"`, pero eso no alcanza para activarlo en el camino típico. En
resumen honesto: **v1 implementada, con tests, jamás calibrada contra
resultados reales y puenteada en producción**. Igual que `auto`: mecanismo
razonable, nunca evaluado.

---

## 4. La propuesta: auto v2 (trabajo futuro)

*Ya en el slide 9: los tres ingredientes (numerados, con el tercero marcado
explícitamente «stretch») y un bloque «cómo se implementa» con los tres puntos de
factibilidad de más abajo. El argumento ya no está reservado para si preguntan —
está en el slide para que la charla lo muestre sin depender de la memoria.*

### Los tres ingredientes

1. **Prior determinista de complejidad en planning.** Una función pura — misma
   filosofía que `scoreNodeComplexity`, que ya demostró el patrón — que para
   cada nodo produce una sugerencia de presión de split con evidencia legible.
   Insumos disponibles hoy: seams heredados, tamaño y forma del goal, y las
   señales estructurales del `repository-index` que ya alimentan al scheduling
   (D19: `static_import_dependency`, `static_producer_consumer_symbol`,
   `static_shared_schema_dependency`, `static_public_api_surface_overlap`).
2. **Rúbrica consciente del costo.** Hoy la rúbrica solo muestra una fuerza
   (hojas chicas = más verificables). La v2 agrega la fuerza opuesta: cada
   split suma una integración, superficie de conflicto entre hermanos y
   overhead de contratos. Un buscador de sweet spot necesita ver ambas fuerzas.
3. **Feedback del corpus (alcance estirado).** El event log acumula evidencia
   usable: hojas con `timeout`/`validation_failed` sugieren «estaba demasiado
   grande»; integraciones con conflicto sugieren «se cortó demasiado fino».
   Cerrar ese loop, aunque sea con calibración simple, queda declarado como
   stretch — se hace solo si las semanas 1-2 vienen bien.

Además: promover `auto` a ciudadano de primera (replan lo preserva, el event
log lo registra como `auto`, la metadata lo distingue).

### Por qué entra en una semana (semana 1)
- El prior es una función pura → TDD directo, sin LLM en los tests.
- El canal de inyección ya existe: `buildStepPrompt` ya recibe hints; agregar
  evidencia estructurada es extender un prompt builder testeado.
- El brazo `random` de la evaluación es trivial: elegir low/medium/high al azar
  por nodo en el punto donde se resuelve `COHESIVE_UNIT`.
- No se toca executor, recorder, scheduler ni integración.

### Qué queda explícitamente afuera
- RL / fine-tuning / cualquier cosa que requiera entrenar.
- Routing v2 (calibrar pesos del scorer contra resultados y activarlo
  productivamente): secundario — mini-estudio en el carril de Codex si hay
  tiempo, si no future work con el mecanismo ya existente como base.
- Esfuerzo de razonamiento por tarea: extensión declarada. No prometerla — no
  está verificado qué expone cada CLI al respecto.

---

## 5. Diseño experimental (propuesta)

*Ya en el slide 10: la aritmética (40 runs), el criterio de diseño del corpus en
una línea (features que admitan cortes distintos, validación real, congelado antes
del primer brazo) y el criterio de éxito completo, palabra por palabra. Lo que
sigue acá es el detalle que no entra en el slide: el pilot, el presupuesto por
carril, el plan de análisis y los riders observacionales.*

### Los cuatro brazos

| Brazo | Qué responde | Implementación |
|---|---|---|
| `auto v2` | ¿decidir con evidencia mejora el resultado? | el mecanismo nuevo |
| `auto v1` | ¿cuánto aporta la evidencia sobre la rúbrica pelada? | ya existe |
| `balanced` fijo | ¿la automatización iguala al mejor ajuste manual? | ya existe |
| `random` por nodo | piso de control: ¿la decisión importa siquiera? | trivial (elegir nivel al azar por nodo) |

Por qué `balanced` como brazo manual: es el default razonable que un usuario
elegiría sin información. Si el presupuesto lo permite, `coarse` y `fine` en un
subconjunto de features enriquecen la curva (ver «análisis»).

### Corpus
5 features medianas sobre 1-2 repos controlados. Criterios de diseño:
- Cada feature debe admitir descomposiciones genuinamente distintas (de ~3 a
  ~12 hojas) — si solo se puede cortar de una manera, la perilla no separa.
- Validación real ejecutable (los `leafValidationCommands` y la validación del
  root deben poder decidir éxito objetivamente).
- Tamaño acotado: el run completo tiene que entrar en una ventana de cuota.
- Diseñar el corpus **antes** de ver resultados de auto v2, y congelarlo — eso
  responde a la objeción de sesgo (ver preguntas probables).

### Presupuesto y aritmética
- 4 brazos × 5 features × 2 repeticiones = **40 runs** + ~5 de pilot.
- Cadencia: ~1 run por ventana de cuota (~5 h) en el carril de Claude → ~4-5
  por día corriendo día y noche con harness automatizado.
- Semanas 2 y 3 dedicadas al sweep (~65 slots teóricos; 45-50 usados deja
  margen para fallos de infraestructura).
- Carril de Codex: pilots, re-runs y (si va) el mini-estudio de routing —
  no se mezclan executors dentro del estudio principal para no confundir la
  variable.
- Los runs se crean por API con `autonomy: autonomous` (sin humano en el loop);
  los checkpoints permiten reanudar un run cortado por cuota en la ventana
  siguiente.

### Pilot (va primero, semana 1)
3-6 runs para verificar dos cosas antes de gastar el presupuesto:
1. **La perilla separa**: `coarse`/`balanced`/`fine` producen grafos con
   `leafCount` claramente distinto en estas features. Si no, agrandar features.
2. **El run entra en la ventana**: si no, achicar features o subir timeouts.

### Métricas (todas ya instrumentadas — verificado)
El **`GranularityVector`** se computa hoy por cada run
(`packages/execution-core/src/granularity/vector.ts`, emitido en
`run.metrics.ready`):

- Forma del árbol: `depth`, `leafCount`, `compositeCount`, `avgLeafDepth`,
  `maxLeafDepth`, `dependencyCount`, `avgAcceptanceCriteriaPerLeaf`.
- Resultado: `leafSuccessRate`, `integrationSuccessRate`, `conflictRate`
  (integraciones con conflicto sobre pares de hojas), `testsPassedRate` (opc.).
- Costo: `totalDurationMs`, `linesChanged`, `totalCostUsd` (opc.),
  `estimatedTokensPerLeaf` (opc.).
- Disciplina: `unexpectedCommitCount`, `scopeViolationCount`.

Complementos: `TaskNodeMetrics` por nodo (`durationMs`, `costUsd`, `tokensIn`,
`tokensOut`, `retries`), `AgentResultStatus` por hoja (8 estados tipados), y
los payloads de `run.scheduling.wave_selected` para reconstruir decisiones.

### Análisis previsto
- **Eje x = granularidad lograda, no la perilla.** La perilla induce variación;
  lo que se grafica es `leafCount` (y profundidad/scope medio) medido del grafo
  persistido. Esto convierte la variabilidad del decomposer en datos.
- Curva éxito/costo-eficiencia vs. granularidad lograda con los brazos fijos
  (+ `coarse`/`fine` en subset si hay presupuesto) → el estudio del sweet spot.
- Comparación de brazos: distribución de éxito, costo, makespan y conflictos
  por brazo, por feature. Distribuciones e intervalos simples, no tests
  formales — consistente con lo que el tribunal espera.
- Trazabilidad: cada decisión de atomicidad de v2 deja su evidencia (el prior
  es explicable), así que se puede auditar **por qué** decidió lo que decidió.

### Los dos riders observacionales (gratis, sobre los mismos 40+ runs)
1. **Tasa de falso éxito del agente**: comparar lo que el agente afirma al
   terminar (exit code + canal de status + stdout, guardados como diagnóstico)
   contra el veredicto objetivo (`AgentResultStatus` del recorder). Justifica
   empíricamente la arquitectura de evidencia («stdout explica, el diff
   decide») con un número.
2. **Precisión del predictor de conflictos**: la `riskMatrix` de planning se
   persiste; los conflictos reales quedan en los eventos de integración.
   Evaluar el predictor como clasificador (precisión/cobertura) contra un
   baseline de overlap de paths. Cierra una incógnita que D19 deja abierta
   (el propio doc admite que el predictor es heurístico y no probado).

### Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| La perilla no separa granularidades en el corpus | Pilot en semana 1; agrandar features |
| Varianza alta del decomposer | Eje x = granularidad lograda; distribuciones; misma versión de CLI/modelo |
| Runs muertos por bugs de infraestructura | Semana 1 incluye cerrar los bottlenecks de ejecución pendientes |
| auto v2 no supera a v1 | El resultado sigue siendo tesis: comparación honesta + curva del sweet spot + riders |
| Un run no entra en la ventana de cuota | Features acotadas; checkpoints permiten partir un run entre ventanas |

### Criterio de éxito del mecanismo
El claim buscado: *auto v2 iguala o supera al mejor ajuste manual por feature —
sin conocerlo de antemano — a costo igual o menor, y domina claramente a
random.* Resultados parciales también cuentan: si v2 solo empata con v1 pero
ambos dominan a random y evitan los extremos malos de la curva, la
automatización ya está justificada frente a la elección manual a ciegas.

---

## 6. Catálogo de hipótesis consideradas (para defender la elección)

Este catálogo ya no es una slide del deck (versión corta, 10-15 min): queda acá como
material de respuesta si algún profesor pregunta «¿por qué no evaluaron X?».

| Hipótesis | Qué probaría | Veredicto y por qué |
|---|---|---|
| Sweet spot de granularidad + auto v2 | asignación adaptativa | **Elegida**: perilla nativa, instrumento ya construido, motivación del autor, contiene al estudio de la curva como caso degenerado |
| Falso éxito del auto-reporte | el valor de la verificación objetiva | **Rider gratis** sobre los mismos runs |
| Predictor de conflictos | calidad de las señales D19 | **Rider gratis** sobre los mismos runs |
| Routing por complejidad | costo/éxito del routing v1 | Secundario: mini-estudio en carril Codex o future work |
| Seams reducen conflictos | valor causal de los contratos | Requiere construir ablations (~1 semana de infra) |
| Scheduling risk-aware vs naive | frontera paralelismo-conflictos | Fuerte, pero compite por el mismo presupuesto de runs |
| Sistema vs agente único | comparación clásica | Duplica corridas; difícil de diseñar justa; se lleva como pregunta |
| Crash-resume acotado | robustez sin LLM | Comodín barato si sobra semana 3 |
| Worktrees vs árbol compartido | interferencia | Habría que construir el modo inseguro; resultado esperable |

---

## 7. Preguntas probables de los profesores

- **¿Por qué no usan SWE-bench u otro benchmark público?**
  Miden bug-fix mono-tarea; el diferencial de ManyHands es composición paralela
  de features multi-módulo. No hay benchmark público para eso; el corpus propio
  y congelado es parte del aporte.

- **¿Por qué no comparan contra un solo agente (Claude Code directo)?**
  Es la comparación más cara (duplica corridas) y la más difícil de hacer justa
  (¿qué es «mismo presupuesto»?). Está en el catálogo de alternativas con esa
  razón; con la cuota disponible, el estudio elegido produce más información
  por run.

- **¿40 runs alcanza?**
  Para tests estadísticos formales, no. Para trazar tendencias con
  distribuciones, comparar cuatro brazos y auditar cada decisión con su
  evidencia, sí — y el tribunal pide medición empírica honesta, no un paper de
  ML. El límite es la cuota (1 run por ventana de ~5 h), y está declarado.

- **¿Y si auto v2 no le gana a auto v1?**
  El diseño está blindado: los brazos fijos trazan la curva del sweet spot (el
  estudio vale por sí mismo), los riders garantizan resultados empíricos, y una
  comparación negativa honesta también es un hallazgo («la rúbrica pelada ya
  captura lo que el prior aporta»).

- **¿El resultado no depende de la calidad del LLM del momento?**
  Sí, como todo el campo. Mitigación: misma versión de CLI y modelo en todos
  los brazos, la variable es solo la política de granularidad. El claim es
  comparativo entre políticas, no absoluto sobre el modelo.

- **¿No están sesgando el corpus a favor de auto v2?**
  El corpus se diseña y congela antes de correr el primer brazo, con criterios
  publicados (features que admitan cortes distintos, validación objetiva). Y el
  brazo random existe justamente como piso de control.

- **¿El brazo random no es un strawman?**
  Random es el piso, no el rival: mide si la decisión importa. Los rivales
  serios son auto v1 (la rúbrica actual) y balanced (el mejor ajuste manual a
  ciegas).

- **¿Qué es exactamente el «prior determinista»?**
  Una función pura que puntúa la complejidad estructural del nodo con señales
  del repo (imports, símbolos producer/consumer, superficie de API, seams) y
  sugiere presión de split con evidencia legible. Mismo patrón que
  `scoreNodeComplexity`, que ya existe para routing.

- **¿Por qué no aprendizaje automático?**
  Un mes, corpus chico, y un requisito de explicabilidad: cada decisión tiene
  que poder auditarse en la defensa. Decisión informada determinista + LLM es
  el punto correcto de la curva riesgo/valor. El feedback del corpus queda
  como calibración simple, declarada stretch.

- **¿Cómo garantizan reproducibilidad?**
  Corpus congelado, configuración por `RunRecord` persistido, event log
  append-only por run, checkpoints, y versiones de CLI/modelo fijadas y
  registradas. Cualquier run del estudio se puede auditar evento por evento.

- **¿Esto no lo hacen ya los labs?**
  Routing de modelos, sí (por eso acá es secundario). Granularidad adaptativa
  de descomposición en orquestación multi-agente con evaluación controlada: no
  hay trabajo estándar — es el hueco que la tesis ataca.

- **¿Cuánto cuesta el estudio?**
  Los planes existentes ($20 de Claude + Codex): ~1 run por ventana de cuota.
  El diseño (40 + pilot) entra en 2 semanas de carril Claude sin gasto extra.

---

## 8. Chuleta de términos

- **Perilla**: parámetro de recursos que hoy elige el usuario (granularidad,
  modelo, esfuerzo).
- **Aggressiveness**: `low|medium|high|auto` — presión de split del decomposer;
  solo sesga el umbral de atomicidad, nunca fija profundidad.
- **Unidad cohesiva / umbral de atomicidad**: la definición de «suficientemente
  chico» que el LLM aplica al decidir atomic vs. split (rúbrica
  `COHESIVE_UNIT`).
- **auto v1**: la rúbrica actual de autocalibración («you choose»), sin
  evidencia ni costo.
- **auto v2**: la propuesta — prior determinista + rúbrica cost-aware +
  (stretch) feedback del corpus.
- **Prior determinista**: función pura que puntúa complejidad estructural del
  nodo y sugiere presión de split, con evidencia legible.
- **Tier / lane**: nivel de complejidad (`trivial|standard|complex|critical`) y
  su lista ordenada de executor/modelo preferidos.
- **Granularidad lograda**: la forma real del grafo producido (`leafCount`,
  profundidad) — el eje x del análisis, medido, no configurado.
- **GranularityVector**: el vector de métricas por run que ya computa el
  sistema (forma del árbol, éxito, conflictos, costo, disciplina).
- **Brazo**: una configuración del experimento (auto v2 / auto v1 / balanced /
  random).
- **Rider**: estudio observacional montado gratis sobre los mismos runs (falso
  éxito, predictor de conflictos).
- **Pilot**: los 3-6 runs previos que validan que la perilla separa y que un
  run entra en la ventana de cuota.
