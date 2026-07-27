# 02 — El replay de C1 es honesto

**What to build:** replayar un journal historico con condicion C1 o funciona fielmente, o falla ruidosamente; nunca se reinterpreta en silencio bajo la semantica de la politica C actual.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Regresion roja primero, que falle por la razon correcta: hoy un journal C1 se resuelve a C sin aviso.
- [ ] Se elige y se documenta una de las dos salidas: replay fiel, o rechazo explicito.
- [ ] Si se elige rechazo, la reachability muerta de la politica legacy se retira.
- [ ] Los documentos que afirman que C1 sigue replayable quedan alineados con el codigo.
