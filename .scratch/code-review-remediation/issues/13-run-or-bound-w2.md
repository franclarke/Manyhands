# 13 — W2 entrega o fija el límite longitudinal

**What to build:** la segunda celda longitudinal corre bajo el protocolo corregido y preserva su entrega verificada o su fallo terminal, de modo que la tesis pueda afirmar el alcance real de la cadena sin extrapolar.

**Blocked by:** 06, 07 — el driver y el fork deben respetar el protocolo antes de producir evidencia nueva.

**Status:** ready-for-agent

- [ ] W2 corre desde la entrega W1 verificada y conserva journal, resultado, diff y recibo del oráculo.
- [ ] Si entrega, el oráculo externo verifica el SHA antes de avanzar la base.
- [ ] Si falla, la cadena queda declarada como 1/8 y la causa se documenta con una sección "Qué no se concluye".
