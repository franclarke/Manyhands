# Prompt de reanudación final para Codex

Copiar el bloque siguiente en una tarea nueva de Codex. Debe iniciarse como
`/goal`, no como una consulta ordinaria.

```text
/goal Completa autónomamente el cierre técnico y académico restante de ManyHands y no te detengas hasta cumplir íntegramente la definición de terminado de docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md.

Antes de modificar cualquier archivo, lee completos y en este orden:
1. GOAL.md
2. docs/tesis/AUTONOMOUS_CLOSURE_PLAN.md
3. docs/tesis/HANDOFF.md
4. PRODUCT.md
5. docs/README.md
6. AGENTS.md y las instrucciones aplicables
7. docs/agents/issue-tracker.md
8. el ticket local que vayas a ejecutar

Usa exclusivamente `.scratch/code-review-remediation/issues/` como fuente de estado, blockers y aceptación. Recalcula el frente después de cada cierre. El estado durable vigente está al final de HANDOFF.md.

Situación de arranque esperada:
- ticket activo 11; ruta crítica `11 -> 12 -> 02 -> 14 -> 15`;
- `retry-9` es evidencia adversa inmutable e incompleta: N=4 run `3340ab0b-b255-43b5-af33-870e8872b00e` encontró identidad Git ausente y un dead-end de handoff; N=8/N=16 no se iniciaron;
- el fix productivo está en `60eb12f`, con TDD y re-review Standards/Spec PASS;
- no reanudes ni reescribas retry-9. Crea un freeze sucesor nuevo desde N=4, recomendado `retry-10`, con tres targets nuevos sobre W1.

Primera acción:
1. verifica root, branch, HEAD, ancestry, `git status --short` y `git diff HEAD`;
2. verifica y, si sigue vivo, termina sólo el servidor histórico que ocupa 127.0.0.1:3000; no borres su clon ni artefactos;
3. crea un clon aislado limpio desde el HEAD actual con `core.autocrlf=false`;
4. instala los 629 paquetes con Node 22.23.1, pnpm 7.29.3 y el store offline ya documentado;
5. ejecuta Gate P0 completo secuencial sobre el mismo commit;
6. verifica policy marker, dist hash, manifest, working tree limpio y una mutación autenticada;
7. genera retry-10 y targets nuevos N=4/N=8/N=16, todos en `codex-cli/gpt-5.5/high`, condición C y base W1 exacta;
8. ejecuta las tres celdas secuencialmente sin cambiar código entre ellas. Preserva cada resultado. Sólo una entrega recibe oráculo; un fallo pre-candidate recibe `not_run`.

Después:
- cierra ticket 11 sólo si sus tres casillas y reviews independientes Standards/Spec pasan;
- ejecuta ticket 12 y emite el veredicto honesto sobre `validationDuplication`, sin tocar fórmula/umbral antes de medir;
- ejecuta ticket 02 con rechazo explícito mínimo de replay C1 no reconstruible;
- ejecuta 14 para rederivar y cerrar la matriz de claims;
- ejecuta 15 para terminar tesis, presentación, defensa y PDFs, incluyendo gate editorial y revisión visual página por página;
- ejecuta el gate final completo sobre un único commit limpio y entrega el informe final exigido por el plan.

Reglas:
- sólo Codex; no uses Claude ni dependas de que esté instalado;
- TDD para toda conducta; `diagnosing-bugs` ante fallos; no reintentos ciegos;
- antes de cerrar cada ticket, reviews independientes Standards y Spec con “No implementes correcciones”;
- usa `grilling` periódicamente como crítica interna, toma vos la decisión y actúa sin preguntarle a Francisco;
- actualiza HANDOFF.md después de cada ticket y antes de toda operación larga;
- conserva resultados adversos; no ajustes fórmulas, thresholds, estímulos u oráculos para favorecer resultados;
- no borres pools, worktrees, clones, artefactos ni journals;
- no uses reset, clean, checkout destructivo ni stash global;
- commits locales pequeños; nunca push;
- no marques el goal completo mientras quede cualquier ticket, gate, claim, run, receipt, PDF o artefacto obligatorio.
```
