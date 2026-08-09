# Demostración visual del sistema — 2026-08-09

## Alcance epistemológico

Esta carpeta conserva una demostración operativa de ManyHands ejecutada desde
la interfaz web sobre el repositorio sintético `C:/mh-thesis-visual`. Sirve para
mostrar el flujo del producto, el grafo, las decisiones supervisadas, la
validación y la entrega. **No es una celda del experimento de tesis y no aporta
observaciones a H-F1 ni H-F2.** Los resultados confirmatorios de esas hipótesis
permanecen en el experimento V2 acotado y pre-registrado.

No se eliminan los intentos adversos. Cada uno documenta una causa observable y
la evolución de las correcciones del sistema.

## Runs preservados

| Run | Estado observado | Causa o resultado |
|---|---|---|
| `b4955431-dd65-4fa3-8b47-e502709b1afc` | `failed` en secuencia 5 | El planner trataba la cobertura transversal de un criterio como ownership exclusivo y rechazó seis referencias hermanas. |
| `0cffb470-09e0-4bd9-bf89-8909a177a674` | `interrupted` en secuencia 38 | Un timeout fue clasificado y el run se interrumpió; se preserva como evidencia adversa de recuperación. |
| `2fcea3bd-a85b-4a3d-a987-9d0badeb7f5f` | `needs_approval` en secuencia 19 | El primer intento de planning fue rechazado porque el crítico infería autoridad de escritura desde rutas mencionadas en prosa; el planner reparó el plan y llegó a revisión. No se presenta como run terminal exitoso. |
| `41ba47d5-d44a-4ec2-a470-d84437c6d076` | `failed` en secuencia 38 | Tras una reparación, el artefacto publicado contenía sólo el delta terminal y el consumidor no podía materializar la línea completa. |
| `87e7fe2c-a4c1-4c21-895c-7c1c33efc154` | `completed`, entrega en secuencia 77 | Run demostrativo completo de siete nodos. Integró, validó y publicó `02234c9a2004c23db48ebba6f46a61c18f5e42e7` sobre `main`. |
| `766ccb97-7a39-45c2-bfcf-0818b97ed907` | `failed` en secuencia 29 | El candidato correcto `43e69e0d66a002be96e4bec1c1bdfd728e189915` fue bloqueado por una contracción de sitios de aserción y la reparación posterior no inició por límite de uso de Codex hasta el 15 de agosto de 2026. El branch se detuvo explícitamente desde la UI. |

Los archivos canónicos de cada run se encuentran bajo `runs/<run-id>/`:
evento append-only, snapshot, configuración, métricas, fence, recuperación y,
cuando existe, trace diagnóstico.

## Verificación independiente del candidato de reparación

El commit exacto `43e69e0d66a002be96e4bec1c1bdfd728e189915` se montó en un worktree separado
sin modificar `main` y se verificó el 2026-08-09:

- `npm test`: PASS, 18/18.
- `npm run build`: PASS.
- `node docs/tesis/evidence/ui-demo-run/oracle.mjs C:/mh-candidate-check`: PASS.
- El test congelado `test/public-reservation-api-contract.test.mjs` permaneció
  sin cambios y pasó dentro de la suite completa.

Por lo tanto, el último run no refuta la corrección del cambio de dominio. Su
resultado adverso identifica dos causas distintas: un falso bloqueo de la
heurística de integridad y un límite externo de suscripción. No se reinterpreta
el run como `completed` ni como entrega exitosa.

## Correcciones derivadas

1. La cobertura de criterios pasó a ser many-to-many; la autoridad de
   aceptación se deriva por ancestro común más bajo.
2. Las rutas inferidas desde prosa dejaron de otorgar autoridad de escritura.
3. Una reparación de hoja publica un handoff acumulativo materializable respecto
   del primer padre y declara explícitamente `cherryPickMainline: 1`.
4. Una reducción de cantidad de llamadas de aserción se conserva como hallazgo,
   pero puede quedar `rebutted` sólo cuando todas las obligaciones de test
   requeridas pasan y sus controles negativos detectan la implementación vieja.
   Eliminaciones, skips, focus, scripts debilitados y casos sin control negativo
   continúan siendo bloqueantes.

## Limitación de transición no cerrada

El contrato de seam puede declarar `materialization: "files"` y
`expectedPaths`, pero el driver actual todavía adopta el candidato producido
como artefacto commit completo. El handoff acumulativo evita perder la línea de
reparación; no implementa todavía transporte selectivo por archivos. Esta
capacidad no debe presentarse como terminada ni utilizarse como evidencia de las
hipótesis hasta cerrar el gap o retirar explícitamente esa pretensión.

## Capturas

Las capturas cronológicas están en
`docs/tesis/assets/demo-run-2026-08-09/`. Las imágenes 21 y 22 documentan el
candidato final verificado y la entrega del run completo. Las imágenes 29, 33 y
34 preservan, respectivamente, el conflicto de materialización, el límite de
uso en reparación y la detención terminal del branch.
