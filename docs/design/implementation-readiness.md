# Preparación para implementación

> Estado: **baseline de diseño** (2026-06-05). Documento puente. **No** es un plan de implementación por PRs — ese es el paso siguiente. Acá se establece qué está listo, qué falta y bajo qué criterios se pasa al plan.
>
> **Superado (auditoría 2026-06-05):** este documento cumplió su rol de puente. El plan se escribió ([`implementation-plan.md`](implementation-plan.md)) y **PR01–PR09 ya están implementados** (fixture-first). Para el estado real de implementación, ver [`implementation-status.md`](implementation-status.md). Se conserva como registro de los criterios de preparación; lo de abajo es histórico.

---

## 1. Qué documentación queda congelada

| Documento | Estado |
|---|---|
| [`run-operative-model.md`](run-operative-model.md) | **Congelado** con refinamientos A–P. Base directa del `runStore`. |
| [`agent-first-redesign.md`](agent-first-redesign.md) | **Congelado** (visión, fases, U de involucramiento). |
| [`interaction-model.md`](interaction-model.md) | **Estable** (comportamiento; el detalle visual fino queda abierto). |
| [`system-components.md`](system-components.md) | **Estable** (piezas conceptuales; nombres React aún no fijados). |
| [`golden-fixtures.md`](golden-fixtures.md) | **Congelado** como contrato de regresión (5 fixtures). |
| [`evolution-and-rationale.md`](evolution-and-rationale.md) | Registro histórico. |

Decisiones congeladas validadas por `golden-behavioral-conflict` y `golden-seam-amendment-blast-radius`.

## 2. Qué conceptos están listos para implementación

- El **envelope `RunEvent`** y las **entidades** (Run, Node, Seam, Wave, Decision, Conflict, Amendment, Evidence).
- El **reducer puro** y los **selectores derivados** (incluido `selectRenderableNodeState`).
- Los **5 fixtures golden** como tests del reducer e insumo del prototipo.
- Las **familias de eventos v1** (las marcadas v1 en el modelo).
- Las **proyecciones de UI** como consumidoras de selectores.

## 3. Orden de implementación (dependencias)

El orden correcto sale de las dependencias de datos, no de la vistosidad:

```
1. Entidades + envelope RunEvent        (vocabulario)
        ↓
2. Reducer puro + selectores            (columna vertebral; todo cuelga de acá)
        ↓
3. Fixtures golden                      (tests del reducer + insumo de UI)
        ↓
4. Proyecciones de UI sobre el modelo   (prototipo con fixtures, sin backend)
        ↓
5. SSE adapter (legacy → RunEvent)      (puente con el backend actual)
        ↓
6. Eventos backend nuevos               (grounding, verify-loop, invalidación)
```

Dependencias clave:
- **La UI no puede construirse bien sin el reducer + selectores** (sería estado visual local otra vez).
- **Los selectores no pueden testearse sin fixtures.**
- **Los eventos de Foundation/verify/invalidación dependen de capacidades backend pendientes**; por eso 4 se hace con fixtures **antes** de 6.

## 4. Qué conviene prototipar con fixtures antes del backend

Todo lo de la fase 4 del orden anterior, en particular:
- El **signo vital del verify-loop** (estados fixture: fail→repair→pass).
- El **énfasis de wavefront** (olas paralelas).
- El **canal de decisiones tipado** (los cinco `kind`).
- La **superficie phase-adaptive** (transición de énfasis sin navegar).
- La **invalidación / blast radius / re-ejecución parcial** (con `golden-seam-amendment-blast-radius`).

Esto valida la experiencia completa —incluida la más sutil— sin comprometer una línea de backend nuevo.

## 5. Qué NO debe implementarse todavía

- **El agente scaffolder de Foundation** (decisión de generalidad tomada, pero implementación pendiente; primero el contrato de eventos y la UI con fixtures).
- **El diagnóstico backend de conflictos** (cross-seam vs defecto latente) — capacidad no trivial; la UI ya puede consumir `conflict.detected` de fixtures.
- **Eventos v2** (cherry-pick por hijo, `node.cli.output`, `integration.diagnosis.started`, `plan.node.thinking`) — no bloquean demo.
- **Cualquier lógica nueva sobre `nodeStatusOverrides` o las vistas pares** — son adaptadores/legacy a retirar, no a expandir.

## 6. Riesgos

### Técnicos
- **Reintroducir estado visual local** (la clase `nodeStatusOverrides`). Mitigación: invariante dura — estado de nodo siempre derivado; la UI consume selectores, nunca `execution` directo.
- **Doble fuente de verdad** entre snapshot materializado y log. Mitigación: el snapshot es fold cacheado, no editable.
- **`builtAgainst` ausente o incompleto** → invalidación no derivable. Mitigación: es invariante de los eventos de éxito; testear con `golden-seam-amendment-blast-radius`.
- **Dependencia de capacidades backend inexistentes** (grounding, verify real). Mitigación: contrato de eventos primero; fixtures cubren la UI; el backend se conecta después vía el adapter.

### UX
- **Sobreingeniería del wavefront/motion** antes de que el backend emita los datos. Mitigación: prototipar con fixtures, no pulir motion sobre datos que aún no existen.
- **El canal de decisiones percibido como nag.** Mitigación: vacío = éxito; distinción bloqueante/advisory.
- **Obsoleto confundido con fallo.** Mitigación: `selectRenderableNodeState` + tratamiento visual distinto (invariante de producto).

### Alcance
- **Querer backend y UI a la vez.** Mitigación: fixtures-first desacopla; la demo v1 no necesita el backend nuevo completo.
- **Expandir features sobre el diseño viejo** mientras se construye el nuevo. Mitigación: congelar lo legacy; no construir lógica nueva sobre adaptadores.

## 7. Criterios para pasar al plan de implementación detallado

Se pasa al plan cuando:
1. Los **6 documentos de diseño** están revisados y aceptados como fuente de verdad.
2. El **contrato de `RunEvent` v1** está cerrado (familias, payloads mínimos, qué es v1/v2).
3. Los **5 fixtures golden** tienen sus assertions de reducer y de UI especificadas (ver [`golden-fixtures.md`](golden-fixtures.md)).
4. Está claro qué es **prototipo con fixtures** y qué requiere **backend nuevo** (separación de la §3–§5).
5. No quedan **decisiones congeladas en disputa** (las abiertas están explícitamente marcadas como abiertas y no bloquean v1).

Estado actual: **1–5 sustancialmente cumplidos.** Listo para escribir el plan.

---

## Próximo documento a escribir

**Plan incremental de implementación por PRs.**

(No se escribe todavía: este documento solo establece la preparación. El plan se redactará como paso siguiente, tomando estos seis documentos como fuente de verdad.)
