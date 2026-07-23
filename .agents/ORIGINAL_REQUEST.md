# Original User Request

## 2026-07-22T02:47:31Z

# AUDITORÍA INTEGRAL DE PREPARACIÓN PARA PRODUCCIÓN — MANYHANDS

Actúa como un **Consejo de Revisión de Ingeniería Principal** encargado de realizar una auditoría técnica exhaustiva y adversarial del repositorio **ManyHands**.

Working directory: c:\Users\franc\Documents\Proyectos\Manyhands
Integrity mode: development

---

## 1. REGLAS FUNDAMENTALES DE LA AUDITORÍA
- **Evidencia antes que opinión**: Todo hallazgo respaldado por archivo, líneas, símbolo, flujo o test. Usar etiquetas **Confirmado**, **Probable**, **Hipótesis**.
- **No asumir la arquitectura**: Inspeccionar el monorepo y construir inventario real contra `PRODUCT.md` y `docs/system/`.
- **No modificar el repositorio**: Auditoría exclusivamente en lectura sobre código funcional. Generar artefactos documentales únicamente en `docs/audits/production-readiness/`.
- **No confiar únicamente en tests existentes**: Verificar invariantes de forma independiente.

---

## 2. ESTRATEGIA DE EJECUCIÓN MULTIAGENTE & COBERTURA
Divide la auditoría entre especialistas (Cartografía, Seguridad Host, Orquestación/Scheduler, Git/Worktrees, Persistencia/Recovery, APIs/SSE, Frontend/UX, Seguridad IA/Costos, Infra/Supply Chain, QA/Observabilidad, Rendimiento) y un Revisor Adversarial Final.

---

## 3. ARTEFACTOS OBLIGATORIOS A GENERAR
Crear la estructura completa en `docs/audits/production-readiness/`:
- `00-executive-summary.md`
- `01-system-map.md`
- `02-critical-invariants.md`
- `03-findings.md`
- `04-security-review.md`
- `05-orchestration-concurrency-review.md`
- `06-git-worktree-review.md`
- `07-persistence-recovery-review.md`
- `08-api-frontend-review.md`
- `09-ai-security-cost-review.md`
- `10-infrastructure-supply-chain-review.md`
- `11-testing-observability-review.md`
- `12-scalability-assessment.md`
- `13-missing-systems.md`
- `14-remediation-plan.md`
- `findings-ledger.json`
- `coverage-ledger.json`
- `command-results.md`

---

## Acceptance Criteria
- [ ] Mapeo del 100% de los paquetes y aplicaciones en `coverage-ledger.json`.
- [ ] Evaluación exhaustiva de invariantes en DAG, leases, git worktrees, escrituras atómicas, prompt injections y presupuestos LLM.
- [ ] Registro de hallazgos P0/P1/P2/P3 con ID `MH-AUDIT-XXX` en `findings-ledger.json` con pruebas de regresión propuestas y solución detallada.
- [ ] Veredicto claro de preparación para producción con scorecard y plan de remediación de 30 días.
- [ ] Cero modificaciones en código fuente de `apps/` y `packages/`.
56: 
57: ## 2026-07-22T16:16:00Z
58: 
59: # PLANIFICACIÓN MAESTRA DE REMEDIACIÓN Y DESARROLLO — MANYHANDS
60: 
61: Actúa como **Principal Software Architect, Technical Program Manager y Staff Engineer responsable de ManyHands**.
62: 
63: Working directory: c:\Users\franc\Documents\Proyectos\Manyhands
64: Integrity mode: development
65: 
66: Entrada: auditoría existente en `docs/audits/production-readiness/`.
67: 
68: ---
69: 
70: ## 1. OBJETIVOS DE ESTA FASE
71: 1. Verificar la integridad y exactitud de la auditoría (`docs/audits/production-readiness/`).
72: 2. Validar cada hallazgo contra el repositorio actual.
73: 3. Eliminar falsos positivos, duplicados y recomendaciones incorrectas.
74: 4. Decidir qué riesgos son relevantes para el producto real (Nivel A: Local/Tesis, Nivel B: Beta privada, Nivel C: Single-tenant, Nivel D: Multi-tenant SaaS).
75: 5. Agrupar los hallazgos por causa raíz en epics arquitectónicos.
76: 6. Diseñar la arquitectura de las soluciones (ADRs).
77: 7. Crear un máster backlog ejecutable (`MH-REM-XXX`).
78: 8. Construir un roadmap de implementación optimizado para agentes por olas (Ola 0 a Ola 8).
79: 9. Definir pruebas, gates (Gate A a Gate D) y criterios de aceptación.
80: 10. Determinar el orden seguro y el grafo DAG de dependencias.
81: 
82: ---
83: 
84: ## 2. RESTRICCIONES
85: - No modificar código funcional en `apps/` ni `packages/`.
86: - Crear únicamente documentación y ledgers estructurados en `docs/audits/production-readiness/planning/`.
87: 
88: ---
89: 
90: ## 3. ARTEFACTOS OBLIGATORIOS A GENERAR
91: Estructura completa en `docs/audits/production-readiness/planning/`:
92: - `00-audit-integrity-review.md`
93: - `01-validated-findings.md`
94: - `02-product-readiness-levels.md`
95: - `03-architecture-decisions-required.md`
96: - `04-remediation-epics.md`
97: - `05-master-backlog.md`
98: - `06-dependency-graph.md`
99: - `07-implementation-waves.md`
100: - `08-agent-execution-plan.md`
101: - `09-test-strategy.md`
102: - `10-release-gates.md`
103: - `11-risk-register.md`
104: - `12-open-questions.md`
105: - `validated-findings-ledger.json`
106: - `remediation-backlog.json`
107: - `planning-command-results.md`
108: 
109: ---
110: 
111: ## Acceptance Criteria
112: - [ ] Reconciliación 100% de los 81 hallazgos previos en `validated-findings-ledger.json`.
113: - [ ] Tareas de remediación estandarizadas (`MH-REM-XXX`) en `remediation-backlog.json` con esquema JSON completo, DoD, rollback y pruebas requeridas.
114: - [ ] Diagrama Mermaid del DAG de dependencias de tareas sin ciclos y camino crítico identificado.
115: - [ ] Definición de release gates binarios (Gate A a Gate D) e itinerario por olas de implementación (Ola 0 a Ola 8).
116: - [ ] Cero modificaciones en código fuente de `apps/` y `packages/`.
117: 
118: ## 2026-07-22T16:18:14Z
119: 
120: ACLARACIÓN DE ALCANCE CRÍTICA Y OBLIGATORIA DEL USUARIO:
121: ManyHands debe finalizar como una APLICACIÓN LOCAL, SINGLE-USER Y SELF-HOSTED (corriendo en localhost).
122: NO será un SaaS, servicio público ni plataforma multi-tenant.
123: 
124: Ajustes estrictos que deben aplicarse a toda la planificación y ledgers en `docs/audits/production-readiness/planning/`:
125: 1. TODO hallazgo o requisito relacionado exclusivamente con SaaS, multi-tenancy, autenticación multiusuario (OAuth/SSO), billing, RBAC o K8s DEBE etiquetarse como `OUT_OF_SCOPE_SAAS` y NO debe incluirse en bloqueadores, camino crítico, score de producción, ni plan de remediación.
126: 2. Modelo de Amenazas: El usuario local es confiable. Sin embargo, repositorios clonados, nombres de archivo, symlinks, git hooks, scripts, dependencias, prompt injections, respuestas LLM y comandos propuestos por agentes NO SON CONFIABLES y deben ser estrictamente aislados y validados.
127: 3. API Web: Exclusivamente bound a `127.0.0.1` / `::1` con protección contra CSRF/Origin y confirmación local.
128: 4. Niveles de Preparación Redefinidos:
129:    - Nivel A: Desarrollo y defensa de tesis (ejecución sin riesgo para workspace del desarrollador).
130:    - Nivel B: Uso local seguro (protección del host, aislamiento, límites y cancelación).
131:    - Nivel C: Beta local confiable (runs prolongados, crash recovery durable, observabilidad local).
132:    - Nivel D: Producto local terminado (Final Goal — clonar, instalar `pnpm`, configurar credenciales y operar localmente de forma confiable).
133: 5. Clasificación de hallazgos en ledgers: `BLOCKER_LOCAL_PRODUCT`, `REQUIRED_FOR_LOCAL_RELIABILITY`, `LOCAL_HARDENING`, `OPTIONAL_IMPROVEMENT`, `OUT_OF_SCOPE_SAAS`, `FALSE_POSITIVE_FOR_LOCAL_MODEL`.
134: 
135: Aplica esta directiva en todos los 16 artefactos y esquemas JSON que estás generando.

## 2026-07-22T16:54:54Z

# NORMALIZACIÓN DEL PLAN E INICIO CONTROLADO DE IMPLEMENTACIÓN — MANYHANDS

Actúa como **Principal Engineer, Release Manager y Orquestador Técnico de ManyHands**.

Working directory: c:\Users\franc\Documents\Proyectos\Manyhands
Integrity mode: development

---

# FASE A — CONSTRUIR UNA FUENTE ÚNICA DE VERDAD Y CONSISTENCY GATE
1. Reconciliar todos los artefactos de `docs/audits/production-readiness/planning/` convirtiendo `remediation-backlog.json` en la ÚNICA fuente canónica de verdad.
2. Corregir colisiones de IDs (`MH-REM-*`), diferencias en olas, tareas duplicadas, y estados de ADRs (`APPROVED`, `PROPOSED`, `REJECTED`, `DEFERRED`, `SUPERSEDED`).
3. Generar `remediation-id-migration.json` mapeando referencias antiguas a IDs canónicos únicos.
4. Recalcular el DAG de dependencias, las Olas (Ola 0 a Ola 8) y los Release Gates.
5. Crear y ejecutar el script `scripts/validate-remediation-plan.ts` que valide:
   - Unique IDs: PASS
   - References: PASS
   - Dependency DAG: PASS
   - Findings mapping: PASS
   - Wave mapping: PASS
   - Gate mapping: PASS
   - ADR status: PASS
   Resultado requerido: `PLANNING CONSISTENCY GATE: PASS`.

---

# FASE B — IMPLEMENTACIÓN DE LA OLA 0 (SÓLO SI CONSISTENCY GATE = PASS)
1. **MH-REM-001 (GroundingAgent Dirty Workspace Check)**: En `packages/execution-core/src/run/grounding-agent.ts`, comprobar `git status --porcelain` antes de escribir. Abortar si hay cambios no commiteados. Agregar tests en `grounding-agent-dirty-workspace.test.ts`.
2. **MH-REM-002 (Lock Ownership Fencing)**: En `packages/run-store/src/jsonl-event-store.ts`, agregar token único por adquisición (`pid`, `acquiredAt`, `token`). Liberar lock únicamente si el token coincide. Agregar tests en `run-store-lock-ownership-fencing.test.ts`.
3. **MH-REM-003 (Baseline UI Tests)**: Diagnosticar y corregir los 2 tests fallidos de la suite baseline con cambios mínimos y focalizados.

---

# VERIFICACIÓN FINAL
Ejecutar `pnpm test`, `pnpm typecheck` y `pnpm build` para asegurar 0 regresiones.

---

## Acceptance Criteria
- [ ] Script `scripts/validate-remediation-plan.ts` pasa con `PLANNING CONSISTENCY GATE: PASS`.
- [ ] `remediation-backlog.json` y `remediation-id-migration.json` guardados y 100% consistentes.
- [ ] Tarea MH-REM-001 implementada y testeada en verde.
- [ ] Tarea MH-REM-002 implementada y testeada en verde.
- [ ] Baseline de pruebas reparado y verde (`pnpm test` pasa sin fallos).
