Ejecutá de principio a fin el plan de finalización de ManyHands correspondiente a las Etapas 2 a 6.

Tu objetivo es dejar completa, estable, verificable y defendible tanto la implementación de ManyHands como la tesis y su presentación. No te limites a describir trabajo pendiente, actualizar checklists o realizar correcciones parciales: implementá, probá, ejecutá, recopilá evidencia y reescribí los documentos necesarios hasta completar todo lo materialmente posible en esta sesión.

## Fuentes de verdad

Usá las siguientes fuentes, en este orden:

1. El código y comportamiento real del repositorio.
2. `stage-execution-plan.md`.
3. `THESIS_COMPLETION_ROADMAP.md`.
4. Los documentos relacionados dentro de `docs/tesis/`, especialmente:
   - `research-questions.md`
   - `claim-evidence-matrix.md`
   - `deferred-capabilities.md`
   - `DECISIONS.md`
   - la evidencia ya recopilada.
5. Las tesinas o tesis de otros autores almacenadas en el repositorio como ejemplos de referencia académica.

Cuando haya contradicciones entre documentación y código, investigá el estado real. No preserves afirmaciones desactualizadas por inercia.

---

# Modo de trabajo

Trabajá autónomamente y de manera continua hasta alcanzar la condición de finalización.

No me pidas confirmación para decisiones técnicas reversibles. Para las decisiones abiertas del plan, adoptá por defecto las recomendaciones ya establecidas, salvo que la evidencia del repositorio demuestre que existe una opción más correcta:

- D-6: Node 22 + pnpm 7.29.3, manteniendo el lockfile compatible.
- D-7: extracción híbrida de señales de complejidad: propuesta semántica del LLM más validación determinista contra el `RepositorySnapshot`.
- D-8: refactorizar el `RecursiveDecomposer` para emitir señales y delegar la frontera de descomposición a la política adaptativa, evitando mantener dos planificadores competidores.

Solo frená para consultarme cuando aparezca una acción realmente irreversible, destructiva, económicamente costosa o dependiente de credenciales o información imposible de inferir.

Antes de modificar cada área:

1. Inspeccioná la implementación real.
2. Localizá sus tests y consumidores.
3. Contrastá el comportamiento observado con el plan.
4. Identificá la causa raíz de cualquier inconsistencia.
5. Ajustá el diseño si el plan quedó desactualizado.
6. Implementá sobre los modelos canónicos existentes.
7. Evitá crear representaciones, pipelines o estados paralelos.

No confíes en stdout, resúmenes de agentes o comentarios como prueba de cambios. Verificá mediante:

- `git status`
- `git diff HEAD`
- historial de commits
- tests y builds
- eventos persistidos
- manifests y receipts
- artefactos de evidencia
- estado real del repositorio resultante

---

# Orden de ejecución obligatorio

Ejecutá las etapas en este orden:

1. Estabilización de toolchain, instalación limpia, tests, typechecks y builds.
2. Integración productiva de la granularidad adaptativa.
3. Run canónico end-to-end, incluyendo delivery real.
4. Experimento reproducible.
5. Reescritura completa de la tesis.
6. Actualización y validación de la presentación y material de defensa.

No avances a una etapa posterior mientras el gate anterior esté rojo.

Si una modificación posterior rompe un gate ya validado, detené el avance, repará la regresión y volvé a verificar ese gate.

---

# Calidad de ingeniería

Para cualquier cambio conductual aplicá TDD:

1. Reproducí el fallo o comportamiento faltante.
2. Escribí o identificá una regresión que falle por la causa correcta.
3. Implementá el arreglo mínimo.
4. Refactorizá cuando sea necesario.
5. Corré primero los tests enfocados.
6. Corré luego todos los gates amplios afectados.

No:

- debilites assertions;
- ocultes errores;
- agregues `continue-on-error`;
- cambies tests solo para hacerlos pasar;
- introduzcas bypasses temporales;
- uses fixtures engañosas como sustituto del flujo productivo;
- evites una falla real cambiando silenciosamente el escenario.

Ante un problema, pensá como un equipo senior de ingeniería: investigá su causa raíz, su impacto sistémico y la solución arquitectónicamente correcta. No hagas un parche superficial si el defecto revela una inconsistencia más profunda.

---

# Invariantes de ManyHands

Preservá estos invariantes durante todo el trabajo:

- `git diff HEAD` es la fuente de verdad de lo modificado por un agente.
- Los agentes no realizan commits; el orquestador los crea.
- El aislamiento proviene de git worktrees y `ScopeChecker`.
- `graph.dependencies` es canónico.
- `node.dependencies` debe permanecer sincronizado como shortcut.
- `goal` es el campo canónico; no reintroduzcas `intent`.
- La integración se realiza bottom-up mediante cherry-pick.
- Los conflictos se reparan semánticamente con contexto del padre, interfaces y diffs.
- El máximo de repairs por integración es cuatro.
- El scheduling productivo es `risk_aware`.
- Las tareas con scopes solapados deben serializarse.
- `run.scheduling.wave_selected` debe persistirse antes del dispatch.
- Las decisiones humanas bloqueantes se gestionan mediante el `execution-gate-service`.
- El estado `gated` se deriva de decisiones pendientes.
- Las transiciones deben validarse con `assertRunActionAllowed`.
- No se integran candidatos fallidos, `stale` o no verificados.
- La validación debe ejecutarse sobre el commit exacto.
- Deben existir manifest y receipt antes de considerar un run `completed`.
- No recentres automáticamente el canvas.

No reintroduzcas:

- Gemini CLI;
- Lab Mode;
- rutas `/lab` o `/replay`;
- manifests deterministas históricos;
- baselines B0-B4 históricos;
- metas académicas retiradas;
- modelos de grafo paralelos;
- componentes legacy innecesarios.

---

# Runs y evidencia real

Cuando necesites ejecutar ManyHands para obtener evidencia:

- Usá Claude Sonnet para planning.
- Usá Codex para execution.
- Usá la configuración real del flujo productivo.
- Registrá modelo, executor, effort, versiones, configuración, timeouts y presupuestos.
- Creá repositorios Git nuevos, aislados y externos al repositorio de ManyHands.
- Cada repositorio debe tener commit inicial, estructura mínima real y tests inicialmente verdes.
- Usá aplicaciones pequeñas y fáciles de comprender, pero suficientemente completas para ejercer el sistema.

Preferí escenarios como:

- división de gastos grupales;
- gestión sencilla de tareas;
- inventario pequeño;
- reservas simples;
- seguimiento de hábitos.

Los escenarios deben permitir observar:

- cambios de dominio;
- API;
- interfaz web;
- tests;
- contratos o seams entre tareas;
- ejecución en más de un archivo;
- integración bottom-up;
- delivery verificable.

No simplifiques artificialmente una tarea para evitar un bug de ManyHands.

## Run canónico

Para el run canónico:

1. Congelá el repository base SHA.
2. Congelá goal, aceptación y configuración.
3. Ejecutá planning adaptativo.
4. Verificá la persistencia de assessments y decisiones.
5. Ejecutá hojas en worktrees aislados.
6. Verificá el diff real.
7. Validá el commit exacto.
8. Integrá bottom-up.
9. Ejecutá delivery.
10. Confirmá que `finalSha !== baseSha`.
11. Verificá ancestry, manifest y receipt.
12. Confirmá que los cambios existen en el repositorio final.
13. Corré los tests del resultado entregado.
14. Registrá cualquier limitación o intervención humana.

Toda evidencia debe almacenarse bajo `docs/tesis/evidence/` e incluir, según corresponda:

- fecha UTC;
- commit de ManyHands;
- base SHA y final SHA;
- configuración;
- comandos ejecutados;
- toolchain;
- exit codes;
- resultados;
- run IDs;
- eventos;
- journals;
- contracts;
- graph revisions;
- assessments de complejidad;
- diffs;
- commits candidatos;
- manifests;
- receipts;
- métricas;
- capturas;
- logs relevantes;
- anomalías y limitaciones.

Un gate no pasa porque exista un test unitario. Debe existir el paquete completo de evidencia exigido por el plan.

---

# Manejo de fallos durante los runs

Cuando un run falle:

1. Clasificá la causa:
   - defecto de ManyHands;
   - defecto del repositorio objetivo;
   - executor;
   - proveedor externo;
   - configuración;
   - ambiente.
2. Preservá eventos, logs, artefactos, SHAs y estado del run.
3. Si es un defecto de ManyHands:
   - reproducilo;
   - agregá una regresión;
   - corregí la causa sistémica;
   - corré los gates afectados;
   - reintentá desde un baseline limpio.
4. No reemplaces una ejecución real fallida por una fixture.
5. No ocultes el problema modificando el escenario.
6. No declares evidencia completa cuando solo existe una ejecución parcial.

Podés generar una fixture visual o un video de respaldo para la defensa, pero debe quedar claramente identificado como material de respaldo y nunca mezclado con la evidencia empírica real.

---

# Agotamiento de tokens o cuota externa

Si Claude Sonnet, Codex o cualquier proveedor deja de estar disponible por agotamiento de tokens, cuota o límite:

1. Confirmá y registrá el error exacto.
2. No reintentes indefinidamente.
3. No inicies nuevos runs dependientes de ese proveedor.
4. Conservá toda la evidencia válida obtenida.
5. Continuá con todo lo que pueda realizarse sin nuevas invocaciones:
   - implementación;
   - tests locales;
   - builds;
   - scripts experimentales;
   - procesamiento de resultados;
   - documentación;
   - organización de evidencia;
   - reescritura de la tesis basada en evidencia disponible;
   - presentación;
   - instrucciones de reproducción.
6. Marcá explícitamente qué runs quedaron pendientes.
7. No inventes datos.
8. No extrapoles resultados inexistentes.
9. No presentes un experimento parcial como concluido.
10. Adaptá las conclusiones de la tesis a la evidencia efectivamente disponible.
11. Dejá preparado un procedimiento exacto de reanudación para una sesión futura.

El agotamiento de tokens debe detener únicamente la obtención de nueva evidencia externa, no el resto del plan.

---

# Reescritura completa de la tesis

La redacción actual de la tesis debe considerarse un **borrador preliminar de contenido**, no una versión cercana a la definitiva.

No realices únicamente correcciones locales, retoques de estilo o parches sobre la estructura existente. Tu responsabilidad en esta etapa es realizar una **reescritura académica integral de la tesis**, desde su organización general hasta la redacción de cada capítulo.

La tesis actual puede reutilizarse como fuente de:

- hechos verificados;
- descripciones técnicas;
- decisiones históricas relevantes;
- referencias;
- tablas;
- figuras;
- datos experimentales;
- evidencia ya confirmada.

No debe tratarse como autoridad en:

- estructura;
- estilo;
- tono académico;
- orden argumental;
- nivel de rigurosidad;
- formulación de objetivos;
- presentación de metodología;
- interpretación de resultados;
- conclusiones.

## Análisis previo obligatorio de tesinas de referencia

Antes de reescribir la tesis:

1. Localizá todas las tesis y tesinas de otros autores almacenadas en el repositorio como ejemplos.
2. Generá un inventario con:
   - nombre del archivo;
   - autor, si está disponible;
   - carrera o área;
   - año;
   - extensión;
   - estructura principal;
   - relevancia como referencia.
3. Leé completamente las más representativas. No te limites al índice o a fragmentos aislados.
4. Analizá comparativamente:
   - estructura macro de la obra;
   - organización de capítulos;
   - extensión relativa de cada sección;
   - estilo de introducción;
   - formulación del problema;
   - objetivos generales y específicos;
   - preguntas de investigación;
   - estado del arte;
   - nivel de detalle técnico;
   - metodología;
   - forma de presentar diseño e implementación;
   - protocolo experimental;
   - tratamiento de resultados;
   - amenazas a la validez;
   - conclusiones;
   - trabajo futuro;
   - uso de figuras y tablas;
   - estilo de citas y bibliografía;
   - formalidad del lenguaje;
   - uso de primera persona o construcciones impersonales;
   - convenciones LaTeX;
   - profundidad esperable para una tesina de Ingeniería en Sistemas.
5. Identificá patrones comunes y diferencias entre los ejemplos.
6. No copies frases, párrafos ni estructuras de manera mecánica.
7. Usá las tesinas como referencia de rigurosidad, nivel académico y convención institucional, no como contenido para imitar literalmente.

Antes de comenzar la reescritura, generá un documento interno, por ejemplo:

`docs/tesis/evidence/thesis-reference-analysis.md`

Debe contener:

- inventario de tesinas;
- análisis comparativo;
- buenas prácticas detectadas;
- errores que conviene evitar;
- estándar de redacción adoptado;
- estructura propuesta para ManyHands;
- justificación de los cambios respecto del borrador actual.

## Rediseño de la estructura

Después de estudiar las tesinas de referencia:

1. Evaluá críticamente la estructura actual de la tesis.
2. No conserves capítulos o secciones solamente porque ya existen.
3. Proponé una estructura completa que construya una narrativa académica coherente.
4. Reubicá, fusionalá o eliminá secciones cuando sea necesario.
5. Separá claramente:
   - problema;
   - motivación;
   - antecedentes;
   - estado del arte;
   - propuesta;
   - arquitectura;
   - diseño;
   - implementación;
   - metodología experimental;
   - resultados;
   - discusión;
   - amenazas a la validez;
   - conclusiones.
6. Evitá que la tesis se lea como documentación interna del producto o como un historial cronológico de desarrollo.
7. La narración debe explicar una contribución técnica, no solamente enumerar features.

## Reescritura integral

Reescribí completamente:

- título, cuando sea necesario;
- resumen;
- abstract;
- introducción;
- motivación;
- planteamiento del problema;
- objetivos;
- preguntas de investigación;
- alcance;
- antecedentes;
- estado del arte;
- fundamentos técnicos;
- diseño de ManyHands;
- arquitectura;
- modelos y contratos;
- política de granularidad adaptativa;
- pipeline de planning;
- DAG y dependencias;
- worktrees y aislamiento;
- scheduling `risk_aware`;
- ejecución;
- verificación;
- integración;
- reparación semántica;
- control-plane humano;
- persistencia;
- recuperación;
- metodología experimental;
- escenarios;
- métricas;
- resultados;
- discusión;
- amenazas a la validez;
- limitaciones;
- trabajo futuro;
- conclusiones.

No traduzcas mecánicamente documentación técnica del repositorio. Convertí esa información en una explicación académica comprensible, ordenada y argumentada.

La tesis debe poder ser comprendida por un lector de Ingeniería en Sistemas que no conozca previamente ManyHands.

## Rigor y trazabilidad

Cada afirmación técnica o experimental debe clasificarse implícitamente como una de estas categorías:

- respaldada por código;
- respaldada por tests;
- respaldada por evidencia de runs;
- respaldada por bibliografía;
- interpretación razonable;
- limitación;
- propuesta de trabajo futuro.

No mezcles estas categorías de forma ambigua.

Usá `claim-evidence-matrix.md` como control de trazabilidad. Actualizala cuando sea necesario.

No afirmes que:

- una capacidad está implementada si solo está diseñada;
- una política gobierna producción si solo existe en tests;
- un run terminó correctamente sin manifest y receipt;
- un experimento está completo si faltan repeticiones;
- una mejora es significativa sin evidencia que lo demuestre;
- el sistema es seguro, privado, robusto o escalable en términos absolutos sin sustento.

Cuando la evidencia sea parcial, usá formulaciones precisas y reconocé la limitación.

## Bibliografía y estado del arte

Revisá toda la bibliografía:

- verificá autores;
- títulos;
- año;
- venue;
- DOI;
- URLs;
- datos BibTeX;
- correspondencia entre citas y referencias;
- uso real de cada fuente en el texto.

No cites una fuente si no respalda la afirmación asociada.

Diferenciá con claridad ManyHands de trabajos relacionados, sin exagerar originalidad ni presentar capacidades comunes como contribuciones inéditas.

## Figuras, tablas y resultados

- Regenerá gráficos y tablas desde datos crudos mediante scripts reproducibles.
- No edites números manualmente dentro del documento.
- Cada figura debe aportar información.
- Cada tabla debe ser explicada e interpretada.
- No incluyas capturas que funcionen únicamente como decoración.
- Mantené consistencia entre tesis, evidencia y presentación.
- Si los resultados cambian, actualizá todas sus apariciones.

## Validación editorial y técnica

Después de la reescritura:

1. Compilá la tesis desde un entorno limpio.
2. Corregí errores y warnings relevantes.
3. Revisá referencias cruzadas.
4. Revisá numeración de figuras, tablas, ecuaciones y capítulos.
5. Verificá que no haya sintaxis Markdown inválida dentro de LaTeX.
6. Revisá visualmente el PDF completo.
7. Detectá:
   - páginas en blanco inesperadas;
   - desbordes;
   - tablas cortadas;
   - figuras ilegibles;
   - títulos huérfanos;
   - referencias rotas;
   - espacios inconsistentes;
   - código demasiado pequeño;
   - saltos de página deficientes.
8. Realizá una segunda lectura editorial completa.
9. Compará el resultado final contra el estándar observado en las tesinas de referencia.
10. Confirmá que la obra final tenga un nivel de rigurosidad, claridad y presentación comparable o superior.

La finalización de esta etapa requiere una tesis reescrita integralmente, no una lista de sugerencias ni un conjunto de capítulos parcialmente corregidos.

---

# Presentación y defensa

Una vez estabilizada la tesis:

- alineá la presentación con la versión final;
- eliminá conceptos, nombres o números obsoletos;
- actualizá diagramas;
- actualizá resultados;
- mantené la misma terminología;
- diferenciá claramente arquitectura, flujo productivo, evaluación y limitaciones;
- prepará una demo reproducible;
- conservá material de respaldo claramente etiquetado;
- verificá que las notas del orador sean naturales, claras y comprensibles para personas que no conocen ManyHands.

No mantengas una slide solo porque ya existe. Rehacela si dejó de representar correctamente la tesis.

---

# Seguridad del repositorio

- Preservá cambios preexistentes que no te pertenezcan.
- No uses `git reset --hard`, `git clean -fd` ni comandos destructivos sin demostrar previamente que son seguros.
- No hagas push.
- No publiques artefactos remotamente.
- Creá commits locales pequeños y coherentes al cerrar cada etapa validada.
- No mezcles refactors masivos de nomenclatura con cambios conductuales.
- Antes de cada commit ejecutá:
  - tests relevantes;
  - `git diff --check`;
  - revisión completa del diff;
  - verificación de archivos no intencionados.

---

# Registro duradero del progreso

Mantené un registro actualizado durante toda la ejecución, no solamente al final.

Usá `docs/tesis/evidence/` o un archivo equivalente para registrar:

- etapa actual;
- tareas completadas;
- decisiones tomadas;
- bugs encontrados;
- causas raíz;
- regresiones agregadas;
- comandos ejecutados;
- resultados;
- commits creados;
- evidencia producida;
- runs realizados;
- bloqueos externos;
- tesinas analizadas;
- avance de la reescritura;
- siguiente acción exacta.

El registro debe permitir continuar el trabajo aunque la sesión se interrumpa inesperadamente.

---

# Condición de finalización

No termines por cansancio, longitud de la sesión o cantidad de archivos modificados.

Finalizá únicamente cuando ocurra una de estas condiciones:

## A. Finalización completa

Todas las etapas quedaron:

- implementadas;
- verificadas;
- documentadas;
- respaldadas por evidencia;
- reflejadas correctamente en la tesis;
- reflejadas correctamente en la presentación.

## B. Bloqueo externo real

Todo lo técnicamente realizable quedó completo y lo único pendiente depende de:

- agotamiento de tokens;
- cuota;
- credenciales;
- infraestructura externa;
- indisponibilidad de un proveedor.

En ese caso deben quedar:

- implementación estable;
- gates locales verdes;
- evidencia parcial correctamente delimitada;
- tesis reescrita de acuerdo con la evidencia disponible;
- claims pendientes eliminados o atenuados;
- runs faltantes identificados;
- procedimiento exacto de reanudación;
- archivos que deberán regenerarse después de obtener nueva evidencia.

---

# Informe final obligatorio

Al finalizar, entregá un informe preciso que incluya:

1. Estado de cada etapa:
   - `completed`
   - `partial`
   - `blocked`
2. Decisiones adoptadas y justificación.
3. Cambios de arquitectura.
4. Cambios de implementación.
5. Bugs encontrados y causas raíz.
6. Tests, typechecks, builds y comandos ejecutados.
7. Resultados y exit codes.
8. Commits locales creados.
9. Runs ejecutados.
10. Modelos y configuraciones utilizados.
11. Base SHA y final SHA de cada run.
12. Evidencia generada y ubicación.
13. Tesinas de referencia analizadas.
14. Criterios académicos extraídos de ellas.
15. Estructura anterior y estructura final de la tesis.
16. Capítulos reescritos.
17. Estado de compilación y revisión visual del PDF.
18. Estado de la presentación.
19. Limitaciones reales.
20. Trabajo pendiente, solo si existe un bloqueo externo.
21. Comandos y pasos exactos para continuar.

No uses conclusiones vagas como:

- “parece funcionar”;
- “quedó bastante completo”;
- “debería estar listo”;
- “los tests principales pasan”.

Toda conclusión debe vincularse con una prueba, un commit, un artefacto, una referencia académica o una limitación explícita.