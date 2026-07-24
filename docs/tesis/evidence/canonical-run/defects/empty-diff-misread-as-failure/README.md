# Defecto: un no-op legítimo clasificado como fallo

> **Run:** `5fe0aa27-2862-4af8-be04-be882995d727` (2026-07-24, serie G4)
> **Estado alcanzado:** `waiting_for_input`, parado en `resolve_conflict`.
> **Corrección:** commit `db096d0`.

## Qué se observó

La política produjo dos hojas. La primera,
`expense-category-domain:expense-category-web` (una unidad **fusionada** por el
crítico de coalescencia), ejecutó y commiteó **cuatro** archivos:

```
src/api/expenses.ts   src/domain/expense.ts   src/web/summary.ts   tests/expense.test.ts
```

La segunda hoja, `expense-category-api`, recibió como base el trabajo de la
primera y reportó:

```
empty_diff: ... the requested behavior appears already present;
verification will determine whether any corrective edit is needed.
```

El sistema lo clasificó como `execution_failed` y levantó una decisión
`resolve_conflict` que ningún operador podía responder de forma útil: el trabajo
**ya estaba hecho y era correcto**.

## Causa raíz

Dos condiciones se combinan.

**1. Solapamiento legítimo de alcance.** `src/api/expenses.ts` estaba en los
`allowedPaths` de *ambas* hojas —la unidad fusionada heredó las rutas de sus dos
fuentes—, así que la primera hoja implementó trabajo de la segunda **sin violar
su contrato**. No hubo violación de alcance porque no la hubo.

**2. Un heurístico inalcanzable.** El `ResultRecorder` ya distinguía un no-op
legítimo (`baselineSatisfiesContract`), pero ese chequeo necesita
`expectedOutput.changedFiles` o `executionScope.implementationPaths`, y la ruta
V2 **no pasa ninguno de los dos**: solo entrega el contrato de alcance. El
heurístico nunca podía dispararse en esta ruta, de modo que *todo* diff vacío era
un fallo.

## Por qué no se corrigió con un heurístico mejor

La tentación era derivar las rutas de implementación desde `allowedPaths`. Sería
incorrecto: sobre un repositorio existente **todas** las rutas declaradas ya
existen en la base, así que el chequeo daría verdadero siempre y un agente que
no hiciera nada quedaría registrado como éxito.

La corrección usa la verificación del propio sistema en lugar de una conjetura:
ante un diff vacío se **revalida la base**. Si la matriz de evidencias verifica,
el contrato está genuinamente satisfecho y la hoja tiene éxito sin commit; si no
verifica, el agente realmente no hizo su trabajo y la hoja sigue fallando.

Regresión: `tests/leaf-empty-diff-noop.test.ts`, con ambos lados —el no-op que
debe pasar y el agente ocioso que debe seguir fallando.

## Consecuencia sobre el gate

Defecto sistémico ⇒ la serie de G4 se reinició sobre el commit corregido.

## Limitación que queda expuesta

La causa de fondo —que una unidad fusionada herede rutas que solapan con las de
una hermana, permitiéndole hacer trabajo ajeno sin violar nada— **no está
resuelta**. La corrección evita que ese solapamiento se manifieste como un fallo
espurio, pero no impide el solapamiento en sí. Reducir el alcance de una unidad
fusionada a lo que realmente le corresponde exigiría una decisión semántica que,
por el resultado negativo de esta misma tesis, la política determinista no puede
tomar. Queda declarado como trabajo futuro.
