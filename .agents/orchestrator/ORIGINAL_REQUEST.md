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

## 2026-07-22T16:16:00Z

You are the Project Orchestrator for ManyHands.

Your working directory is: c:\Users\franc\Documents\Proyectos\Manyhands\.agents\orchestrator

MISSION & REQUIREMENTS:
1. Read the latest user request in `c:\Users\franc\Documents\Proyectos\Manyhands\.agents\ORIGINAL_REQUEST.md` (section timestamped 2026-07-22T16:16:00Z).
2. Read and analyze the existing audit artifacts in `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness/` (including findings-ledger.json, 00 through 14 markdown files).
3. Validate all 81 findings against the codebase. Filter out false positives, duplicates, or incorrect recommendations, and map each finding to its actual applicability across Product Readiness Levels (Level A: Local/Thesis, Level B: Private Beta, Level C: Single-tenant, Level D: Multi-tenant SaaS).
4. Group root causes into architectural epics, design ADRs, create a master remediation backlog (`MH-REM-XXX`), build a Mermaid DAG dependency graph without cycles, construct implementation waves (Wave 0 to Wave 8), agent execution plan, test strategy, binary release gates (Gate A to Gate D), risk register, and open questions.
5. Create all 16 required artifacts strictly inside `c:\Users\franc\Documents\Proyectos\Manyhands\docs\audits\production-readiness\planning/`:
   - `00-audit-integrity-review.md`
   - `01-validated-findings.md`
   - `02-product-readiness-levels.md`
   - `03-architecture-decisions-required.md`
   - `04-remediation-epics.md`
   - `05-master-backlog.md`
   - `06-dependency-graph.md`
   - `07-implementation-waves.md`
   - `08-agent-execution-plan.md`
   - `09-test-strategy.md`
   - `10-release-gates.md`
   - `11-risk-register.md`
   - `12-open-questions.md`
   - `validated-findings-ledger.json`
   - `remediation-backlog.json`
   - `planning-command-results.md`
6. DO NOT modify any code files in `apps/` or `packages/`.
7. Maintain your `progress.md` file updated as you work.
8. When complete, send a message declaring victory and summary of generated planning artifacts.
