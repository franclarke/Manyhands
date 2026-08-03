# ManyHands — Decisiones de arquitectura vigente

> Estado: vigente. La ruta productiva V2 implementa estas decisiones. Los ADR
> explican alternativas y trade-offs; `docs/system/` especifica los contratos
> técnicos y código/tests/persistencia aportan la evidencia operacional.

## A1. La documentación fija el contrato y declara el estado real

La arquitectura se define por el producto y sus contratos, no por accidentes de
implementación. Una función existente no se considera correcta por el solo hecho
de existir y una capacidad documentada no se presenta como operativa sin
evidencia en código, tests y, cuando corresponde, un run persistido.

Consecuencia: auditorías y cambios deben distinguir `implemented`, `partial`,
`missing` e `incompatible`. Los planes cerrados son evidencia histórica; las
brechas nuevas se registran como drift o trabajo de migración explícito.

## A2. El run es la unidad de producto

Un run transforma un objetivo de software y un contexto inmutable de repositorio
en un resultado integrado, verificado y entregable. Tareas, contratos, waves,
intentos y decisiones existen dentro del run; no son productos independientes.

Estados de lifecycle objetivo:

`planning → needs_approval → running → result_ready → delivering → completed`

Estados alternativos: `waiting_for_input`, `paused`, `cancelling`,
`interrupted` y `failed`. `waiting_for_input` solo se usa cuando no queda trabajo
independiente ejecutable.

## A3. El grafo usa un modelo híbrido optimizado para implementar software

La raíz representa el objetivo del usuario. Los composites representan límites
reales de integración —módulo, dominio, paquete, aplicación o incremento
vertical— y las hojas son los cambios cohesivos más pequeños que pueden
implementarse y verificarse de forma independiente.

No se fuerza una división uniforme frontend/backend, una profundidad fija ni un
número fijo de hijos. Una hoja puede atravesar UI, API y tests si ese corte
produce una unidad vertical más coherente. La forma del grafo debe seguir al
repositorio y a las fronteras de integración, no a una plantilla de demo.

## A4. Planning es una transacción durable con semántica canónica

El adaptador de modelo sólo propone un `SemanticPlanDraft` compacto y no
confiable. No puede elegir IDs persistentes, hashes, snapshot, revisiones,
comandos ni estado. `PlanningModule.start/resume/replay` posee la transacción:
congela contexto y protocolo, persiste cada receipt, canoniza una única
`SemanticPlan`, selecciona un `ExecutionCut`, compila el grafo y confirma el
outcome terminal bajo el fencing token antes de devolver `ready`.

El Graph Compiler proyecta el plan y el corte a nodos, relaciones, contratos,
scopes, validaciones y requisitos de artefactos. El Run Coordinator adquiere la
lease y continúa ejecución; no orquesta candidatos ni reimplementa quorum.

Antes de aprobación se ejecutan críticos de completitud, atomicidad,
compatibilidad de contratos, validez del DAG, aislamiento, riesgo y cobertura de
validación. La falla de un modelo se reporta; no se reemplaza silenciosamente por
un plan determinista de otra calidad.

## A5. Jerarquía, disponibilidad, compatibilidad y riesgo son relaciones diferentes

El modelo no usa una arista genérica `dependency` para todo:

- `parentId`: ownership de integración y jerarquía.
- `ArtifactRequirement`: un nodo necesita un resultado materializado de otro.
- `SeamBinding`: productor y consumidores comparten un contrato compatible; no
  impone orden por sí solo.
- `ConflictConstraint`: señal de scheduling o exclusión de recursos; no es una
  dependencia funcional.

Estas relaciones tienen una única representación canónica. No se duplican en
campos del nodo y listas globales sincronizadas manualmente.

## A6. No se pretende conocer todas las dependencias futuras

El planner declara lo que puede justificar con el repositorio y los contratos.
Si un agente descubre una dependencia ausente, el intento no la oculta: emite
una propuesta de enmienda con evidencia, relación nueva e impacto calculado.

La enmienda crea una nueva revisión del grafo. Solo los intentos cuyo
`InputFingerprint` dejó de coincidir quedan obsoletos. El trabajo independiente
se preserva.

## A7. Los contratos definen obligaciones, no detalles prematuros

Cada hoja recibe:

- objetivo y criterios de aceptación;
- `ScopeContract`;
- contratos de seam consumidos y producidos;
- requisitos y outputs de artefactos;
- `ValidationContract`;
- contexto y base de ejecución identificables.

El `ValidationContract` congela qué debe demostrarse. La `ValidationRecipe`
puede compilarse más tarde según el repositorio real. No se congela de manera
prematura un comando exacto cuando todavía puede cambiar legítimamente.

## A8. Los intentos son inmutables y adoptables solo contra entradas exactas

Cada intento tiene identidad propia y un `InputFingerprint` que incluye, como
mínimo, identidad del nodo, revisiones de contratos, commit base, artefactos
consumidos, contexto, perfil de executor y contrato de validación. El fingerprint
es deliberadamente node-local: la revisión global del grafo **no** es una de sus
entradas. Así una enmienda ajena que sube la revisión no invalida un nodo
independiente (ver A6); la revisión viaja como procedencia del intento, no como
identidad de elegibilidad.

Un intento puede terminar técnicamente y aun así quedar `stale`. Un resultado
obsoleto nunca se integra. Reintentar crea otro intento; no reescribe evidencia
anterior.

## A9. La base de ejecución se construye explícitamente

El `ExecutionBaseBuilder` compone el commit base del run, el baseline de
contratos y únicamente los artefactos requeridos por el nodo. Registra un
manifest de composición y evita aplicar commits transitivos a ciegas.

Los siblings pueden trabajar en paralelo cuando un seam congelado les permite
implementar contra la misma frontera. Si un nodo necesita archivos concretos de
otro, eso se modela como `ArtifactRequirement` y su base debe incluirlos.

## A10. El scheduler decide por readiness, presupuesto y riesgo

Un nodo está listo cuando sus contratos son vigentes, sus artefactos requeridos
están disponibles, su base puede materializarse y no existe una restricción de
recurso activa. El límite de paralelismo es configuración efectiva persistida,
no una constante arquitectónica.

La incertidumbre aumenta cautela; nunca se convierte silenciosamente en bajo
riesgo. Cada wave queda registrada antes de despachar trabajo.

## A11. Los fallos se recuperan según su causa

La política objetivo es:

| Causa | Respuesta automática |
|---|---|
| transitorio | reintento acotado |
| autenticación, binario o entorno | suspender recurso y pedir corrección |
| código o test local | un intento de reparación en el mismo worktree |
| contrato o descomposición incorrectos | proponer enmienda/replan local |
| dependencia no declarada | registrar y enmendar el grafo |
| scope o commit inesperado | descartar intento |
| integración | una reparación semántica; luego decisión humana |
| infraestructura compartida | suspender solo trabajo afectado |

No existe “reintentar tres veces” como respuesta universal. Tampoco se puede
aceptar un resultado fallido como si estuviera verificado.

## A12. El event log contiene hechos; los snapshots y la UI son proyecciones

Los eventos de dominio se emiten en la frontera real del efecto. El event log
append-only es la historia dinámica canónica. Los snapshots son materializaciones
versionadas para carga y recuperación, no una segunda verdad.

Estado de fase, nodo, atención, freshness, progreso y resultado se deriva mediante
reducer y selectores. Las trazas de modelos y logs de proceso son telemetría
separada; no gobiernan el lifecycle.

## A13. Las decisiones humanas son recursos locales y no bloquean lo independiente

Toda intervención se representa como `Decision` con pregunta, opciones,
evidencia, nodos afectados, impacto, la revisión de grafo contra la que se
levantó y estado. Resolverla produce `decision.resolved` y puede generar una
revisión de grafo o contrato.

Una decisión pendiente registra su base (`raisedAtGraphRevision`). Si se aprueba
una revisión posterior que supera esa base, la decisión se marca `expired`
mediante `decision.expired` en lugar de aplicarse con premisa obsoleta; deja de
bloquear sus nodos afectados. Las aclaraciones previas al grafo no tienen base de
revisión y no se expiran automáticamente.

Una decisión bloquea únicamente los nodos cuyo readiness depende de ella. El run
sigue en `running` mientras exista trabajo independiente; cambia a
`waiting_for_input` solo cuando la decisión es el único impedimento restante.

Decisiones principales: aclaración de objetivo, aprobación de plan, aprobación
de enmienda, resolución de conflicto conductual y aprobación de entrega.

## A14. La integración es bottom-up y produce artefactos explícitos

Cada composite integra los resultados adoptados de sus hijos sobre una base
conocida, registra los artefactos aplicados y valida su propio contrato. Un
cherry-pick limpio no prueba corrección semántica.

Los conflictos se clasifican antes de actuar. El sistema puede hacer una
reparación semántica acotada con contexto del padre, contratos, resultados y
evidencia. Si no converge, escala una decisión; no oculta hijos omitidos ni crea
un “éxito parcial” ambiguo.

## A15. Validar significa demostrar criterios sobre el commit exacto

La validación ocurre en un sandbox limpio sobre el commit candidato exacto. Una
`EvidenceMatrix` vincula cada criterio de aceptación con evidencia:
`satisfied`, `failed`, `uncovered`, `flaky` o `not_applicable` con justificación.

Se registra baseline previo, se detecta debilitamiento de tests y se usa control
negativo cuando sea razonable. Un test que solo pasa después de reintentos se
considera flaky, no evidencia limpia. Un resultado con criterios sin cubrir es
`unverified`.

La entrega sigue `prepare → validate exact candidate → publish`. `completed`
requiere un `FinalArtifactManifest` válido y entrega confirmada.

## A16. El aislamiento se aplica en varias capas

Cada intento corre en un worktree aislado. El agente propone cambios; el
orquestador inspecciona `git diff`, aplica scope, valida y crea el commit
candidato. El stdout nunca define qué cambió.

Los procesos quedan bajo un supervisor cancelable. Mutaciones del run y del
repositorio usan leases durables y fencing tokens para impedir resultados
tardíos. La cancelación invalida la autoridad antes de aceptar nuevos eventos o
artefactos.

## A17. El grafo es el centro de la experiencia, no toda la experiencia

Durante planning y ejecución el workspace se organiza alrededor del grafo. Las
superficies separadas de Tareas, Planificación, Integración e Interfaces dejan de
ser destinos principales: esa información aparece progresivamente en el nodo o
relación seleccionada.

Cuando el run alcanza `result_ready`, la evidencia y la entrega toman el centro;
el grafo queda como mapa de procedencia. El canvas nunca se recentra por eventos,
creación de nodos o cambios de estado. Solo cambia el foco ante una acción
explícita del usuario. La jerarquía permanece visible y las relaciones tipadas se
revelan mediante lentes explícitos o el vecindario del nodo seleccionado.

Las decisiones se anuncian en una franja global con alcance contextual. Al
elegir una, la UI selecciona el nodo afectado y muestra pregunta, evidencia,
impacto y opciones en el inspector persistente; no abre un modal que oculte el
grafo. La franja permite recorrer pendientes sin convertirse en un dashboard.

## A18. El dominio no depende de LangGraph, React Flow ni un executor específico

`TaskGraph`, contratos, eventos, intentos, artefactos y estados pertenecen al
dominio. LangGraph puede implementar el control plane y React Flow el canvas,
pero ninguno define la semántica persistida.

La ejecución usa el seam `AgentExecutor`. Los perfiles concretos son
configuración y pueden evolucionar sin cambiar el contrato del run. La falta de
un executor configurado falla de forma explícita.

## A19. Simplicidad de producto antes que diagnóstico avanzado

La superficie principal debe permitir: entender el plan, observar trabajo real,
responder decisiones, pausar o cancelar y aceptar un resultado probado. Logs,
trazas, prompts, manifests y diagnósticos completos existen bajo demanda para
explicar evidencia, no como navegación primaria.

No se incorpora un “modo diagnóstico avanzado” independiente mientras esos
datos puedan resolverse mediante progressive disclosure en el mismo run.

## A20. Grounding exacto y worktrees reciclables conservan identidad

Un `RepositorySnapshot` cacheado por commit representa exclusivamente los bytes
de ese commit. El working tree dirty requiere una vista separada y nunca puede
contaminar `index-<commit>.json`. Ripgrep y el extractor de exports producen el
`RepositoryIndex` canónico; métricas de caché y timings quedan fuera del dominio.

Los worktrees reciclables implementan el mismo boundary de ejecución que los
worktrees descartables. Cada slot tiene una lease durable con token y generación
monótona, se sanea y verifica antes de entregarse, y entra en quarantine ante
cualquier resultado ambiguo. Un commit candidato se ancla antes del reset. Véase
[ADR 0011](adr/0011-exact-repository-index-and-fenced-worktree-pool.md).

## A21. La granularidad es un corte conservador del plan semántico

La política `bounded-cohesion-v1` no reescribe semántica ni compara árboles
masivos redactados por el modelo. Mantiene la raíz como boundary de integración,
ejecuta hojas declaradas y sólo colapsa un composite no raíz cuando todos sus
descendientes forman un componente conectado por seams u overlap y el conjunto
entra en límites duros de hojas, paths y outcomes. Cada assessment persiste
decisión, razones y métricas.

Una hoja que excede los hard limits rechaza sólo su propuesta antes del quorum.
En producto se solicitan dos propuestas pero una opción segura basta y registra
comparación degradada. Un protocolo experimental exige dos propuestas seguras,
semánticamente distintas y comparables. Diferencias de rationale no crean una
alternativa. El `ExecutionCut` es una proyección reproducible de la misma
`SemanticPlan`; nunca cambia ownership, criterios ni interfaces.

## Decisiones retiradas

Quedan retiradas como arquitectura vigente:

- el campo duplicado `node.dependencies`;
- dependencias con semántica exclusivamente `ordering_only`;
- fases de UX rígidas como Foundation/Supervision/Reconciliation/Disposition;
- gates que congelan el run entero por defecto;
- aceptación de fallos como equivalente a verificación;
- `maxParallel = 6` como constante de producto;
- LangGraph checkpoints como sustituto automático del event log de dominio;
- un número fijo de repairs de integración como regla universal;
- benchmarks, Lab Mode o granularidad experimental como centro del producto;
- vistas principales separadas para tareas, planificación, integración e
  interfaces;
- recentrado automático del canvas ante actividad.
- `PlanningEnvelope`, `CandidatePlan` y `WorkBreakdown` como formatos de
  escritura productiva; permanecen sólo para leer y probar historiales previos.
