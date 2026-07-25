# Diagnóstico: el planner escribe el documento en vez de devolverlo

Estado: **causa raíz confirmada por reproducción; corrección pendiente**.

## Reproducción

Se reprodujo la llamada real de planning fuera de un run: prompt construido con
`buildWorkBreakdownPrompt` sobre el goal W1 (8079 caracteres) y exactamente los
mismos argumentos que usa `run-coordinator-host`.

    exit=0
    envelopes=system,stream_event,assistant,user,rate_limit_event,result
    stdoutBytes=346091
    resultChars=197  hasBrace=false  hasSchemaVersion=false

El `result` final, íntegro:

    No quedan preguntas pendientes que cambien comportamiento, arquitectura,
    alcance, riesgo o aceptación — todo lo necesario ya está fijado por el
    enunciado. El WorkBreakdown está completo en el plan.

El CLI **no falló**: salió con código 0. Simplemente su mensaje final no contiene
el documento, y eso es lo que ManyHands lee.

## Causa

El JSON sí existe en el stream —ocho apariciones de `schemaVersion`— pero llega
por `assistant:tool_use`, no como texto de respuesta. Las herramientas invocadas
durante la llamada fueron:

    Bash 5, Grep 3, Write 2, Glob 2, Agent 2, ...

El planner corre con el toolset agéntico completo disponible. Con un prompt
grande y una tarea que suena a trabajo, el modelo **hace el trabajo**: explora
con Bash/Grep/Glob y **escribe el WorkBreakdown con `Write`**, tratando el
documento como un artefacto a producir en el disco en vez de como la respuesta a
devolver.

Esto explica el modo de fallo dominante (`No JSON object found in response` en
las series 5, 8, 9 y 11) y también por qué se concentra en el primer intento:
los reintentos llevan `repairIssues` con "return the complete JSON again", que
reancla la tarea a devolver texto.

## Corrección de un diagnóstico previo

Una nota anterior dio por **refutada** la hipótesis de que `--permission-mode
plan` estuviera implicado, porque un probe con un prompt trivial devolvió el JSON
con y sin la bandera. Esa refutación no era válida: el probe era demasiado chico
para inducir el uso de herramientas. Con el prompt real el comportamiento
aparece. La lección es que el caso de prueba tiene que parecerse al caso que
falla.

## Dirección de la corrección

El planner no necesita herramientas: su evidencia de repositorio ya viaja dentro
del prompt, construida por `buildFastRepositorySnapshot`. Una invocación de
planning sin toolset —o con las de escritura y delegación deshabilitadas— obliga
a que la respuesta sea el documento.

No se aplicó todavía: el flag exacto debe verificarse contra el CLI instalado
antes de tocar la ruta productiva, y esa verificación es barata comparada con un
run.
