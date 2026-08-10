# Defectos abiertos de la etapa 7 — diseño de las correcciones

**Origen:** las tres pasadas del ensayo SP2 del 2026-08-07 (`1bb2b66b`,
`209c3e59`, `dbb427ca`). Ver
[`docs/tesis/evidence/semantic-planning/sp2-preregistration.md`](../../docs/tesis/evidence/semantic-planning/sp2-preregistration.md)
§4.1–4.2.

Cuatro defectos quedaron corregidos en la sesión, cada uno con regresión roja
previa. Este documento diseña los que **siguen abiertos**, y sólo esos.

## Qué gobierna estas decisiones

La etapa 7 acepta dos resultados: `PASS` con 2/2 celdas, o **un resultado adverso
atribuible con causa observable**. Todo lo de abajo se juzga contra esa segunda
mitad. Un defecto que hace fracasar una celda por algo que no es ManyHands, o que
hace ilegible la causa de un fracaso real, destruye la medición aunque el sistema
funcione.

Por eso el orden no es por dificultad sino por **qué contamina la medición**:

| # | Defecto | Efecto sobre la medición | ¿Bloquea el freeze? |
|---|---|---|---|
| 01 | El ejecutor hereda la configuración global del operador | Una celda puede fracasar por un archivo que ManyHands nunca pidió, y queda registrado como violación de scope del sistema | **Sí** |
| 02 | `unclassified` absorbe causas nombrables | Un fracaso real queda sin causa observable | **Sí** |
| 03 | El ref por intento repite el `runId` | Limita dónde puede vivir un target; ya mató una pasada | No, con la regla de ruta corta |
| 04 | Integración y entrega nunca se ejercitaron | La mitad del pipeline no tiene evidencia | **Sí** |

## Lo que no se hace acá

- No se toca la deuda D5, D6, D8 ni D12. Son del plan, no del ensayo.
- No se ajusta ningún umbral para que una celda pase. Se corrige lo que está
  demostrablemente mal medido y se reporta aparte si el caso sigue fallando.
- No se agregan clases de falla especulativas. Sólo las dos observadas, cada una
  con su regresión derivada de la observación registrada.

## Método

Todo cambio conductual: regresión roja **por la razón correcta**, fix mínimo,
verificación contra el caso observado —no contra un fixture nuevo, que siempre
pasa en frío—. Un fix que no se comprueba contra la observación que lo motivó no
está verificado; esta sesión ya produjo un caso donde el fix movió el defecto una
capa en vez de cerrarlo, y sólo se vio al buscarlo a propósito.
