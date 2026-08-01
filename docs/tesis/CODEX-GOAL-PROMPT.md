# Prompt para iniciar el objetivo en Codex

> Copiá el bloque de abajo tal cual y pegalo en una tarea nueva de Codex.
> Iniciala como `/goal`, no como consulta ordinaria.

```text
/goal Completá la evidencia que falta para la tesis de ManyHands siguiendo docs/tesis/GOAL-PLAN.md etapa por etapa, y no te detengas hasta terminar la etapa 12.

Antes de tocar cualquier archivo, leé completos y en este orden:
1. docs/tesis/EVIDENCE-BASELINE.md  — lo que YA está hecho y verificado. No lo repitas ni lo re-midas.
2. docs/tesis/GOAL-PLAN.md          — el plan imperativo por etapas. Es tu guion.
3. docs/tesis/evidence/g6-preregistration.md — el diseño congelado del experimento.
4. CLAUDE.md y AGENTS.md            — reglas del repositorio.

Contexto de arranque:
- root C:\Users\franc\Documents\Proyectos\Manyhands, rama main, commit efafeab o posterior.
- NUNCA hagas push. Sólo commits locales, chicos y coherentes.
- La etapa 1 de G6 ya se ejecutó y entregó 10/10 con claude-code-cli/sonnet. Su evidencia está en docs/tesis/evidence/g6/runs/g6-01-T1-A-r1/.
- Francisco pidió ejecutar los runs con modelos de Codex, del escalón más bajo posible. La etapa 0 del plan te dice exactamente cómo decidirlo y qué hacer con la celda ya ejecutada.

Reglas que no se negocian:
- NO escribas la tesis. No toques main.tex ni presentacion.tex. Sólo producís y documentás evidencia.
- TDD para todo cambio conductual: regresión roja que falle por la razón correcta antes del fix.
- pnpm build ANTES de pnpm test y antes de cualquier run. El servidor resuelve @manyhands/* desde dist/.
- MANYHANDS_RUNS_DIR fuera del repositorio. Un solo vigía detached por run; nada de polling cada 30-60 s.
- Un intento por celda. Un fallo pre-candidate se preserva y no se reintenta.
- No muevas minimumAdvantage, ni la fórmula, ni el estímulo, ni los criterios externos, ni el oráculo, durante G6.
- Si el planner pide una aclaración, NO se la respondas: registrá la celda como detenida y avisá.
- Los resultados adversos se preservan y se reportan como salieron. Está acordado por escrito: si la hipótesis vuelve a quedar falsada, se reporta falsada.
- No borres pools, worktrees, clones, journals ni artefactos. Nada de reset, clean, checkout destructivo ni stash global.
- Normalizá finales de línea a LF antes de cada commit y verificá con git diff --numstat.

Cómo trabajar cada etapa:
1. Hacé el trabajo que la etapa pide.
2. Corré su verificación y escribí el resultado en el archivo de evidencia que la etapa indica, con una sección final "Qué no se concluye".
3. Agregá una fila a docs/tesis/evidence/g6/STAGE-LEDGER.md: etapa, fecha, resultado, commit, archivo de evidencia.
4. Commit local.
5. Recién entonces pasá a la siguiente etapa.

Si una verificación falla: no avances. Diagnosticá, corregí con TDD, repetí la verificación. Si no podés corregirlo, escribilo como limitación declarada y detené la serie.

Presupuesto: tope de USD 8 por celda y USD 40 por la serie, medidos desde el journal. Si se alcanza un tope, cortá, preservá y reportá qué faltó.

Primera acción: verificá root, rama, HEAD, git status --short y git diff HEAD; exigí árbol limpio. Después ejecutá la etapa 0 del plan.
```

---

## Notas para vos, no para el agente

**Sobre el cambio de ejecutor.** La celda ya ejecutada usó Claude. El pre-registro
declara el ejecutor como constante del experimento, así que una serie con celdas
de ejecutores distintos no sirve como estudio. La etapa 0 del plan resuelve esto
reclasificando esa celda como **piloto** y reiniciando la serie con Codex. Su
evidencia se conserva entera y su valor ya está cobrado: fue el chequeo de piso
de capacidad y la puesta a punto del instrumento.

**Sobre el riesgo del modelo bajo.** `gpt-5.4-mini` con esfuerzo `low` puede no
alcanzar una tarea de seis capas. Si eso pasa, las tres condiciones fallan por
igual y el estudio mediría capacidad del modelo, no granularidad. Por eso la
etapa 2 es un chequeo de piso con una regla de escalada de **un solo escalón, una
sola vez**, y si vuelve a fallar el agente debe **detenerse** y declarar G6 no
informativo con ese ejecutor, en vez de gastar seis celdas.

**Sobre Codex en esta máquina.** El 2026-07-30 el CLI 0.141.0 falló con
`windows sandbox: orchestrator_helper_launch_failed ... Acceso denegado`. Hoy
está el 0.146.0. La etapa 0 lo prueba antes de comprometer nada; si no arranca,
el plan indica seguir con la selección Claude ya congelada.

**Qué vas a tener al final.** Seis celdas ejecutadas y preservadas, sus
resultados derivados por script, el veredicto de la hipótesis contra su falsador,
las reviews pendientes saldadas, y un dossier en
`docs/tesis/evidence/THESIS-EVIDENCE-DOSSIER.md` con el índice de toda la
evidencia. Con eso se escribe la tesis en una fase aparte.
