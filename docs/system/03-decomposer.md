# Repository Inspector, Planner y Graph Compiler

## Pipeline

```text
Goal + RunTargetContext
  -> Repository Inspector
  -> RecursivePlanner        (un corte por unidad, hasta punto fijo)
  -> Relaciones derivadas    (reads INTERSECT writes)
  -> SemanticPlan
  -> Graph Compiler
  -> GraphRevision
  -> Critics
  -> Approval candidate
```

## Repository Inspector

Lee el commit objetivo sin modificarlo. Produce:

- paquetes, módulos y dependencias;
- public APIs, schemas y símbolos relevantes;
- comandos y suites de validación;
- convenciones y límites arquitectónicos;
- estado git y restricciones operativas;
- digest/freshness del modelo.

Los datos desconocidos se marcan como unknown. No se fabrican paths o comandos
para completar el schema.

## Planner

El planner productivo es `RecursivePlanner`. **No** pide un árbol entero de una
vez: le pide al modelo **un corte de una unidad**, valida ese corte, y recursa
sobre los hijos hasta punto fijo. El contrato del corte tiene cinco campos por
hijo — `key`, `objective`, `criterionIds`, `reads`, `writes` — y nada más.

Una unidad es una **hoja ejecutable** cuando entra en el presupuesto de scope
**y escribe al menos un test**. Escribir un test es lo que la vuelve capaz de
probar algo; una unidad que sólo lee no prueba nada por generoso que sea el
presupuesto, así que la raíz siempre se corta. Las cuatro propiedades que todo
corte aceptado satisface:

| | Propiedad |
|---|---|
| P1 | Toda hoja es ejecutable: entra en presupuesto y escribe un test. |
| P2 | Las escrituras de las hojas son disjuntas. |
| P3 | Cada criterio requerido del padre queda cubierto por uno o más hijos. |
| P4 | Todo hijo reduce el scope respecto del padre. |

Un corte rechazado vuelve al modelo con los diagnósticos del validador
**verbatim**, hasta agotar los intentos de esa unidad. Una unidad que no se pudo
cortar queda `unresolved` **en su lugar** en el árbol, se registra como
`planning.unit_unresolved`, y el run falla en vez de compilar un plan que no
tiene: nunca se acepta una hoja sobre presupuesto en silencio.

**Las relaciones no las declara el modelo.** Se derivan de `reads` ∩ `writes`
entre hojas: si una hoja lee un archivo que otra escribe, hay una dependencia, y
su materialización es `files` porque la dependencia *es* de archivos. Esto hace
que un seam `logical` entre unidades ejecutables sea **irrepresentable**, no
meramente ilegal.

## SemanticPlan

El árbol resuelto se proyecta a un `SemanticPlan` canónico, que es la única
representación de planning que se persiste e intercambia. Sus unidades contienen
outcomes que cubren criterios, y cada seam contiene una sola vez productor,
consumidores, promise, compatibilidad, materialización, verificación y evidencia.
El caller no arma scopes, ownership, artifacts, obligations ni validaciones
paralelas.

`PlanningModule` —el planner de una sola pasada sobre el árbol entero— ya **no
es alcanzable en producción**. Sobrevive como sustrato del arnés de planning en
proceso y como brazo de comparación.

### Preguntas aclaratorias: hoy no hay

El contrato del corte no tiene campo de incertidumbre, así que **planning no
puede levantar una decisión `clarify_goal`**. La mitad receptora sigue en pie
—`questionAnswers` entra al planner y una decisión pendiente frena el run— pero
nada la produce. Está registrado como deuda D12 en
[`docs/plans/2026-08-05-robust-graph-execution-redesign.md`](../plans/2026-08-05-robust-graph-execution-redesign.md);
la decisión pendiente es devolverle al contrato un canal de incertidumbre o
retirar también la mitad receptora.

Cuando exista, la regla es la de siempre: una pregunta se eleva sólo si la
respuesta cambia comportamiento, arquitectura, scope, riesgo o aceptación. Las
preferencias locales reversibles se dejan al agente.

## Granularidad

La fórmula de utilidad adaptativa se sigue midiendo en cada run y se persiste
como `planning.granularity_strategy_selected` más un artefacto
`<runId>.granularity-metrics.json`, pero **no decide nada**: el árbol que compila
es el del punto fijo. La medición se escribe después de que el estado es durable,
para que algo que no es evidencia nunca pueda hacer fallar un run.

## Graph Compiler

Asigna identidad estable, compila relaciones tipadas, contratos, scopes,
validation obligations y revisions. La compilación debe ser determinista en las
partes mecánicas y rechazar ambigüedad no resuelta.

## Critics

| Critic | Pregunta |
|---|---|
| Completeness | ¿Todo criterio del objetivo tiene owner y evidencia? |
| Atomicity | ¿Cada hoja es cohesiva y descartable? |
| Graph | ¿Las relaciones son válidas y sin ciclos? |
| Contracts | ¿Seams y artifacts permiten implementar sin adivinar? |
| Scope | ¿Los límites son posibles y seguros? |
| Validation | ¿Se puede demostrar el resultado? |
| Risk | ¿El paralelismo propuesto es defendible? |

Un finding contiene severidad, evidencia, nodo/contrato afectado y reparación
propuesta. Los errores bloquean aprobación. Los warnings se muestran con
impacto; no se esconden en logs.

`criterionIds` expresa cobertura, no ownership. Un criterio transversal puede
ser referenciado por varias hojas; el owner ejecutable se deriva de forma
determinista como el ancestro común más bajo de los contribuidores terminales.
La repetición entre hermanos es válida, la repetición dentro de una unidad y los
IDs desconocidos no lo son. El contrato del owner materializa los tests de sus
descendientes y los vuelve a ejecutar sobre el candidato integrado exacto.

Una ruta mencionada en la descripción de un criterio no concede autoridad de
escritura: puede ser evidencia de lectura o un oráculo protegido. Sólo
`requiredPaths` estructurado crea una obligación de modificación y el
`CutFeasibilityCritic` la comprueba sobre la unión de escrituras de todos los
contribuidores. Esto evita rechazar un corte correcto por no reescribir el test
que justamente debe permanecer independiente.

## Fallos

- Error/timeout del modelo: falla accionable o retry transitorio según causa.
- Output inválido: el corte se rechaza y el repair devuelve al mismo modelo los
  diagnósticos del validador verbatim, sin inventar contenido.
- Unidad sin corte seguro: `planning.unit_unresolved` y `no_safe_cut`; el run
  falla en vez de compilar un plan que no tiene.
- Repo no inspeccionable: decisión de entorno o fail; nunca plan sin grounding
  presentado como confiable.
- Graph no ejecutable: vuelve al compiler/planner con findings.

## Aprobación

La aprobación refiere una revisión exacta. Editar goal, node boundaries,
contratos o criterios crea una nueva revisión e invalida la aprobación anterior.
