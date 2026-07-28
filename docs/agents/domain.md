# Domain documentation

ManyHands already has authoritative product, architecture, system, and thesis
documents. Skills must consume those sources rather than create a parallel
description of the system.

## Before exploring

1. Read `PRODUCT.md` and `docs/README.md`.
2. Read `CONTEXT-MAP.md` and follow only the entries relevant to the work.
3. Read applicable ADRs under `docs/adr/`.
4. For thesis work, read `docs/tesis/HANDOFF.md` and the referenced evidence
   protocol or defect record.

## Vocabulary and authority

- Use the canonical terms from the selected context documents.
- Do not rename persisted historical evidence to match newer terminology.
- If implementation contradicts target documentation, record a transition gap;
  do not rewrite the target silently.
- New context documents should be created only when a real terminology gap is
  resolved. They must point back to the authoritative source rather than copy it.
