# PROMPT 2/4 — COCKPIT VISUAL UI, MEDALLAS DE ESTADO Y COLA DE DECISIONES

Copiar y ejecutar en el **Agente 2 (Codex en modo `/goal`)**.

---

```markdown
# AGENTE 2: INSTRUCCIÓN /GOAL — COCKPIT VISUAL UI & DECISION QUEUE ENGINE

Actúa como **Principal Frontend Architect y UI/UX Specialist** responsable de implementar la suite visual del Cockpit de ManyHands en `apps/web`.

---

## 1. ALCANCE Y LÍMITES DE RESPONSABILIDAD (EXCLUSIVO)

Tus modificaciones están **estrictamente limitadas** a los siguientes directorios:
- `apps/web/src/app/runs/[runId]/_components/*`
- `apps/web/src/lib/server/runs/*`
- `tests/cockpit-decision-queue.test.ts`

**PROHIBIDO MODIFICAR**: `packages/decomposer/*`, `packages/run-store/*`, `packages/repository-index/*`. (Estos paquetes están siendo modificados en paralelo por otros agentes).

---

## 2. COMPONENTES Y REQUISITOS A IMPLEMENTAR

### 2.1 Medallas de Ciclo de Vida en Nodos (`task-node-v2.tsx`)
Renderiza tarjetas de nodo en el grafo con 5 estados visuales bien diferenciados:
- 🟡 **Candidate**: Borde amarillo intermitente + badge `"Candidate [commit_sha]"`. Muestra candidato no verificado.
- 🟢 **Verified**: Borde verde + badge `"Verified [X/Y passed]"`.
- 🔴 **Failed**: Borde rojo + indicador del motivo de fallo.
- ⚪ **Stale**: Borde gris punteado.
- 🟣 **Delivered**: Estado final integrado.

### 2.2 Cola Flotante de Decisiones Non-Blocking (`DecisionQueueDrawer.tsx`)
- Drawer flotante lateral + tarjetas de decisión sobre los nodos afectados.
- Modal accesible (WCAG 2.2 AA) con tabulación por teclado.
- Integración de `SideBySideDiffViewer.tsx` para comparar el diff del candidato propuesto por el agente antes de aprobar.
- Las decisiones pendientes **solo pausan los nodos descendientes afectados**. Toda rama independiente sigue ejecutándose.

### 2.3 Inspector Interactivo de Aristas y Seams (`InteractiveRelationEdge.tsx`)
- Destaca visualmente el tipo de relación (`ArtifactRequirement`, `SeamBinding`, `ConflictConstraint`).
- Al hacer clic, abre un modal inspector (`SeamContractInspector.tsx`) mostrando las firmas exportadas/importadas y revisiones de contrato.

### 2.4 Reglas Inviolables de UI
- **Prohibido `fitView` Automático**: El canvas NUNCA se recentra ni cambia zoom al recibir eventos del run.
- **Reduced Motion**: Respetar la preferencia `prefers-reduced-motion`.

---

## 3. METODOLOGÍA DE VERIFICACIÓN

Al finalizar:
```bash
npx vitest run tests/cockpit-decision-queue.test.ts tests/cockpit-layout.test.ts
pnpm --filter @manyhands/web exec tsc --noEmit
pnpm --filter @manyhands/web build
```
```
