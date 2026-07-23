# SUBSISTEMA 04 — COCKPIT VISUAL Y COLA DE DECISIONES NON-BLOCKING

> **Aplicación**: `apps/web`

---

## 1. COMPONENTES VISUALES Y MEDALLAS DE ESTADO

- **Tarjetas de Nodo (`task-node-v2.tsx`)**: Medallas para 5 estados (`Candidate`, `Verified`, `Failed`, `Stale`, `Delivered`).
- **Cola Flotante (`<DecisionQueueDrawer />`)**: Visualiza decisiones pendientes en paralelo. Permite usar `<SideBySideDiffViewer />` para comparar código antes de aprobar.
- **Aristas Interactivas (`InteractiveRelationEdge.tsx`)**: Destaca relaciones de contratos de interfaz (`SeamBinding`) y abre el modal inspector.
- **Regla Inviolable de UI**: Prohibición estricta de recentrado o cambio de zoom automático del canvas (`fitView` desactivado). Cumplimiento de WCAG 2.2 AA y `prefers-reduced-motion`.
