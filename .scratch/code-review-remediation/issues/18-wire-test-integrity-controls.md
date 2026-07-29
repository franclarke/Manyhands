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
- Re-reviews `37ed94d`: ambos FAIL P1 por discovery config y scripts indirectos.
  Fix `6c1989d` agrega finding durable para configs de runner y compara
  fail-closed todos los scripts de cada manifest cambiado. Focal 24/24 y
  typechecks execution-core/run-coordinator PASS; pendiente re-review final.
- Re-review `40d2d2a`: FAIL por Jest embebido/Mocha, wrapper externo y enum nuevo
  bajo v3. Fix `a33cf84` congela config embebida, manifests ancestros e inputs
  referenciados por comandos; schema durable v4 con upcast v3. Delta 32/32 y
  tres typechecks PASS; pendiente reviews finales.
- Re-review `d2e6add`: los hallazgos previos quedaron resueltos; FAIL P1 único
  por wrappers relativos a workspaces y dependencias transitivas. TDD reprodujo
  ambos casos. Fix `acb1b1b` resuelve comandos desde el directorio del manifest
  y recorre imports/requires relativos en ambos commits. Focal 28/28 y
  typechecks execution-core/run-coordinator PASS; pendiente reviews finales.
- Reviews `7b19895`: Spec FAIL P1 por imports de paquetes workspace; Standards
  FAIL con dos P1 y un P2 porque el recorrido desde todos los scripts bloquea
  código productivo, la regex conserva inputs opacos/NodeNext y no tiene
  presupuesto. Se descarta continuar enumerando sintaxis: la siguiente RED
  exige raíces de test reales, resolución workspace/fail-closed y límites.
- RED posterior: cuatro fallos válidos (alias workspace, NodeNext, loader opaco
  y falso positivo sobre `dev`). Fix `85079da`: sólo sigue la clausura de
  scripts de test, resuelve paquetes workspace y sources NodeNext, rechaza
  loaders opacos y acota el recorrido a 256 archivos/16 niveles/1 MiB con
  cancelación. GREEN focal 33/33; typecheck execution-core PASS.
