# Validación, evidencia y resultado

## Principio

El sistema no pregunta “¿el comando terminó en cero?”, sino “¿qué criterios
quedaron demostrados sobre este commit exacto?”.

## ValidationContract y recipe

El contrato define obligaciones. El compiler de recipes resuelve checks
ejecutables desde package scripts, config, tests, tipos de artifact y políticas
de riesgo.

```ts
type EvidenceItem = {
  criterionId: string;
  status: "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";
  source: "command" | "diff" | "review" | "artifact" | "manual";
  refs: string[];
  observedOnCommit: string;
  rationale?: string;
};
```

## Pipeline por candidato

1. Confirmar fingerprint y commit.
2. Crear sandbox limpio del commit candidato.
3. Compilar ValidationRecipe.
4. Reproducir baseline relevante sobre la base previa.
5. Ejecutar checks en orden barato→caro, sin ocultar los obligatorios.
6. Detectar tests eliminados, `skip`, `only` y assertions debilitadas.
7. Aplicar negative control cuando sea viable: el test nuevo debe fallar sobre
   la base previa o demostrar otra discriminación válida.
8. Construir Evidence Matrix.
9. Clasificar eligibility y persistir evidencia.

## Capas

- Leaf: scope, static checks, tests focalizados y criterios locales.
- Composite: integración de contratos y tests del límite.
- Root: objetivo end-to-end, seguridad, build y regresiones.
- Delivery candidate: repetición de checks necesarios sobre el árbol exacto a
  publicar.

## Flaky y retry

Un check que falla y pasa sin cambio relevante es `flaky`. Puede investigarse o
repetirse según política, pero no se transforma en `satisfied` limpio. Criterios
obligatorios flaky dejan el artifact `unverified` salvo decisión explícita de
política que nunca equivale a `verified`.

## Revisión semántica

Tests no cubren todo. Según riesgo, el validator puede exigir revisión de:

- alineación con arquitectura del repo;
- auth/permissions y datos sensibles;
- migraciones y backward compatibility;
- accesibilidad y UX;
- performance o concurrency.

La revisión produce findings y evidencia, no texto libre que marque success.

## Resultado final

```ts
type FinalArtifactManifest = {
  commitSha: string;
  treeSha: string;
  graphRevision: number;
  artifactIds: ArtifactId[];
  evidenceMatrixId: string;
  validationRecipeDigest: string;
  deliveryTarget: string;
};
```

`result_ready` requiere manifest candidato y Evidence Matrix elegible.
`completed` requiere delivery receipt correspondiente al mismo tree/commit.
