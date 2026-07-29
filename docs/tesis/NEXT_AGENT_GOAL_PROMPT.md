# Prompt de continuación para Codex

Copiar el bloque siguiente en una tarea nueva de Codex. Debe iniciarse como
`/goal`, no como una consulta ordinaria.

```text
/goal Continúa autónomamente el cierre técnico y académico de ManyHands desde el estado durable final de docs/tesis/HANDOFF.md y no te detengas hasta cumplir la definición de terminado de docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md.

Antes de modificar cualquier archivo, lee completos y en este orden:
1. GOAL.md
2. docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md
3. docs/tesis/HANDOFF.md, especialmente “Handoff por límite de cuota — 2026-07-28”
4. PRODUCT.md
5. docs/README.md
6. AGENTS.md y las instrucciones aplicables
7. docs/agents/issue-tracker.md
8. .scratch/code-review-remediation/issues/19-criterion-aware-validation.md

Usa exclusivamente `.scratch/code-review-remediation/issues/` como fuente de estado, blockers y aceptación. Recalcula el frente después de cada cierre. No confíes en este prompt si contradice el estado durable al final de HANDOFF o los tickets locales.

Situación de arranque esperada:
- branch `main`, sin push;
- tickets 16, 17 y 18 cerrados; ticket 19 es el siguiente `ready-for-agent` y todavía no fue iniciado;
- ruta crítica `19 -> 20 -> 21 -> 22 -> 23 -> 24 -> 25 -> 26 -> 11 -> 12 -> 02 -> 14 -> 15`;
- ticket 18 cerró sobre fix `d593b53`, con 39/39, typechecks execution-core/run-coordinator y reviews Standards/Spec PASS, cero P0-P3;
- CLAIM-040/041 siguen `partial`;
- retry-9 y retry-10 son evidencia adversa inmutable: no reanudes, reescribas ni borres runs, targets, clones, pools, journals o artefactos.

Primera acción:
1. verifica root, branch, HEAD, ancestry, `git status --short` y `git diff HEAD`; exige árbol limpio;
2. verifica que `d593b53` sea ancestro de HEAD y que ticket 18 esté `closed` con cinco casillas completas;
3. lee completo `.scratch/code-review-remediation/issues/19-criterion-aware-validation.md` antes de modificar archivos;
4. reclama sólo ticket 19, define RED y ejecuta su aceptación con TDD;
5. antes de cerrarlo, solicita reviews Standards y Spec con “No implementes correcciones”, actualiza HANDOFF y recalcula el frente.

Después:
- ejecuta en orden tickets 19–26 con TDD, gates afectados y doble review independiente antes de cada cierre;
- sólo entonces vuelve a ticket 11 y crea un freeze sucesor nuevo sobre un único commit limpio para N=4/N=8/N=16; no reutilices retry-9/retry-10;
- ejecuta ticket 12 sin alterar fórmula, threshold, estímulos u oráculos antes de medir;
- ejecuta ticket 02 con rechazo explícito mínimo si C1 no es reconstruible;
- ejecuta ticket 14 para rederivar honestamente todos los claims;
- ejecuta ticket 15 para finalizar tesis, presentación, defensa y PDFs, incluido gate editorial y revisión visual página por página;
- ejecuta el gate final completo sobre un único commit limpio y entrega el informe final exigido por el plan.

Reglas:
- sólo Codex; no uses Claude;
- TDD para conducta y `diagnosing-bugs` ante fallos; no reintentos ciegos;
- antes de cerrar cada ticket, reviews Standards y Spec con “No implementes correcciones”;
- usa `grilling` como crítica interna, decide y actúa sin pedirle decisiones rutinarias a Francisco;
- actualiza HANDOFF después de cada ticket y antes de operaciones largas;
- conserva toda evidencia adversa; nunca ajustes fórmulas, thresholds u oráculos para favorecer la tesis;
- no borres pools, worktrees, clones, artefactos ni journals;
- no uses reset, clean, checkout destructivo ni stash global;
- commits locales pequeños; nunca push;
- no marques el goal completo mientras quede cualquier ticket, gate, claim, run, receipt, PDF o artefacto obligatorio.
```
