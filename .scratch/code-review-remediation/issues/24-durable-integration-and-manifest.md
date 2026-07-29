# 24 — Hacer durable integración, manifest y delivery

**What to build:** V2 usa journal de integración recuperable y persiste un FinalArtifactManifest completo que enlaza commit, tree, grafo, artifacts y recipe digest.

**Blocked by:** 23.

**Status:** closed

- [ ] RED recupera un crash después del primer child sin repetir efectos.
- [x] Manifest durable incluye commit/tree/revision/artifacts/recipe y se reconstruye por replay.
- [x] Delivery revalida exactitud/freshness antes de ff-only y receipt.
- [ ] La evidencia de recovery alimenta CLAIM-053 sin declararlo completo antes de ticket 25.
- [x] Tests, gates y reviews Standards/Spec pasan.

## Closure evidence - 2026-07-29

- [x] `tests/run-v2-e2e.test.ts` and `tests/integration-manifest.test.ts` recover a crash after the Git effect with an authorized takeover without repeating the applied child.
- [x] The journal persists and replays the `IntegrationManifest`; the canonical `FinalArtifactManifest` links commit, tree, graph revision, artifacts, evidence matrix, recipe digest and delivery target.
- [x] Root V2 requires both `finalManifestId` and the complete manifest; coordinator replay preserves its invariants.
- [x] Delivery revalidates metadata, exact tree and target immediately before `merge --ff-only`, then validates the receipt.
- [x] CLAIM-053 remains `partial`; recovery test evidence was added without declaring the claim complete before ticket 25.
- [x] Focused Spec review: 40/40 tests PASS. Final Standards review: PASS, no P0-P3 findings.
- [x] Typechecks/builds for shared, execution-core, run-coordinator, orchestrator-graph and web PASS; `git diff --check` PASS.
