# 18 — Cablear integridad de tests y controles negativos

**What to build:** el validador V2 rechaza candidatos que borran/debilitan tests o eluden cobertura aunque el comando restante quede verde.

**Blocked by:** 17.

**Status:** ready-for-agent

- [ ] RED cubre test borrado, skip, only y assertion de carga removida.
- [ ] `ExactCandidateValidatorV2` ejecuta detección productiva y negative control.
- [ ] Findings y referencias quedan en la Evidence Matrix durable.
- [ ] Suites, typecheck y reviews Standards/Spec pasan.
