# 18 — Cablear integridad de tests y controles negativos

**What to build:** el validador V2 rechaza candidatos que borran/debilitan tests o eluden cobertura aunque el comando restante quede verde.

**Blocked by:** 17.

**Status:** ready-for-agent

- [ ] RED cubre test borrado, skip, only y assertion de carga removida.
- [ ] `ExactCandidateValidatorV2` ejecuta detección productiva y negative control.
- [ ] Findings y referencias quedan en la Evidence Matrix durable.
- [ ] CLAIM-040/041 sólo se reevalúan después de evidencia productiva; mientras tanto permanecen `partial`.
- [ ] Suites, typecheck y reviews Standards/Spec pasan.

## Progreso TDD

- RED con Node 22.23.1/pnpm 7.29.3: 5 fallos válidos. Un test borrado,
  `skip`, `only` y una assertion removida conservaban outcome `verified`; el
  detector aislado tampoco encontraba los tres debilitamientos de contenido.
- GREEN focal: 24/24. `ExactCandidateValidatorV2` inspecciona el diff exacto,
  compara contenidos/scripts, ejecuta tests candidatos sobre la base previa y
  rechaza un control que permanece verde.
- La matriz durable conserva findings completos y controles con `evidenceId`,
  outcome y digest de output; el schema impide outcome `verified` con findings
  o controles ineficaces.
- Typechecks execution-core/run-coordinator PASS. CLAIM-040/041 permanecen
  `partial`; pendiente gate afectado amplio y reviews Standards/Spec.
- Gate afectado amplio: 44/44 PASS. Typechecks execution-core,
  run-coordinator, orchestrator-graph y web PASS. Working tree limpio en el
  punto fijo documentado; pendiente reviews independientes Standards/Spec.
- Reviews del fixed point `6ab9bde`: Spec FAIL P1 y Standards FAIL con 3 P1 +
  4 P2. Confirmaron bypass por script estrechado, symlink de materialización,
  schema durable sin bump, cache incompleto, baseline no exacto, `assert(...)`
  omitido y cleanup secuencial. No implementaron correcciones.
- Reapertura TDD: 6 fallos observables; GREEN 38/38. El fix `4fec620` compara
  scripts de test fail-closed en manifests cambiados de ambos commits, rechaza
  symlinks, versiona eventos v3 con upcast v2, versiona la cache con findings,
  cuenta `assert(...)` y siempre intenta ambos cleanups.
- Typechecks execution-core/run-store/run-coordinator PASS. Pendiente repetir
  gate afectado amplio y re-reviews.
- Gate afectado ampliado tras remediation: 66/66 PASS en 16 archivos, incluidos
  run-store fencing/event-source/snapshot/upcast. Typechecks execution-core,
  run-store, run-coordinator, orchestrator-graph y web PASS. Pendiente
  re-reviews independientes.
