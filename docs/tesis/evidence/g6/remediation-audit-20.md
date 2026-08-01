# G6 — auditoría de remediación 20

## Fallo observado

La corrida `g6-03-T1-B-r1-remediation-20-full` (`97b38515-b7ff-422d-8e61-f6ed5bd438b2`) llegó a `needs_approval`, ejecutó la aprobación pre-registrada y completó un único intento de la hoja de dominio. El intento produjo un candidato válido (`e72069bca524dbe373194c26fd2be6acec34fa59`) y journalizó `tokensTotal=105313`, pero no produjo `costUsd`. El scheduler cerró el presupuesto monetario y dejó la corrida en `waiting_for_input` sobre `resolve_conflict`; no se respondió la decisión.

La causa de base no fue el agente ni un conflicto de worktree: el catálogo no reconocía `gpt-5.4-mini`, y Codex CLI informa sólo el total de tokens. Como la celda declara `maxCostUsd=8`, la guarda de presupuesto trata un costo ausente como no medible y bloquea las hojas restantes. La primera corrida del driver también tuvo una desviación operativa de ruta externa (`Documents\manyhands-g6-runtime` frente a `Documents\Proyectos\manyhands-g6-runtime`); se detuvo sólo ese driver y se reanudó el mismo run con `--attach`, sin repetir la celda ni contestar decisiones.

## Fix aplicado

- Se agregó `gpt-5.4-mini` al catálogo de precios estándar (`$0.75/M` input, `$4.50/M` output).
- Se agregó una estimación conservadora para proveedores que reportan sólo el total: cada token se valora a la tarifa mayor del modelo. Es una cota superior para hacer cumplir el tope, no una afirmación de factura exacta.
- El perfil Codex recibe el modelo seleccionado y registra esa cota en `costUsd`; un modelo desconocido continúa sin costo fabricado y debe quedar bloqueado por la guarda.
- Se agregaron regresiones para el modelo conocido y para el modelo desconocido.

## Verificación

- Regresión roja previa al fix: `tests/codex-usage-parsing.test.ts` falló porque `costUsd` era `undefined` para `gpt-5.4-mini`.
- `pnpm build`: pasó después del fix.
- `pnpm test -- tests/codex-usage-parsing.test.ts tests/execution-core-codex-cli.test.ts`: 15/15 pasó.

El precio usado se contrastó con la ficha oficial de GPT-5.4 mini, pero el journal de ManyHands conserva la cota calculada y su total de tokens como evidencia operativa de esta celda.

## Qué no se concluye

- Esta corrida no es un resultado experimental de G6: no produjo candidate integrado ni delivery.
- No demuestra que la hipótesis pase ni que el modelo complete correctamente la tarea.
- La cota conservadora no equivale a un importe exacto de facturación.
- La celda debe reintentarse desde un run fresco, con el mismo estímulo, criterios y protocolo congelado, después del commit del fix.
