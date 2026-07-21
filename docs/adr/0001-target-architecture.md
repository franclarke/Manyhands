# ADR 0001 — Documentación como arquitectura objetivo

## Estado

Aceptado.

## Contexto

La documentación mezclaba implementación actual, diseños congelados, auditorías,
planes cerrados y promesas de UI. Eso impedía saber qué debía conservarse y qué
era solo deuda histórica.

## Decisión

`PRODUCT.md`, `docs/DECISIONS.md`, `docs/system/` y `docs/design/` describen el
target. El código se considera una implementación parcial hasta ser auditado.
Los documentos temporales no forman parte del recorrido normativo.

## Alternativas

- **Documentar solo el código actual:** facilita precisión inmediata, pero no
  permite diseñar la transición solicitada.
- **Mantener current y target con igual autoridad:** conserva historia, pero
  perpetúa ambigüedad.
- **Target explícito + gap analysis posterior:** elegida; separa decisión de
  implementación.

## Consecuencias

- El plan de transición empieza con una matriz de brechas verificada contra el
  flujo y los paquetes actuales.
- Los docs no pueden usarse como evidencia de feature implementada.
- Cambios de arquitectura requieren actualizar varias vistas canónicas.
- Se retira documentación histórica que competía por autoridad.

## Resultado de la transición

La transición V2 se cerró el 18 de julio de 2026. Desde ese cierre, los mismos
documentos describen la arquitectura vigente y toda divergencia se registra como
drift, limitación verificada o nueva propuesta; ya no se presenta el monorepo
como una implementación V1 parcial por defecto.
