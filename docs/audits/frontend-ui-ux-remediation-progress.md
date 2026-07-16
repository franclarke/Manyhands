# Frontend UI/UX remediation progress

## Baseline

- Fecha: 2026-07-16.
- Branch/base: `main` @ `deb370a14d6dca2bf63a50c4564d8d2fa8fa160a`.
- Working tree inicial: 193 archivos rastreados modificados y archivos no rastreados preexistentes. Se preservan; este ledger no atribuye esos cambios a esta remediación hasta verificarlos.
- Pruebas focalizadas iniciales: `pnpm vitest run tests/run-model-selectors.test.ts tests/operational-recovery.test.ts tests/run-model-decision-channel.test.ts tests/run-model-minimal-workspace-view.test.ts tests/run-model-timeline.test.ts tests/run-model-fixtures.test.ts tests/run-model-proto-render.test.ts tests/cockpit-layout.test.ts tests/thread-messages.test.ts` - 9 archivos, 213 tests, todos verdes.

| Hallazgo | Estado | Causa confirmada | Archivos afectados | Tests | Validación manual | Commit local | Riesgo residual |
|---|---|---|---|---|---|---|---|
| F-01 | Pendiente | Recovery prioriza gate pendiente sobre fallo terminal. | `operational-recovery.ts`, canal de decisiones, recovery UI | Pendiente | Pendiente | — | Alto hasta verificar terminales |
| F-02 | Pendiente | `selectPhase` adelanta por grounding aunque haya `approve_plan` pendiente. | `selectors.ts`, labels de etapa | Pendiente | Pendiente | — | Alto para propuesta |
| F-03 | Pendiente | Resolución del gate duplicada entre superficies. | cockpit, chat, outline | Pendiente | Pendiente | — | Medio |
| F-04 | Pendiente | Atención cuenta conflictos resueltos. | selectors, header, outline | Pendiente | Pendiente | — | Bajo |
| F-05 | Pendiente | Enums/labels internos se filtran a superficies primarias. | run model, cockpit | Pendiente | Pendiente | — | Medio |
| F-06 | Pendiente | Pluralización ad hoc. | vistas de workspace/cockpit | Pendiente | Pendiente | — | Bajo |
| F-07 | Pendiente | Review mantiene canvas como superficie central. | workspace surfaces | Pendiente | Pendiente | — | Medio |
| F-08 | Pendiente | Panel de chat permite ancho insuficiente. | cockpit/chat | Pendiente | Pendiente | — | Medio |
| F-09 | Pendiente | Recovery no deriva ni muestra causa durable. | recovery selector/UI | Pendiente | Pendiente | — | Alto para fallos |
| F-10 | Pendiente | Nodos DAG sin nombre/rol/estado accesible completo. | graph canvas | Pendiente | Pendiente | — | Medio |
| F-11 | Pendiente | Referencias a tokens/reglas inexistentes. | CSS/cockpit/graph | Pendiente | Pendiente | — | Bajo |
| F-12 | Pendiente | Superficies usan color Tailwind crudo. | sidebar/terminal | Pendiente | Pendiente | — | Bajo |
| F-13 | Pendiente | Hidratación de WorkspacePicker no confirmada desde causa raíz. | Command Center | Pendiente | Pendiente | — | Medio |
| F-14 | Pendiente | Interrupt card potencialmente sin consumidores. | interrupt card | Pendiente | Pendiente | — | Bajo |
| F-15 | Pendiente | El dock duplica ownership de cierre. | dock/focus panel | Pendiente | Pendiente | — | Medio |
| F-16 | Pendiente | Tabs se presentan sin datos. | focus panel | Pendiente | Pendiente | — | Bajo |
| F-17 | Pendiente | Canvas ajusta contra nodos no visibles/minimap vacía. | graph canvas | Pendiente | Pendiente | — | Bajo |
| F-18 | Pendiente | Header distribuye vitals y conexión sin jerarquía. | RunHeader | Pendiente | Pendiente | — | Bajo |
| F-19 | Pendiente | Riesgo compite con estado en sidebar. | sidebar | Pendiente | Pendiente | — | Bajo |
| F-20 | Pendiente | `globals.css` usa fuente remota render-blocking. | layout/CSS | Pendiente | Pendiente | — | Bajo |
| F-21 | Pendiente | Activity y Raw Events renderizan el conjunto completo. | workspace surfaces | Pendiente | Pendiente | — | Medio |
| F-22 | Pendiente | Primitivos icon-button/resize duplicados. | UI/cockpit/sidebar | Pendiente | Pendiente | — | Medio |
| F-23 | Pendiente | Slider sin target/hint accesible completo. | effort control | Pendiente | Pendiente | — | Bajo |
| F-24 | Pendiente | Fixtures se reproducen en proto divergente. | routes/fixture playback | Pendiente | Pendiente | — | Medio |
| F-25 | Pendiente | Cockpit no expone momento display. | RunHeader/review | Pendiente | Pendiente | — | Bajo |
| F-26 | Pendiente | Rail móvil no preserva label de fase activa. | run timeline | Pendiente | Pendiente | — | Bajo |
| F-27 | Pendiente | No existe canal de comandos contextual. | cockpit | Pendiente | Pendiente | — | Medio |
| F-28 | Pendiente | Recovery fuerza `window.location.reload()`. | recovery UI | Pendiente | Pendiente | — | Bajo |

## Desviaciones verificadas

Ninguna por ahora. Cualquier recomendación de la auditoría que resulte obsoleta se documentará aquí con evidencia de código y prueba reproducible.

## Actualización de remediación — 2026-07-16

| Hallazgos | Estado | Evidencia principal | Riesgo residual |
|---|---|---|---|
| F-01, F-02, F-09, F-28 | Implementado | Selector terminal primero, decisiones archivadas, causa durable enlazada a Eventos/tarea, lifecycle para `failed_artifact`, `router.refresh()` dirigido. | El typecheck global está bloqueado por una exportación previa de `deliver/route.ts`. |
| F-03, F-04, F-05, F-06, F-18, F-19 | Implementado | Un único gate resolutivo en chat; satélites navegan; conflictos resueltos no cuentan; copy/plurales/conexión/riesgo presentados en español. | Los enums internos permanecen disponibles en Eventos y tooltips forenses. |
| F-07, F-08, F-15, F-16, F-25, F-26, F-27 | Implementado | Revisión evidence-first, chat mínimo 300px, dock dueño de su cierre, tabs por datos, momento display, rail móvil y paleta Ctrl/Cmd+K. | La paleta ejecuta pausa reversible y navegación; decisiones siguen resolviéndose sólo en chat. |
| F-10, F-11, F-12, F-17, F-20, F-21, F-23 | Implementado | Etiquetas ARIA del DAG, token check, tokens por tema, frame de nodos visibles, `next/font`, paginación de logs y slider accesible. | Validado estáticamente y en fixture; falta una corrida larga real para medir paginación con miles de eventos. |
| F-13, F-14, F-24 | Implementado | Id determinista del picker, componente muerto eliminado y `/runs/proto/*` ahora usa el cockpit real con playback local sin SSE. | El dev server HMR tuvo un 404 transitorio después de recompilar rutas; la ruta había renderizado correctamente antes del refresco. |
| F-22 | Implementado | `components/ui/icon-button.tsx` con tamaño/tone, adoptado por command center, sidebar, foco y dock; `ResizeHandle` ahora es orientable y reemplaza los dos handles horizontales duplicados. | Los botones de texto conservan sus componentes propios porque no son icon-buttons. |

### Verificación de esta fase

- `pnpm vitest run ...` (15 archivos focalizados): 270 tests verdes.
- `pnpm --filter @manyhands/web token:check`: verde (189 tokens, 218 fuentes).
- `pnpm --filter @manyhands/web contrast:check`: verde (AA+ en dark/light).
- `pnpm --filter @manyhands/web exec tsc --noEmit --pretty false`: bloqueado por error previo de export de `resolveRunRevealTarget` en `app/api/runs/[id]/deliver/route.ts`; no reportó errores de los archivos de esta fase.
- Browser visible local: fixture `golden-happy-path` en el cockpit, paleta Ctrl/Cmd+K y revisión final con evidencia 8/8. No se lanzaron agentes ni se hizo push.
