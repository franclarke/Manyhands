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
- Reviews `65e48f8`: Spec FAIL 2 P1 (loader opaco estable bloquea cambios ajenos;
  mapa candidate pisa baseline y faltan exports/tsconfig); Standards FAIL 2 P1
  + P2 (spawn/make, subpaths/imports y límite aplicado después de cargar blobs).
  El punto fijo y los resultados adversos se preservan sin reinterpretación.
- Remediation estructural: `ee9b78b` separa y une resolución exacta
  baseline/candidate para exports/imports/tsconfig, cubre spawn/Makefile y sólo
  falla opaco al intersectar el cambio. `5e71d9f` agrega `showFile` acotado y
  cancelable; `18c0b5d` lo cablea antes de materializar blobs. 46/46 PASS. El
  primer typecheck falló por optional exacto; ajuste mínimo y ambos typechecks
  execution-core/run-coordinator PASS.
- Reviews `3746182`: Spec PASS, cero P0-P3. Standards FAIL 2 P1 + P2 por
  scripts workspace entre manifests, `imports` sin name/JSONC/extends y porque
  el presupuesto no incluye lecturas iniciales. Se preserva el PASS/FAIL
  dividido; el ticket no cierra hasta resolver Standards.
- RED final: cuatro fallos (script cross-manifest, imports sin name,
  tsconfig JSONC/extends y blob inicial fuera del presupuesto). Fix `1c99171`
  modela la clausura global de scripts, sigue configuración heredada y comparte
  1 MiB/cancelación entre todas las lecturas. GREEN 50/50; typechecks
  execution-core/run-coordinator PASS. Pendiente re-review de ambos roles.
- Reviews `8ce8955`: ambos FAIL. Spec P1 y Standards 2 P1 + P2 por pérdida de
  identidad: `--filter` enlaza scripts homónimos ajenos, nombres con punto no se
  tokenizan, wildcard tsconfig no usa el más específico y aliases privados se
  fusionan globalmente. Los controles previos permanecen PASS.
- RED de identidad: cuatro fallos válidos (script con punto, wildcard más
  específico y falsos positivos de filter/alias privado). Fix `c3cb30e`
  conserva manifest/package scope, interpreta `--filter`, prioriza patterns y
  scope de config. GREEN 36/36; typechecks execution-core/run-coordinator PASS.
- Reviews `656423e`: ambos FAIL por shorthand/filtros múltiples o quoted de
  pnpm. Standards agregó homónimo preexpandido localmente y scope de tsconfig
  base externo aplicado al directorio equivocado. Ticket permanece abierto.
- RED posterior: shorthand quoted, homónimo local filtrado y config base fuera
  del root fallaron. Fix `c9a10f7` parsea cada segmento pnpm y transporta scope
  de aplicación por extends. GREEN 37/37; ambos typechecks PASS.
- Reviews posteriores aislaron múltiples filters, args tras `--` y exec/dlx.
  RED 3; fix `9e4eda3` consume la gramática posicional y excluye subcomandos que
  no ejecutan scripts. GREEN 39/39; ambos typechecks PASS.
