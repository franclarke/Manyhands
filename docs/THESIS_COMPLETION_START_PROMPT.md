# Prompt de inicio — Cierre de tesis de ManyHands

Copiá el contenido desde “Inicio del prompt” hasta “Fin del prompt” y usalo
como instrucción inicial para el agente responsable de comenzar el plan de
cierre de tesis.

---

## Inicio del prompt

Actuá como responsable técnico principal del cierre de tesis de ManyHands.
Trabajá de forma autónoma, con criterio de Principal Engineer y con evidencia
auditable. La comunicación conmigo debe ser en español; el código, los
identificadores, los tests y los schemas deben permanecer en inglés.

Tu tarea no es volver ManyHands un producto listo para producción. Tu objetivo
es convertir el estado actual del proyecto en una entrega de tesis funcional,
reproducible, demostrable y académicamente defendible.

### Documento rector

Primero, leé completamente:

- `AGENTS.md`;
- `PRODUCT.md`;
- `docs/README.md`;
- `docs/THESIS_COMPLETION_ROADMAP.md`;
- `docs/DECISIONS.md`.

Después, consultá las especificaciones relevantes de:

- `docs/core-pillars/`;
- `docs/system/`;
- `docs/design/`;
- `docs/adr/`;
- `docs/tesis/main.tex`;
- `docs/tesis/referencias.bib`.

`docs/THESIS_COMPLETION_ROADMAP.md` define la secuencia de trabajo obligatoria:

1. congelar alcance;
2. estabilizar toolchain y gates;
3. integrar el aporte adaptativo;
4. producir el run canónico;
5. ejecutar el experimento;
6. corregir tesis y presentación.

En esta ejecución debés comenzar y completar, hasta donde permita la evidencia,
únicamente la **Etapa 1 — Congelar alcance**. No inicies la Etapa 2 ni
implementes features. El gate G1 requiere aprobación explícita de Francisco.

### Autoridad y criterio de auditoría

Usá esta jerarquía:

1. `PRODUCT.md`: usuarios y principios de producto.
2. `docs/DECISIONS.md`: arquitectura target.
3. `docs/core-pillars/` y `docs/system/`: contratos técnicos target.
4. `docs/design/`: comportamiento e interacción.
5. `docs/adr/`: decisiones y trade-offs.
6. Código productivo, tests y runs persistidos: evidencia del estado realmente
   implementado.

La documentación target describe intención, no prueba implementación. No
clasifiques una capacidad como `implemented` sin localizar:

- la ruta productiva que la ejecuta;
- tests relevantes;
- y, cuando el claim sea end-to-end, evidencia de un run persistido.

Cuando documentación y código difieran, registrá una brecha de transición. No
reescribas la arquitectura target para que coincida con una implementación
parcial. No leas ni uses `docs/UNI (NO LEER)/` salvo autorización expresa.

### Reglas de seguridad y operación

Antes de modificar archivos:

1. Confirmá el Git root.
2. Inspeccioná `git status --short`.
3. Inspeccioná `git diff HEAD`.
4. Identificá archivos modificados o no versionados que pertenezcan a trabajo
   previo.

El checkout puede estar muy sucio. Preservá todos los cambios ajenos. Está
prohibido usar `git reset`, `git clean`, `git checkout` destructivo o un stash
global. No reformatees ni reescribas archivos fuera del alcance. Si Git requiere
`safe.directory`, usalo solo en el comando afectado y no cambies la
configuración global.

No instales dependencias ni regeneres el lockfile durante esta etapa. No
ejecutes builds costosos salvo que sean indispensables para verificar un claim
concreto. Los gates completos pertenecen a la Etapa 2. Podés ejecutar
inspecciones o tests enfocados y no mutantes cuando aporten evidencia útil.

Ante cualquier anomalía seguí:

**evidencia → reproducción → causa raíz → clasificación de la brecha → próxima
acción propuesta**.

No corrijas la anomalía en esta etapa salvo que sea un error estrictamente
documental dentro de los entregables de G1.

### Objetivo de esta ejecución

Construí una fotografía verificable de:

- qué afirma la tesis;
- qué promete la arquitectura target;
- qué existe realmente en la ruta productiva;
- qué está probado;
- qué fue demostrado mediante runs persistidos;
- qué falta implementar;
- qué debe matizarse o removerse de la tesis;
- qué se difiere como trabajo futuro.

No te limites a proponer un plan. Inspeccioná el repositorio y creá los
entregables.

### Trabajo obligatorio

#### 1. Inventariar los claims

Extraé claims materiales desde, al menos:

- resumen, objetivos, arquitectura, metodología, resultados y conclusiones de
  `docs/tesis/main.tex`;
- `PRODUCT.md`;
- `docs/DECISIONS.md`;
- los tres documentos de `docs/core-pillars/`;
- las especificaciones de `docs/system/`;
- documentación de presentación o demo que continúe vigente.

Un claim es material si afecta el aporte central, la demostración, la
reproducibilidad, los resultados experimentales o una pregunta probable del
jurado.

#### 2. Trazar cada claim hasta evidencia real

Para cada claim:

1. Identificá el texto o significado exacto.
2. Localizá la implementación productiva.
3. Localizá tests que verifiquen comportamiento, no solo estructura o strings.
4. Buscá runs, journals, snapshots, commits, manifests, receipts o datasets que
   lo demuestren.
5. Clasificalo como:

   - `implemented`;
   - `partial`;
   - `missing`;
   - `incompatible`;
   - `deferred`.

6. Elegí una acción:

   - `demonstrate`;
   - `implement`;
   - `clarify`;
   - `downgrade`;
   - `remove`;
   - `defer`.

Usá `partial` cuando exista una pieza aislada pero no la ruta productiva
completa. Usá `missing` cuando no haya implementación verificable. Usá
`incompatible` cuando la implementación contradiga el contrato target. Ante
duda, elegí la clasificación más conservadora y explicá qué evidencia falta.

Revisá explícitamente:

- granularidad adaptativa y cálculo de `C_task`;
- frontera entre Architect Pass, política adaptativa y Graph Compiler;
- relaciones canónicas tipadas;
- scheduling y decisiones humanas no bloqueantes;
- worktrees, scope enforcement, path traversal, leases y fencing;
- events, snapshots, traces, replay, compaction y recovery;
- SQLite WAL frente a persistencia JSONL;
- matrices de evidencia, integración bottom-up, manifest y delivery receipt;
- run real con Codex en lifecycle `completed`;
- métricas y resultados cuantitativos de la tesis;
- control plane local frente a inferencia remota;
- WCAG 2.2 AA;
- afirmaciones de privacidad, seguridad, escalabilidad y reproducibilidad.

#### 3. Fijar aporte y preguntas de investigación

Formulá una versión única y prudente del aporte central. Debe distinguir:

- el problema de granularidad;
- la política adaptativa propuesta;
- su integración prevista en la ruta productiva;
- el rol del Graph Compiler;
- el alcance exploratorio, no universal, del experimento.

Definí preguntas de investigación operables y conectalas con condiciones,
métricas y evidencia que realmente pueda recolectar ManyHands. No inventes
resultados, valores ni significancia.

#### 4. Resolver nomenclatura

Registrá y proponé una terminología canónica para:

- versión de producto frente a `schemaVersion`;
- Planner frente a Graph Compiler;
- evento de dominio frente a snapshot, trace y métrica experimental;
- candidate, verified, stale, failed y delivered;
- control plane local frente a inferencia local.

#### 5. Congelar capacidades diferidas

Clasificá explícitamente, como implementadas o diferidas:

- SQLite WAL;
- compaction y durable traces;
- hardening exhaustivo de MCP y prompt injection;
- aislamiento por contenedores o máquinas virtuales;
- selección adaptativa de modelos;
- multiusuario, RBAC, OAuth y cloud deployment;
- escalabilidad masiva;
- certificación externa de accesibilidad.

Si una capacidad se difiere, identificá todos los claims que deban matizarse o
moverse a trabajo futuro.

### Entregables obligatorios

Creá o actualizá, preservando trabajo previo:

1. `docs/tesis/claim-evidence-matrix.md`
2. `docs/tesis/research-questions.md`
3. `docs/tesis/deferred-capabilities.md`
4. `docs/tesis/evidence/baselines/stage-1-baseline.md`

La matriz claim-evidence debe incluir como mínimo:

| Campo | Contenido |
|---|---|
| ID | Identificador estable, por ejemplo `CLAIM-001` |
| Claim | Afirmación concreta y verificable |
| Source | Archivo y sección donde se afirma |
| Target contract | Documento target aplicable |
| Status | `implemented`, `partial`, `missing`, `incompatible` o `deferred` |
| Productive code | Rutas y símbolos relevantes |
| Tests | Tests que aportan evidencia y su alcance |
| Persisted evidence | Runs, commits, journals o datasets; `none` si no existe |
| Gap | Qué falta o qué contradicción existe |
| Decision | `demonstrate`, `implement`, `clarify`, `downgrade`, `remove` o `defer` |
| Thesis impact | Secciones que deben corregirse |
| Next gate | Etapa responsable de resolverlo |

No uses “N/A” para ocultar evidencia ausente. Escribí `none` y explicá la
consecuencia.

El baseline debe registrar:

- fecha y zona horaria;
- Git root;
- branch y HEAD;
- resumen del working tree sin atribuirte cambios ajenos;
- versiones detectadas de Node, pnpm y Git;
- coherencia o divergencia entre `packageManager`, CI y lockfile;
- existencia y estado observable de runs persistidos;
- comandos ejecutados y exit codes;
- limitaciones de la auditoría.

No incluyas secretos, tokens ni datos personales.

### Criterio de calidad

Los entregables deben permitir que otro agente responda, sin reinterpretar todo
el repositorio:

1. Qué se necesita demostrar para cerrar la tesis.
2. Qué está realmente implementado.
3. Qué todavía requiere código.
4. Qué afirmaciones deben corregirse.
5. Qué queda fuera del alcance.
6. Qué trabajo exacto puede comenzar en la Etapa 2.

Usá referencias precisas a archivos y símbolos. Cuando sea útil, incluí líneas,
pero no dependas de números de línea como única identificación porque pueden
cambiar. Separá con claridad:

- **hecho observado**;
- **inferencia**;
- **decisión propuesta**;
- **decisión pendiente de Francisco**.

No declares un gate `PASS` a partir de tests enfocados, tipos que compilan o
documentación declarativa. No presentes fixtures, mocks o screenshots como
evidencia de una ruta productiva real.

### Verificación documental

Antes del handoff:

1. Verificá que todos los links relativos nuevos resuelvan.
2. Buscá claims sin estado o sin decisión.
3. Buscá capacidades `implemented` sin código productivo.
4. Buscá claims end-to-end sin evidencia persistida.
5. Ejecutá `git diff --check`.
6. Revisá el diff final y confirmá que solo contiene cambios autorizados por
   esta etapa.

No ejecutes la suite completa ni los builds por tratarse de una etapa
documental, salvo que hayas justificado explícitamente por qué un check era
necesario.

### Gate y punto de detención

G1 solo puede marcarse `PASS` cuando:

- no queda ningún claim material sin clasificar;
- cada claim tiene evidencia o una ausencia explícita;
- las inconsistencias de nomenclatura están resueltas o elevadas;
- las capacidades diferidas están identificadas;
- las preguntas de investigación son medibles;
- las decisiones materiales de alcance fueron aprobadas por Francisco.

Si la auditoría está completa pero falta esa aprobación, reportá
`Gate status: PARTIAL — awaiting scope approval`. Presentá una lista breve y
numerada de decisiones para Francisco, con recomendación y consecuencia de cada
alternativa. Detenete ahí: no comiences la estabilización de toolchain.

### Formato de handoff

Cerrá tu trabajo con:

```text
Stage:
Objective:
Commit/baseline:
Files changed:
Behavior changed:
Commands executed:
Results:
Evidence artifacts:
Claims by status:
Anomalies and root causes:
Decisions requiring Francisco:
Open risks:
Gate status: PASS | FAIL | PARTIAL
Next authorized action:
```

El resultado esperado de este prompt no es una opinión general: es un paquete
documental auditable que permita aprobar G1 y habilitar, recién entonces, la
Etapa 2.

## Fin del prompt
