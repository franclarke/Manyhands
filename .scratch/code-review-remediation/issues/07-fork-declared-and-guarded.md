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

## Closure record

- Fixed point: `eeb2f89b0657c160720e7212bc517075cab3ccaf`.
- Scope decision commit: `0cb3fc33f08c6d91b17f1f64a37236ce201b918f`.
- Review remediation commit: `f8e615e65c2aad969d9a7ba7662f80f5611172c4`.
- Files changed: este ticket, `docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md` y
  `docs/tesis/HANDOFF.md`; no cambió código, protocolo ni evidencia científica.
- Verification:
  - el frente activo no ejecuta `--resume-state`;
  - el plan y el handoff no presentan el fork como verificado;
  - `git diff --check` PASS para el recorte documental.
- Independent review at the scope decision:
  - Spec: PASS.
  - Standards: FAIL por trazabilidad transversal incompleta; sus hallazgos se
    corrigen antes del cierre final de revisión.
- Next unlocked frontier: tickets 02 y 10; se prioriza 10 porque produce la
  evidencia discriminante y 02 sólo bloquea la síntesis histórica de ticket 14.
