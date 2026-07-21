# Autoencuadre conmutable del grafo

**Estado:** implementado  
**Fecha:** 2026-07-18

## Objetivo

Permitir que el operador elija si el canvas debe volver a encuadrarse cuando se
agregan nodos durante un run, sin perder la garantía actual de que el viewport
no se mueve por cambios de estado, selección, lentes o actividad.

## Diseño

La toolbar compartida del grafo incorpora un switch accesible `Autoencuadre`,
activado por defecto tanto en runs reales como de muestra. Mientras permanece activo, el canvas observa
únicamente la firma ordenada de IDs de nodos y ejecuta `fitView` después de un
cambio estructural. Desactivarlo devuelve inmediatamente el control exclusivo
del viewport al operador. `Encuadrar` continúa disponible como acción puntual.

No se persiste la opción entre runs o recargas: es un modo temporal de
seguimiento para la ejecución visible, no una preferencia global. El control usa
semántica `role="switch"`, `aria-checked`, foco visible y tokens existentes.

## Verificación

- Regresión estática: estado inicial activado, un único control y efecto
  condicionado por la firma estructural.
- Typecheck web y lint del componente afectado.
- Inspección visual del switch apagado/encendido y crecimiento del fixture.
