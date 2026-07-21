# Diseño de la demo de recuperación de contraseña

> Estado: implementado el 2026-07-18.

## Decisión

La suite de Proto se reduce a un único run diseñado para una demostración
técnica breve. Se elige recuperación de contraseña porque el dominio es
universal, permite un corte full-stack realista y hace visibles las propiedades
centrales de ManyHands sin una explicación previa del negocio.

El escenario comienza sobre un portal existente con Next.js, Node.js,
PostgreSQL, sesiones persistidas y email transaccional. El grafo conserva tres
límites de integración: seguridad, servidor y experiencia. Las seis hojas son
unidades verificables y no una plantilla frontend/backend uniforme.

## Flujo y estado

El fixture emite el mismo envelope de eventos que el stream productivo. La UI
reconstruye cada cursor con `buildRunModel(seed, events.slice(0, cursor))`; el
reproductor controla únicamente el cursor y nunca altera estados de dominio.

Nueve hitos referencian índices del journal. La navegación directa, por evento
o por hito pausa el autoplay antes de mover el cursor. Esto permite retroceder
durante una explicación sin carreras entre el operador y el temporizador.

## Riesgos y mitigaciones

- **Demo demasiado compleja:** un solo caso conocido y nueve hitos con copy
  explicativo.
- **Éxito superficial:** el run incluye fallo reproducible, reparación, decisión,
  integración, Evidence Matrix y delivery receipt.
- **Fixture confundido con backend real:** Proto y la documentación declaran
  explícitamente que la reproducción es simulada.
- **Navegación inconsistente:** helpers puros fijan límites y selección de hitos;
  todos los prefijos del journal tienen regresión.

## Verificación

- test del catálogo y del resultado final;
- reducción de todos los prefijos de eventos;
- tests unitarios de navegación bidireccional y saltos de hito;
- typecheck de la aplicación web;
- inspección de la ruta real en navegador.
