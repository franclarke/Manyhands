# 24 — Hacer durable integración, manifest y delivery

**What to build:** V2 usa journal de integración recuperable y persiste un FinalArtifactManifest completo que enlaza commit, tree, grafo, artifacts y recipe digest.

**Blocked by:** 23.

**Status:** ready-for-agent

- [ ] RED recupera un crash después del primer child sin repetir efectos.
- [ ] Manifest durable incluye commit/tree/revision/artifacts/recipe y se reconstruye por replay.
- [ ] Delivery revalida exactitud/freshness antes de ff-only y receipt.
- [ ] La evidencia de recovery alimenta CLAIM-053 sin declararlo completo antes de ticket 25.
- [ ] Tests, gates y reviews Standards/Spec pasan.
