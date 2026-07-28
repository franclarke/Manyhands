# 07 — Fork longitudinal retirado del mínimo científico

**What to build:** no se abre una nueva serie longitudinal ni se usa el fork
durante este cierre. La cadena queda acotada honestamente a W1 y el riesgo del
fork permanece como deuda explícita, no como infraestructura necesaria para H1
o H2.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Ningún run científico nuevo usa `--resume-state` ni hereda un prefijo
  longitudinal de otra versión.
- [x] La tesis no presenta el fork como verificado ni como parte de la
  demostración.
- [x] Si se reabre una serie longitudinal futura, las guardas de versión, base y
  modo vuelven a ser requisito previo.

## Scope disposition

Francisco reafirmó el 2026-07-28 que el cierre debe concentrarse en demostrar el
sistema real y evaluar la política de granularidad, evitando infraestructura
intermedia sin poder discriminante. Un nuevo W2 dejó de formar parte del mínimo;
por tanto, implementar y validar el fork ya no desbloquea evidencia requerida.

La implementación existente no se declara correcta ni se modifica. Se conserva
como deuda fuera del alcance de la tesis. La ruta científica activa usa una
base W1 verificada y una serie ancha nueva sin `--resume-state`.
