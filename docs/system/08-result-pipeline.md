# Validación, evidencia y resultado

## Principio

El sistema no pregunta “¿el comando terminó en cero?”, sino “¿qué criterios
quedaron demostrados sobre este commit exacto?”.

## ValidationContract y recipe

El contrato define obligaciones. El compiler de recipes resuelve checks
ejecutables desde package scripts, config, tests, tipos de artifact y políticas
de riesgo. Cada step materializado conserva una atribución explícita a
`criterionId`, `obligationId` y referencias exactas. Si esa atribución no existe,
la obligación no recibe un comando genérico por defecto y queda sin materializar.

Un enlace `shared_command` debe enumerar sus criterios y explicar por qué una
ejecución es relevante para cada uno; sus referencias exactas se ejecutan como
selectors. El recipe deduplica comandos físicos idénticos por digest, ejecuta
una sola vez y proyecta observaciones lógicas separadas para todas las
atribuciones explícitas sin inventar ejecuciones adicionales.

```ts
type EvidenceItem = {
  criterionId: string;
  status: "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";
  source: "command" | "diff" | "review" | "artifact" | "manual";
  refs: string[];
  observedOnCommit: string;
  rationale?: string;
};

type CriterionEvidenceObservation = {
  evidenceId: string;
  commandDigest: string;
  durationMs: number;
  passed: boolean;
  attempt: number;
  outputDigest: string;
  criterionIds: string[];
  obligationIds: string[];
  references: string[];
};
```

La Evidence Matrix sólo considera pertinente una observación cuando coincide
el criterio, la obligación, el digest del comando, la duración observable y
todas las referencias enlazadas. El resultado durable agrupa una ejecución
física compartida en una observación con todos sus criterios y obligaciones.
Un exit code verde sin ese enlace deja el criterio `unverified`.

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

La evidencia es función pura de la `ValidationRecipe` compilada, que fija el
commit candidato exacto, el contrato de validación, el snapshot y los steps. Un
`EvidenceValidationCache` opcional, keyed por `recipeId`, permite reutilizar la
Evidence Matrix de una recipe idéntica —revalidación de entrega, replay de
recuperación o un retry que reprodujo el mismo candidato— sin reabrir sandbox ni
re-ejecutar checks; nunca convierte un resultado negativo en positivo. El sandbox
de baseline se abre una vez por candidato y se reutiliza entre obligaciones, no
uno por obligación.

La duración se persiste como medición de la ejecución, pero no forma parte de
`matrixId`: dos ejecuciones equivalentes de la misma recipe conservan identidad
estable aunque el reloj observado difiera. Resultado, intento, digest de salida,
digest de comando y atribuciones sí forman parte de la identidad.

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

El protocolo experimental Wide Graph añade un gate externo entre ambos estados:
su driver sólo autoriza delivery tras un PASS del contrato de oráculo congelado
atribuible al commit candidato exacto y reconcilia el receipt final contra el
mismo SHA. Este gate no reescribe retrospectivamente la Evidence Matrix ni los
eventos `final_candidate.verified`; un contrato más fuerte crea una nueva versión
y una nueva serie.
