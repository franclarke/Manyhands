# Scheduler y waves

## Readiness

Un leaf está ready si:

- pertenece a la graph revision aprobada;
- no está pausado, cancelled ni cubierto por decisión pendiente;
- todos sus ArtifactRequirements resuelven artifacts fresh;
- seams requeridos tienen baseline compatible;
- puede construirse execution base;
- no existe resource/conflict constraint activa;
- existe presupuesto de executor y validación.

Un composite está ready para integración cuando sus child artifacts obligatorios
están verified/fresh y el contrato del parent es vigente.

## Wave selection

La wave maximiza trabajo útil bajo restricciones. No maximiza cantidad de nodos.

Inputs:

- ready set y razones de bloqueo;
- effective parallel budget por executor/recurso;
- risk/conflict constraints;
- prioridades y critical path;
- costo estimado y fairness;
- estado de circuit breakers.

Output durable:

```ts
type WaveSelection = {
  waveId: string;
  graphRevision: number;
  readyNodeIds: NodeId[];
  selectedNodeIds: NodeId[];
  blocked: { nodeId: NodeId; reasons: string[] }[];
  effectiveBudget: Record<string, number>;
  riskSummary: string[];
};
```

Se persiste antes del dispatch. Si no puede registrarse, no se despacha la wave.

## Política

Default objetivo: `risk_aware`. El paralelismo máximo proviene de configuración
normalizada y capacidades reales; no es una constante universal.

Unknown data produce warnings y serialización conservadora cuando el riesgo no
puede acotarse. Una relación seam compatible no aumenta riesgo por sí sola.

## Decisions y pause

Pending decisions eliminan solo affected nodes del ready set. Pause branch usa
parentage + requirements para determinar alcance, sin bloquear siblings
independientes.

## Reproducibilidad

La selección debe poder recalcularse desde graph revision, artifact registry,
decisions, config y constraints del mismo cursor. Heurísticas no deterministas
registran seed/model output o su decisión completa.
