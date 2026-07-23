# PROMPT 3/4 — MOTOR DE DESCOMPOSICIÓN ADAPTATIVA DE GRANULARIDAD (DECOMPOSER V3)

Copiar y ejecutar en el **Agente 3 (Codex en modo `/goal`)**.

---

```markdown
# AGENTE 3: INSTRUCCIÓN /GOAL — ADAPTIVE GRANULARITY DECOMPOSER ENGINE V3

Actúa como **Principal AI & Graph Compiler Engineer** responsable de implementar el nuevo motor de descomposición adaptativa de granularidad en `packages/decomposer`.

---

## 1. ALCANCE Y LÍMITES DE RESPONSABILIDAD (EXCLUSIVO)

Tus modificaciones están **estrictamente limitadas** al paquete:
- `packages/decomposer/*`
- `tests/decomposer-adaptive-granularity.test.ts`

Lee la especificación arquitectónica en:
`docs/core-pillars/01-decomposer-engine.md`

**PROHIBIDO MODIFICAR**: `apps/web/*`, `packages/run-store/*`, `packages/repository-index/*`. (Estos paquetes están siendo trabajados por otros agentes en paralelo).

---

## 2. COMPONENTES A IMPLEMENTAR

### 2.1 Evaluador de Complejidad Intrínseca (`packages/decomposer/src/granularity/complexity-evaluator.ts`)
Implementa el cálculo del Índice de Complejidad Intrínseca ($C_{task}$) evaluando Scope Radius ($S_r$), Interface Impact ($I_i$), Validation Surface ($V_s$) y Context Token Mass ($T_m$).
- Si $C_{task} \le 3.5$: Marca la tarea como `isLeaf: true` y detiene la división de inmediato.
- Si $C_{task} > 3.5$: Marca la tarea como `CompositeNode` y calcula el factor de ramificación recomendado ($k^* \in [2, 5]$).

### 2.2 Coalescing & Re-splitting Critics (`packages/decomposer/src/granularity/coalescing-critic.ts`)
- **Over-splitting Critic**: Si el Architect propone sub-tareas triviales que modifican el mismo archivo o directorio pequeño sin dependencias cruzadas, el critic las **fusiona** en una sola hoja.
- **Under-splitting Critic**: Si se propone una hoja con `ScopeRadius` excesivo (> 3 módulos), el critic exige sub-división.

### 2.3 Compresor de Contexto (`packages/decomposer/src/context-compressor.ts`)
- **Tree Summarization por Scope**: Envia al agente CLI únicamente el sub-árbol de archivos declarado en el `ScopeContract`.
- **Interface Signature Extractor**: Extrae solo tipos y firmas exportadas (`type`, `interface`, `function`) omitiendo cuerpos de código.
- **Fingerprinting**: Asigna hash SHA-256 (`InputFingerprint`) a las entradas para reutilizar caché inmutable.

### 2.4 Colector de Métricas para la Tesis (`packages/decomposer/src/granularity/thesis-metrics.ts`)
Persiste en cada run el Granularity Efficiency Index ($GEI$), profundidad máxima del grafo, factor de ramificación promedio y tasa de éxito por nivel de complejidad.

---

## 3. METODOLOGÍA DE VERIFICACIÓN

Crea `tests/decomposer-adaptive-granularity.test.ts` evaluando:
1. Tarea simple ("corregir typo") $\rightarrow$ 1 hoja directa.
2. Tarea compleja ("módulo completo") $\rightarrow$ división adaptativa en sub-composites.
3. Sub-tareas triviales $\rightarrow$ fusionadas por el Coalescing Critic.

Ejecuta:
```bash
npx vitest run tests/decomposer-adaptive-granularity.test.ts tests/decomposer-recursive.test.ts
pnpm --filter "@manyhands/decomposer" typecheck
pnpm --filter "@manyhands/decomposer" build
```
```
