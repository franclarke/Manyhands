# ManyHands — Guía operativa para Claude Code

> Comunicación con Francisco: español. Código y nombres técnicos: inglés.
> Empezar por `PRODUCT.md` y
> `docs/plans/2026-08-12-correctness-first-system-redesign.md`.

## Autoridad

1. `PRODUCT.md` define producto y experiencia estable.
2. El plan de rediseño del 2026-08-12 es la única arquitectura objetivo y el
   único orden de implementación.
3. `docs/tesis/` contiene material académico y evidencia histórica atribuible;
   no es una especificación vigente.
4. Código, tests y journals muestran qué funciona actualmente. No convierten un
   comportamiento legacy en diseño objetivo.

Leé el plan completo antes de implementar una etapa. No ejecutes benchmarks
grandes ni series con modelos hasta que Stage 11 declare elegible la
arquitectura y cierre GProd.

## Dirección del rediseño

- Repository Model exacto y consultable, sin volcar todo el repo al prompt.
- Planning Engine progresivo con un único `SemanticPlan`.
- Graph Compiler directo con artifacts, seams y `ResourceClaim`.
- Hojas semánticas; profundidad y amplitud emergen de fronteras reales.
- Commits como procedencia y artifacts acotados como transporte.
- Integración composite como intento normal, con trabajo compartido propio.
- Evidencia jerárquica sobre candidatos exactos.
- Intentos y reparaciones inmutables con fingerprints exactos.
- Daemon local single-writer; Next.js como cliente de comandos/queries.
- Worktree y sandbox como garantías distintas y visibles.
- Recovery causal y selectivo.

Cuando un modelo tiene que devolver material canónico, el contrato viaja con el
request: claves aceptadas, enumeraciones, invariantes del verifier y un ejemplo
completo. Nombrar el tipo no alcanza. El ejemplo se fija con tests que lo pasan
por el schema real, por `verifyPlan`, por `compilePlan` y por la preparación de
la receta de validación, así una deriva del contrato falla offline en lugar de
gastar una corrida viva.

## Cómo trabajar sobre la transición

1. Confirmar root, rama, `git status --short` y `git diff HEAD`.
2. Preservar todo cambio ajeno. Nunca `stash`, `reset` ni `clean` global.
3. Trabajar solamente en la etapa activa del plan y respetar sus dependencias.
4. Caracterizar la ruta productiva antes de moverla.
5. Para comportamiento: test rojo por la razón correcta, fix mínimo, refactor.
6. Mover el caller productivo y después retirar el camino reemplazado. No dejar
   V1/V2/V3 sincronizados indefinidamente.
7. Un adapter legacy sólo puede leer evidencia histórica y debe tener consumidor
   y criterio de retiro explícitos.
8. No quitar worktrees, scope, commits del orquestador, supervisión, leases o
   fencing antes de que el reemplazo y sus pruebas de crash/concurrencia estén
   verdes.
9. No incorporar términos, métodos esperados ni respuestas de benchmarks a
   código productivo o prompts genéricos.
10. No afirmar aislamiento fuerte si el perfil sólo ofrece worktree o permisos
    advisory.

## Git y finales de línea

- El checkout puede estar muy sucio. Tocá sólo archivos del alcance.
- No borres evidencia o workspaces sin autorización explícita.
- `core.autocrlf=false`; el índice contiene LF y CRLF. Para cada archivo
  modificado, comparar con `git show HEAD:<path>` y conservar su convención.
- Antes de commitear, inspeccionar `git diff --numstat`; suma/resta del archivo
  entero suele señalar una conversión accidental de EOL.
- Los commits son locales salvo autorización explícita de push.

## Pruebas

- Los tests normales no llaman modelos, no dependen de red y no abren browser.
- Usar fixtures, stubs, replay, real Git temporal y procesos controlados.
- Una prueba live siempre es opt-in y posterior a sus gates offline.
- No cerrar una etapa sin `pnpm test` completo sobre el árbol exacto.
- Bajar el stack de desarrollo antes de la suite completa. Un daemon vivo toma
  el installation lease del checkout y hace fallar por contención a
  `daemon-kernel`, `daemon-installation-lease`, `process-supervisor-physical` y
  `stage3-restart-recovery`. Un fallo ahí se confirma re-ejecutando el archivo
  en aislamiento antes de tratarlo como regresión.
- `pnpm typecheck` incluye `tests/` y resuelve `@manyhands/*` por `dist`, que no
  está versionado. Reconstruir los paquetes antes de typechequear: un `dist`
  viejo esconde deriva de tipos en los dobles de prueba.
- `pnpm build` y el typecheck recursivo filtran `./packages/*`: **no cubren
  `apps/daemon`**. Vitest transpila sin typechequear, así que un error de tipos
  ahí pasa la suite entera y recién explota al levantar el stack de desarrollo,
  que sí compila el daemon. Correr `pnpm --filter @manyhands/daemon build`
  después de tocar `apps/daemon` o cualquier tipo que consuma.
- El código de salida de `pnpm test` no es el gate: el wrapper puede terminar en
  0 con archivos en rojo. Leer siempre la línea `Test Files ... failed` del
  resumen de vitest antes de declarar verde.
- Un repo destino greenfield no puede ejecutar nada: `RepositoryModel.commands`
  sale del `package.json`, y sin comandos ninguna obligación se materializa, así
  que toda hoja falla con `needs_input` antes de invocar al agente. Inicializar
  el repo con un `package.json` que declare `test` antes de correr un run vivo.
- La suite completa corre 312 archivos en paralelo y los tests que lanzan
  procesos reales se caen por timeout bajo esa carga. `stage3-daemon-restart-physical`
  ya lo hizo: 90 s de timeout en la suite, 4 s en aislamiento.

Todos estos comandos van con `corepack pnpm`. El `pnpm` global de esta máquina
es 7.29.3 y `engines.pnpm` pide 11.21.0, así que un `pnpm` pelado falla con
`ERR_PNPM_UNSUPPORTED_ENGINE` antes de ejecutar nada.

```bash
pnpm test
pnpm typecheck
pnpm -r --filter "./packages/*" typecheck
pnpm --filter @manyhands/daemon build
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm build
pnpm web:build
```

`pnpm typecheck` quedó verde el 2026-08-16 y tiene que seguir así. Es el único
gate que mira `tests/`: encontró un guard que chequeaba un campo inexistente y
por lo tanto no chequeaba nada, y un doble que decía `operation: "create"`
cuando el motor sólo acepta `plan | expand | amend`.

Para cambios sólo documentales, validar links, referencias obsoletas, diff y
EOL; no hace falta ejecutar builds del producto.

## Límites de paquetes

La dependencia es `apps -> packages específicos -> shared`. No agregar nuevas
dependencias a `@manyhands/core`.

- `repository-index`: Repository Model y consultas grounded.
- `decomposer`: Planning Engine, verifier y Graph Compiler.
- `contracts`, `task-graph`: lenguaje y grafo canónicos.
- `scheduler`: frontier puro sobre readiness y recursos.
- `execution-core`: bases, attempts, artifacts, validation, integration y
  sandbox detrás de interfaces profundas.
- `run-coordinator`: comandos, eventos, reducer y políticas de dominio.
- `run-store`, `trace-store`: hechos durables y diagnóstico separados.
- `orchestrator-graph` y hosts web: transición hacia `run-engine`/`apps/daemon`.
- `apps/web`: presentación y cliente del daemon.

## UI

- Un workspace por run.
- Grafo central durante planning/ejecución; evidencia central al final.
- Sin estado de dominio inventado por componentes.
- Sin `fitView`, foco, zoom o recentrado por eventos.
- Las decisiones bloquean sólo el alcance afectado.
- Candidate, verified, stale, failed y delivered son distintos.
- Mostrar la capacidad real de sandbox/seguridad.
- WCAG 2.2 AA y `prefers-reduced-motion`.

## Agent skills

- Issues locales: `.scratch/`; no publicar sin autorización. Ver
  `docs/agents/issue-tracker.md`.
- Roles de triage: ver `docs/agents/triage-labels.md`.
- Vocabulario y autoridad: `CONTEXT-MAP.md` y `docs/agents/domain.md`.
