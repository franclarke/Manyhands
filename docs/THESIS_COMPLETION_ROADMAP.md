# ManyHands — Plan rector de cierre para tesis

> **Estado:** activo  
> **Fecha de emisión:** 2026-07-23  
> **Audiencia:** agentes de ingeniería, agentes de QA, responsables de la
> evaluación experimental y autores de la tesis/presentación  
> **Propietario del alcance:** Francisco Clarke  
> **Propósito:** transformar el prototipo avanzado de ManyHands en una entrega
> de tesis funcional, reproducible, demostrable y académicamente trazable.

## 1. Mandato

El objetivo de esta etapa no es convertir ManyHands en un producto SaaS listo
para producción. El objetivo es cerrar una tesis de ingeniería sólida:

- una implementación funcional del aporte central;
- un recorrido end-to-end real y repetible;
- evidencia técnica y experimental que pueda auditarse;
- una tesis que describa exactamente lo implementado;
- una demostración defendible aun cuando un proveedor LLM falle.

El trabajo debe seguir, en este orden estricto:

1. **Congelar alcance.**
2. **Estabilizar toolchain y gates.**
3. **Integrar el aporte adaptativo.**
4. **Producir el run canónico.**
5. **Ejecutar el experimento.**
6. **Corregir tesis y presentación.**

Una etapa no se considera cerrada hasta que su gate de salida tenga evidencia
persistida. El estado reportado por un agente, un exit code aislado o una suite
enfocada no sustituyen esa evidencia.

Este documento es un plan de ejecución. No reemplaza la autoridad de
[`PRODUCT.md`](../PRODUCT.md), [`docs/DECISIONS.md`](DECISIONS.md) ni los
contratos de [`docs/system/`](system/). Cuando la implementación actual difiera
del target, se debe registrar la brecha; no se debe reescribir el target para
hacer coincidir accidentalmente documentación y código.

## 2. Resultado final esperado

ManyHands estará completo para la tesis cuando exista una versión identificable
que satisfaga simultáneamente lo siguiente:

1. Puede instalarse desde un checkout limpio con una toolchain única y
   documentada.
2. Tests, typechecks y builds requeridos pasan en esa misma versión.
3. La política de granularidad adaptativa participa del planning productivo y
   deja evidencia persistida.
4. Un run real con Codex alcanza `completed` sobre un repositorio controlado y
   entrega un commit no vacío, validado y publicable.
5. El experimento puede reconstruirse desde protocolo, configuración, datos
   crudos, scripts y commits versionados.
6. La tesis y la presentación no contienen afirmaciones más fuertes que la
   evidencia disponible.

La entrega final debe estar asociada a un commit y tag de Git. No se acepta como
entrega un working tree con cambios dispersos o artefactos críticos sin
versionar.

## 3. Estado de partida auditado

La auditoría del 23 de julio de 2026 encontró una base de ingeniería sustancial,
pero no una versión de tesis cerrada:

- el checkout contiene una transición amplia sin consolidar;
- `package.json`, CI y lockfile no fijan una versión coherente de pnpm;
- la suite completa y los typechecks están rojos en el entorno auditado;
- el compilador adaptativo y las métricas de tesis existen, pero no participan
  del pipeline productivo;
- no existe un snapshot V2 persistido en lifecycle `completed`;
- los resultados cuantitativos publicados en la tesis no tienen un paquete de
  evidencia reconstruible;
- la documentación declara capacidades —por ejemplo SQLite WAL— que no existen
  en la ruta productiva.

Este estado es una línea base, no una verdad permanente. Al comenzar cada
etapa, el agente responsable debe volver a medir el checkout y registrar si la
evidencia cambió.

## 4. Alcance congelado

### 4.1 Incluido

Solo se autoriza trabajo que contribuya directamente a uno de estos resultados:

- reproducibilidad de instalación, tests, typechecks y builds;
- integración productiva de la granularidad adaptativa;
- seguridad local necesaria para ejecutar sobre repositorios reales;
- run canónico, evidencia exacta y delivery;
- protocolo, ejecución y análisis del experimento;
- corrección de tesis, diagramas, presentación y guion de demo.

### 4.2 Diferido o fuera de alcance

Salvo que se demuestre que bloquean un gate de tesis, quedan diferidos:

- OAuth, SSO, RBAC y multi-tenancy;
- billing y límites comerciales;
- Kubernetes, despliegue cloud y alta disponibilidad;
- colaboración multiusuario;
- escalabilidad masiva y optimización para miles de nodos;
- certificación externa de accesibilidad;
- aislamiento por contenedores o máquinas virtuales;
- SQLite WAL, si la persistencia JSONL satisface el recorrido de tesis;
- rotación sofisticada de traces;
- hardening exhaustivo de MCP y prompt injection;
- selección adaptativa de modelos;
- features nuevas del cockpit que no sean necesarias para la demo.

La decisión de diferir una capacidad obliga a remover o matizar cualquier
afirmación en presente que diga que esa capacidad está implementada.

### 4.3 Invariantes no negociables

Aunque el target sea académico y local, no se puede relajar:

- protección del working tree sucio del usuario;
- aislamiento por worktree;
- inspección del diff real;
- enforcement de scope y protección contra path traversal;
- commits candidatos controlados por el orquestador;
- cancelación y verificación de muerte de procesos;
- leases y fencing para efectos tardíos;
- validación sobre el commit exacto;
- prohibición de integrar resultados `stale`, fallidos o sin evidencia;
- manifest y receipt válidos antes de `completed`;
- ausencia de recentrado automático del canvas por eventos.

ManyHands modifica repositorios reales. Una tesis no necesita seguridad
enterprise, pero sí debe evitar dañar el trabajo del usuario.

## 5. Contrato operativo para agentes

Todo agente que trabaje bajo este plan debe:

1. Leer `AGENTS.md`, `PRODUCT.md`, `docs/DECISIONS.md` y la especificación
   aplicable antes de cambiar código.
2. Confirmar el Git root y registrar `git status --short` y `git diff HEAD`
   antes de actuar.
3. Preservar cambios ajenos. Está prohibido usar `reset`, `clean`, `checkout`
   destructivo o un stash global para obtener un árbol limpio.
4. Trabajar con TDD para todo cambio conductual.
5. Ante una anomalía, seguir:
   **evidencia → regresión roja → causa raíz → corrección sistémica →
   repetición de la verificación original**.
6. Mantener una sola representación canónica de grafo, relaciones, lifecycle y
   evidencia.
7. No presentar una fixture, un mock o un test unitario como prueba de una
   capacidad productiva real.
8. No inventar, completar ni aproximar datos experimentales.
9. Entregar un handoff con comandos, resultados, artefactos y brechas abiertas.
10. Detener expansión de alcance cuando el siguiente trabajo no contribuya al
    gate activo.

Código, identificadores, tests y schemas permanecen en inglés. La colaboración
y los documentos de tesis pueden permanecer en español.

## 6. Secuencia maestra

| Etapa | Resultado obligatorio | Gate de salida |
|---|---|---|
| 1. Congelar alcance | Matriz de claims y capacidades aceptada | Cada claim queda clasificado y trazable |
| 2. Toolchain y gates | Checkout reproducible y verificación verde | Install, tests, typechecks y builds pasan |
| 3. Aporte adaptativo | `C_task` gobierna planning productivo | Evidencia adaptativa persistida y replayable |
| 4. Run canónico | Run real Codex hasta `completed` | Commit, evidence, manifest y receipt válidos |
| 5. Experimento | Dataset y análisis reconstruibles | Protocolo ejecutado sin datos faltantes |
| 6. Tesis y presentación | Documento y demo coherentes | PDF compilado y claims respaldados |

## 7. Etapa 1 — Congelar alcance

### Objetivo

Establecer qué afirma la tesis, qué implementa ManyHands y qué se declara
trabajo futuro. Después de este gate no se agregan subsistemas por oportunidad.

### Trabajo requerido

1. Crear una matriz de trazabilidad con una fila por claim relevante:

   - claim;
   - capítulo/sección;
   - estado: `implemented`, `partial`, `missing`, `incompatible` o `deferred`;
   - código productivo;
   - tests;
   - run o artefacto persistido;
   - decisión: demostrar, implementar, matizar o remover.

2. Definir una única formulación del aporte central:

   - problema de granularidad;
   - política adaptativa;
   - relación entre `Architect Pass`, evaluación determinista y Graph Compiler;
   - alcance exploratorio de la evaluación.

3. Resolver inconsistencias de nomenclatura:

   - V2/V3 de producto frente a `schemaVersion`;
   - Planner frente a Graph Compiler;
   - evento de dominio frente a trace o métrica experimental;
   - local control plane frente a inferencia local.

4. Clasificar explícitamente SQLite WAL, compaction, durable traces, WCAG,
   hardening de prompts y escalabilidad como implementado o diferido.

5. Elegir el escenario del run canónico y las preguntas de investigación del
   experimento antes de continuar.

### Entregables

- `docs/tesis/claim-evidence-matrix.md`;
- `docs/tesis/research-questions.md`;
- inventario de capacidades diferidas;
- baseline Git y técnico fechado.

### Gate de salida

La etapa pasa cuando:

- no queda ningún claim material sin clasificación;
- cada capacidad `implemented` apunta a código productivo y evidencia;
- cada capacidad `partial` o `deferred` está redactada como tal;
- Francisco aprueba el alcance congelado;
- no hay features nuevas abiertas fuera de este documento.

## 8. Etapa 2 — Estabilizar toolchain y gates

### Objetivo

Producir una base reproducible antes de integrar más comportamiento. Ningún
resultado experimental es válido si el entorno cambia entre corridas o los
gates de código están rojos.

### Decisión de toolchain

La ruta de menor riesgo para la tesis es alinear inicialmente:

- Node.js 22, como CI;
- pnpm 7.29.3, como CI y el lockfile 5.4 existente;
- instalación con `--frozen-lockfile`.

Migrar a pnpm 11 es válido solo como cambio deliberado: debe regenerar el
lockfile, actualizar CI, demostrar fresh install y no mezclarse con pnpm 7.
Hasta tomar esa decisión, ningún agente debe reparar dependencias ejecutando
instalaciones concurrentes sobre el checkout sucio.

### Trabajo requerido

1. Alinear `packageManager`, CI, lockfile y documentación.
2. Fijar la versión de Node con el mecanismo adoptado por el repositorio.
3. Validar instalación en un fresh clone o workspace aislado.
4. Separar fallos de entorno de fallos reales de tipos o comportamiento.
5. Corregir suites que no colectan, imports faltantes y contratos migrados.
6. Actualizar tests frágiles que inspeccionan strings cuando deberían probar
   comportamiento, sin debilitar sus invariantes.
7. Ejecutar los gates amplios después de que los checks enfocados estén verdes.
8. Registrar duración, versión de toolchain y resultado de cada gate.

### Comandos mínimos

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
git diff --check
```

La instalación debe probarse fuera del `node_modules` histórico. Un build verde
usando symlinks hacia un workspace temporal anterior no es evidencia válida.

### Entregables

- definición única de toolchain;
- log de fresh install;
- resultados completos de los gates;
- lista cerrada de regresiones encontradas y corregidas;
- CI equivalente a los comandos locales.

### Gate de salida

La etapa pasa cuando:

- fresh install termina sin modificar inesperadamente el lockfile;
- todos los comandos mínimos pasan sobre el mismo commit;
- no existen suites que fallen durante collection;
- no existen fallos aceptados mediante `continue-on-error` en gates de tesis;
- el checkout candidato puede reconstruirse sin reutilizar caches privados.

## 9. Etapa 3 — Integrar el aporte adaptativo

### Objetivo

Convertir el prototipo de granularidad adaptativa en parte de la ruta productiva
sin crear un segundo modelo de grafo.

### Diseño esperado

La ruta objetivo debe ser:

```text
RepositorySnapshot
  → semantic planning signals
  → deterministic C_task assessment
  → adaptive WorkUnit tree
  → canonical compileGraphRevision
  → critics and contracts
  → approved GraphRevision
```

El compilador adaptativo debe producir el `WorkUnit` canónico que ya consume el
Graph Compiler. No debe aparecer un `GraphRevisionV3` paralelo ni otra lista de
relaciones que deba sincronizarse manualmente.

### Trabajo requerido

1. Definir cómo se obtienen y validan:

   - `scopeRadius`;
   - `interfaceImpact`;
   - `validationSurface`;
   - `contextTokenMass`;
   - evidencia y confianza de cada dimensión.

2. Integrar `compileAdaptiveWorkUnitTree` o su evolución en el planning
   productivo.
3. Persistir por nodo:

   - dimensiones;
   - pesos y versión de fórmula;
   - `C_task`;
   - decisión leaf/composite;
   - branching factor;
   - decisiones de coalescence o re-splitting;
   - evidencia de entrada.

4. Persistir las métricas de tesis como artefactos diagnósticos versionados,
   keyed por `runId`, commit y configuración. No deben gobernar lifecycle ni
   crear una segunda fuente de verdad.
5. Asegurar que replay y UI puedan explicar por qué se eligió una granularidad.
6. Cubrir, como mínimo:

   - tarea simple que permanece leaf;
   - tarea compleja que se divide;
   - siblings triviales que se fusionan;
   - aparente leaf demasiado amplia que se redivide;
   - enmienda que invalida solo fingerprints afectados;
   - planning productivo que emite y recupera evidencia adaptativa.

### Gate de salida

La etapa pasa cuando:

- el pipeline productivo invoca la política adaptativa;
- una prueba vertical atraviesa inspector, planner, adaptive compiler y Graph
  Compiler;
- los datos de `C_task` sobreviven a persistencia y replay;
- no hay doble representación de nodos o relaciones;
- la suite completa de la etapa 2 continúa verde;
- la UI o un reporte explican la decisión de granularidad con evidencia.

Tests unitarios aislados del compilador no alcanzan este gate.

## 10. Etapa 4 — Producir el run canónico

### Objetivo

Demostrar que ManyHands transforma un objetivo real en un resultado entregado,
no solo que sus componentes funcionan por separado.

### Repositorio y escenario

El repositorio canónico debe ser:

- pequeño y versionado;
- independiente de rutas personales del Desktop;
- Git clean y con baseline verde;
- suficientemente rico para requerir varias hojas, al menos un seam y
  validación de integración;
- suficientemente acotado para completar una demo con presupuesto razonable;
- reproducible desde un commit conocido.

El escenario recomendado es una feature vertical sobre un pequeño monorepo o
aplicación TypeScript existente: dominio, adaptación/API, superficie visible y
tests. No debe elegirse un greenfield vacío si eso obliga a evaluar al mismo
tiempo scaffolding, selección de stack y la contribución adaptativa.

### Configuración congelada

Registrar antes del run:

- goal y criterios de aceptación;
- repositorio y base SHA;
- executor Codex;
- modelo y esfuerzo;
- versiones de Codex, Node, pnpm y Git;
- `maxParallel`, timeouts y políticas;
- variables de entorno relevantes, redactadas;
- commit exacto de ManyHands.

### Evidencia obligatoria

El paquete del run debe incluir:

- configuración del run;
- journal de eventos canónico;
- snapshot final;
- grafo y contratos aprobados;
- attempts e input fingerprints;
- commits candidatos;
- diffs no vacíos;
- matrices de evidencia;
- resultados de integración;
- `FinalArtifactManifest`;
- delivery approval y receipt;
- SHAs base, candidato final y rama entregada;
- logs diagnósticos redactados;
- capturas del recorrido UI;
- instrucciones para repetir el caso.

### Criterios de éxito

El run solo pasa si:

- termina en `completed`;
- `finalSha` existe y es diferente del base SHA;
- el diff final contiene el cambio solicitado;
- todo commit integrado tiene ancestry y provenance explicables;
- no hay criterio requerido `uncovered`, `failed` o flaky oculto;
- el manifest coincide con el candidato validado;
- el receipt confirma la publicación del mismo SHA;
- el target final pasa sus tests;
- el recorrido puede repetirse una segunda vez desde un baseline limpio.

Si aparece una anomalía, debe corregirse en ManyHands y repetirse el run
original. No se reemplaza silenciosamente por una fixture más fácil.

### Gate de salida

Dos ejecuciones consecutivas del escenario canónico deben producir resultados
válidos o, si los commits difieren por implementación legítima, satisfacer los
mismos criterios y evidencias. Al menos una ejecución debe usar Codex real; una
fixture visual puede existir únicamente como fallback de presentación.

## 11. Etapa 5 — Ejecutar el experimento

### Objetivo

Evaluar exploratoriamente si la política adaptativa ofrece un trade-off
prometedor frente a estrategias de granularidad fija. La tesis no debe presentar
un benchmark exploratorio como demostración universal.

### Preguntas de investigación mínimas

- **RQ1:** ¿Cómo cambia la tasa de entrega verificada entre granularidad de hoja
  única, sobre-división fija y política adaptativa?
- **RQ2:** ¿Qué trade-off existe entre éxito, duración, tokens/costo y overhead
  de coordinación?
- **RQ3:** ¿Qué tipos de falla, retry, stale result o conflicto aparecen en cada
  configuración?

### Condiciones

Evaluar las mismas tareas bajo:

1. **A — Single leaf:** se prohíbe descomponer.
2. **B — Fixed fine-grained:** se aplica una regla fija y documentada.
3. **C — Adaptive:** se utiliza la política productiva de ManyHands.

Mantener constantes:

- repositorio y base commit;
- objetivo y criterios;
- modelo, esfuerzo y executor;
- presupuesto y timeouts;
- versión de ManyHands;
- comandos de validación;
- hardware y entorno, cuando sea posible.

El orden de las condiciones debe alternarse o randomizarse para reducir sesgos
temporales del proveedor.

### Tamaño mínimo

Para conservar carácter exploratorio:

- mínimo aceptable: 3 tareas × 3 condiciones × 3 repeticiones = 27 runs;
- recomendado: 5 tareas × 3 condiciones × 3 repeticiones = 45 runs.

Si costo o tiempo obligan a reducir el diseño, debe documentarse antes de
observar resultados. No se elimina selectivamente una corrida porque perjudique
la hipótesis.

### Métricas

Métricas primarias:

- entrega verificada del objetivo;
- cobertura de criterios;
- duración wall-clock;
- tokens y costo;
- cantidad de attempts y retries;
- fallos de validación e integración;
- decisiones humanas requeridas.

Métricas estructurales:

- profundidad;
- cantidad de hojas;
- branching factor;
- unidades coalesced;
- tamaño de contexto;
- resultados `stale`;
- conflictos evitados o materializados.

`GEI` puede mantenerse como métrica secundaria, pero siempre acompañado por sus
componentes. Se debe versionar su fórmula, unidades y tratamiento de
denominadores cero. No debe ser la única base de comparación.

### Análisis

El análisis debe reportar:

- datos crudos completos;
- mediana, rango e idealmente IQR por condición;
- resultados por tarea y agregados;
- fallos y outliers, no solo promedios;
- sensibilidad a costos y a la fórmula de `GEI`;
- limitaciones y amenazas a la validez;
- ausencia de significancia estadística cuando el tamaño no la permita.

### Entregables

```text
docs/tesis/evidence/experiment/
  protocol.md
  environment.json
  tasks/
  raw/runs.csv
  raw/run-artifacts/
  derived/summary.csv
  scripts/
  analysis.md
  limitations.md
```

Cada fila de `runs.csv` debe apuntar a un `runId`, commit de ManyHands, base
commit, configuración y artefactos verificables.

### Gate de salida

La etapa pasa cuando:

- todas las celdas planificadas tienen resultado o una razón de ausencia;
- los scripts regeneran tablas y métricas desde datos crudos;
- una muestra de runs puede auditarse hasta commits y journals;
- las conclusiones distinguen observación, inferencia y limitación;
- no existen números manuales sin procedencia.

## 12. Etapa 6 — Corregir tesis y presentación

### Objetivo

Alinear el relato académico con la versión demostrada de ManyHands.

### Trabajo sobre la tesis

1. Reescribir resumen, objetivos y conclusiones desde la matriz de claims.
2. Describir ManyHands como control plane local; no afirmar inferencia local ni
   privacidad absoluta cuando se usan proveedores remotos.
3. Remover SQLite WAL y cualquier otra capacidad diferida, o moverla a trabajo
   futuro.
4. Explicar con precisión la frontera Planner → adaptive policy → Graph
   Compiler.
5. Incluir metodología reproducible, no solo resultados.
6. Incorporar:

   - protocolo;
   - repositorios y tareas;
   - configuraciones;
   - métricas;
   - resultados;
   - amenazas a la validez;
   - limitaciones del estudio exploratorio.

7. Aumentar y verificar bibliografía académica, URLs/DOIs y citas.
8. Sustituir sintaxis Markdown dentro de LaTeX por comandos válidos.
9. Compilar el PDF desde cero y revisar:

   - referencias;
   - figuras y tablas;
   - cortes de página;
   - warnings;
   - metadatos;
   - ortografía y consistencia terminológica.

### Trabajo sobre la presentación

La presentación debe seguir una narrativa breve:

1. problema;
2. hipótesis de diseño;
3. arquitectura mínima;
4. demo del run canónico;
5. evidencia experimental;
6. limitaciones;
7. trabajo futuro.

Debe existir:

- guion de demo;
- checklist de preparación;
- fixture visual offline;
- video o capturas de respaldo;
- paquete del run canónico;
- respuestas preparadas sobre validez, privacidad, costos y reproducibilidad.

La fixture de respaldo debe estar claramente rotulada. Nunca se presenta como
un run real.

### Gate de salida

La etapa pasa cuando:

- la tesis compila desde un entorno documentado;
- la matriz claim-evidence no tiene claims sin respaldo;
- tablas y gráficos se generan desde el dataset;
- el PDF y la presentación usan la misma terminología y números;
- la demo fue ensayada desde un baseline limpio;
- una falla del proveedor LLM no impide explicar y demostrar el resultado.

## 13. Gates globales

| Gate | PASS obligatorio | Evidencia |
|---|---|---|
| G1 — Scope | Claims clasificados y alcance aprobado | Matriz claim-evidence |
| G2 — Reproducibilidad | Fresh install y checks verdes | Logs + CI sobre commit |
| G3 — Adaptive | Política usada por planning productivo | Events/artifacts + tests |
| G4 — Canonical run | `completed` con entrega válida | Journal, SHAs, manifest, receipt |
| G5 — Experiment | Datos y análisis regenerables | Dataset + scripts |
| G6 — Thesis | PDF y demo coherentes | PDF, deck, traceability review |

El programa no está completo si un gate anterior vuelve a rojo. Una regresión en
G2 durante G4 obliga a reparar G2 antes de aceptar el run.

## 14. Convención de evidencia

Todo artefacto nuevo de cierre debe vivir bajo:

```text
docs/tesis/evidence/
  README.md
  baselines/
  gates/
  canonical-run/
  experiment/
  traceability/
```

Cada evidencia debe incluir:

- fecha UTC;
- commit de ManyHands;
- comando o procedimiento;
- versión de toolchain;
- exit code;
- resultado resumido;
- ruta al output completo;
- limitaciones conocidas.

Secretos, tokens, prompts privados y rutas personales deben redactarse antes de
versionar evidencia.

## 15. Formato obligatorio de handoff

Cada agente debe cerrar su trabajo con:

```text
Stage:
Objective:
Commit/baseline:
Files changed:
Behavior changed:
Tests added first:
Commands executed:
Results:
Evidence artifacts:
Anomalies and root causes:
Open decisions:
Gate status: PASS | FAIL | PARTIAL
Next authorized action:
```

`PASS` solo es válido cuando se adjunta la evidencia completa del gate.
`PARTIAL` no habilita automáticamente la etapa siguiente.

## 16. Próxima acción autorizada

La próxima acción es exclusivamente la **Etapa 1 — Congelar alcance**.

El agente responsable debe producir la matriz claim-evidence a partir de:

- `PRODUCT.md`;
- `docs/DECISIONS.md`;
- `docs/core-pillars/`;
- `docs/system/`;
- código productivo;
- tests;
- runs persistidos;
- `docs/tesis/main.tex`.

No debe comenzar una nueva implementación durante ese inventario. Al finalizar,
debe presentar las decisiones de alcance que requieran aprobación de Francisco.
Una vez aprobado G1, el siguiente agente puede iniciar la estabilización de
toolchain y gates.
