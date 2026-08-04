# Próximo run de validación semántica

> **Estado:** diseño documentado; no ejecutado.
> **Fecha:** 2026-08-04.
> **Regla:** este documento no constituye evidencia experimental ni cambia los
> freezes, resultados u oráculos históricos de SP1/G6.

## Diagnóstico que motiva el cambio

El fallo relevante de SP1p no fue una falsa alarma del guard de scope. El plan
modeló como seam `logical` una dependencia de runtime en la que la API
exponía estado cuya implementación pertenecía a otra hoja. La reparación
intentó modificar el archivo del productor, pero el scope de la API no lo
permitía. El guard actuó correctamente; el error estaba en la granularidad
compilada.

Los fallos anteriores de materialización de artefactos y de consumo de
presupuesto ya tienen regresiones y correcciones separadas. No se reabren ni se
reintentan sus runs.

## Fixes aplicados

- El prompt exige que una superficie de runtime que expone estado de otra hoja
  cruce como artefacto `files` o `commit`, no solamente como relación lógica.
- La frontera de planificación ahora rechaza de forma determinista una seam
  `api`, `type` o `command` con materialización `logical`, mediante el
  diagnóstico `executable_seam_requires_materialization`.
- La frontera de scope estricto se conserva. Una reparación no puede ampliarlo
  para compensar un plan incorrecto.
- La solución esperada ante ese diagnóstico es una nueva propuesta de plan,
  no una modificación fuera de scope.

## Diseño recomendado para el futuro

No repetir inmediatamente la tarea de seis capas. Para validar la hipótesis
con una carga completa pero acotada, usar un vertical slice de tres hojas y un
composite de integración:

1. **Domain:** reglas de backorders y estado observable.
2. **Application:** operación que registra el backorder y emite el evento.
3. **API:** exposición del estado actual de backorders.
4. **Integration composite:** compatibilidad domain–application–API y validación
   final.

La seam API debe declarar explícitamente el artefacto materializado del
productor. No incluir fulfillment, presentación ni probe en esta primera
validación; esas capas agregan superficie, pero no son necesarias para probar
el defecto que se quiere cerrar.

### Procedimiento previo al run

- Crear dos targets limpios e independientes desde el mismo commit base.
- Registrar el SHA real de cada target y congelar configuración, prompt,
  modelo, esfuerzo, presupuesto y criterios antes de ejecutar.
- Generar el plan sin iniciar ejecución.
- Inspeccionar únicamente la salida durable del planner: cada seam ejecutable
  debe ser `files`, `manifest` o `commit`; si aparece `logical`, detener y
  considerar la celda inválida.

### Serie

- Dos repeticiones independientes, sin reintentos automáticos.
- Una sola reparación permitida únicamente dentro del scope declarado.
- Si falla una celda, conservarla como resultado adverso y no sustituirla con
  un retry.
- Ejecutar la evaluación externa sobre el commit candidato exacto de cada
  celda.
- Emitir `PASS` únicamente con 2/2 celdas completas y todos los criterios
  externos satisfechos. En cualquier otro caso, emitir `PARTIAL` o `FAIL` con
  la causa observada.

## Qué no hacer

- No abrir el servidor ni iniciar `run-experiment.mjs` como parte de este
  cambio.
- No ampliar scopes manualmente durante la ejecución.
- No convertir una seam problemática en `logical` para hacer avanzar el run.
- No modificar el protocolo histórico ni borrar la evidencia adversa de SP1.

