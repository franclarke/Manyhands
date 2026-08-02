# Prompt de continuación para el agente

Copiá y pegá todo el texto siguiente como instrucción del próximo agente.

---

Actuá como agente senior de implementación para ManyHands. Vas a retomar una
implementación pausada; no hagas un análisis histórico desde cero.

Tu primera acción documental debe ser leer completo, y únicamente como fuente de
continuación, este archivo exacto:

`C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning\docs\plans\2026-08-02-policy-guided-semantic-planning-handoff.md`

No busques otros handoffs, resúmenes ni archivos equivalentes. No reconstruyas
la historia del trabajo antes de leer ese archivo. Después de leerlo, seguí sus
pendientes y sus restricciones como contrato operativo. Si el handoff indica
leer `AGENTS.md` o documentación normativa para cumplir reglas del repositorio,
hacelo en ese momento; no reemplaces el handoff por una búsqueda general.

## Contexto operativo fijo

Trabajá en el worktree existente:

`C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning`

Y en la branch existente:

`codex/policy-guided-planning`

No crees otro clone o worktree. No uses el checkout original para implementar.
El checkout original puede estar siendo usado por otro agente.

Antes de modificar cualquier archivo, verificá solamente desde el worktree de
trabajo:

```powershell
Set-Location 'C:\Users\franc\.codex\tmp\manyhands-policy-guided-planning'
git branch --show-current
git status --short
git log --oneline --decorate -8
```

Si no estás en `codex/policy-guided-planning`, corregí la ubicación sin usar
operaciones destructivas. Si el worktree está sucio de forma inesperada,
preservá los cambios y diagnosticá antes de tocar nada.

## Modo de ejecución

No te limites a describir lo que habría que hacer: implementá el handoff de
principio a fin. Trabajá en ciclos cortos y verificables:

1. Elegí el próximo pendiente concreto del handoff.
2. Inspeccioná sólo el código, tipos y tests necesarios para ese pendiente.
3. Escribí primero una regresión roja que falle por la razón correcta.
4. Ejecutá `pnpm build` antes de cualquier `pnpm test` o Vitest.
5. Implementá el arreglo de causa raíz más pequeño y mantenible.
6. Repetí build y tests hasta obtener evidencia verde.
7. Verificá que no rompiste compatibilidad histórica.
8. Normalizá finales de línea a LF, ejecutá `git diff --check` y revisá
   `git diff --numstat`.
9. Hacé un commit local pequeño, coherente y descriptivo.
10. Recién entonces pasá al siguiente pendiente.

Si encontrás un fallo, investigá la causa profunda y corregila. No tapes el
fallo con un mock, un retry indiscriminado, un umbral debilitado o una relajación
de los hard gates. Conservá los resultados adversos y documentá las
limitaciones. Si una corrección requiere una decisión que el handoff no resuelve
y cambia la arquitectura o el significado de la evidencia, detené esa parte,
documentá el bloqueo y no inventes una decisión.

Podés usar subagentes sólo si reducen trabajo real y no duplican la inspección.
Asignales tareas read-only o claramente separadas, verificá sus resultados vos
mismo y no delegues la lectura o interpretación del handoff.

## Restricciones no negociables

- No hagas push.
- No uses `git reset --hard`, `git clean`, `git checkout` destructivo ni stash
  global.
- No borres worktrees, pools, clones, journals, runs ni artefactos.
- No modifiques `main.tex`, `presentacion.tex` ni escribas la tesis.
- No cambies el preregistro, el estímulo, el oráculo, `minimumAdvantage`, la
  fórmula ni los criterios externos de G6.
- No regeneres ni alteres el candidato experimental congelado de G6.
- No lances nuevos runs experimentales mientras la implementación del handoff
  no haya completado todos sus gates.
- Si aparece una aclaración del planner, no la respondas automáticamente;
  preservala como decisión detenida según el flujo documentado.
- No conviertas un timeout o una salida parcial en PASS.
- No reportes una verificación como exitosa sin ejecutar el comando y conservar
  su resultado.

## Resultado esperado

Completá todos los pendientes del handoff, incluyendo la integración productiva
de candidatos, la validación por Graph Compiler, la preservación de ownership,
la persistencia de evaluaciones, la documentación normativa y todos los gates
finales.

Al terminar, integrá la branch a `main` exactamente como indica la sección
`Required final integration into main` del handoff:

- verificá que el worktree original esté limpio y disponible;
- cambiá el checkout original a `main` sólo si hacerlo es seguro;
- ejecutá `merge --ff-only codex/policy-guided-planning`;
- no fuerces la integración si `main` avanzó o hay divergencia;
- no hagas push.

Si `merge --ff-only` falla, preservá la branch y reportá los commits exactos en
conflicto; no rebases ni resetees para ocultarlo.

## Informe final obligatorio

Respondé en español e incluí únicamente información comprobada:

- qué se implementó;
- archivos modificados;
- commits creados;
- branch y commit finalmente integrado a `main`, o motivo preciso por el que
  no pudo integrarse;
- comandos de verificación ejecutados y resultado de cada uno;
- limitaciones o evidencia pendiente;
- confirmación explícita de que no hubo push y de que G6 no fue modificado.

No cierres la tarea diciendo “listo” si queda algún pendiente del handoff.

---
