# E2E scenario matrix

Estado: en ejecución. `pending` no implica que el escenario falle; implica que todavía no existe evidencia manual y automatizada suficiente en esta auditoría.

| ID | Escenario | Invariantes principales | Automatizado | Chrome/manual | Estado |
|---|---|---|---|---|---|
| E2E-001 | Happy path real con Codex | plan revisionado, waves durables, commits físicos, manifest válido, delivery y completed | pendiente | pendiente | pending |
| E2E-002 | Repo dirty | preflight bloquea antes de mutar; copy accionable | existente parcial | pendiente | pending |
| E2E-003 | Repo sin commit inicial | readiness/initialization coherente y sin fallback silencioso | existente | pendiente | pending |
| E2E-004 | Fixed routing + override incompatible | rechazo preflight temprano; UI no ofrece acción imposible | route + control-plane/UI guards green | pendiente | pending |
| E2E-005 | Critic con errores | override explícito/auditable; revisión stale rechazada | parcial | pendiente | pending |
| E2E-006 | Aprobación r1, edit r2, resolución stale | una identidad canónica por revisión, CAS y una sola resolución | route + service + recovery green | pendiente | pending |
| E2E-007 | Cancellation en planning/execution/integration | cancelling → kill tree → allDead → interrupted; sin resultados tardíos | parcial | pendiente | pending |
| E2E-008 | Restart durante cherry-pick | journal adopta sólo evidencia física, no duplica side effects | unit recovery + real Git green | n/a | automated-pass |
| E2E-009 | Writer con lease/fencing stale | no persiste resultado/evento/status/journal | CAS/fencing journal + attempt lease green | n/a | automated-pass |
| E2E-010 | Cross-owner Windows repo | `safe.directory` scoped, barras Git, sin config global | unit + inventory guard + cross-owner smoke | n/a | automated-pass |
| E2E-011 | Composite multinivel A+B → parent | árbol final contiene todos los cambios; commits físicos alcanzables | real Git + reentry green | n/a | automated-pass |
| E2E-012 | Composite all-no-op/redundante | no duplica base SHA ni dispara duplicate child commit | redundant distinct commits real Git + nested all-no-op green | n/a | automated-pass |
| E2E-013 | Artifact vacío/fallido | failed_artifact; sin evidence/gate/completed success | pipeline + projection green | n/a | automated-pass |
| E2E-014 | Artifact unverified/partial | evidencia sólo si material; nunca completed success | parcial | pendiente | pending |
| E2E-015 | Delivery desde needs_delivery | confirmación única, receipt idempotente, manifest delivered, completed | real Git route + crash recovery green | pendiente | pending |
| E2E-016 | Conflicto de delivery | abort limpio, estado retryable, sin rollback falso | parcial | pendiente | pending |
| E2E-017 | RunRecord corrupto/grande | listado no bloqueante y polling acotado/single-flight | 24 tests + server vivo: hot path sin crawl, índice incremental | pendiente | pending |
| E2E-018 | Workspace duplicado exact/case/symlink/subdir | una identidad canónica y migración legacy | exact/case/symlink/subdir green; concurrencia/cache/API alias en fix | pendiente | pending |
| E2E-019 | Dependencia A → B con archivo concreto | contrato `ordering_only`; B conserva el base y no recibe A; integración compone ambos | prompt/UI guards + real Git green | pendiente | pending |
| E2E-020 | Edit de DAG después de planning | snapshot, events, canvas y approval revision coinciden | full replacement/cold reload green; runtime/amendment/replan gaps en fix | pendiente | pending |
| E2E-021 | Canvas D1/seam/conflict | edges tipados, sin self-seam ni seam-as-dependency | typed event→reducer→canvas + self-seam boundary/projection green | pendiente | pending |
| E2E-022 | Scheduling de seams grounded | paralelismo seguro, wave ordinal humano correcto | seam-risk + ordinal 1..N regressions green | pendiente | pending |

Las capturas aprobadas se almacenan en `docs/audits/screenshots/` con nombre `<scenario>-<viewport>-<step>.png` y se referencian desde esta tabla al verificarse.
